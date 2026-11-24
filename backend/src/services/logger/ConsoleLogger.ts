/**
 * ConsoleLogger (US-RC-06) — implémentation dev du port ILogger.
 *
 * Sortie lisible, identique à l'ancien comportement console :
 * `util.format(message, ...meta)` + saut de ligne, `debug`/`info` sur stdout,
 * `warn`/`error` sur stderr. On n'utilise pas le global console ici (DoD US-RC-06 :
 * zéro occurrence dans backend/src) : on écrit directement sur les flux.
 */
import { format } from 'util';
import { ILogger, LogLevel, levelPriority } from './logger.types';

export class ConsoleLogger implements ILogger {
  constructor(public readonly level: LogLevel = 'debug') {}

  isLevelEnabled(level: LogLevel): boolean {
    return levelPriority(level) >= levelPriority(this.level);
  }

  debug(message: string, ...meta: unknown[]): void {
    this.write('debug', message, meta, process.stdout);
  }

  info(message: string, ...meta: unknown[]): void {
    this.write('info', message, meta, process.stdout);
  }

  warn(message: string, ...meta: unknown[]): void {
    this.write('warn', message, meta, process.stderr);
  }

  error(message: string, ...meta: unknown[]): void {
    this.write('error', message, meta, process.stderr);
  }

  private write(level: LogLevel, message: string, meta: unknown[], stream: NodeJS.WriteStream): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }
    stream.write(`${format(message, ...meta)}\n`);
  }
}
