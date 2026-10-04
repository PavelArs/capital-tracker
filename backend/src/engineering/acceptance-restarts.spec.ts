import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const e2e = resolve(__dirname, '../../../tests/e2e');
const sources = readdirSync(e2e)
  .filter((name) => /\.(ts|cjs|mjs)$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(e2e, name), 'utf8') }));

describe('ISO-006 Acceptance backend restarts skip the ignored stop signal', () => {
  it('ISO-006-A restarts the backend pair with a zero stop timeout', () => {
    const replicas = sources.find(({ name }) => name === 'replicas.ts');
    expect(replicas?.text).toContain(
      "docker(...compose, 'restart', '--timeout', '0', ...services);",
    );
  });

  it('ISO-006-A leaves no Compose restart that waits for the stop timeout', () => {
    const restarts = sources.flatMap(({ name, text }) =>
      text
        .split('\n')
        .filter((line) => /['"]restart['"]/.test(line))
        .map((line) => `${name}: ${line.trim()}`),
    );
    expect(restarts.length).toBeGreaterThan(0);
    for (const line of restarts) expect(line).toMatch(/'restart', '--timeout', '0'/);
  });
});
