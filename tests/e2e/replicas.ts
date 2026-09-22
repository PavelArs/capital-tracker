import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sendFrom } from './source-client';

const { renderAcceptanceProxy } = require('../../scripts/render-acceptance-proxy.cjs');
const root = resolve(__dirname, '../..');
const compose = ['compose', '-p', 'capital-tracker-e2e', '-f', resolve(__dirname, 'compose.yml')];
const docker = (...args: string[]): string => execFileSync('docker', args, {
  cwd: root, encoding: 'utf8', timeout: 120_000,
}).trim();
const services = ['backend', 'backend-replica'] as const;
const endpoints = { primary: '172.30.91.10:3000', replica: '172.30.91.11:3000' };
type Backend = keyof typeof endpoints;
export type UpstreamEvidence = { source: string; upstream: string; backend: Backend };

function lines(): string[] {
  const output = docker(...compose, 'exec', '-T', 'proxy', 'cat', '/var/log/nginx/acceptance-upstreams.log');
  return output ? output.split('\n') : [];
}

export async function upstreamMark(): Promise<number> { return lines().length; }

export async function upstreamsSince(mark: number): Promise<UpstreamEvidence[]> {
  const current = lines();
  assert.ok(Number.isInteger(mark) && mark >= 0 && mark <= current.length, 'Routing evidence must not be truncated');
  return current.slice(mark).flatMap((line) => {
    const [source, upstream, extra] = line.split(' ');
    assert.equal(extra, undefined, 'Routing log has exactly two safe fields');
    const backend = (Object.keys(endpoints) as Backend[]).find(name => endpoints[name] === upstream);
    // Frontend traffic is also logged; only actual backend upstreams are relevant.
    return backend ? [{ source, upstream, backend }] : [];
  });
}

export async function selectBackend(mode: Backend | 'both'): Promise<void> {
  writeFileSync(resolve(__dirname, '.runtime/deploy-nginx.conf'), renderAcceptanceProxy(mode));
  docker(...compose, 'exec', '-T', 'proxy', 'nginx', '-t');
  const mark = await upstreamMark();
  docker(...compose, 'exec', '-T', 'proxy', 'nginx', '-s', 'reload');
  const deadline = Date.now() + 10_000;
  // A real harmless HTTPS probe proves the reloaded route; no arbitrary sleep or
  // auth request is used. Client B keeps client A's exact routing evidence separate.
  do {
    const result = await sendFrom('client-b', { requests: [{ method: 'GET', path: '/api/health' }] });
    assert.equal(result.responses[0].status, 200);
    const observed = (await upstreamsSince(mark)).filter(row => row.source === '172.30.90.11');
    const reached = new Set(observed.map(row => row.backend));
    if (mode === 'both' ? reached.has('primary') && reached.has('replica') : reached.has(mode)) return;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error('Synthetic Nginx selection did not reach its expected actual backend');
}

function state(service: typeof services[number]) {
  const id = docker(...compose, 'ps', '-q', service);
  assert.ok(id, 'Expected owned backend container');
  const [container] = JSON.parse(docker('inspect', id));
  assert.equal(container.Config.Labels['com.docker.compose.project'], 'capital-tracker-e2e');
  return container;
}

export async function restartBackends(): Promise<void> {
  const before = services.map(state);
  docker(...compose, 'restart', ...services);
  const deadline = Date.now() + 60_000;
  for (let index = 0; index < services.length; index++) {
    let ready = false;
    do {
      const current = state(services[index]);
      if (current.State.Running && current.State.Health?.Status === 'healthy'
        && current.State.StartedAt !== before[index].State.StartedAt) {
        // Check each process directly: a healthy sibling cannot conceal failure.
        docker(...compose, 'exec', '-T', services[index], 'node', '-e',
          "fetch('http://127.0.0.1:3000/health').then(async r=>{if(r.status!==200||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))");
        assert.equal(current.Image, before[index].Image);
        ready = true;
        break;
      }
      await delay(100);
    } while (Date.now() < deadline);
    assert.ok(ready, `Independent restart readiness failed: ${services[index]}`);
  }
}
