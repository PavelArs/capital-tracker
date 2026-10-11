import { randomUUID } from 'node:crypto';

/**
 * Request logging for nestjs-pino. In production every line is one JSON object with a string
 * level and an ISO time, which Loki can parse without a custom pipeline; development keeps
 * pino-pretty. Every line logged while a request is handled, services included, carries that
 * request's id in `req.id`, and the id is returned to the caller as X-Request-Id.
 */
export function pinoHttpOptions(isProduction: boolean) {
  return {
    transport: isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            colorize: true,
          },
        },
    level: isProduction ? 'info' : 'debug',
    ...(isProduction
      ? {
          base: { service: 'backend' },
          formatters: { level: (label: string) => ({ level: label }) },
          timestamp: () => `,"time":"${new Date().toISOString()}"`,
        }
      : {}),
    genReqId: (_req: unknown, res: { setHeader: (name: string, value: string) => void }) => {
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      // Never serialize query parameters or arbitrary request headers.
      req: (req: { id?: string; method?: string; url?: string; remoteAddress?: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url?.split('?')[0],
        remoteAddress: req.remoteAddress,
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
    customAttributeKeys: { responseTime: 'durationMs' },
    autoLogging: {
      ignore: (req: { url?: string }) => req.url === '/health',
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.headers["x-csrf-token"]',
        'req.body.password',
        'req.body.newPassword',
        'req.body.apiKey',
        'req.body.apiSecret',
      ],
      censor: '[REDACTED]',
    },
  };
}
