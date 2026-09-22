'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../..');
const compose = ['compose', '-p', 'capital-tracker-e2e', '-f', resolve(__dirname, 'compose.yml')];
const docker = (...args) => execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 30000 }).trim();
const inspect = (id) => JSON.parse(docker('inspect', id))[0];
const backend = inspect(docker(...compose, 'ps', '-q', 'backend'));
assert.equal(backend.Config.User, 'node', 'MFA runtime must remain non-root');
const keyMount = backend.Mounts.find(mount => mount.Destination === '/run/secrets/ct-mfa-key');
assert.ok(keyMount, 'MFA key must be supplied at runtime');
assert.equal(keyMount.RW, false, 'Runtime cannot overwrite the mounted MFA key');
const caMount = backend.Mounts.find(mount => mount.Destination === '/run/acceptance/provider-ca.pem');
assert.ok(caMount && !caMount.RW, 'Only the public synthetic provider certificate is mounted read-only');
assert.ok(!backend.Mounts.some(mount => mount.Source.endsWith('/provider-tls')
  || mount.Source.endsWith('/provider-tls/privkey.pem')), 'Application cannot read provider private key');
const providerContainer = inspect(docker(...compose, 'ps', '-q', 'providers'));
assert.ok(!providerContainer.Mounts.some(mount => mount.Destination === '/run/secrets/ct-mfa-key'
  || mount.Source.endsWith('/mfa-key')), 'External fixture cannot read the MFA key');
for (const name of ['backend', 'frontend', 'postgres', 'redis', 'providers']) {
  const container = inspect(docker(...compose, 'ps', '-q', name));
  assert.deepEqual(container.HostConfig.PortBindings ?? {}, {}, `${name} must have no published ports`);
}
const proxy = inspect(docker(...compose, 'ps', '-q', 'proxy'));
assert.deepEqual(proxy.HostConfig.PortBindings, { '443/tcp': [{ HostIp: '127.0.0.1', HostPort: '8443' }] });
for (const network of Object.keys(backend.NetworkSettings.Networks)) {
  const [info] = JSON.parse(docker('network', 'inspect', network));
  assert.equal(info.Internal, true, 'Backend network must deny external routing');
}
const scan = `
const fs = require('node:fs');
const assert = require('node:assert/strict');
for (const path of ['/tests', '/app/tests', '/app/backend/src', '/app/.env', '/app/backend/.env', '/run/secrets/ct-mfa-key', '/run/acceptance/provider-ca.pem']) {
  assert.equal(fs.existsSync(path), false, 'No fixture/source/env path: ' + path);
}
assert.equal(process.env.NODE_EXTRA_CA_CERTS, undefined, 'Production image must not carry fixture TLS trust');
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'Normal TLS verification remains enabled');
function walk(path) {
  for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
    const full = path + '/' + entry.name;
    if (entry.isDirectory()) walk(full);
    else {
      assert.ok(!/\\.(spec|test)\\./.test(entry.name), 'No compiled tests: ' + full);
      const contents = fs.readFileSync(full, 'utf8');
      for (const marker of ['Synthetic-password-42!', 'synthetic-characterization-secret', 'synthetic-scheduling-fixture', 'synthetic-acceptance-secret']) {
        assert.ok(!contents.includes(marker), 'No fixture credential in ' + full);
      }
    }
  }
}
walk('/app/backend/dist');
console.log('PASS ISO-005-A backend release files exclude fixture credentials and test code');
`;
// Inspect the exact running image ID, not a tag that could move after startup.
console.log(docker('run', '--rm', '--network', 'none', '--entrypoint', 'node', backend.Image, '-e', scan));
console.log(`PASS ISO-005-A isolated ports/network; tested backend image ${backend.Image}`);
console.log(`Tested frontend image ${inspect(docker(...compose, 'ps', '-q', 'frontend')).Image}`);

const frontend = inspect(docker(...compose, 'ps', '-q', 'frontend'));
const frontendScan = String.raw`
set -eu
test ! -e /tests
test ! -e /app
test -f /usr/share/nginx/html/index.html
if find /usr/share/nginx/html -type f | grep -E '\.(spec|test)\.'; then exit 1; fi
if grep -R -E 'Synthetic-password-42!|synthetic-characterization-secret|synthetic-scheduling-fixture|synthetic-acceptance-secret' /usr/share/nginx/html /etc/nginx/conf.d; then exit 1; fi
nginx -t
`;
docker('run', '--rm', '--network', 'none', '--entrypoint', 'sh', frontend.Image, '-c', frontendScan);
console.log('PASS ISO-005-A frontend release files');
