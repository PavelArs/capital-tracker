import { execFile, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export type SourceJar = Record<string, string>;
export type SourceResponse = {
  status: number;
  headers: Record<string, string | string[]>;
  body: any;
  localAddress: string;
  remoteAddress: string;
};
export type SourceInput = {
  requests: Array<{
    method: string;
    path: string;
    headers?: Record<string, string | string[]>;
    body?: unknown;
  }>;
  jar?: SourceJar;
};
export type SourceResult = { responses: SourceResponse[]; jar: SourceJar };
const root = resolve(__dirname, '../..');
const compose = ['compose', '-p', 'capital-tracker-e2e', '-f', resolve(__dirname, 'compose.yml')];
const docker = (args: string[], input?: string) => execFileSync('docker', args, {
  cwd: root, encoding: 'utf8', input, timeout: 120_000,
});

export async function sendFrom(client: 'client-a' | 'client-b', input: SourceInput): Promise<SourceResult> {
  // Actual concurrent callers must overlap; Promise.all around execFileSync would
  // silently serialize requests and provide no shared-budget race evidence.
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile('docker', [...compose, 'exec', '-T', client, 'node', '/tests/client.cjs'], {
      cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error); });
    child.stdin?.end(JSON.stringify(input));
  });
  const result: SourceResult = JSON.parse(output);
  for (const response of result.responses) {
    assert.equal(response.localAddress, client === 'client-a' ? '172.30.90.10' : '172.30.90.11');
    assert.equal(response.remoteAddress, '172.30.90.2');
  }
  return result;
}

export async function sendDirect(source: 'trusted' | 'untrusted', input: SourceInput): Promise<SourceResult> {
  const backendId = docker([...compose, 'ps', '-q', 'backend']).trim();
  const [backend] = JSON.parse(docker(['inspect', backendId]));
  const directAddress = backend.NetworkSettings.Networks['capital-tracker-e2e_isolated'].IPAddress;
  const networkArgs = source === 'trusted'
    ? ['--network', `container:${docker([...compose, 'ps', '-q', 'proxy']).trim()}`]
    : ['--network', 'capital-tracker-e2e_isolated', '--ip', '172.30.91.30'];
  const name = `capital-tracker-e2e-source-${randomUUID()}`;
  try {
    const result: SourceResult = JSON.parse(docker(['run', '--rm', '-i', '--name', name,
      '--label', 'com.capital-tracker.acceptance=client-source', '--read-only', ...networkArgs,
      '--mount', `type=bind,src=${resolve(__dirname, 'source-client.cjs')},dst=/tests/client.cjs,readonly`,
      '--entrypoint', 'node', backend.Image, '/tests/client.cjs'], JSON.stringify({ ...input, directAddress })));
    for (const response of result.responses) {
      assert.equal(response.localAddress, source === 'trusted' ? '172.30.91.2' : '172.30.91.30');
      assert.equal(response.remoteAddress, directAddress);
    }
    return result;
  } finally {
    // A timed-out Docker CLI can leave its container alive: remove only this exact probe.
    try { docker(['rm', '-f', name]); }
    catch (error) {
      if (!String((error as { stderr?: string }).stderr).includes('No such container')) throw error;
    }
  }
}
