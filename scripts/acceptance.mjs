import { execFileSync } from 'node:child_process';
import { mkdirSync, lstatSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { withPreservedFile } from './preserve-file.cjs';
import { assertSyntheticNetworks } from './acceptance-networks.cjs';
import { renderAcceptanceProxy } from './render-acceptance-proxy.cjs';

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
    assertSyntheticNetworks();
    const tls = join(root, 'tests/e2e/.runtime/tls');
    mkdirSync(tls, { recursive: true });
    // Exercise the actual deployment edge, changing only synthetic authorities/TLS.
    writeFileSync(join(root, 'tests/e2e/.runtime/deploy-nginx.conf'), renderAcceptanceProxy());
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
    const providerTls = join(root, 'tests/e2e/.runtime/provider-tls');
    mkdirSync(providerTls, { recursive: true });
    if (!lstatSync(providerTls).isDirectory()) throw new Error('Provider TLS fixture directory must not be a symlink');
    // These two fixed fixture files are synthetic, regenerated each run. A previous
    // Linux run may have assigned the private key to the non-root fixture container.
    for (const name of ['privkey.pem', 'fullchain.pem']) {
      const path = join(providerTls, name);
      try {
        if (!lstatSync(path).isFile()) throw new Error('Provider TLS fixture must be a regular file');
        unlinkSync(path);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '2', '-nodes',
      '-keyout', join(providerTls, 'privkey.pem'), '-out', join(providerTls, 'fullchain.pem'),
      '-subj', '/CN=capital-tracker-provider-fixture.invalid',
      '-addext', 'subjectAltName=DNS:blockstream.info,DNS:api.coingecko.com,DNS:api.exchangerate-api.com']);
    compose('down', '--remove-orphans');
    try {
      compose('build', 'backend', 'frontend');
      if (process.platform === 'linux') run('docker', ['run', '--rm', '--network', 'none', '--user', '0',
        '--mount', `type=bind,src=${key},dst=/synthetic-key`, '--entrypoint', 'node',
        'capital-tracker-backend:acceptance', '-e',
        "const fs=require('node:fs');fs.chownSync('/synthetic-key',1000,1000);fs.chmodSync('/synthetic-key',0o400)"]);
      if (process.platform === 'linux') run('docker', ['run', '--rm', '--network', 'none', '--user', '0',
        '--mount', `type=bind,src=${join(providerTls, 'privkey.pem')},dst=/synthetic-provider-key`, '--entrypoint', 'node',
        'capital-tracker-backend:acceptance', '-e',
        "const fs=require('node:fs');fs.chownSync('/synthetic-provider-key',1000,1000);fs.chmodSync('/synthetic-provider-key',0o400)"]);
      compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis', 'providers');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e/provider-proxy.cjs')}:/tests/provider-proxy.cjs:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'node', '/tests/provider-proxy.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/migrations.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/owner-cli.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/sessions-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/mfa-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/mfa-expiry.cjs');
      compose('run', '--rm', '--no-deps', 'migrate');
      compose('run', '--rm', '--no-deps', 'seed');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'node', '/tests/client-source-startup.cjs');
      compose('up', '-d', '--wait', '--wait-timeout', '120', 'backend', 'backend-replica', 'frontend', 'proxy', 'client-a', 'client-b');
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
