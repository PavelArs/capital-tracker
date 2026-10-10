'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { renderAcceptanceProxy } = require('../../scripts/render-acceptance-proxy.cjs');
const root = resolve(__dirname, '../..');
const compose = ['compose', '-p', 'capital-tracker-e2e', '-f', resolve(__dirname, 'compose.yml')];
// A bound against a hung Docker call, not a speed check: on a self-hosted runner whose disk
// another runner is loading images onto, `docker run --rm` alone has taken over 30 seconds.
const docker = (...args) => execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 120000 }).trim();
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
for (const name of ['backend', 'backend-replica', 'frontend', 'postgres', 'redis', 'providers']) {
  const container = inspect(docker(...compose, 'ps', '-q', name));
  assert.deepEqual(container.HostConfig.PortBindings ?? {}, {}, `${name} must have no published ports`);
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), ['capital-tracker-e2e_isolated']);
}
const proxy = inspect(docker(...compose, 'ps', '-q', 'proxy'));
assert.deepEqual(Object.keys(proxy.NetworkSettings.Networks).sort(),
  ['capital-tracker-e2e_clients', 'capital-tracker-e2e_ingress', 'capital-tracker-e2e_isolated']);
assert.equal(proxy.NetworkSettings.Networks['capital-tracker-e2e_isolated'].IPAddress, '172.30.91.2');
assert.ok(backend.Config.Env.includes('TRUSTED_PROXY_IPS=["172.30.91.2"]'));
assert.ok(backend.Config.Env.includes('EXCHANGE_RATES_CACHE_TTL=86400000'));
const replica = inspect(docker(...compose, 'ps', '-q', 'backend-replica'));
assert.equal(replica.Image, backend.Image);
assert.deepEqual([...replica.Config.Env].sort(), [...backend.Config.Env].sort());
const mountsByDestination = container => [...container.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination));
assert.deepEqual(mountsByDestination(replica), mountsByDestination(backend));
assert.equal(replica.Config.User, backend.Config.User);
const imageHealth = inspect(backend.Image).Config.Healthcheck;
for (const container of [backend, replica]) {
  assert.deepEqual(container.Config.Healthcheck, {
    ...imageHealth, Interval: 2_000_000_000, StartInterval: 2_000_000_000,
  }, 'Only acceptance readiness cadence differs from the exact image health policy');
}
assert.equal(backend.NetworkSettings.Networks['capital-tracker-e2e_isolated'].IPAddress, '172.30.91.10');
assert.equal(replica.NetworkSettings.Networks['capital-tracker-e2e_isolated'].IPAddress, '172.30.91.11');
const rendered = renderAcceptanceProxy();
assert.equal(docker(...compose, 'exec', '-T', 'proxy', 'cat', '/etc/nginx/conf.d/default.conf'), rendered.trim());
docker(...compose, 'exec', '-T', 'proxy', 'nginx', '-t');
const effective = docker(...compose, 'exec', '-T', 'proxy', 'nginx', '-T').replace(/#[^\n]*/g, '');
for (const [header, value] of [['X-Forwarded-For', '$remote_addr'], ['X-Real-IP', '$remote_addr'],
  ['X-Forwarded-Proto', '$scheme'], ['Forwarded', '""'], ['X-Forwarded-Host', '""']]) {
  const directives = [...effective.matchAll(new RegExp(`proxy_set_header\\s+${header}\\s+([^;]+);`, 'gi'))];
  assert.equal(directives.length, 1, 'One inherited forwarding policy: ' + header);
  assert.equal(directives[0][1].trim(), value);
}
assert.doesNotMatch(effective, /location\s+[^{}]+\{[^{}]*proxy_set_header/i);
assert.doesNotMatch(effective, /\b(real_ip_header|set_real_ip_from|real_ip_recursive|proxy_protocol)\b/i);
for (const [name, address] of [['client-a', '172.30.90.10'], ['client-b', '172.30.90.11']]) {
  const client = inspect(docker(...compose, 'ps', '-q', name));
  assert.equal(client.Image, backend.Image, 'Clients reuse the tested image');
  assert.equal(client.Config.User, 'node');
  assert.equal(client.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(client.HostConfig.PortBindings ?? {}, {});
  assert.deepEqual(Object.keys(client.NetworkSettings.Networks), ['capital-tracker-e2e_clients']);
  assert.equal(client.NetworkSettings.Networks['capital-tracker-e2e_clients'].IPAddress, address);
  assert.ok(!client.Config.Env.some(value => /^(DB_|MFA_|HTTP_PROXY=|HTTPS_PROXY=)/.test(value)));
  assert.deepEqual(client.Mounts.map(mount => mount.Destination).sort(), ['/tests/client.cjs', '/tests/public-ca.pem']);
  assert.ok(client.Mounts.every(mount => !mount.RW));
}
const [clientNetwork] = JSON.parse(docker('network', 'inspect', 'capital-tracker-e2e_clients'));
assert.equal(clientNetwork.Internal, true);
assert.deepEqual(Object.values(clientNetwork.Containers).map(container => container.Name).sort(),
  ['capital-tracker-e2e-client-a-1', 'capital-tracker-e2e-client-b-1', 'capital-tracker-e2e-proxy-1']);
const [ingressNetwork] = JSON.parse(docker('network', 'inspect', 'capital-tracker-e2e_ingress'));
assert.deepEqual(Object.values(ingressNetwork.Containers).map(container => container.Name), ['capital-tracker-e2e-proxy-1']);
console.log('PASS PROXY-004-A actual deployment Nginx config and isolated real client topology');
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
