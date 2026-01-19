const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketManager } = require('./websocket/WebSocketManager');
const { spawn } = require('child_process');
const path = require('path');

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

// Route pour exécuter les outils Python (existante)
app.post('/api/execute-python-tool', async (req, res) => {
  try {
    const { toolName, args } = req.body;
    
    // Validation basique
    if (!toolName || !args) {
      return res.status(400).json({ 
        error: 'Tool name and args are required' 
      });
    }

    // Construction du chemin vers l'outil Python
    const toolPath = path.join(__dirname, '..', '..', 'utils', 'pythonTools', `${toolName}.py`);
    const jsonArgs = JSON.stringify(args);

    // Exécution de l'outil Python
    const pythonProcess = spawn('python3', [toolPath, jsonArgs], {
      cwd: path.join(__dirname, '..', '..')
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          res.json({ success: true, result });
        } catch (parseError) {
          res.json({ success: true, result: stdout });
        }
      } else {
        res.status(500).json({ 
          error: 'Python tool execution failed', 
          stderr,
          code 
        });
      }
    });

    pythonProcess.on('error', (error) => {
      res.status(500).json({ 
        error: 'Failed to start Python process', 
        message: error.message 
      });
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
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