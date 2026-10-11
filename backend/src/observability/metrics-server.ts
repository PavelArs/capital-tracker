import { createServer, type Server } from 'node:http';
import { Logger } from '@nestjs/common';
import { registry } from './metrics';
import type { MetricsCollector } from './metrics.collector';

/**
 * Serves /metrics on its own port. The port is never published by Compose and the public
 * reverse proxy only forwards /api/ to the API port, so the endpoint is reachable from the
 * Docker network only. Anything but GET /metrics answers 404.
 */
export function startMetricsServer(
  collector: MetricsCollector,
  port: number,
  host = '0.0.0.0',
): Promise<Server | null> {
  const logger = new Logger('MetricsServer');
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    collector
      .collect()
      .then(() => registry.metrics())
      .then((body) => {
        res.writeHead(200, { 'Content-Type': registry.contentType, 'Cache-Control': 'no-store' });
        res.end(body);
      })
      .catch((error: Error) => {
        logger.error(`Metrics scrape failed: ${error.name}`);
        res.writeHead(500).end();
      });
  });
  return new Promise((resolve) => {
    // Metrics are optional: a port clash must not stop the application.
    server.once('error', (error: Error) => {
      logger.warn(`Metrics listener not started: ${error.message}`);
      resolve(null);
    });
    server.listen(port, host, () => {
      logger.log(`Metrics listener on port ${(server.address() as { port: number }).port}`);
      resolve(server);
    });
  });
}
