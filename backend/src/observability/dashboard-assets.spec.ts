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
      expect(read(file)).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b|pavelars\.ru|api[_-]?key|secret/i);
    }
  });
});
