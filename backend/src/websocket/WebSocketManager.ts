import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

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
  workspaceId?: string;
  userInfo?: {
    name: string;
    color: string;
  };
}

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

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[WebSocket] Client connecté: ${socket.id}`);
      
      // Générer un userId temporaire (à améliorer avec auth)
      const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      socket.data.userId = userId;
      
      // Envoyer confirmation de connexion
      socket.emit('connection:status', 'connected');

      // === GESTION DES WORKSPACES ===
      socket.on('workspace:join', (workspaceId) => {
        this.handleWorkspaceJoin(socket, workspaceId);
      });

      socket.on('workspace:leave', (workspaceId) => {
        this.handleWorkspaceLeave(socket, workspaceId);
      });

      // === SYNCHRONISATION AGENTS ===
      socket.on('agent:position:update', (data) => {
        this.broadcastToWorkspace(socket, 'agent:position:updated', {
          ...data,
          userId: socket.data.userId
        });
      });

      socket.on('agent:message:add', (data) => {
        this.broadcastToWorkspace(socket, 'agent:message:added', {
          ...data,
          userId: socket.data.userId
        });
      });

      socket.on('agent:toggle:minimize', (data) => {
        this.broadcastToWorkspace(socket, 'agent:toggle:minimized', {
          ...data,
          userId: socket.data.userId
        });
      });

      // === CURSEUR UTILISATEUR ===
      socket.on('user:cursor:update', (data) => {
        this.broadcastToWorkspace(socket, 'user:cursor:updated', {
          ...data,
          userId: socket.data.userId
        });
      });

      // === DÉCONNEXION ===
      socket.on('disconnect', () => {
        console.log(`[WebSocket] Client déconnecté: ${socket.id}`);
        this.handleDisconnect(socket);
      });
    });
  }

  private handleWorkspaceJoin(socket: any, workspaceId: string) {
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
      userInfo: socket.data.userInfo || { name: socket.data.userId, color: this.generateUserColor() }
    });

    console.log(`[WebSocket] User ${socket.data.userId} rejoint workspace ${workspaceId}`);
  }

  private handleWorkspaceLeave(socket: any, workspaceId: string) {
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

  private handleDisconnect(socket: any) {
    if (socket.data.workspaceId) {
      this.handleWorkspaceLeave(socket, socket.data.workspaceId);
    }
  }

  private broadcastToWorkspace(socket: any, event: keyof ServerToClientEvents, data: any) {
    if (socket.data.workspaceId) {
      socket.to(socket.data.workspaceId).emit(event, data);
    }
  }

  private generateUserColor(): string {
    const colors = ['#00ff88', '#ff6b00', '#0066ff', '#ff0066', '#66ff00', '#ff6600'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // Méthodes publiques pour monitoring
  public getConnectedUsers(workspaceId: string): string[] {
    return Array.from(this.connectedUsers.get(workspaceId) || []);
  }

  public getActiveWorkspaces(): string[] {
    return Array.from(this.connectedUsers.keys());
  }
}