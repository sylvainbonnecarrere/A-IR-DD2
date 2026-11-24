import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import mongoose from 'mongoose';
import { WebSocketManager } from './websocket/WebSocketManager';
import { configureRuntimeEventEmitter } from './services/runtimeEventPublisher.service';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import passport from './middleware/auth.middleware';
import { connectDatabase, disconnectDatabase } from './config/database';
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
import cloudConnectionProfilesRoutes from './routes/cloud-connection-profiles.routes';
import localLLMProfilesRoutes from './routes/local-llm-profiles.routes';
import llmProxyRoutes from './routes/llm-proxy.routes';
import userSettingsRoutes from './routes/user-settings.routes';
import userWorkspaceRoutes from './routes/user-workspace.routes';
import workspacesTransitionRoutes from './routes/workspaces.routes';
import workspaceRunsRoutes from './routes/workspaceRuns.routes';
import toolsRoutes from './routes/tools.routes';
import runsRoutes from './routes/runs.routes';
import mediaRoutes from './routes/media.routes';
import sandboxRoutes from './routes/sandbox.routes';
import { initializeDatabase } from './services/databaseInit';
import { createProductionRunWorker } from './services/runtime/productionRunWorker';
import type { DurableRunWorker } from './services/runtime/DurableRunWorker';
import os from 'os';
import { randomUUID } from 'crypto';
import {
  activateDockerGatewayWorker,
  closeDockerGatewayWorker,
  isDockerGatewayRequired,
  isDockerGatewayWorkerActive,
} from './services/runtime/DockerGatewayRuntime';
import { DockerGatewayControlClient } from './services/runtime/DockerGatewayControlClient';
import { DockerGatewayFencedAttemptProof } from './services/runtime/DockerGatewayFencedAttemptProof';
import { MongoDockerGatewayAdmission } from './services/runtime/MongoDockerGatewayAdmission';
import { MongoExpiredRunReconciler } from './services/runtime/MongoExpiredRunReconciler';
import { AgentAutoRecoveryService } from './services/runtime/agentAutoRecovery.service';
import { MongoRunVisibilityService } from './services/runtime/runVisibility.service';
import { FenceAndRetryService } from './services/fenceAndRetry.service';
import { configureLogger, logger } from './services/logger';

// SOLID: Valider la configuration au démarrage (fail-fast pattern)
validateConfig();

// US-RC-06: wiring du logger structuré (LOG_LEVEL / NODE_ENV) avant tout log
configureLogger();
logger.info('Logger configuré', { level: logger.level, nodeEnv: process.env.NODE_ENV ?? 'development' });

const isTestEnvironment = process.env.NODE_ENV === 'test';

const app = express();
const PORT = config.port;

// ===== SECURITY MIDDLEWARE =====
// Helmet: Sécurise les headers HTTP
app.use(helmet());

// MongoDB query sanitization (prévention injection NoSQL)
app.use(mongoSanitize());

// Configuration CORS
// In development, accept any localhost port (4000, 5174, 5175, 3000, etc.)
// In production, use FRONTEND_URL env var
const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) {
    // Allow requests with no origin (like mobile apps or curl requests)
    callback(null, true);
    return;
  }

  const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  const isProduction = process.env.NODE_ENV === 'production';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';

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

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);

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

app.get('/api/health/ready', (_req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  const workerState = runWorker?.getState() ?? (isTestEnvironment ? 'disabled' : 'not_started');
  const workerReady = isTestEnvironment || workerState === 'running';
  const gatewayReady = !isDockerGatewayRequired() || isDockerGatewayWorkerActive();
  const ready = databaseReady && workerReady && gatewayReady;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    components: {
      database: databaseReady ? 'connected' : 'unavailable',
      durableRunWorker: workerState,
      dockerGateway: gatewayReady ? (isDockerGatewayRequired() ? 'active' : 'optional') : 'unavailable',
    },
    ...(runWorker?.getFailure() ? { workerFailure: runWorker.getFailure() } : {}),
  });
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
app.use('/api/cloud-connection-profiles', cloudConnectionProfilesRoutes);
app.use('/api/local-llm-profiles', localLLMProfilesRoutes);
app.use('/api/llm', llmProxyRoutes);

// Local LLM detection routes (new architecture - Option C Hybrid)
app.use('/api/local-llm', localLLMRoutes);

// User settings routes (Jalon 4 - Phase 3)
app.use(userSettingsRoutes);

// User workspace composite routes (Jalon 4 - Phase 4: Hydration)
app.use('/api/user', userWorkspaceRoutes);
app.use('/api/workspaces', workspacesTransitionRoutes);
app.use('/api/workspaces', workspaceRunsRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/runs', runsRoutes);

// ⭐ NOUVEAU: Routes média (stockage images, fichiers générés par agents)
app.use('/api/media', mediaRoutes);

// ⭐ Tools V2 — Bibliothèque de fonctions personnalisées (Phil Robot)
app.use('/api/sandbox', sandboxRoutes);

// Routes proxy LMStudio (legacy)
app.use('/api/lmstudio', lmstudioRoutes);

// Créer le serveur HTTP
const httpServer = createServer(app);
const lmStudioRequestTimeoutMs = LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS + 10_000;

// Align HTTP server timeouts with local LLM long-running streaming paths.
httpServer.headersTimeout = Math.max(httpServer.headersTimeout, lmStudioRequestTimeoutMs + 1_000);
httpServer.requestTimeout = Math.max(httpServer.requestTimeout, lmStudioRequestTimeoutMs);
httpServer.keepAliveTimeout = Math.max(httpServer.keepAliveTimeout, 65_000);

let wsManager: WebSocketManager | null = null;
let isShuttingDown = false;
let runWorker: DurableRunWorker | null = null;

function ensureWebSocketManager(): WebSocketManager {
  if (!wsManager) {
    wsManager = new WebSocketManager(httpServer);
    configureRuntimeEventEmitter({
      emitRuntimeEvent: (workspaceId, event) => wsManager?.emitRuntimeEvent(workspaceId, event) ?? false,
    });
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
    let databaseInitialized = false;

    // Tentative connexion MongoDB (non-bloquante pour Jalon 1)
    try {
      await connectDatabase();

      // Initialize database schema, collections, and indexes (Code-First approach)
      // This runs AFTER successful MongoDB connection
      await initializeDatabase();
      databaseInitialized = true;
    } catch (dbError) {
      console.warn('⚠️  MongoDB non disponible - Mode Guest uniquement');
      console.warn('   Pour activer le mode Authenticated, démarrer MongoDB :');
      console.warn('   - Windows: Installer MongoDB Community Server');
      console.warn('   - Docker: docker run -d -p 27017:27017 --name mongodb mongo:6');
      console.warn('');
    }

    if (!isTestEnvironment && databaseInitialized) {
      const gatewaySocket = process.env.DOCKER_GATEWAY_SOCKET?.trim();
      if (isDockerGatewayRequired() && !gatewaySocket) {
        throw new Error('DOCKER_GATEWAY_SOCKET is required in production; direct Docker access is disabled');
      }
      if (gatewaySocket) {
        await activateDockerGatewayWorker(gatewaySocket, `backend:${os.hostname()}:${process.pid}:${randomUUID()}`);
        const gatewayAdmission = new MongoDockerGatewayAdmission();
        const gatewayControl = new DockerGatewayControlClient({ socketPath: gatewaySocket });
        const runVisibility = new MongoRunVisibilityService();
        const fenceAndRetryService = new FenceAndRetryService(
          gatewayControl,
          gatewayAdmission,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          runVisibility,
        );
        const recovery = await new MongoExpiredRunReconciler(
          new DockerGatewayFencedAttemptProof(gatewayAdmission, gatewayControl),
          undefined,
          undefined,
          new AgentAutoRecoveryService(fenceAndRetryService),
          runVisibility,
        ).reconcile();
        if (recovery.unresolved > 0 || recovery.lockCleanupPending > 0 || recovery.autoRecovered > 0) {
          console.warn('[Backend startup] Some expired runs remain quarantined after Docker reconciliation', recovery);
        }
      }
      runWorker = createProductionRunWorker();
      runWorker.start();
    }

    // Démarrer le serveur HTTP (même sans MongoDB)
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(PORT, () => {
        serverStarted = true;

        if (!isTestEnvironment) {
          console.debug('\n✨ ===== A-IR-DD2 BACKEND DÉMARRÉ ===== ✨');
          console.debug(`🚀 Serveur HTTP: http://localhost:${PORT}`);
          console.debug('📡 WebSocket prêt pour les connexions');
          console.debug(`🔐 Mode: ${process.env.NODE_ENV || 'development'}`);
          console.debug('✅ Jalon 1: Infrastructure prête (MongoDB + Encryption)');
          console.debug('✅ Jalon 2: Authentification JWT (Passport + Zod)');
          console.debug('🔓 Mode Guest: OPÉRATIONNEL (Python tools, WebSocket)');
          console.debug('🔐 Mode Auth: DISPONIBLE (/api/auth/*)');
          console.debug('═══════════════════════════════════════════\n');
        }

        resolve();
      });
    });

    return httpServer;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use.`);
      console.error('   Another backend process is likely still running.');
      console.error('   Windows check: Get-NetTCPConnection -LocalPort 3001 -State Listen');
      console.error('   Then stop it with: Stop-Process -Id <PID>');
    }
    console.error('💀 Erreur critique au démarrage:', error);
    process.exit(1);
  }
}

async function stopServer() {
  const shutdownErrors: string[] = [];

  if (serverStarted) {
    try {
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
    } catch (error) {
      shutdownErrors.push(`HTTP server: ${describeShutdownError(error)}`);
    }
  }

  if (runWorker) {
    try {
      await runWorker.stop();
    } catch (error) {
      shutdownErrors.push(`Durable run worker: ${describeShutdownError(error)}`);
    } finally {
      runWorker = null;
    }
  }

  if (isDockerGatewayWorkerActive()) {
    try {
      await closeDockerGatewayWorker();
    } catch (error) {
      shutdownErrors.push(`Docker gateway worker epoch: ${describeShutdownError(error)}`);
    }
  }

  if (wsManager) {
    try {
      await wsManager.close();
    } catch (error) {
      shutdownErrors.push(`WebSocket manager: ${describeShutdownError(error)}`);
    } finally {
      wsManager = null;
      configureRuntimeEventEmitter(null);
    }
  }

  try {
    await disconnectDatabase();
  } catch (error) {
    shutdownErrors.push(`MongoDB connection: ${describeShutdownError(error)}`);
  }

  if (shutdownErrors.length > 0) {
    throw new Error(`Backend shutdown did not complete cleanly: ${shutdownErrors.join('; ')}`);
  }
}

function describeShutdownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  if (!isTestEnvironment) {
    console.debug(`\n🛑 Received ${signal}. Shutting down backend gracefully...`);
  }

  try {
    await stopServer();
    process.exit(0);
  } catch (error) {
    console.error('💥 Graceful shutdown failed:', error);
    process.exit(1);
  }
}

function registerShutdownHandlers() {
  const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  if (process.platform === 'win32') {
    shutdownSignals.push('SIGBREAK');
  }

  shutdownSignals.forEach((signal) => {
    process.on(signal, () => {
      void shutdown(signal);
    });
  });
}

// Lancer le serveur uniquement en exécution directe
if (require.main === module) {
  registerShutdownHandlers();
  void startServer();
}

export { app, startServer, stopServer, httpServer };
