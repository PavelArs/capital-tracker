const isProduction = import.meta.env.PROD;

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class LoggerService {
  log(level: LogLevel, message: string, ...args: any[]) {
    if (isProduction && level === 'debug') return;

    const timestamp = new Date().toISOString();
    const logFn = console[level] || console.log;

    // In production, you might want to send these to a remote logging service
    // if (isProduction && (level === 'error' || level === 'warn')) { ... }

    logFn(`[${timestamp}] [${level.toUpperCase()}]: ${message}`, ...args);
  }

  info(message: string, ...args: any[]) {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.log('error', message, ...args);
  }

  debug(message: string, ...args: any[]) {
    this.log('debug', message, ...args);
  }
}

export const logger = new LoggerService();
