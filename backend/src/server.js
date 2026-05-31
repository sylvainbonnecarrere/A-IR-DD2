const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketManager } = require('./websocket/WebSocketManager');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration CORS
app.use(cors({
  origin: ["http://localhost:4000", "http://localhost:3000"],
  credentials: true
}));

app.use(express.json());

// Créer serveur HTTP pour Socket.IO
const httpServer = createServer(app);

// Initialiser WebSocket Manager
const wsManager = new WebSocketManager(httpServer);
console.log('[Server] WebSocket Manager initialisé');

// Routes API existantes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    websocket: 'enabled',
    activeWorkspaces: wsManager.getActiveWorkspaces().length
  });
});

// Route pour monitoring WebSocket
app.get('/api/websocket/status', (req, res) => {
  res.json({
    activeWorkspaces: wsManager.getActiveWorkspaces(),
    connectedUsers: wsManager.getActiveWorkspaces().reduce((total, workspace) => {
      return total + wsManager.getConnectedUsers(workspace).length;
    }, 0)
  });
});

// Route pour obtenir les utilisateurs d'un workspace
app.get('/api/websocket/workspace/:workspaceId/users', (req, res) => {
  const { workspaceId } = req.params;
  const users = wsManager.getConnectedUsers(workspaceId);
  res.json({ workspaceId, users });
});

// Démarrer le serveur HTTP avec WebSocket
httpServer.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket enabled on same port`);
  console.log(`[Server] CORS configured for development`);
});

module.exports = app;