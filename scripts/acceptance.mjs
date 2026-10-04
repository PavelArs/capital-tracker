import { execFileSync } from 'node:child_process';
import { mkdirSync, lstatSync, writeFileSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { withPreservedFile } from './preserve-file.cjs';
import { assertSyntheticNetworks } from './acceptance-networks.cjs';
import { renderAcceptanceProxy } from './render-acceptance-proxy.cjs';
import criticalProfile from './critical-release-profile.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const releaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (process.env.CAPITAL_RELEASE_COMMIT && process.env.CAPITAL_RELEASE_COMMIT !== releaseCommit) {
  throw new Error('Acceptance image revision must match the checkout commit');
}
process.env.CAPITAL_RELEASE_COMMIT = releaseCommit;
const project = 'capital-tracker-e2e';
const composeArgs = ['compose', '-p', project, '-f', join(root, 'tests/e2e/compose.yml')];
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const compose = (...args) => run('docker', [...composeArgs, ...args]);
const command = process.argv[2] ?? 'run';
if (!['run', 'critical', 'down'].includes(command)) throw new Error('Use acceptance.mjs [run|critical|down]');
// This file/project exclusively owns disposable synthetic databases; never use production Compose.
if (command === 'down') {
  compose('down', '--remove-orphans');
} else {
  const receiptPath = join(root, 'test-results/critical-release-acceptance.json');
  if (existsSync(receiptPath)) unlinkSync(receiptPath);
  let selection;
  if (command === 'critical') {
    const manifest = JSON.parse(readFileSync(join(root, 'tests/e2e/manual-mvp-manifest.json'), 'utf8'));
    const inventory = JSON.parse(execFileSync('pnpm', ['exec', 'playwright', 'test', '--list', '--reporter=json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }));
    selection = criticalProfile.select(manifest, inventory);
    const routed = JSON.parse(execFileSync('pnpm', ['exec', 'playwright', 'test', ...selection.files,
      '--grep', selection.grep, '--list', '--reporter=json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }));
    criticalProfile.assertRouted(selection, routed);
  }
  const runAcceptance = () => withPreservedFile(join(root, 'frontend/nginx.conf'), async () => {
    let completedReceipt;
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
      '-addext', 'subjectAltName=DNS:blockstream.info,DNS:api.coingecko.com,DNS:api.exchangerate-api.com,DNS:open.er-api.com']);
    compose('down', '--remove-orphans');
    try {
      let postgresPin;
      let pinnedPostgresId;
      if (command === 'critical') {
        postgresPin = JSON.parse(readFileSync(join(root, 'deploy/manual-mvp-infrastructure-pins.json'), 'utf8')).postgres;
        pinnedPostgresId = execFileSync('docker', ['image', 'inspect', postgresPin.registryDigest, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
        if (execFileSync('docker', ['image', 'inspect', postgresPin.tag, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim() !== pinnedPostgresId) {
          throw new Error('Acceptance PostgreSQL differs from the reviewed original digest');
        }
        compose('build', 'backend', 'frontend');
        run('node', ['tests/e2e/restore-readiness.cjs', postgresPin.tag]);
      } else {
        compose('build', 'backend', 'frontend', 'postgres');
      }
      if (process.platform === 'linux') run('docker', ['run', '--rm', '--network', 'none', '--user', '0',
        '--mount', `type=bind,src=${key},dst=/synthetic-key`, '--entrypoint', 'node',
        'capital-tracker-backend:acceptance', '-e',
        "const fs=require('node:fs');fs.chownSync('/synthetic-key',1000,1000);fs.chmodSync('/synthetic-key',0o400)"]);
      if (process.platform === 'linux') run('docker', ['run', '--rm', '--network', 'none', '--user', '0',
        '--mount', `type=bind,src=${join(providerTls, 'privkey.pem')},dst=/synthetic-provider-key`, '--entrypoint', 'node',
        'capital-tracker-backend:acceptance', '-e',
        "const fs=require('node:fs');fs.chownSync('/synthetic-provider-key',1000,1000);fs.chmodSync('/synthetic-provider-key',0o400)"]);
      compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'postgres', 'redis', 'providers');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e/provider-proxy.cjs')}:/tests/provider-proxy.cjs:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'node', '/tests/provider-proxy.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/migrations.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/auth-limits-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/manual-opening-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/usd-trades-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/csv-import-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/carry-in-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/historical-accounting-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/external-usd-flows-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/period-profit-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/xirr-preview-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/twr-preview-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/linked-twr-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/manual-usd-prices-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/historical-valuation-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/valuation-history-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/display-fx-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/manual-portfolio-valuation-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/owned-transfers-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/owned-transfers-bounds-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/asset-rewards-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/asset-rewards-bounds-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/asset-swaps-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/asset-swaps-bounds-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/wallet-addresses-db.cjs');
      compose('run', '--rm', '--no-deps', '-v', `${join(root, 'tests/e2e')}:/tests:ro`,
        '-e', 'NODE_PATH=/app/backend/node_modules', 'migrate', 'env', '-u', 'TRUSTED_PROXY_IPS', 'node', '/tests/asset-classification-db.cjs');
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
      compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'backend', 'backend-replica', 'frontend', 'proxy', 'client-a', 'client-b');
      if (postgresPin && execFileSync('docker', ['image', 'inspect', postgresPin.tag, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim() !== pinnedPostgresId) {
        throw new Error('Acceptance changed the reviewed PostgreSQL image identity');
      }
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
      if (command === 'critical') {
        const reportPath = join(root, 'tests/e2e/.runtime/critical-playwright.json');
        if (existsSync(reportPath)) unlinkSync(reportPath);
        execFileSync('pnpm', ['exec', 'playwright', 'test', ...selection.files,
          '--grep', selection.grep, '--workers=1', '--retries=0', '--reporter=json'], {
          cwd: root, stdio: 'inherit',
          env: { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
        });
        const result = JSON.parse(readFileSync(reportPath, 'utf8'));
        completedReceipt = criticalProfile.receipt(selection, result, releaseCommit, process.env.GITHUB_RUN_ID ?? 'local');
      } else {
        run('pnpm', ['exec', 'playwright', 'test']);
      }
    } finally {
      compose('down', '--remove-orphans');
    }
    return completedReceipt;
  });
  if (command === 'critical') {
    // The returned value is available only after Compose cleanup and Nginx preservation.
    const receipt = await criticalProfile.publishAfterGates(runAcceptance, receiptPath);
    console.log('PASS ISO-005-C checkout Nginx file preserved through acceptance and cleanup');
    console.log(`PASS critical release profile: ${receipt.cases.length} exact browser cases`);
  } else {
    await runAcceptance();
    console.log('PASS ISO-005-C checkout Nginx file preserved through acceptance and cleanup');
  }
}
