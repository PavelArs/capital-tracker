'use strict';

// MRR-001-A/B: a real, disposable PostgreSQL 18 init-hook race and TCP restore.
// Usage: node tests/e2e/restore-readiness.cjs IMAGE
// CI supplies the already authenticated, digest-pinned acceptance image.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const image = process.argv[2];
assert.ok(image && !process.argv[3] && /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$/.test(image),
  'Supply exactly one already selected PostgreSQL image reference');
const root = path.resolve(__dirname, '../..');
const normalizer = path.join(root, 'scripts/normalize-release-snapshot.awk');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'capital-pg-restore-'));
const handshake = path.join(fixture, 'handshake');
const hook = path.join(fixture, '00-hold.sh');
const key = path.join(fixture, 'synthetic-backup-key');
const sourceName = `capital-pg-source-${randomUUID()}`;
const targetName = `capital-pg-target-${randomUUID()}`;
const containers = [];

function command(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: root, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], ...options,
  });
}
const docker = (args, options) => command('docker', args, options);
const digest = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const probe = (id, host) => {
  try {
    docker(['exec', id, 'pg_isready', ...(host ? ['-h', '127.0.0.1'] : []),
      '-U', 'postgres', '-d', 'postgres']);
    return true;
  } catch {
    return false;
  }
};
function waitFor(label, check, attempts, intervalMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return;
    sleep(intervalMs);
  }
  throw new Error(`${label} did not become ready in ${attempts} bounded attempts`);
}
function start(name, mounts = []) {
  const id = docker(['run', '-d', '--name', name, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e', 'PGDATA=/var/lib/postgresql/18/docker',
    ...mounts, image], { encoding: 'utf8', timeout: 60_000 }).trim();
  assert.match(id, /^[a-f0-9]{64}$/);
  containers.push(id);
  const details = JSON.parse(docker(['inspect', id], { encoding: 'utf8' }))[0];
  assert.equal(details.HostConfig.NetworkMode, 'none');
  assert.equal(details.Image, initialImageId, 'Fixture must run the selected image ID');
  assert.deepEqual(details.HostConfig.PortBindings ?? {}, {});
  assert.ok(details.HostConfig.Tmpfs['/var/lib/postgresql'] !== undefined);
  assert.ok(!details.Mounts.some(mount => mount.Type === 'volume'));
  return id;
}
function sql(id, statement) {
  return docker(['exec', id, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
    '-U', 'postgres', '-d', 'postgres', '-At', '-c', statement], { encoding: 'utf8' }).trim();
}
function fingerprint(id) {
  const dump = docker(['exec', id, 'pg_dump', '--no-owner', '--no-privileges',
    '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres']);
  return digest(command('awk', ['-f', normalizer], { input: dump }));
}
function imageId() {
  const id = docker(['image', 'inspect', image, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
  assert.match(id, /^sha256:[a-f0-9]{64}$/);
  return id;
}

let initialImageId;
try {
  initialImageId = imageId();
  fs.mkdirSync(handshake, { mode: 0o777 });
  fs.chmodSync(handshake, 0o777); // Only a synthetic, disposable handshake is shared.
  fs.writeFileSync(hook, '#!/bin/sh\nset -eu\ntouch /fixture/entered\nwhile [ ! -f /fixture/release ]; do sleep 0.1; done\n', { mode: 0o755 });
  fs.chmodSync(hook, 0o755);
  fs.writeFileSync(key, randomBytes(48), { mode: 0o600 });
  const source = start(sourceName, ['-v', `${hook}:/docker-entrypoint-initdb.d/00-hold.sh:ro`,
    '-v', `${handshake}:/fixture:rw`]);
  waitFor('PostgreSQL init hook', () => fs.existsSync(path.join(handshake, 'entered')), 120, 250);
  assert.equal(docker(['exec', source, 'sh', '-c', 'cat "$PGDATA/PG_VERSION"'],
    { encoding: 'utf8' }).trim(), '18');
  waitFor('temporary Unix socket', () => probe(source, false), 60, 250);
  assert.equal(probe(source, true), false, 'Temporary init server must refuse loopback TCP');
  assert.throws(() => waitFor('final loopback TCP', () => probe(source, true), 60, 50),
    /did not become ready in 60 bounded attempts/);
  // The held server cannot pass the gate, so no decrypt or restore is attempted.
  console.log('PASS MRR-001-B 60 TCP attempts refuse the socket-only init server');

  fs.writeFileSync(path.join(handshake, 'release'), '', { flag: 'wx' });
  waitFor('final loopback TCP', () => probe(source, true), 60, 1_000);
  // Exercise the release gate against an actual pristine PG18 cluster, including
  // its built-in roles/extensions, before the fixture deliberately adds data.
  command('python3', ['-I', path.join(root, 'scripts/manual-mvp-resume.py'),
    'cluster', source, 'postgres', 'postgres']);
  sql(source, "CREATE SCHEMA fixture; CREATE TABLE fixture.entries (id integer PRIMARY KEY, amount numeric(18,6) NOT NULL, note text NOT NULL); INSERT INTO fixture.entries VALUES (1, 12.500000, 'socket vs tcp'), (2, -0.125000, 'unicode π');");
  const query = 'SELECT id || E\'|\' || amount || E\'|\' || note FROM fixture.entries ORDER BY id';
  const expected = '1|12.500000|socket vs tcp\n2|-0.125000|unicode π';
  assert.equal(sql(source, query), expected, 'Synthetic source rows must match the independent oracle');
  const sourceFingerprint = fingerprint(source);
  const archive = docker(['exec', source, 'pg_dump', '-Fc', '-h', '127.0.0.1',
    '-U', 'postgres', '-d', 'postgres']);
  const encrypted = command('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-iter', '200000',
    '-salt', '-pass', `file:${key}`], { input: archive });
  assert.notEqual(digest(encrypted), digest(archive), 'Archive must be encrypted');
  const target = start(targetName);
  waitFor('isolated restore TCP', () => probe(target, true), 60, 1_000);
  assert.equal(docker(['exec', target, 'sh', '-c', 'cat "$PGDATA/PG_VERSION"'],
    { encoding: 'utf8' }).trim(), '18');
  const decrypted = command('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2',
    '-iter', '200000', '-pass', `file:${key}`], { input: encrypted });
  assert.equal(digest(decrypted), digest(archive), 'Encrypted archive must decrypt exactly');
  docker(['exec', '-i', target, 'pg_restore', '--exit-on-error', '--clean', '--if-exists',
    '--no-owner', '--no-privileges', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'],
  { input: decrypted, timeout: 60_000 });
  assert.equal(sql(target, query), expected, 'Restored rows must match the independent oracle');
  assert.equal(fingerprint(target), sourceFingerprint, 'Logical SQL fingerprint must match');
  assert.equal(imageId(), initialImageId, 'Pinned source image identity must remain unchanged');
  console.log('PASS MRR-001-A final PG18 TCP restore and isolated fingerprint');
} finally {
  for (const id of containers.reverse()) {
    try { docker(['container', 'rm', '-f', id]); } catch { /* Preserve original failure. */ }
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}
