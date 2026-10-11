import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MetricsCollector } from './metrics.collector';
import { startMetricsServer } from './metrics-server';

describe('OBS-SERVER', () => {
  let server: Server;
  let base: string;
  const collect = jest.fn(async () => {});

  beforeAll(async () => {
    server = (await startMetricsServer(
      { collect } as unknown as MetricsCollector,
      0,
      '127.0.0.1',
    ))!;
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((done) => server.close(done)));

  it('OBS-SRV-1 serves Prometheus text on GET /metrics after refreshing the gauges', async () => {
    const response = await fetch(`${base}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('ct_http_requests_in_flight');
    expect(collect).toHaveBeenCalled();
  });

  it('OBS-SRV-2 answers 404 to every other path and method', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/api/accounting`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(404);
  });

  it('OBS-SRV-3 does not stop the application when the port is taken', async () => {
    const port = (server.address() as AddressInfo).port;
    expect(
      await startMetricsServer({ collect } as unknown as MetricsCollector, port, '127.0.0.1'),
    ).toBeNull();
  });
});
