import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };
const root = resolve(__dirname, '../../..');

describe('PRC-2 production switch (owner decision 2026-10-04)', () => {
  it('collects prices in production without enabling the legacy background jobs', () => {
    const compose = parse(readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')) as {
      services: { backend: { environment: Record<string, string> } };
    };
    const environment = compose.services.backend.environment;
    expect(environment.PRICE_COLLECTION_ENABLED).toBe('true');
    expect(environment.BACKGROUND_JOBS_ENABLED).toBe('false');
    expect(environment).not.toHaveProperty('COINGECKO_DEMO_API_KEY');
  });
});
