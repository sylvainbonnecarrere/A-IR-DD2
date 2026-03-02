import { io, Socket } from 'socket.io-client';
import { ChatMessage } from '../types';

// Types pour les événements (synchronisés avec le backend)
interface ServerToClientEvents {
  'agent:position:updated': (data: { nodeId: string; position: { x: number; y: number }; userId: string }) => void;
  'agent:message:added': (data: { nodeId: string; message: ChatMessage; userId: string }) => void;
  'agent:toggle:minimized': (data: { nodeId: string; userId: string }) => void;
  'workspace:user:joined': (data: { userId: string; userInfo: any }) => void;
  'workspace:user:left': (data: { userId: string }) => void;
  'user:cursor:updated': (data: { x: number; y: number; userId: string }) => void;
  'connection:status': (status: 'connected' | 'disconnected' | 'error') => void;
}

interface ClientToServerEvents {
  'agent:position:update': (data: { nodeId: string; position: { x: number; y: number } }) => void;
  'agent:message:add': (data: { nodeId: string; message: ChatMessage }) => void;
  'agent:toggle:minimize': (data: { nodeId: string }) => void;
  'workspace:join': (workspaceId: string) => void;
  'workspace:leave': (workspaceId: string) => void;
  'user:cursor:update': (data: { x: number; y: number; userId: string }) => void;
}

export interface ConnectedUser {
  userId: string;
  userInfo: {
    name: string;
    color: string;
  };
}

export interface ConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  userId: string | null;
  workspaceId: string | null;
  connectedUsers: ConnectedUser[];
}

type EventCallback = (...args: any[]) => void;

class WebSocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private currentWorkspaceId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isManualDisconnect = false;

  // État de connexion
  private connectionState: ConnectionState = {
    isConnected: false,
    isConnecting: false,
    error: null,
    userId: null,
    workspaceId: null,
    connectedUsers: []
  };

  // Event listeners
  private eventListeners: Map<string, Set<EventCallback>> = new Map();

  constructor() {
    this.connect();
  }

  private connect() {
    if (this.socket?.connected) {
      return;
    }

    this.connectionState.isConnecting = true;
    this.connectionState.error = null;
    this.emit('connectionStateChanged', this.connectionState);

    try {
      this.socket = io('http://localhost:3001', {
        transports: ['websocket', 'polling'],
        timeout: 5000,
        forceNew: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5
      });

      this.setupEventHandlers();
    } catch (error) {
      console.warn('[WebSocket] Erreur lors de la création du socket:', error);
      this.connectionState.isConnecting = false;
      this.connectionState.error = 'Échec de création du socket';
      this.emit('connectionStateChanged', this.connectionState);
    }
  }

  private setupEventHandlers() {
    if (!this.socket) return;

    // === CONNEXION/DÉCONNEXION ===
    this.socket.on('connect', () => {
      console.log('[WebSocket] Connecté au serveur');
      this.connectionState.isConnected = true;
      this.connectionState.isConnecting = false;
      this.connectionState.error = null;
      this.reconnectAttempts = 0;
      
      // Rejoindre le workspace si nécessaire
      if (this.currentWorkspaceId) {
        this.joinWorkspace(this.currentWorkspaceId);
      }
      
      this.emit('connectionStateChanged', this.connectionState);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[WebSocket] Déconnecté:', reason);
      this.connectionState.isConnected = false;
      this.connectionState.isConnecting = false;
      this.connectionState.connectedUsers = [];
      
      if (!this.isManualDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
      
      this.emit('connectionStateChanged', this.connectionState);
    });

    this.socket.on('connect_error', (error) => {
      console.warn('[WebSocket] Erreur de connexion:', error?.message || error);
      this.connectionState.isConnecting = false;
      this.connectionState.error = error?.message || 'Erreur de connexion';
      this.emit('connectionStateChanged', this.connectionState);
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    });

    // === GESTION DES ERREURS DE PORT ===
    (this.socket as any).on('error', (error: Error) => {
      console.warn('[WebSocket] Erreur socket:', error);
      // Ne pas propager - l'erreur est gérée
    });

    // === ÉTAT DE CONNEXION ===
    this.socket.on('connection:status', (status) => {
      try {
        if (status === 'connected') {
          this.connectionState.userId = this.socket?.id || null;
          this.emit('connectionStateChanged', this.connectionState);
        }
      } catch (error) {
        console.warn('[WebSocket] Erreur dans connection:status:', error);
      }
    });

    // === GESTION DES UTILISATEURS ===
    this.socket.on('workspace:user:joined', (data) => {
      try {
        const existingUser = this.connectionState.connectedUsers.find(u => u.userId === data.userId);
        if (!existingUser) {
          this.connectionState.connectedUsers.push(data);
          this.emit('connectionStateChanged', this.connectionState);
          this.emit('userJoined', data);
        }
      } catch (error) {
        console.warn('[WebSocket] Erreur dans workspace:user:joined:', error);
      }
    });

    this.socket.on('workspace:user:left', (data) => {
      try {
        this.connectionState.connectedUsers = this.connectionState.connectedUsers.filter(
          u => u.userId !== data.userId
        );
        this.emit('connectionStateChanged', this.connectionState);
        this.emit('userLeft', data);
      } catch (error) {
        console.warn('[WebSocket] Erreur dans workspace:user:left:', error);
      }
    });

    // === SYNCHRONISATION AGENTS ===
    this.socket.on('agent:position:updated', (data) => {
      try {
        this.emit('agentPositionUpdated', data);
      } catch (error) {
        console.warn('[WebSocket] Erreur dans agent:position:updated:', error);
      }
    });

    this.socket.on('agent:message:added', (data) => {
      try {
        this.emit('agentMessageAdded', data);
      } catch (error) {
        console.warn('[WebSocket] Erreur dans agent:message:added:', error);
      }
    });

    this.socket.on('agent:toggle:minimized', (data) => {
      try {
        this.emit('agentToggleMinimized', data);
      } catch (error) {
        console.warn('[WebSocket] Erreur dans agent:toggle:minimized:', error);
      }
    });

    // === CURSEUR COLLABORATIF ===
    this.socket.on('user:cursor:updated', (data) => {
      try {
        this.emit('userCursorUpdated', data);
      } catch (error) {
        console.warn('[WebSocket] Erreur dans user:cursor:updated:', error);
      }
    });
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      console.log(`[WebSocket] Tentative de reconnexion ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      this.connect();
    }, delay);
  }

  // === MÉTHODES PUBLIQUES ===
  
  public joinWorkspace(workspaceId: string) {
    if (this.socket?.connected) {
      this.socket.emit('workspace:join', workspaceId);
      this.currentWorkspaceId = workspaceId;
      this.connectionState.workspaceId = workspaceId;
      this.emit('connectionStateChanged', this.connectionState);
    }
  }

  public leaveWorkspace() {
    if (this.socket?.connected && this.currentWorkspaceId) {
      this.socket.emit('workspace:leave', this.currentWorkspaceId);
      this.currentWorkspaceId = null;
      this.connectionState.workspaceId = null;
      this.connectionState.connectedUsers = [];
      this.emit('connectionStateChanged', this.connectionState);
    }
  }

  // Synchronisation agents
  public updateAgentPosition(nodeId: string, position: { x: number; y: number }) {
    if (this.socket?.connected) {
      this.socket.emit('agent:position:update', { nodeId, position });
    }
  }

  public addAgentMessage(nodeId: string, message: ChatMessage) {
    if (this.socket?.connected) {
      this.socket.emit('agent:message:add', { nodeId, message });
    }
  }

  public toggleAgentMinimize(nodeId: string) {
    if (this.socket?.connected) {
      this.socket.emit('agent:toggle:minimize', { nodeId });
    }
  }

  // Curseur collaboratif
  public updateCursor(x: number, y: number) {
    if (this.socket?.connected && this.connectionState.userId) {
      this.socket.emit('user:cursor:update', { x, y, userId: this.connectionState.userId });
    }
  }

  // === EVENT MANAGEMENT ===
  
  public on(event: string, callback: EventCallback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  public off(event: string, callback: EventCallback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  private emit(event: string, ...args: any[]) {
    try {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        listeners.forEach(callback => {
          try {
            callback(...args);
          } catch (error) {
            console.warn(`[WebSocket] Erreur dans callback '${event}':`, error);
          }
        });
      }
    } catch (error) {
      console.warn(`[WebSocket] Erreur lors de l'émission '${event}':`, error);
    }
  }

  // === ÉTAT ET NETTOYAGE ===
  
  public getConnectionState(): ConnectionState {
    return { ...this.connectionState };
  }

  public disconnect() {
    this.isManualDisconnect = true;
    this.leaveWorkspace();
    this.socket?.disconnect();
    this.connectionState.isConnected = false;
    this.connectionState.isConnecting = false;
    this.emit('connectionStateChanged', this.connectionState);
  }

  public reconnect() {
    this.isManualDisconnect = false;
    this.reconnectAttempts = 0;
    this.connect();
  }
}

// Instance singleton
export const webSocketService = new WebSocketService();
export default webSocketService;