export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

class Logger {
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = this.getTimestamp();
    const metaStr = meta ? ` | meta: ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  }

  public debug(message: string, meta?: any): void {
    if (process.env.NODE_ENV !== 'production' || process.env.DEBUG) {
      console.debug(this.formatMessage('DEBUG', message, meta));
    }
  }

  public info(message: string, meta?: any): void {
    console.info(this.formatMessage('INFO', message, meta));
  }

  public warn(message: string, meta?: any): void {
    console.warn(this.formatMessage('WARN', message, meta));
  }

  public error(message: string, error?: any, meta?: any): void {
    const combinedMeta = {
      ...(error instanceof Error ? { error: error.message, stack: error.stack } : { error }),
      ...meta
    };
    console.error(this.formatMessage('ERROR', message, combinedMeta));
  }
}

export const logger = new Logger();
