// Logging middleware pour les requêtes LMStudio
import { logger } from '../services/logger';
import { Request, Response, NextFunction } from 'express';

/**
 * Interface pour les logs structurés
 */
interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  ip: string;
  userAgent?: string;
  endpoint?: string;
  model?: string;
  messagesCount?: number;
  stream?: boolean;
}

/**
 * Middleware de logging pour toutes les requêtes LMStudio
 * IMPORTANT : Ne log PAS le contenu des messages (privacy)
 */
export function logLMStudioRequest(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Construire le log (sans données sensibles)
  const logEntry: RequestLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    userAgent: req.get('user-agent'),
  };

  // Ajouter infos non-sensibles du body
  if (req.body) {
    if (req.body.endpoint) {
      logEntry.endpoint = req.body.endpoint;
    }
    if (req.body.model) {
      logEntry.model = req.body.model;
    }
    if (Array.isArray(req.body.messages)) {
      logEntry.messagesCount = req.body.messages.length;
    }
    if (typeof req.body.stream === 'boolean') {
      logEntry.stream = req.body.stream;
    }
  }

  // Ajouter endpoint depuis query params
  if (req.query.endpoint) {
    logEntry.endpoint = req.query.endpoint as string;
  }

  logger.debug('[LMStudio Proxy]', JSON.stringify(logEntry));

  // Logger la durée de la requête à la fin
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.debug(`[LMStudio Proxy] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });

  next();
}

/**
 * Logger les erreurs de manière sécurisée
 * Ne log PAS les détails potentiellement sensibles
 */
export function logError(error: Error, context: string): void {
  logger.error(`[LMStudio Proxy Error] ${context}:`, {
    message: error.message,
    name: error.name,
    timestamp: new Date().toISOString(),
    // Ne PAS logger: stack trace complète, arguments, variables
  });
}

/**
 * Middleware de gestion d'erreurs global pour les routes LMStudio
 */
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  logError(err, `${req.method} ${req.path}`);

  // Réponse sécurisée (pas de détails d'implémentation)
  res.status(500).json({
    error: 'Internal server error',
    details: 'An error occurred while processing your request',
    // En développement, ajouter plus de détails
    ...(process.env.NODE_ENV === 'development' && {
      message: err.message,
    }),
  });
}
