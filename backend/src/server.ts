import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketManager } from './websocket/WebSocketManager';
import { spawn } from 'child_process';
import path from 'path';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import passport from './middleware/auth.middleware';
import { connectDatabase } from './config/database';
import config, { validateConfig } from './config/environment';
import { LMSTUDIO_CONFIG } from './config/lmstudio.config';
import lmstudioRoutes from './routes/lmstudio.routes';
import localLLMRoutes from './routes/local-llm.routes';
import authRoutes from './routes/auth.routes';
import workflowsRoutes from './routes/workflows.routes';
import agentPrototypesRoutes from './routes/agent-prototypes.routes';
import agentTemplatesRoutes from './routes/agent-templates.routes';
import agentInstancesRoutes from './routes/agent-instances.routes';
import llmConfigsRoutes from './routes/llm-configs.routes';
import localLLMProfilesRoutes from './routes/local-llm-profiles.routes';
import llmProxyRoutes from './routes/llm-proxy.routes';
import userSettingsRoutes from './routes/user-settings.routes';
import userWorkspaceRoutes from './routes/user-workspace.routes';
import workspacesTransitionRoutes from './routes/workspaces.routes';
import toolsRoutes from './routes/tools.routes';
import runsRoutes from './routes/runs.routes';
import mediaRoutes from './routes/media.routes';
import functionsRoutes from './routes/functions.routes';
import sandboxRoutes from './routes/sandbox.routes';
import { initializeDatabase } from './services/databaseInit';

// SOLID: Valider la configuration au démarrage (fail-fast pattern)
validateConfig();

const isTestEnvironment = process.env.NODE_ENV === 'test';

const app = express();
const PORT = config.port;

// ===== SECURITY MIDDLEWARE =====
// Helmet: Sécurise les headers HTTP
app.use(helmet());

// MongoDB query sanitization (prévention injection NoSQL)
app.use(mongoSanitize());

// Configuration CORS
// In development, accept any localhost port (5173, 5174, 5175, 3000, etc.)
// In production, use FRONTEND_URL env var
const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) {
    // Allow requests with no origin (like mobile apps or curl requests)
    callback(null, true);
    return;
  }

  const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  const isProduction = process.env.NODE_ENV === 'production';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (isProduction) {
    // Production: strict CORS - only accept configured frontend URL
    if (origin === frontendUrl) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  } else {
    // Development: allow all localhost origins
    if (isLocalhost) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

app.use(cors({
  origin: corsOrigin,
  credentials: true
}));

// ⭐ FIX 413: Augmenter la limite pour les images base64 (jusqu'à 50MB)
// Les images en base64 peuvent facilement dépasser la limite par défaut de 100KB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ===== PASSPORT INITIALIZATION =====
app.use(passport.initialize());

// ===== ROUTES =====
// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Backend is running' });
});

// Auth routes (Jalon 2)
app.use('/api/auth', authRoutes);

// Workflow routes (Jalon 3 - Phase 1)
// ⭐ FIX: Monter agentInstancesRoutes AVANT workflowsRoutes pour éviter le conflit /:id/*
// Le chemin spécifique /workflows/:workflowId/instances doit être prioritaire
app.use('/api/workflows/:workflowId/instances', agentInstancesRoutes);
// ⭐ JALON 4.9 FIX: Mount also on /api/agent-instances for direct access (PUT, GET by ID)
// Routes that require workflowId will return 400 if missing (see agent-instances.routes.ts)
app.use('/api/agent-instances', agentInstancesRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/agent-prototypes', agentPrototypesRoutes);
app.use('/api/agent-templates', agentTemplatesRoutes);

// LLM routes (Jalon 3 - Phase 2)
app.use('/api/llm-configs', llmConfigsRoutes);
app.use('/api/local-llm-profiles', localLLMProfilesRoutes);
app.use('/api/llm', llmProxyRoutes);

// Local LLM detection routes (new architecture - Option C Hybrid)
app.use('/api/local-llm', localLLMRoutes);

// User settings routes (Jalon 4 - Phase 3)
app.use(userSettingsRoutes);

// User workspace composite routes (Jalon 4 - Phase 4: Hydration)
app.use('/api/user', userWorkspaceRoutes);
app.use('/api/workspaces', workspacesTransitionRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/runs', runsRoutes);

// ⭐ NOUVEAU: Routes média (stockage images, fichiers générés par agents)
app.use('/api/media', mediaRoutes);

// ⭐ Tools V2 — Bibliothèque de fonctions personnalisées (Phil Robot)
app.use('/api/functions', functionsRoutes);
app.use('/api/sandbox', sandboxRoutes);

// Routes proxy LMStudio (legacy)
app.use('/api/lmstudio', lmstudioRoutes);

// Route pour exécuter les outils Python
app.post('/api/execute-python-tool', async (req, res) => {
  try {
    const { toolName, args } = req.body;

    if (!toolName || !args) {
      return res.status(400).json({ error: 'toolName et args requis' });
    }

    const pythonPath = path.join(__dirname, '../../utils/pythonTools', `${toolName}.py`);
    const argsString = JSON.stringify(args);

    const pythonProcess = spawn('python3', [pythonPath, argsString]);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).json({
          error: 'Erreur d\'exécution Python',
          stderr: stderr
        });
      }

      try {
        const result = JSON.parse(stdout);
        res.json(result);
      } catch (parseError) {
        res.status(500).json({
          error: 'Erreur de parsing JSON',
          output: stdout
        });
      }
    });

  } catch (error) {
    res.status(500).json({
      error: 'Erreur serveur',
      message: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

// Créer le serveur HTTP
const httpServer = createServer(app);
const lmStudioRequestTimeoutMs = LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS + 10_000;

// Align HTTP server timeouts with local LLM long-running streaming paths.
httpServer.headersTimeout = Math.max(httpServer.headersTimeout, lmStudioRequestTimeoutMs + 1_000);
httpServer.requestTimeout = Math.max(httpServer.requestTimeout, lmStudioRequestTimeoutMs);
httpServer.keepAliveTimeout = Math.max(httpServer.keepAliveTimeout, 65_000);

let wsManager: WebSocketManager | null = null;

function ensureWebSocketManager(): WebSocketManager {
  if (!wsManager) {
    wsManager = new WebSocketManager(httpServer);
  }

  return wsManager;
}

let serverStarted = false;

// ===== DÉMARRAGE DU SERVEUR =====
async function startServer() {
  if (serverStarted) {
    return httpServer;
  }

  try {
    ensureWebSocketManager();

    // Tentative connexion MongoDB (non-bloquante pour Jalon 1)
    try {
      await connectDatabase();
      
      // Initialize database schema, collections, and indexes (Code-First approach)
      // This runs AFTER successful MongoDB connection
      await initializeDatabase();
      
    } catch (dbError) {
      console.warn('⚠️  MongoDB non disponible - Mode Guest uniquement');
      console.warn('   Pour activer le mode Authenticated, démarrer MongoDB :');
      console.warn('   - Windows: Installer MongoDB Community Server');
      console.warn('   - Docker: docker run -d -p 27017:27017 --name mongodb mongo:6');
      console.warn('');
    }

    // Démarrer le serveur HTTP (même sans MongoDB)
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(PORT, () => {
        serverStarted = true;

        if (!isTestEnvironment) {
          console.log('\n✨ ===== A-IR-DD2 BACKEND DÉMARRÉ ===== ✨');
          console.log(`🚀 Serveur HTTP: http://localhost:${PORT}`);
          console.log('📡 WebSocket prêt pour les connexions');
          console.log(`🔐 Mode: ${process.env.NODE_ENV || 'development'}`);
          console.log('✅ Jalon 1: Infrastructure prête (MongoDB + Encryption)');
          console.log('✅ Jalon 2: Authentification JWT (Passport + Zod)');
          console.log('🔓 Mode Guest: OPÉRATIONNEL (Python tools, WebSocket)');
          console.log('🔐 Mode Auth: DISPONIBLE (/api/auth/*)');
          console.log('═══════════════════════════════════════════\n');
        }

        resolve();
      });
    });

    return httpServer;
  } catch (error) {
    console.error('💀 Erreur critique au démarrage:', error);
    process.exit(1);
  }
}

async function stopServer() {
  if (!serverStarted) {
    return;
  }

  if (wsManager) {
    await wsManager.close();
    wsManager = null;
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      serverStarted = false;
      resolve();
    });
  });
}

// Lancer le serveur uniquement en exécution directe
if (require.main === module) {
  void startServer();
}

export { app, startServer, stopServer, httpServer };
