import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };
const compose = parse(
  readFileSync(resolve(__dirname, '../../../tests/e2e/compose.yml'), 'utf8'),
) as {
  services: Record<
    string,
    { healthcheck: { disable?: boolean; test?: string[]; interval: string; timeout: string; retries: number } }
  >;
};

describe('Synthetic source clients have real process and fixture readiness', () => {
  it.each(['client-a', 'client-b'])('%s refuses missing request fixtures', (name) => {
    const health = compose.services[name].healthcheck;
    expect(health.disable).not.toBe(true);
    expect(health.test?.slice(0, 3)).toEqual(['CMD', 'node', '-e']);
    expect(health).toMatchObject({ interval: '2s', timeout: '3s', retries: 30 });
    const directory = mkdtempSync(join(tmpdir(), 'capital-client-readiness-'));
    const script = join(directory, 'client.cjs');
    const ca = join(directory, 'public-ca.pem');
    writeFileSync(script, '// Synthetic mounted request script\n');
    writeFileSync(ca, 'Synthetic public certificate fixture\n');
    // Execute the actual predicate against real files. The local Jest parent is
    // the live process fixture; container PID1 is verified separately with Compose.
    const command = health.test![3]
      .replace('process.kill(1,0)', `process.kill(${process.pid},0)`)
      .replace("'/tests/client.cjs'", JSON.stringify(script))
      .replace("'/tests/public-ca.pem'", JSON.stringify(ca));
    const run = () => spawnSync(process.execPath, ['-e', command], { encoding: 'utf8', timeout: 5000 });
    try {
      expect(run().status).toBe(0);
      for (const path of [script, ca]) {
        unlinkSync(path);
        const result = run();
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('ENOENT');
        expect(result.stderr).toContain(path);
        writeFileSync(path, 'Synthetic readable request fixture\n');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
