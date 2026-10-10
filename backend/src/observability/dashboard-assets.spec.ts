import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registry } from './metrics';

const { parse } = require('yaml') as { parse: (source: string) => unknown };
const dir = resolve(__dirname, '../../../deploy/observability');
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8');

// Series a histogram adds to its metric name.
const SERIES_SUFFIX = /_(bucket|count|sum)$/;

describe('OBS-ASSETS Grafana and Prometheus files', () => {
  const files = [
    'grafana/capital-tracker-dashboard.json',
    'capital-tracker.rules.yml',
    'prometheus-scrape.yml',
  ];

  it('OBS-ASSET-1 parse as JSON and YAML', () => {
    const dashboard = JSON.parse(read(files[0])) as { panels: unknown[]; __inputs: unknown[] };
    expect(dashboard.panels.length).toBeGreaterThan(10);
    expect(dashboard.__inputs).toHaveLength(2);
    expect(parse(read(files[1]))).toHaveProperty('groups');
    expect(parse(read(files[2]))).toEqual([
      expect.objectContaining({ job_name: 'capital-tracker-backend' }),
    ]);
  });

  it('OBS-ASSET-2 only query metrics the backend exports', async () => {
    const exported = new Set((await registry.getMetricsAsJSON()).map((metric) => metric.name));
    const used = new Set(
      files
        .flatMap((file) => read(file).match(/\bct_[a-z_]+/g) ?? [])
        .map((name) => (exported.has(name) ? name : name.replace(SERIES_SUFFIX, ''))),
    );
    expect(used.size).toBeGreaterThan(8);
    for (const name of used) expect(exported).toContain(name);
  });

  it('OBS-ASSET-3 name no server, address or credential', () => {
    for (const file of [...files, 'README.md', 'alloy-logs.alloy']) {
      // Loopback and wildcard listen addresses are not servers.
      const text = read(file).replace(/\b(127\.0\.0\.1|0\.0\.0\.0)\b/g, '');
      expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b|pavelars\.ru|api[_-]?key|secret/i);
    }
  });

  it('OBS-PORT-1 Compose publishes the metrics port on the loopback only', () => {
    const compose = readFileSync(resolve(__dirname, '../../../docker-compose.yml'), 'utf8');
    const metricsPorts = compose.split('\n').filter((line) => line.trimStart().startsWith('- ') && line.includes(':9464'));
    expect(metricsPorts).toHaveLength(1);
    expect(metricsPorts[0]).toMatch(/"127\.0\.0\.1:\$\{METRICS_HOST_PORT:-9464\}:9464"/);
  });
});
