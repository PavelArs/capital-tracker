import { execFileSync } from 'node:child_process';
import { mkdirSync, lstatSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { withPreservedFile } from './preserve-file.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const project = 'capital-tracker-e2e';
const composeArgs = ['compose', '-p', project, '-f', join(root, 'tests/e2e/compose.yml')];
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const compose = (...args) => run('docker', [...composeArgs, ...args]);
const command = process.argv[2] ?? 'run';
if (!['run', 'down'].includes(command)) throw new Error('Use acceptance.mjs [run|down]');
// This file/project exclusively owns disposable synthetic databases; never use production Compose.
if (command === 'down') {
  compose('down', '--remove-orphans');
} else {
  await withPreservedFile(join(root, 'frontend/nginx.conf'), async () => {
    const tls = join(root, 'tests/e2e/.runtime/tls');
    mkdirSync(tls, { recursive: true });
    const key = join(root, 'tests/e2e/.runtime/mfa-key');
    try { writeFileSync(key, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const keyStat = lstatSync(key);
    if (!keyStat.isFile() || keyStat.size !== 32 || ![0o400, 0o600].includes(keyStat.mode & 0o7777)) {
      throw new Error('Synthetic MFA fixture key must be a private regular 32-byte file');
    }
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '2', '-nodes',
      '-keyout', join(tls, 'privkey.pem'), '-out', join(tls, 'fullchain.pem'),
      '-subj', '/CN=capital-tracker-e2e.invalid', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);
    compose('down', '--remove-orphans');
    try {
      compose('build', 'backend', 'frontend');
      if (process.platform === 'linux') run('docker', ['run', '--rm', '--network', 'none', '--user', '0',
        '--mount', `type=bind,src=${key},dst=/synthetic-key`, '--entrypoint', 'node',
        'capital-tracker-backend:acceptance', '-e',
        "const fs=require('node:fs');fs.chownSync('/synthetic-key',1000,1000);fs.chmodSync('/synthetic-key',0o400)"]);
      compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis', 'providers');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'node', '/tests/migrations.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'node', '/tests/owner-cli.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'node', '/tests/sessions-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'node', '/tests/mfa-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'node', '/tests/mfa-expiry.cjs');
      compose('run', '--rm', '--no-deps', 'migrate');
      compose('run', '--rm', '--no-deps', 'seed');
      compose('up', '-d', '--wait', '--wait-timeout', '120', 'backend', 'frontend', 'proxy');
      // Container health is insufficient: verify the browser's actual host ingress too.
      let ready = false;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && !ready) {
        ready = await new Promise((resolve) => {
          const request = https.get('https://127.0.0.1:8443/health', { rejectUnauthorized: false, timeout: 2_000 },
            (response) => { response.resume(); resolve(response.statusCode === 200); });
          request.on('error', () => resolve(false));
          request.on('timeout', () => request.destroy());
        });
        if (!ready) await delay(200);
      }
      if (!ready) throw new Error('Synthetic HTTPS proxy is not reachable from the browser host');
      run('node', ['tests/e2e/artifacts.cjs']);
      run('pnpm', ['exec', 'playwright', 'test']);
    } finally {
      compose('down', '--remove-orphans');
    }
  });
  console.log('PASS ISO-005-C checkout Nginx file preserved through acceptance and cleanup');
}
