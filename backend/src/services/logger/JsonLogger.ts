/**
 * JsonLogger (US-RC-06) — implémentation production du port ILogger.
 *
 * Une ligne JSON par log sur stdout : `{ ts, level, msg, meta }`, avec le
 * contexte sérialisé de façon sûre (Error, ObjectId, références circulaires).
 * On n'utilise pas le global console ici (DoD US-RC-06) : on écrit directement sur stdout.
 */
import { ILogger, LogLevel, levelPriority } from './logger.types';
import { serializeMeta } from './serializeMeta';

export class JsonLogger implements ILogger {
  constructor(public readonly level: LogLevel = 'info') {}

  isLevelEnabled(level: LogLevel): boolean {
    return levelPriority(level) >= levelPriority(this.level);
  }

  debug(message: string, ...meta: unknown[]): void {
    this.write('debug', message, meta);
  }

  info(message: string, ...meta: unknown[]): void {
    this.write('info', message, meta);
  }

  warn(message: string, ...meta: unknown[]): void {
    this.write('warn', message, meta);
  }

  error(message: string, ...meta: unknown[]): void {
    this.write('error', message, meta);
  }

  private write(level: LogLevel, message: string, meta: unknown[]): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      meta: serializeMeta(meta),
    });
    process.stdout.write(`${line}\n`);
  }
}
