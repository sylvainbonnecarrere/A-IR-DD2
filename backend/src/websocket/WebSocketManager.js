const { Server: SocketIOServer } = require('socket.io');

class WebSocketManager {
  constructor(httpServer) {
    this.connectedUsers = new Map(); // workspaceId -> Set<userId>
    
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: ["http://localhost:4000", "http://localhost:3000"],
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[WebSocket] Client connecté: ${socket.id}`);
      
      // Générer un userId temporaire
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

  handleWorkspaceJoin(socket, workspaceId) {
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
    this.connectedUsers.get(workspaceId).add(socket.data.userId);

    // Notifier les autres utilisateurs
    socket.to(workspaceId).emit('workspace:user:joined', {
      userId: socket.data.userId,
      userInfo: socket.data.userInfo || { name: socket.data.userId, color: this.generateUserColor() }
    });

    console.log(`[WebSocket] User ${socket.data.userId} rejoint workspace ${workspaceId}`);
  }

  handleWorkspaceLeave(socket, workspaceId) {
    socket.leave(workspaceId);
    
    // Retirer de la liste des utilisateurs connectés
    if (this.connectedUsers.has(workspaceId)) {
      this.connectedUsers.get(workspaceId).delete(socket.data.userId);
      if (this.connectedUsers.get(workspaceId).size === 0) {
        this.connectedUsers.delete(workspaceId);
      }
    }

    // Notifier les autres utilisateurs
    socket.to(workspaceId).emit('workspace:user:left', {
      userId: socket.data.userId
    });

    console.log(`[WebSocket] User ${socket.data.userId} quitte workspace ${workspaceId}`);
  }

  handleDisconnect(socket) {
    if (socket.data.workspaceId) {
      this.handleWorkspaceLeave(socket, socket.data.workspaceId);
    }
  }

  broadcastToWorkspace(socket, event, data) {
    if (socket.data.workspaceId) {
      socket.to(socket.data.workspaceId).emit(event, data);
    }
  }

  generateUserColor() {
    const colors = ['#00ff88', '#ff6b00', '#0066ff', '#ff0066', '#66ff00', '#ff6600'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // Méthodes publiques pour monitoring
  getConnectedUsers(workspaceId) {
    return Array.from(this.connectedUsers.get(workspaceId) || []);
  }

  getActiveWorkspaces() {
    return Array.from(this.connectedUsers.keys());
  }
}

module.exports = { WebSocketManager };