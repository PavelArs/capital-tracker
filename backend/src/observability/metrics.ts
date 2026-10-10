import type { NextFunction, Request, Response } from 'express';
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/**
 * One process-wide registry. It is exposed only by the internal metrics listener
 * (metrics-server.ts), never by a route of the public API.
 */
export const registry = new Registry();

collectDefaultMetrics({ register: registry });

const HTTP_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const JOB_BUCKETS = [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300];

const httpRequests = new Histogram({
  name: 'ct_http_request_duration_seconds',
  help: 'API request duration by method, matched route pattern and status code.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: HTTP_BUCKETS,
  registers: [registry],
});

const httpInFlight = new Gauge({
  name: 'ct_http_requests_in_flight',
  help: 'API requests being handled right now.',
  registers: [registry],
});

const jobRuns = new Counter({
  name: 'ct_job_runs_total',
  help: 'Background job ticks by job and outcome (an outcome of "error" is a tick that threw).',
  labelNames: ['job', 'outcome'] as const,
  registers: [registry],
});

const jobDuration = new Histogram({
  name: 'ct_job_duration_seconds',
  help: 'Background job tick duration.',
  labelNames: ['job'] as const,
  buckets: JOB_BUCKETS,
  registers: [registry],
});

const walletRuns = new Counter({
  name: 'ct_wallet_sync_runs_total',
  help: 'Wallet sync passes by network and resulting state.',
  labelNames: ['network', 'outcome'] as const,
  registers: [registry],
});

const walletDuration = new Histogram({
  name: 'ct_wallet_sync_duration_seconds',
  help: 'Wallet sync pass duration by network.',
  labelNames: ['network'] as const,
  buckets: JOB_BUCKETS,
  registers: [registry],
});

/** Gauges that are read from the database or Redis when Prometheus scrapes. */
export const sourceLastSuccess = new Gauge({
  name: 'ct_source_last_success_timestamp_seconds',
  help: 'Unix time of the last successful run of a price or rate source.',
  labelNames: ['source'] as const,
  registers: [registry],
});

export const sourceState = new Gauge({
  name: 'ct_source_state',
  help: 'Price or rate source state: 1 on the current state, 0 on the others.',
  labelNames: ['source', 'state'] as const,
  registers: [registry],
});

export const walletsByState = new Gauge({
  name: 'ct_wallets',
  help: 'Wallets by network and sync state (pending: never synced).',
  labelNames: ['network', 'state'] as const,
  registers: [registry],
});

export const walletOldestSuccess = new Gauge({
  name: 'ct_wallet_oldest_success_timestamp_seconds',
  help: 'Unix time of the oldest last successful sync among a network’s wallets.',
  labelNames: ['network'] as const,
  registers: [registry],
});

export const dependencyUp = new Gauge({
  name: 'ct_dependency_up',
  help: '1 when the dependency answered during the scrape, else 0.',
  labelNames: ['dependency'] as const,
  registers: [registry],
});

export const databaseSize = new Gauge({
  name: 'ct_database_size_bytes',
  help: 'Size of the application database on disk.',
  registers: [registry],
});

export const dbPool = new Gauge({
  name: 'ct_db_pool_connections',
  help: 'PostgreSQL pool connections by state (total, idle, waiting).',
  labelNames: ['state'] as const,
  registers: [registry],
});

const seconds = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e9;

/**
 * Times API requests. The route label is the matched pattern ("/accounting/operations/:id"),
 * never the raw URL, so ids and scanner noise cannot grow the label set.
 */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  httpInFlight.inc();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    httpInFlight.dec();
    const pattern = req.route?.path;
    httpRequests.observe(
      {
        method: req.method,
        route: typeof pattern === 'string' ? `${req.baseUrl}${pattern}` : 'unmatched',
        status: String(res.statusCode),
      },
      seconds(start),
    );
  };
  // "close" covers a client that hung up before the response ended.
  res.once('finish', finish);
  res.once('close', finish);
  next();
}

/**
 * Runs one scheduled tick and counts it. The outcome is the result's own `outcome` word
 * ("collected", "busy", "disabled" ...) or "error" when the tick throws; the error is rethrown.
 */
export async function trackJob<T extends { outcome: string }>(
  job: string,
  tick: () => Promise<T>,
): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const result = await tick();
    jobRuns.inc({ job, outcome: result.outcome });
    return result;
  } catch (error) {
    jobRuns.inc({ job, outcome: 'error' });
    throw error;
  } finally {
    jobDuration.observe({ job }, seconds(start));
  }
}

export function recordWalletSync(network: string, outcome: string, startedAt: bigint): void {
  walletRuns.inc({ network, outcome });
  walletDuration.observe({ network }, seconds(startedAt));
}

export const startTimer = () => process.hrtime.bigint();
