import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };
const root = resolve(__dirname, '../../..');

describe('PRC-2 production switch (owner decision 2026-10-04)', () => {
  it('collects prices in production, where PRICE_COLLECTION_ENABLED is the only background-job switch', () => {
    const compose = parse(readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')) as {
      services: { backend: { environment: Record<string, string> } };
    };
    const environment = compose.services.backend.environment;
    expect(environment.PRICE_COLLECTION_ENABLED).toBe('true');
    const switches = Object.keys(environment).filter((key) => key.endsWith('_ENABLED'));
    expect(switches.sort()).toEqual(['DISPLAY_FX_ENABLED', 'PRICE_COLLECTION_ENABLED']);
    expect(environment).not.toHaveProperty('COINGECKO_DEMO_API_KEY');
  });
});
