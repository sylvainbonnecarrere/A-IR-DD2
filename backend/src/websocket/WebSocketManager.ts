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
  WorkspaceRoomIdSchema,
  type AgentMessageAdd,
} from '../domain/workflow/workspaceCollaboration.contract';
import { RuntimeEventEnvelopeSchema, type RuntimeEventEnvelope } from '../domain/execution/runtimeEvent.contract';
import { Workflow } from '../models/Workflow.model';
import {
  verifySocketAccessToken,
  buildAuthenticatedSocketData,
  generateUserColor,
  type AuthenticatedSocketData,
} from '../middleware/socketAuth.middleware';

// Types pour les événements WebSocket
interface ClientToServerEvents {
  // Synchronisation des agents
  'agent:position:update': (data: { nodeId: string; position: { x: number; y: number } }) => void;
  'agent:message:add': (data: AgentMessageAdd) => void;
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
  'agent:message:added': (data: AgentMessageAdd & { userId: string }) => void;
  'agent:toggle:minimized': (data: { nodeId: string; userId: string }) => void;

  // Feedback utilisateur
  'workspace:user:joined': (data: { userId: string; userInfo: AuthenticatedSocketData['userInfo'] }) => void;
  'workspace:user:left': (data: { userId: string }) => void;
  'user:cursor:updated': (data: { x: number; y: number; userId: string }) => void;
  'runtime:event': (data: RuntimeEventEnvelope) => void;

  // État de connexion
  'connection:status': (status: 'connected' | 'disconnected' | 'error') => void;
}

interface InterServerEvents {
  ping: () => void;
}

/**
 * US-J7-12 — SocketData strictement authentifié.
 * `userId` provient exclusivement du JWT vérifié + base de données.
 * Aucun identifiant temporaire de session invite n'est possible.
 * Tout socket connecté est authentifié (deny by default au handshake).
 */
type SocketData = AuthenticatedSocketData;

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
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    // US-J7-12 — Authentification JWT stricte au handshake.
    // Toute connexion sans JWT valide est rejetée (deny by default).
    // Aucun userId temporaire n'est créé.
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
      console.debug(`[WebSocket] Client connecté: ${socket.id} (user: ${socket.data.userId})`);

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
            userId: socket.data.userId,
          });
        });
      });

      socket.on('agent:message:add', (data) => {
        this.handleValidatedWorkspaceEvent(socket, 'agent:message:add', data, AgentMessageAddSchema, (payload) => {
          this.broadcastToWorkspace(socket, 'agent:message:added', {
            ...payload,
            userId: socket.data.userId,
          });
        });
      });

      socket.on('agent:toggle:minimize', (data) => {
        this.handleValidatedWorkspaceEvent(socket, 'agent:toggle:minimize', data, AgentToggleMinimizeSchema, (payload) => {
          this.broadcastToWorkspace(socket, 'agent:toggle:minimized', {
            ...payload,
            userId: socket.data.userId,
          });
        });
      });

      // === CURSEUR UTILISATEUR ===
      socket.on('user:cursor:update', (data) => {
        this.handleValidatedWorkspaceEvent(socket, 'user:cursor:update', data, UserCursorUpdateSchema, (payload) => {
          this.broadcastToWorkspace(socket, 'user:cursor:updated', {
            x: payload.x,
            y: payload.y,
            userId: socket.data.userId,
          });
        });
      });

      // === DÉCONNEXION ===
      socket.on('disconnect', () => {
        console.debug(`[WebSocket] Client déconnecté: ${socket.id} (user: ${socket.data.userId})`);
        this.handleDisconnect(socket);
      });
    });
  }

  /**
   * US-J7-12 — Authentification JWT stricte.
   * Rejette la connexion si le token est absent, invalide, ou si l'utilisateur
   * est introuvable/inactif. Ne crée JAMAIS d'identité temporaire.
   */
  private async authenticateSocket(socket: WorkspaceSocket): Promise<void> {
    const result = await verifySocketAccessToken(socket);
    const socketData = buildAuthenticatedSocketData(result);
    socket.data.userId = socketData.userId;
    socket.data.role = socketData.role;
    socket.data.userInfo = socketData.userInfo;
  }

  /**
   * US-J7-12 — Vérifie qu'un utilisateur authentifié est bien propriétaire
   * du workspace avant toute exposition d'état runtime ou join de room.
   */
  private async hasWorkspaceOwnership(userId: string, workspaceId: string): Promise<boolean> {
    const exists = await Workflow.exists({
      _id: workspaceId,
      userId: userId,
    });
    return exists !== null;
  }

  private async handleWorkspaceJoin(socket: WorkspaceSocket, workspaceId: string) {
    const workspaceParseResult = WorkspaceJoinSchema.safeParse(workspaceId);
    if (!workspaceParseResult.success) {
      this.denySocketAction(socket, 'workspace:join', 'invalid_workspace_id');
      return;
    }

    // US-J7-12 — filtrage strict par workspaceId : seul le propriétaire
    // authentifié peut rejoindre la room et recevoir les états runtime.
    const canAccessWorkspace = await this.hasWorkspaceOwnership(socket.data.userId, workspaceParseResult.data);

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
      userInfo: socket.data.userInfo || { name: socket.data.userId, color: generateUserColor(socket.data.userId) },
    });

    console.debug(`[WebSocket] User ${socket.data.userId} rejoint workspace ${workspaceId}`);
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
      userId: socket.data.userId,
    });

    console.debug(`[WebSocket] User ${socket.data.userId} quitte workspace ${workspaceId}`);
  }

  private handleDisconnect(socket: WorkspaceSocket) {
    if (socket.data.workspaceId) {
      this.handleWorkspaceLeave(socket, socket.data.workspaceId);
    }
  }

  private broadcastToWorkspace<E extends keyof ServerToClientEvents>(
    socket: WorkspaceSocket,
    event: E,
    data: Parameters<ServerToClientEvents[E]>[0],
  ) {
    if (socket.data.workspaceId) {
      // La paire (event, data) est contrainte par la signature générique de cette
      // méthode ; on caste `emit` car son type conditionnel interne (socket.io)
      // n'est pas résoluble pour un paramètre de type générique.
      const emit = socket.to(socket.data.workspaceId).emit as unknown as (ev: string, ...args: unknown[]) => boolean;
      emit(event, data);
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
    // US-J7-12 — tout socket connecté est authentifié (JWT strict au handshake).
    // Seul le workspaceId (ownership vérifié au join) est requis.
    if (!socket.data.workspaceId) {
      this.denySocketAction(socket, eventName, 'workspace_required');
      return false;
    }

    return true;
  }

  private denySocketAction(socket: WorkspaceSocket, eventName: string, reason: string, metadata: Record<string, unknown> = {}) {
    console.warn('[WebSocket][Denied]', {
      socketId: socket.id,
      eventName,
      reason,
      userId: socket.data.userId,
      workspaceId: socket.data.workspaceId,
      ...metadata,
    });
    socket.emit('connection:status', 'error');
  }

  // Méthodes publiques pour monitoring
  public getConnectedUsers(workspaceId: string): string[] {
    return Array.from(this.connectedUsers.get(workspaceId) || []);
  }

  public getActiveWorkspaces(): string[] {
    return Array.from(this.connectedUsers.keys());
  }

  /**
   * US-J7-12 — Émission d'un événement runtime vers une room workspace.
   * Filtrage strict :
   * - le workspaceId doit être un ObjectId valide ;
   * - l'événement doit être conforme au contrat Zod ;
   * - l'event.workspaceId doit correspondre exactement au workspaceId de la room ;
   * - seuls les sockets authentifiés propriétaires du workspace sont dans la room
   *   (garanti par le handshake JWT strict + ownership check au join).
   * Aucun événement n'est émis vers une room non authentifiée.
   */
  public emitRuntimeEvent(workspaceId: string, event: unknown): boolean {
    const workspaceParseResult = WorkspaceRoomIdSchema.safeParse(workspaceId);
    if (!workspaceParseResult.success) {
      return false;
    }

    const eventParseResult = RuntimeEventEnvelopeSchema.safeParse(event);
    if (!eventParseResult.success) {
      return false;
    }

    const normalizedEvent = eventParseResult.data;
    if (normalizedEvent.workspaceId !== workspaceParseResult.data) {
      return false;
    }

    // Filtrage strict : la room ne contient que des sockets authentifiés
    // ayant prouvé l'ownership du workspace (US-J7-12).
    this.io.to(workspaceId).emit('runtime:event', normalizedEvent);
    return true;
  }

  /**
   * US-J7-12 — Vérifie qu'un utilisateur authentifié a accès à un workspace.
   * Utilisé pour valider avant toute exposition d'état runtime (y compris quarantaine).
   */
  public async canAccessWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const workspaceParseResult = WorkspaceRoomIdSchema.safeParse(workspaceId);
    if (!workspaceParseResult.success) {
      return false;
    }
    return this.hasWorkspaceOwnership(userId, workspaceParseResult.data);
  }

  public async close(): Promise<void> {
    this.connectedUsers.clear();
    await this.io.close();
  }
}
