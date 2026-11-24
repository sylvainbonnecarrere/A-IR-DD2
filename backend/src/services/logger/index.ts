/**
 * Point d'entrée du logger structuré backend (US-RC-06).
 *
 * - `createLogger()` choisit l'implémentation : `JsonLogger` en production
 *   (ou `LOG_FORMAT=json`), `ConsoleLogger` en dev.
 * - Niveau via `LOG_LEVEL` ; défaut `info` en production, `debug` sinon
 *   (ne jamais perdre de logs en prod à cause d'un niveau trop haut).
 * - `logger` est le singleton injecté dans tout `backend/src` ; `server.ts`
 *   appelle `configureLogger()` au bootstrap, et les tests peuvent le
 *   remplacer via `setLogger()`.
 */
import { ConsoleLogger } from './ConsoleLogger';
import { JsonLogger } from './JsonLogger';
import { ILogger, LogLevel, LogFormat, LoggerOptions, isLogLevel } from './logger.types';

export * from './logger.types';
export { ConsoleLogger } from './ConsoleLogger';
export { JsonLogger } from './JsonLogger';
export { serializeMeta, serializeMetaValue } from './serializeMeta';

function defaultLevel(nodeEnv: string | undefined): LogLevel {
  return nodeEnv === 'production' ? 'info' : 'debug';
}

function defaultFormat(nodeEnv: string | undefined): LogFormat {
  return nodeEnv === 'production' ? 'json' : 'console';
}

export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env.LOG_LEVEL?.toLowerCase();
  return isLogLevel(raw) ? raw : defaultLevel(env.NODE_ENV);
}

export function resolveLogFormat(env: NodeJS.ProcessEnv = process.env): LogFormat {
  const raw = env.LOG_FORMAT?.toLowerCase();
  if (raw === 'json' || raw === 'console') {
    return raw;
  }
  return defaultFormat(env.NODE_ENV);
}

export function createLogger(options: LoggerOptions = {}, env: NodeJS.ProcessEnv = process.env): ILogger {
  const level = options.level ?? resolveLogLevel(env);
  const format = options.format ?? resolveLogFormat(env);
  return format === 'json' ? new JsonLogger(level) : new ConsoleLogger(level);
}

let currentLogger: ILogger = createLogger();

/**
 * Singleton logger utilisé par tout le backend. Objet simple dont les méthodes
 * délèguent au logger courant : `jest.spyOn(logger, 'error')` intercepte donc
 * normalement les appels (les tests conservent leurs assertions telles quelles).
 */
export const logger: ILogger = {
  get level(): LogLevel {
    return currentLogger.level;
  },
  debug(message: string, ...meta: unknown[]): void {
    currentLogger.debug(message, ...meta);
  },
  info(message: string, ...meta: unknown[]): void {
    currentLogger.info(message, ...meta);
  },
  warn(message: string, ...meta: unknown[]): void {
    currentLogger.warn(message, ...meta);
  },
  error(message: string, ...meta: unknown[]): void {
    currentLogger.error(message, ...meta);
  },
  isLevelEnabled(level: LogLevel): boolean {
    return currentLogger.isLevelEnabled(level);
  },
};

/**
 * Reconfigure le singleton depuis l'environnement (appelé au bootstrap par
 * `server.ts`). Les appels existants `logger.x(...)` basculent sans réimport.
 */
export function configureLogger(env: NodeJS.ProcessEnv = process.env): ILogger {
  currentLogger = createLogger({}, env);
  return logger;
}

/** Remplace le logger (tests, wiring) — ex. `setLogger(new ConsoleLogger('error'))`. */
export function setLogger(next: ILogger): void {
  currentLogger = next;
}

/** Logger courant (utile pour les assertions de tests). */
export function getLogger(): ILogger {
  return currentLogger;
}
