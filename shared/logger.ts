import { config } from './config';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVELS: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

class Logger {
  private currentLevel(): number {
    return LEVELS[config.logLevel as LogLevel] ?? 1;
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = this.getTimestamp();
    const metaStr = meta ? ` | meta: ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  }

  public debug(message: string, meta?: any): void {
    if (LEVELS.DEBUG < this.currentLevel()) return;
    console.debug(this.formatMessage('DEBUG', message, meta));
  }

  public info(message: string, meta?: any): void {
    if (LEVELS.INFO < this.currentLevel()) return;
    console.info(this.formatMessage('INFO', message, meta));
  }

  public warn(message: string, meta?: any): void {
    if (LEVELS.WARN < this.currentLevel()) return;
    console.warn(this.formatMessage('WARN', message, meta));
  }

  public error(message: string, error?: any, meta?: any): void {
    if (LEVELS.ERROR < this.currentLevel()) return;
    const combinedMeta = {
      ...(error instanceof Error ? { error: error.message, stack: error.stack } : { error }),
      ...meta
    };
    console.error(this.formatMessage('ERROR', message, combinedMeta));
  }
}

export const logger = new Logger();

