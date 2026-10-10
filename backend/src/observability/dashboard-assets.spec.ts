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
    for (const file of [
      ...files,
      'README.md',
      'alloy-logs.alloy',
      'loki/docker-compose.yml',
      'loki/loki.yml',
      'loki/config.alloy',
    ]) {
      // Loopback and wildcard listen addresses are not servers.
      const text = read(file).replace(/\b(127\.0\.0\.1|0\.0\.0\.0)\b/g, '');
      expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b|pavelars\.ru|api[_-]?key|secret/i);
    }
  });
});

describe('OBS-LOKI the Loki and Alloy stack', () => {
  const compose = parse(read('loki/docker-compose.yml')) as {
    services: Record<string, { image: string; ports?: unknown }>;
  };

  it('OBS-LOKI-1 pins both images by tag and digest and publishes no port', () => {
    for (const service of Object.values(compose.services)) {
      expect(service.image).toMatch(/:[\w.-]+@sha256:[0-9a-f]{64}$/);
      expect(service).not.toHaveProperty('ports');
    }
    expect(Object.keys(compose.services).sort()).toEqual(['alloy', 'loki']);
  });

  it('OBS-LOKI-2 keeps its Alloy pipeline equal to the snippet and adds only the Loki write', () => {
    const lines = (file: string) =>
      read(file)
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('//'));
    const snippet = lines('alloy-logs.alloy');
    const stack = lines('loki/config.alloy');
    expect(stack.slice(0, snippet.length)).toEqual(snippet);
    expect(stack.slice(snippet.length).join('\n')).toContain('http://loki:3100/loki/api/v1/push');
  });

  it('OBS-LOKI-3 parses the Loki configuration and keeps 30 days', () => {
    const loki = parse(read('loki/loki.yml')) as { limits_config: { retention_period: string } };
    expect(loki.limits_config.retention_period).toBe('720h');
  });
});
