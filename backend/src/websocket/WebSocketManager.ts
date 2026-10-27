import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import type { ZodType } from 'zod';
import {
  AgentMessageAddSchema,
  AgentPositionUpdateSchema,
  AgentToggleMinimizeSchema,
  UserCursorUpdateSchema,
  WorkspaceJoinSchema,
  WorkspaceLeaveSchema,
} from '../domain/workflow/workspaceCollaboration.contract';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { verifyAccessToken } from '../utils/jwt';

// Types pour les événements WebSocket
interface ClientToServerEvents {
  // Synchronisation des agents
  'agent:position:update': (data: { nodeId: string; position: { x: number; y: number } }) => void;
  'agent:message:add': (data: { nodeId: string; message: any }) => void;
  'agent:toggle:minimize': (data: { nodeId: string }) => void;
  
  // Gestion des rooms/workspaces
  'workspace:join': (workspaceId: string) => void;
  'workspace:leave': (workspaceId: string) => void;
  
  // Présence utilisateur
  'user:cursor:update': (data: { x: number; y: number; userId: string }) => void;
}

interface ServerToClientEvents {
  // Synchronisation des agents
  'agent:position:updated': (data: { nodeId: string; position: { x: number; y: number }; userId: string }) => void;
  'agent:message:added': (data: { nodeId: string; message: any; userId: string }) => void;
  'agent:toggle:minimized': (data: { nodeId: string; userId: string }) => void;
  
  // Feedback utilisateur
  'workspace:user:joined': (data: { userId: string; userInfo: any }) => void;
  'workspace:user:left': (data: { userId: string }) => void;
  'user:cursor:updated': (data: { x: number; y: number; userId: string }) => void;
  
  // État de connexion
  'connection:status': (status: 'connected' | 'disconnected' | 'error') => void;
}

interface InterServerEvents {
  ping: () => void;
}

interface SocketData {
  userId: string;
  role?: string;
  isAuthenticated: boolean;
  workspaceId?: string;
  userInfo?: {
    name: string;
    color: string;
  };
}

type WorkspaceSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export class WebSocketManager {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private connectedUsers: Map<string, Set<string>> = new Map(); // workspaceId -> Set<userId>

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) {
            callback(null, true);
            return;
          }
          const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
          const isProduction = process.env.NODE_ENV === 'production';
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
          
          if (isProduction) {
            if (origin === frontendUrl) {
              callback(null, true);
            } else {
              callback(new Error('Not allowed by CORS'));
            }
          } else {
            if (isLocalhost) {
              callback(null, true);
            } else {
              callback(new Error('Not allowed by CORS'));
            }
          }
        },
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.io.use((socket, next) => {
      void this.authenticateSocket(socket)
        .then(() => next())
        .catch((error) => {
          next(error instanceof Error ? error : new Error('Socket authentication failed'));
        });
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[WebSocket] Client connecté: ${socket.id}`);
      
      // Envoyer confirmation de connexion
      socket.emit('connection:status', 'connected');

      // === GESTION DES WORKSPACES ===
      socket.on('workspace:join', (workspaceId) => {
        void this.handleWorkspaceJoin(socket, workspaceId);
      });

      socket.on('workspace:leave', (workspaceId) => {
        this.handleWorkspaceLeave(socket, workspaceId);
      });

      // === SYNCHRONISATION AGENTS ===
      socket.on('agent:position:update', (data) => {
        this.handleValidatedWorkspaceEvent(socket, 'agent:position:update', data, AgentPositionUpdateSchema, (payload) => {
          this.broadcastToWorkspace(socket, 'agent:position:updated', {
            ...payload,
            userId: socket.data.userId
          });
        });
      });

      socket.on('agent:message:add', (data) => {
        this.handleValidatedWorkspaceEvent(socket, 'agent:message:add', data, AgentMessageAddSchema, (payload) => {
          this.broadcastToWorkspace(socket, 'agent:message:added', {
            ...payload,
            userId: socket.data.userId
          });
        });
      });

      socket.on('agent:toggle:minimize', (data) => {
        this.handleValidatedWorkspaceEvent(socket, 'agent:toggle:minimize', data, AgentToggleMinimizeSchema, (payload) => {
          this.broadcastToWorkspace(socket, 'agent:toggle:minimized', {
            ...payload,
            userId: socket.data.userId
          });
        });
      });

      // === CURSEUR UTILISATEUR ===
      socket.on('user:cursor:update', (data) => {
        this.handleValidatedWorkspaceEvent(socket, 'user:cursor:update', data, UserCursorUpdateSchema, (payload) => {
          this.broadcastToWorkspace(socket, 'user:cursor:updated', {
            x: payload.x,
            y: payload.y,
            userId: socket.data.userId
          });
        });
      });

      // === DÉCONNEXION ===
      socket.on('disconnect', () => {
        console.log(`[WebSocket] Client déconnecté: ${socket.id}`);
        this.handleDisconnect(socket);
      });
    });
  }

  private async authenticateSocket(socket: WorkspaceSocket): Promise<void> {
    const token = this.extractHandshakeToken(socket);

    if (!token) {
      socket.data.userId = `guest:${socket.id}`;
      socket.data.isAuthenticated = false;
      socket.data.userInfo = {
        name: 'guest',
        color: this.generateUserColor(socket.id)
      };
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new Error('Socket authentication failed');
    }

    const user = await User.findById(payload.sub).select('_id email username role isActive').lean();
    if (!user || !user.isActive) {
      throw new Error('Socket authentication failed');
    }

    socket.data.userId = user._id.toString();
    socket.data.role = user.role;
    socket.data.isAuthenticated = true;
    socket.data.userInfo = {
      name: typeof user.username === 'string' && user.username.trim().length > 0 ? user.username : user.email,
      color: this.generateUserColor(user._id.toString())
    };
  }

  private extractHandshakeToken(socket: WorkspaceSocket): string | null {
    const authToken = typeof socket.handshake.auth?.token === 'string'
      ? socket.handshake.auth.token.trim()
      : '';

    if (authToken) {
      return authToken;
    }

    const authorizationHeader = socket.handshake.headers.authorization;
    if (typeof authorizationHeader === 'string' && authorizationHeader.startsWith('Bearer ')) {
      const bearerToken = authorizationHeader.slice('Bearer '.length).trim();
      return bearerToken || null;
    }

    return null;
  }

  private async handleWorkspaceJoin(socket: WorkspaceSocket, workspaceId: string) {
    const workspaceParseResult = WorkspaceJoinSchema.safeParse(workspaceId);
    if (!workspaceParseResult.success) {
      this.denySocketAction(socket, 'workspace:join', 'invalid_workspace_id');
      return;
    }

    if (!socket.data.isAuthenticated) {
      this.denySocketAction(socket, 'workspace:join', 'auth_required');
      return;
    }

    const canAccessWorkspace = await Workflow.exists({
      _id: workspaceParseResult.data,
      userId: socket.data.userId,
    });

    if (!canAccessWorkspace) {
      this.denySocketAction(socket, 'workspace:join', 'workspace_forbidden', {
        workspaceId: workspaceParseResult.data,
      });
      return;
    }

    // Quitter l'ancien workspace si nécessaire
    if (socket.data.workspaceId) {
      this.handleWorkspaceLeave(socket, socket.data.workspaceId);
    }

    // Rejoindre le nouveau workspace
    socket.join(workspaceId);
    socket.data.workspaceId = workspaceId;
    
    // Ajouter à la liste des utilisateurs connectés
    if (!this.connectedUsers.has(workspaceId)) {
      this.connectedUsers.set(workspaceId, new Set());
    }
    this.connectedUsers.get(workspaceId)!.add(socket.data.userId);

    // Notifier les autres utilisateurs
    socket.to(workspaceId).emit('workspace:user:joined', {
      userId: socket.data.userId,
      userInfo: socket.data.userInfo || { name: socket.data.userId, color: this.generateUserColor(socket.data.userId) }
    });

    console.log(`[WebSocket] User ${socket.data.userId} rejoint workspace ${workspaceId}`);
  }

  private handleWorkspaceLeave(socket: WorkspaceSocket, workspaceId: string) {
    const workspaceParseResult = WorkspaceLeaveSchema.safeParse(workspaceId);
    if (!workspaceParseResult.success) {
      this.denySocketAction(socket, 'workspace:leave', 'invalid_workspace_id');
      return;
    }

    socket.leave(workspaceId);
    
    // Retirer de la liste des utilisateurs connectés
    if (this.connectedUsers.has(workspaceId)) {
      this.connectedUsers.get(workspaceId)!.delete(socket.data.userId);
      if (this.connectedUsers.get(workspaceId)!.size === 0) {
        this.connectedUsers.delete(workspaceId);
      }
    }

    // Notifier les autres utilisateurs
    socket.to(workspaceId).emit('workspace:user:left', {
      userId: socket.data.userId
    });

    console.log(`[WebSocket] User ${socket.data.userId} quitte workspace ${workspaceId}`);
  }

  private handleDisconnect(socket: WorkspaceSocket) {
    if (socket.data.workspaceId) {
      this.handleWorkspaceLeave(socket, socket.data.workspaceId);
    }
  }

  private broadcastToWorkspace(socket: WorkspaceSocket, event: keyof ServerToClientEvents, data: any) {
    if (socket.data.workspaceId) {
      socket.to(socket.data.workspaceId).emit(event, data);
    }
  }

  private handleValidatedWorkspaceEvent<T>(
    socket: WorkspaceSocket,
    eventName: string,
    payload: unknown,
    schema: ZodType<T>,
    forward: (data: T) => void,
  ) {
    if (!this.ensureWorkspaceAccess(socket, eventName)) {
      return;
    }

    const parseResult = schema.safeParse(payload);
    if (!parseResult.success) {
      this.denySocketAction(socket, eventName, 'invalid_payload');
      return;
    }

    forward(parseResult.data);
  }

  private ensureWorkspaceAccess(socket: WorkspaceSocket, eventName: string): boolean {
    if (!socket.data.isAuthenticated) {
      this.denySocketAction(socket, eventName, 'auth_required');
      return false;
    }

    if (!socket.data.workspaceId) {
      this.denySocketAction(socket, eventName, 'workspace_required');
      return false;
    }

    return true;
  }

  private denySocketAction(
    socket: WorkspaceSocket,
    eventName: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ) {
    console.warn('[WebSocket][Denied]', {
      socketId: socket.id,
      eventName,
      reason,
      userId: socket.data.userId,
      isAuthenticated: socket.data.isAuthenticated,
      workspaceId: socket.data.workspaceId,
      ...metadata,
    });
    socket.emit('connection:status', 'error');
  }

  private generateUserColor(seed: string): string {
    const colors = ['#00ff88', '#ff6b00', '#0066ff', '#ff0066', '#66ff00', '#ff6600'];
    const hash = Array.from(seed).reduce((acc, character) => acc + character.charCodeAt(0), 0);
    return colors[Math.abs(hash) % colors.length];
  }

  // Méthodes publiques pour monitoring
  public getConnectedUsers(workspaceId: string): string[] {
    return Array.from(this.connectedUsers.get(workspaceId) || []);
  }

  public getActiveWorkspaces(): string[] {
    return Array.from(this.connectedUsers.keys());
  }

  public async close(): Promise<void> {
    this.connectedUsers.clear();
    await this.io.close();
  }
}