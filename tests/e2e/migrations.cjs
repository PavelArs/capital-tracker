'use strict';

// Mounted into a one-off release container; never copied into the release image.
// Run with NODE_PATH=/app/backend/node_modules and the isolated Compose DB settings.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const runner = '/app/backend/dist/migrate.js';
const settings = {
  DB_HOST: 'postgres',
  DB_PORT: '5432',
  DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e',
  DB_NAME: 'capital_tracker_e2e',
};
const freshName = 'capital_tracker_migrations_e2e';
const legacyName = 'capital_tracker_legacy_e2e';
const emptyLegacyName = 'capital_tracker_empty_legacy_e2e';
const previousName = 'capital_tracker_previous_eight_e2e';
const previousNineName = 'capital_tracker_previous_nine_e2e';
const previousTenName = 'capital_tracker_previous_ten_e2e';
const testDatabases = [freshName, legacyName, emptyLegacyName, previousName, previousNineName, previousTenName];
const migrationNames = [
  'Init1763669182662',
  'AddCurrencySystemAndPreferences1763741417438',
  'AddInvitationCodes1763800000000',
  'AddEmailVerificationAndResetFields1763900000000',
  'MigrateCurrencyToForeignKey1764000000000',
  'DropStubModuleTables1764100000000',
  'DropRemovedModuleTables1764200000000',
  'CleanupCryptoTypeEnum1764300000000',
  'AddOwnerBinding1789990000000',
  'AddOwnerSessions1790000000000',
  'AddOwnerMfa1790010000000',
];

function connection(database) {
  assert.ok([settings.DB_NAME, ...testDatabases].includes(database));
  return {
    host: settings.DB_HOST,
    port: Number(settings.DB_PORT),
    user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD,
    database,
    connectionTimeoutMillis: 5000,
  };
}

function runMigration(database, overrides = {}) {
  const env = { ...process.env, ...settings, DB_NAME: database, ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  const result = spawnSync(process.execPath, [runner], {
    cwd: '/app/backend',
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.error, undefined, 'Migration runner must finish without process errors');
  assert.equal(result.signal, null, 'Migration runner must not time out or crash');
  assert.notEqual(result.status, null);
  return { status: result.status, output: result.stdout + result.stderr };
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function snapshot(client) {
  const result = {};
  const queries = {
    tables: `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    columns: `SELECT table_name, column_name, ordinal_position, data_type, udt_name,
      is_nullable, column_default, numeric_precision, numeric_scale
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
    constraints: `SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      ORDER BY c.relname, k.conname`,
    indexes: `SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY tablename, indexname`,
    enums: `SELECT t.typname, e.enumlabel, e.enumsortorder FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' ORDER BY t.typname, e.enumsortorder`,
    sequences: `SELECT sequencename, start_value, min_value, max_value, increment_by,
      cycle, cache_size, last_value FROM pg_sequences
      WHERE schemaname = 'public' ORDER BY sequencename`,
    extensions: `SELECT extname, extversion FROM pg_extension ORDER BY extname`,
  };
  for (const [key, sql] of Object.entries(queries)) result[key] = (await client.query(sql)).rows;
  result.rows = {};
  for (const { tablename } of result.tables) {
    result.rows[tablename] = (await client.query(
      `SELECT to_jsonb(t)::text AS row FROM public.${quoteIdentifier(tablename)} t ORDER BY row`,
    )).rows;
  }
  return result;
}

async function seedOwner(client, email) {
  const { rows } = await client.query(
    `INSERT INTO users(email, password, "emailVerified") VALUES ($1, $2, true) RETURNING id`,
    [email, 'synthetic-migration-fixture-not-a-login-hash'],
  );
  return rows[0].id;
}

async function verifyFresh() {
  const first = runMigration(freshName);
  assert.equal(first.status, 0, `ISO-001 first migration failed: ${first.output}`);
  const client = new Client(connection(freshName));
  await client.connect();
  try {
    const ledger = (await client.query('SELECT name FROM migrations ORDER BY timestamp')).rows;
    assert.deepEqual(ledger.map((row) => row.name), migrationNames, 'Exactly eleven migrations');
    const tables = (await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )).rows.map((row) => row.tablename);
    for (const table of ['users', 'assets', 'liabilities', 'currencies', 'crypto_wallets', 'user_currency_preferences', 'owner_auth', 'auth_sessions', 'owner_mfa', 'owner_mfa_recovery']) {
      assert.ok(tables.includes(table), `Missing current table ${table}`);
    }
    const owner = await seedOwner(client, 'fresh-migration@example.invalid');
    await client.query(
      `INSERT INTO crypto_wallets("userId", type, address, balance)
       VALUES ($1, 'bitcoin', 'synthetic-migration-address', '1.250000000000000001')`,
      [owner],
    );
    const before = await snapshot(client);
    const replay = runMigration(freshName);
    assert.equal(replay.status, 0, `ISO-001 replay failed: ${replay.output}`);
    assert.deepEqual(await snapshot(client), before, 'Replay must preserve schema, rows and ledger');
    console.log('PASS ISO-001 fresh migration and populated replay');
  } finally {
    await client.end();
  }
}

async function verifyLockContention() {
  const client = new Client(connection(freshName));
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(1763669182)');
    const before = await snapshot(client);
    const result = runMigration(freshName);
    assert.notEqual(result.status, 0, 'Competing migration must refuse the held lock');
    assert.match(result.output, /another migration|lock|already running/i);
    assert.deepEqual(await snapshot(client), before, 'Lock refusal must not create schema or ledger');
    console.log('PASS MIG-002 lock contention refuses before mutation');
  } finally {
    // Closing this session also releases its advisory lock if explicit unlock fails.
    try {
      await client.query('SELECT pg_advisory_unlock(1763669182)');
    } finally {
      await client.end();
    }
  }
}

async function verifyLegacy(database, empty = false) {
  const client = new Client(connection(database));
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    const filenames = [
      '1763669182662-Init',
      '1763741417438-AddCurrencySystemAndPreferences',
      '1763800000000-AddInvitationCodes',
      '1763900000000-AddEmailVerificationAndResetFields',
    ];
    const prior = new DataSource({
      type: 'postgres',
      host: settings.DB_HOST,
      port: Number(settings.DB_PORT),
      username: settings.DB_USERNAME,
      password: settings.DB_PASSWORD,
      database,
      synchronize: false,
      migrationsRun: false,
      installExtensions: false,
      migrations: filenames.map((file, index) =>
        require(`/app/backend/dist/migrations/${file}.js`)[migrationNames[index]]),
    });
    await prior.initialize();
    try {
      await prior.runMigrations({ transaction: 'all' });
    } finally {
      await prior.destroy();
    }
    if (empty) {
      const tables = (await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'migrations'",
      )).rows;
      // Empty application tables remain a pre-existing schema. This is fixture
      // setup only in the newly created allowlisted disposable database.
      await client.query(`TRUNCATE ${tables.map(({ tablename }) => quoteIdentifier(tablename)).join(', ')}`);
    } else {
      const owner = await seedOwner(client, 'legacy-migration@example.invalid');
      await client.query(
        `INSERT INTO assets("userId", name, category, amount, currency, date)
         VALUES ($1, 'Preserve unknown currency', 'crypto', 123.45, 'ZZZ', '2025-01-01')`,
        [owner],
      );
      await client.query(
        `INSERT INTO crypto_wallets("userId", type, address, balance)
         VALUES ($1, 'solana', 'synthetic-legacy-address', '42.123456789012345678')`,
        [owner],
      );
    }
    const before = await snapshot(client);
    assert.equal(before.rows.migrations.length, 4);
    if (empty) {
      for (const [table, rows] of Object.entries(before.rows)) {
        if (table !== 'migrations') assert.equal(rows.length, 0, `Fixture ${table} must be empty`);
      }
    }
    const result = runMigration(database);
    assert.notEqual(result.status, 0, 'ISO-002 must reject destructive pending legacy migrations');
    assert.match(result.output, /preflight|unsafe|destructive|existing schema/i);
    assert.deepEqual(await snapshot(client), before, 'Refusal must preserve all schema, rows and ledger');
    console.log(`PASS ISO-002 ${empty ? 'empty' : 'populated'} legacy migration refused without mutation`);
  } finally {
    await client.end();
  }
}

async function verifyAdditiveOwnerUpgrade(previousCount = 8) {
  assert.ok([8, 9, 10].includes(previousCount));
  const target = previousCount === 8 ? previousName : previousCount === 9 ? previousNineName : previousTenName;
  const scenario = previousCount === 8 ? 'OWN-MIG-001' : previousCount === 9 ? 'SES-MIG-001' : 'MFA-MIG-001';
  const client = new Client(connection(target));
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    const migrationClasses = readdirSync('/app/backend/dist/migrations')
      .filter((file) => file.endsWith('.js'))
      .flatMap((file) => Object.values(require(`/app/backend/dist/migrations/${file}`)))
      .filter((entry) => typeof entry === 'function' && migrationNames.slice(0, previousCount).includes(entry.name));
    assert.equal(migrationClasses.length, previousCount, 'Fixture must run exactly the preceding migration version');
    const prior = new DataSource({
      type: 'postgres', host: settings.DB_HOST, port: Number(settings.DB_PORT),
      username: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: target,
      synchronize: false, migrationsRun: false, installExtensions: false,
      migrations: migrationClasses,
    });
    await prior.initialize();
    try { await prior.runMigrations({ transaction: 'all' }); }
    finally { await prior.destroy(); }
    for (const email of ['previous-owner@example.invalid', 'previous-other@example.invalid']) {
      const owner = await seedOwner(client, email);
      if (previousCount >= 9 && email === 'previous-owner@example.invalid') {
        await client.query(`INSERT INTO owner_auth(id,"userId","credentialVersion")
          VALUES (1,$1,'11111111-1111-4111-8111-111111111111')`, [owner]);
      }
      await client.query(
        `INSERT INTO crypto_wallets("userId", type, address, balance)
         VALUES ($1, 'bitcoin', $2, '1.250000000000000001')`, [owner, `synthetic-${email}`],
      );
    }
    if (previousCount === 10) {
      await client.query(`INSERT INTO auth_sessions("tokenHash","csrfToken",state,"userId","credentialVersion","createdAt","lastSeenAt","expiresAt")
        SELECT repeat('a',64),repeat('b',43),'authenticated',"userId","credentialVersion",clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '12 hours' FROM owner_auth`);
    }
    const before = await snapshot(client);
    assert.equal(before.rows.migrations.length, previousCount);
    if (previousCount >= 9) assert.equal(before.rows.owner_auth.length, 1, 'Previous schema has an explicitly bound owner');
    const result = runMigration(target);
    assert.equal(result.status, 0, `${scenario} additive upgrade failed: ${result.output}`);
    const after = await snapshot(client);
    if (previousCount === 8) assert.deepEqual(after.rows.owner_auth, [], 'No automatic owner selection');
    assert.deepEqual(after.rows.auth_sessions, [], 'Migration cannot grant a session');
    for (const [table, rows] of Object.entries(before.rows)) {
      if (!['migrations','auth_sessions'].includes(table)) assert.deepEqual(after.rows[table], rows, `Preserve every previous ${table} row`);
    }
    const previousNames = migrationNames.slice(0, previousCount);
    assert.deepEqual(after.rows.migrations.filter(({row}) => previousNames.includes(JSON.parse(row).name)),
      before.rows.migrations, 'Preserve previous migration records');
    assert.deepEqual((await client.query('SELECT name FROM migrations ORDER BY timestamp')).rows.map(({name}) => name), migrationNames);
    const addedTables = [...(previousCount === 8 ? ['owner_auth'] : []), 'auth_sessions','owner_mfa','owner_mfa_recovery'];
    assert.deepEqual(after.rows.owner_mfa, [], 'No implicit MFA enrollment');
    assert.deepEqual(after.rows.owner_mfa_recovery, [], 'No implicit recovery codes');
    // Only the additive tables' schema/index/constraint entries may differ.
    for (const [kind, tableKey] of [['tables', 'tablename'], ['columns', 'table_name'], ['constraints', 'relname'], ['indexes', 'tablename']]) {
      assert.deepEqual(after[kind].filter((row) => !addedTables.includes(row[tableKey])), before[kind].filter((row) => !addedTables.includes(row[tableKey])), `Preserve previous ${kind}`);
    }
    if (previousCount === 10) {
      const priorColumns=before.columns.filter(row=>row.table_name==='auth_sessions');
      const names=new Set(priorColumns.map(row=>row.column_name));
      assert.deepEqual(after.columns.filter(row=>row.table_name==='auth_sessions' && names.has(row.column_name)),priorColumns,'Existing session columns preserved');
      assert.deepEqual(after.indexes.filter(row=>row.tablename==='auth_sessions'),before.indexes.filter(row=>row.tablename==='auth_sessions'),'Existing session indexes preserved');
      const changedChecks=new Set(['auth_sessions_state_check','auth_sessions_identity']);
      const priorConstraints=new Set(before.constraints.filter(row=>row.relname==='auth_sessions').map(row=>row.conname));
      assert.deepEqual(after.constraints.filter(row=>row.relname==='auth_sessions' && priorConstraints.has(row.conname) && !changedChecks.has(row.conname)),before.constraints.filter(row=>row.relname==='auth_sessions' && !changedChecks.has(row.conname)),'Existing session constraints preserved apart from state/identity extension');
    }
    assert.deepEqual(after.enums, before.enums);
    assert.deepEqual(after.extensions, before.extensions);
    const replay = runMigration(target);
    assert.equal(replay.status, 0);
    assert.deepEqual(await snapshot(client), after, 'Additive upgrade replay preserves complete state');
    console.log(`PASS ${scenario} previous ${previousCount}-migration data/owner preserved without implicit sessions`);
  } finally { await client.end(); }
}

async function main() {
  for (const [key, expected] of Object.entries(settings)) {
    assert.equal(process.env[key], expected, `Refuse execution outside isolated harness: ${key}`);
  }
  assert.ok(existsSync(runner), 'Build prerequisite: explicit migration runner must exist');
  for (const key of Object.keys(settings)) {
    const secret = 'synthetic-secret-must-not-appear';
    const result = runMigration(freshName, {
      DB_PASSWORD: secret,
      [key]: undefined,
    });
    assert.notEqual(result.status, 0, `Missing ${key} must fail`);
    assert.match(result.output, /config|required|missing/i, 'Configuration refusal precedes connection');
    assert.ok(!result.output.includes(secret), 'Configuration failure must not print password');
    assert.doesNotMatch(result.output, /ENOTFOUND|ECONNREFUSED|password authentication/i);
  }
  console.log('PASS MIG-002-A missing connection settings fail before connection');

  const admin = new Client(connection(settings.DB_NAME));
  await admin.connect();
  try {
    // Fresh disposable stack required. Never drop/reuse an existing database.
    const existing = await admin.query('SELECT datname FROM pg_database WHERE datname = ANY($1)', [testDatabases]);
    assert.equal(existing.rowCount, 0, 'Migration test databases already exist; reset isolated stack first');
    for (const name of testDatabases) await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  await verifyLockContention();
  await verifyFresh();
  await verifyLegacy(legacyName);
  await verifyLegacy(emptyLegacyName, true);
  await verifyAdditiveOwnerUpgrade();
  await verifyAdditiveOwnerUpgrade(9);
  await verifyAdditiveOwnerUpgrade(10);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
