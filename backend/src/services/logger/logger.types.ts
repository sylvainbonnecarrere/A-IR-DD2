/**
 * Contrat du logger structuré backend (US-RC-06, pattern *strategy*).
 *
 * - `ILogger` est le port : 4 niveaux (`debug` < `info` < `warn` < `error`) avec
 *   un message et un contexte structuré variadique (`...meta`).
 * - Implémentations : `ConsoleLogger` (dev, lisible) et `JsonLogger` (prod, JSON lines).
 * - Le niveau se règle via `LOG_LEVEL` (défaut : `info` en production, `debug` sinon).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value.toLowerCase());
}

export function levelPriority(level: LogLevel): number {
  return LEVEL_PRIORITY[level];
}

export type LogFormat = 'console' | 'json';

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
}

/**
 * Port logger. Chaque méthode accepte un message plus un contexte variadique
 * (objets, Error, etc.) sérialisé de façon sûre par l'implémentation.
 */
export interface ILogger {
  readonly level: LogLevel;
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  isLevelEnabled(level: LogLevel): boolean;
}
