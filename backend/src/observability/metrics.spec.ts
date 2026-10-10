import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { httpMetrics, registry, trackJob } from './metrics';

function serve(req: Partial<Request>, statusCode: number) {
  const res = Object.assign(new EventEmitter(), { statusCode }) as unknown as Response;
  httpMetrics({ method: 'GET', baseUrl: '', ...req } as Request, res, () => {});
  res.emit('finish');
  res.emit('close');
}

const sample = async (name: string, labels: Record<string, string>) => {
  for (const metric of await registry.getMetricsAsJSON()) {
    for (const entry of metric.values) {
      const matches = Object.entries(labels).every(
        ([key, expected]) => entry.labels[key] === expected,
      );
      // A histogram's rows carry their own series name ("..._count"); gauges and counters use the metric's.
      if (matches && ((entry as { metricName?: string }).metricName ?? metric.name) === name) {
        return entry.value;
      }
    }
  }
  return undefined;
};

describe('OBS-METRICS', () => {
  it('OBS-HTTP-1 labels a request by its route pattern, not by the raw URL', async () => {
    serve({ route: { path: '/operations/:id' }, baseUrl: '/accounting' }, 200);
    expect(
      await sample('ct_http_request_duration_seconds_count', {
        method: 'GET',
        route: '/accounting/operations/:id',
        status: '200',
      }),
    ).toBe(1);
  });

  it('OBS-HTTP-2 groups requests that match no route, so scanners cannot grow the labels', async () => {
    serve({ url: '/wp-admin/setup.php' }, 404);
    serve({ url: '/.env' }, 404);
    expect(
      await sample('ct_http_request_duration_seconds_count', { route: 'unmatched', status: '404' }),
    ).toBe(2);
  });

  it('OBS-HTTP-3 counts a request once and returns the in-flight gauge to zero', async () => {
    serve({ route: { path: '/once' } }, 200);
    expect(await sample('ct_http_request_duration_seconds_count', { route: '/once' })).toBe(1);
    expect(await sample('ct_http_requests_in_flight', {})).toBe(0);
  });

  it('OBS-JOB-1 counts a tick by the outcome it reports', async () => {
    await trackJob('unit', async () => ({ outcome: 'collected' }));
    await trackJob('unit', async () => ({ outcome: 'busy' }));
    expect(await sample('ct_job_runs_total', { job: 'unit', outcome: 'collected' })).toBe(1);
    expect(await sample('ct_job_runs_total', { job: 'unit', outcome: 'busy' })).toBe(1);
  });

  it('OBS-JOB-2 counts a failed tick as an error and rethrows it', async () => {
    await expect(
      trackJob('unit-fail', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await sample('ct_job_runs_total', { job: 'unit-fail', outcome: 'error' })).toBe(1);
    expect(await sample('ct_job_duration_seconds_count', { job: 'unit-fail' })).toBe(1);
  });
});
