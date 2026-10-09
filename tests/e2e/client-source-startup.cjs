'use strict';

// External release-image acceptance only. Run after migrate/seed, before HTTP
// backend startup, with /tests mounted and NODE_PATH=/app/backend/node_modules.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const net = require('node:net');
const { Client } = require('pg');

const settings = {
  DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e',
};
const mainPath = '/app/backend/dist/main.js';
const validationPath = '/app/backend/dist/config/env.validation.js';
const migrationPath = '/app/backend/dist/migrate.js';
const startupPort = 39017;
const sentinel = `synthetic-startup-secret-${randomBytes(12).toString('hex')}`;
const invalid = [
  ['missing', undefined],
  ['empty', ''],
  ['broken-json', '['],
  ['null', 'null'],
  ['object', '{"synthetic-startup-config-value":"must-not-be-echoed"}'],
  ['string', '"127.0.0.1"'],
  // Distinct safe-integer canary avoids incidental short stack/path substrings.
  ['number', '812734650918273'],
  ['boolean', 'false'],
  ['nonstring-null', '[null]'],
  ['nonstring-number', '[1]'],
  ['nonstring-object', '[{}]'],
  ['nested-array', '[[]]'],
  ['empty-entry', '[""]'],
  ['hostname', '["private-proxy.example.invalid"]'],
  ['symbolic-peer', '["loopback"]'],
  ['cidr-v4', '["127.0.0.0/8"]'],
  ['cidr-v6', '["2001:db8::/32"]'],
  ['port', '["127.0.0.1:3000"]'],
  ['bracketed', '["[::1]"]'],
  ['zone', '["fe80::1%eth0"]'],
  ['shorthand', '["127.1"]'],
  ['leading-zero', '["127.000.0.1"]'],
  ['whitespace-literal', '[" 127.0.0.1"]'],
  ['too-many', JSON.stringify(Array.from({ length: 9 }, (_, index) => `192.0.2.${index + 1}`))],
  ['duplicate', '["127.0.0.1","127.0.0.1"]'],
  ['mapped-duplicate', '["127.0.0.1","::ffff:127.0.0.1"]'],
  ['ipv6-duplicate', '["2001:db8::1","2001:0db8:0:0:0:0:0:1"]'],
];

function environment(value) {
  const env = {
    ...process.env, ...settings, PORT: String(startupPort),
    NODE_ENV: 'production', BACKGROUND_JOBS_ENABLED: 'false',
    HTTP_STARTUP_SECRET_SENTINEL: sentinel,
  };
  delete env.TRUSTED_PROXY_IPS;
  if (value !== undefined) env.TRUSTED_PROXY_IPS = value;
  return env;
}

function safeOutput(output, rejectedValue) {
  const secrets = [sentinel, settings.DB_PASSWORD, 'Synthetic-password-42!'];
  const key = readFileSync(process.env.MFA_KEY_FILE);
  secrets.push(key.toString('hex'), key.toString('base64'));
  for (const secret of secrets) {
    assert.ok(!output.includes(secret), 'Startup/CLI output must not disclose synthetic secrets');
  }
  if (typeof rejectedValue === 'string' && rejectedValue.length > 2) {
    assert.ok(!output.includes(rejectedValue), 'Configuration refusal must not echo its input');
  }
}

async function fingerprint(client) {
  const result = {};
  const schemaQueries = {
    tables: "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    columns: `SELECT table_name,column_name,ordinal_position,data_type,udt_name,
      is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
    constraints: `SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      ORDER BY c.relname,k.conname`,
    indexes: "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
    enums: `SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e
      JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder`,
    sequences: "SELECT * FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
    extensions: 'SELECT extname,extversion FROM pg_extension ORDER BY extname',
  };
  for (const [name, sql] of Object.entries(schemaQueries)) result[name] = (await client.query(sql)).rows;
  result.rows = {};
  for (const { tablename } of result.tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    result.rows[tablename] = (await client.query(
      `SELECT to_jsonb(t)::text AS row FROM public.${quoted} t ORDER BY row`,
    )).rows;
  }
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

function listening() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: startupPort });
    const finish = (accepted) => { socket.destroy(); resolve(accepted); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(100, () => finish(false));
  });
}

async function startup(value) {
  assert.equal(await listening(), false, 'Probe requires its own unused container-local port');
  let served = false;
  let output = '';
  let childError;
  const probes = [];
  const probe = () => {
    probes.push(listening().then((accepted) => { served ||= accepted; }));
  };
  const child = spawn(process.execPath, [mainPath], {
    cwd: '/app/backend', env: environment(value),
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  });
  const capture = (chunk) => {
    output += chunk;
    if (Buffer.byteLength(output) > 131072) {
      childError = new Error('Bounded startup output exceeded');
      child.kill('SIGKILL');
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (error) => { childError = error; });
  probe();
  const monitor = setInterval(probe, 20);
  const closed = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  clearInterval(monitor);
  await Promise.all(probes);
  assert.equal(childError, undefined, 'Compiled backend must execute, not fail the test prerequisite');
  assert.equal(closed.signal, null, 'Invalid configuration must terminate promptly, not time out');
  assert.notEqual(closed.code, null);
  assert.notEqual(closed.code, 0, 'Invalid proxy configuration must refuse HTTP startup');
  safeOutput(output, value);
  assert.match(output, /Invalid TRUSTED_PROXY_IPS configuration/,
    'Refusal must come from actual proxy validation, not an unrelated startup failure');
  assert.doesNotMatch(output, /Cannot find module|MODULE_NOT_FOUND|ENOTFOUND|ECONNREFUSED|password authentication failed|Unable to connect to the database/i);
  assert.doesNotMatch(output, /Application is running|Nest application successfully started/);
  assert.equal(served, false, 'Invalid configuration must never accept a TCP client');
  assert.equal(await listening(), false);
}

async function main() {
  for (const [name, expected] of Object.entries(settings)) {
    assert.equal(process.env[name], expected, `Allowlisted isolated fixture required: ${name}`);
  }
  assert.equal(process.env.BACKGROUND_JOBS_ENABLED, 'false');
  assert.ok(process.env.MFA_KEY_FILE && existsSync(process.env.MFA_KEY_FILE), 'Private synthetic key prerequisite');
  assert.ok(existsSync(mainPath) && existsSync(validationPath) && existsSync(migrationPath),
    'Compiled release artifacts prerequisite');
  const { validateEnvironment } = require(validationPath);
  for (const value of ['[]', ' [ "::ffff:192.0.2.1", "2001:0db8:0000::1" ] ']) {
    assert.equal(validateEnvironment(environment(value)).TRUSTED_PROXY_IPS, value,
      'Environment validation preserves the exact explicit JSON for the source service');
  }
  for (const [, value] of invalid) {
    assert.throws(() => validateEnvironment(environment(value)), (error) => {
      safeOutput(error.message, value);
      return error.message === 'Invalid TRUSTED_PROXY_IPS configuration';
    });
  }
  console.log('PASS PROXY-001-B compiled environment validation preserves explicit JSON and rejects invalid settings');

  const client = new Client({
    host: settings.DB_HOST, port: Number(settings.DB_PORT), user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const { rows: [state] } = await client.query(`SELECT
      (SELECT count(*) FROM migrations) AS migrations,
      (SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1) AS latest_migration,
      (SELECT count(*) FROM owner_auth WHERE "userId"='11111111-1111-4111-8111-111111111111') AS owners`);
    assert.equal(Number(state.migrations), 49, 'Run after the actual preserved forty-nine migrations');
    assert.equal(state.latest_migration, 'PriceBybitCoins1794500000000',
      'Latest current migration follows the preceding exact-ledger migration probe');
    assert.equal(Number(state.owners), 1, 'Run after synthetic owner seed and before HTTP traffic');
    const before = await fingerprint(client);
    for (const [name, value] of invalid) {
      await startup(value);
      assert.equal(await fingerprint(client), before, `Rejected startup must preserve all database state: ${name}`);
    }
    console.log(`PASS PROXY-001-B ${invalid.length} actual HTTP startup refusals without listener, secret output or database changes`);

    // Actual read-only CLI success, not merely a module import or argument rejection.
    const shown = spawnSync(process.execPath, [migrationPath, 'show'], {
      cwd: '/app/backend', env: environment(undefined), encoding: 'utf8', timeout: 15000,
    });
    assert.equal(shown.error, undefined);
    assert.equal(shown.signal, null);
    safeOutput(shown.stdout + shown.stderr);
    assert.equal(shown.status, 0, 'Migration CLI must work without the HTTP-only setting');
    const shownNames = [...shown.stdout.matchAll(/^\[X\] (\S+)$/gm)].map((match) => match[1]).sort();
    const appliedNames = (await client.query('SELECT name FROM migrations ORDER BY name')).rows.map((row) => row.name);
    assert.equal(shownNames.length, 49);
    assert.deepEqual(shownNames, appliedNames, 'CLI displays every exact applied migration from the preserved ledger');
    assert.ok(!(shown.stdout + shown.stderr).includes('TRUSTED_PROXY_IPS'));
    assert.equal(await fingerprint(client), before, 'Read-only CLI inspection preserves all database state');
    console.log('PASS PROXY-001-B actual migration CLI works with HTTP proxy configuration absent');
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
