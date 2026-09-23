'use strict';

// Mounted into a one-off release container; never copied into the release image.
// Run with NODE_PATH=/app/backend/node_modules and the isolated Compose DB settings.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ConfigService } = require('@nestjs/config');
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
const previousElevenName = 'capital_tracker_previous_eleven_e2e';
const previousTwelveName = 'capital_tracker_previous_twelve_e2e';
const previousThirteenName = 'capital_tracker_previous_thirteen_e2e';
const tradeTables = ['account_trade_journals', 'account_trades', 'account_trade_versions'];
const accountingTables = [
  'manual_accounts', 'accounting_instruments',
  'account_opening_snapshots', 'account_opening_positions',
];
const testDatabases = [
  freshName, legacyName, emptyLegacyName, previousName,
  previousNineName, previousTenName, previousElevenName, previousTwelveName, previousThirteenName,
];
let stage = 'isolated configuration';
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
  'AddAuthRequestLimits1790020000000',
  'AddManualOpeningPositions1790030000000',
  'AddUsdTradeJournal1790040000000',
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
      is_nullable, column_default, numeric_precision, numeric_scale,
      character_maximum_length, character_octet_length, datetime_precision,
      interval_type, interval_precision, collation_name, is_identity,
      identity_generation, identity_start, identity_increment, identity_maximum,
      identity_minimum, identity_cycle, is_generated, generation_expression
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
    constraints: `SELECT c.relname, k.conname, k.contype, k.convalidated,
      k.condeferrable, k.condeferred, k.connoinherit, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      ORDER BY c.relname, k.conname`,
    indexes: `SELECT v.tablename, v.indexname, v.indexdef, i.indisunique,
      i.indisprimary, i.indisvalid, i.indisready, i.indislive, i.indisclustered,
      i.indnullsnotdistinct FROM pg_indexes v
      JOIN pg_namespace n ON n.nspname=v.schemaname
      JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=v.indexname
      JOIN pg_index i ON i.indexrelid=c.oid
      WHERE v.schemaname = 'public' ORDER BY v.tablename, v.indexname`,
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
    assert.deepEqual(ledger.map((row) => row.name), migrationNames, 'Exactly fourteen migrations');
    const tables = (await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )).rows.map((row) => row.tablename);
    for (const table of ['users', 'assets', 'liabilities', 'currencies', 'crypto_wallets', 'user_currency_preferences', 'owner_auth', 'auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits', ...accountingTables, ...tradeTables]) {
      assert.ok(tables.includes(table), `Missing current table ${table}`);
    }
    assert.equal((await client.query('SELECT count(*)::int AS count FROM auth_request_limits')).rows[0].count, 0);
    for (const table of [...accountingTables, ...tradeTables]) {
      assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 0);
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

async function createPreviousSchema(client, target, previousCount) {
  assert.ok(testDatabases.includes(target));
  assert.ok([8, 9, 10, 11, 12, 13].includes(previousCount));
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  const migrationClasses = readdirSync('/app/backend/dist/migrations')
    .filter((file) => file.endsWith('.js'))
    .flatMap((file) => Object.values(require(`/app/backend/dist/migrations/${file}`)))
    .filter((entry) => typeof entry === 'function'
      && migrationNames.slice(0, previousCount).includes(entry.name));
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
}

async function verifyAdditiveOwnerUpgrade(previousCount = 8) {
  assert.ok([8, 9, 10].includes(previousCount));
  const target = previousCount === 8 ? previousName : previousCount === 9 ? previousNineName : previousTenName;
  const scenario = previousCount === 8 ? 'OWN-MIG-001' : previousCount === 9 ? 'SES-MIG-001' : 'MFA-MIG-001';
  const client = new Client(connection(target));
  await client.connect();
  try {
    await createPreviousSchema(client, target, previousCount);
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
    const addedTables = [...(previousCount === 8 ? ['owner_auth'] : []),
      'auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits', ...accountingTables, ...tradeTables];
    assert.deepEqual(after.rows.owner_mfa, [], 'No implicit MFA enrollment');
    assert.deepEqual(after.rows.owner_mfa_recovery, [], 'No implicit recovery codes');
    assert.deepEqual(after.rows.auth_request_limits, [], 'Migration creates no request admissions');
    for (const table of [...accountingTables, ...tradeTables]) assert.deepEqual(after.rows[table], [], 'No implicit opening state');
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

async function seedPreviousEleven(client, cipher) {
  const { createTotp, newRecoveryCodes, recoveryHash } = require('/app/backend/dist/auth/mfa-crypto.js');
  const owner = await seedOwner(client, 'previous-eleven-owner@example.invalid');
  const other = await seedOwner(client, 'previous-eleven-other@example.invalid');
  const currency = (await client.query("SELECT id FROM currencies WHERE code='USD'")).rows;
  assert.equal(currency.length, 1, 'Previous schema supplies its real USD currency');
  for (const [index, userId] of [owner, other].entries()) {
    await client.query(`INSERT INTO crypto_wallets("userId",type,address,balance)
      VALUES ($1,$2,$3,$4)`, [userId, index === 0 ? 'bitcoin' : 'ethereum',
      `synthetic-previous-eleven-wallet-${index}`, '1.250000000000000001']);
    await client.query(`INSERT INTO assets("userId",name,category,amount,"currencyId",date)
      VALUES ($1,'Preserved asset','savings','2345.12',$2,'2026-01-01')`,
    [userId, currency[0].id]);
    await client.query(`INSERT INTO liabilities("userId",name,category,amount,"currencyId",date)
      VALUES ($1,'Preserved liability','loans','89.87',$2,'2026-01-02')`,
    [userId, currency[0].id]);
    await client.query(`INSERT INTO user_currency_preferences("userId","currencyId","isHidden")
      VALUES ($1,$2,$3)`, [userId, currency[0].id, index === 1]);
  }

  const credentialVersion = randomUUID();
  await client.query(`INSERT INTO owner_auth(id,"userId","credentialVersion") VALUES(1,$1,$2)`,
    [owner, credentialVersion]);
  const activeVersion = randomUUID(), candidateId = randomUUID();
  const activeSecret = createTotp().secret.base32;
  const candidateSecret = createTotp().secret.base32;
  const activeEnvelope = cipher.encrypt(activeSecret, owner, activeVersion);
  const candidateEnvelope = cipher.encrypt(candidateSecret, owner, candidateId);
  assert.ok(cipher.decrypt(activeEnvelope, owner, activeVersion) === activeSecret,
    'Production cipher opens the synthetic active envelope');
  assert.ok(cipher.decrypt(candidateEnvelope, owner, candidateId) === candidateSecret,
    'Production cipher opens the synthetic candidate envelope');
  assert.throws(() => cipher.decrypt(activeEnvelope, owner, candidateId), /could not be opened/);
  await client.query(`INSERT INTO owner_mfa(id,"userId","activeVersion","activeEnvelope",
    "lastCounter","candidateId","candidateEnvelope","candidateExpiresAt","candidateAttempts",
    "failedAttempts","failureWindowStart","blockedUntil")
    VALUES (1,$1,$2,$3,floor(extract(epoch FROM clock_timestamp())/30)::bigint-1,
      $4,$5,clock_timestamp()+interval '7 minutes',3,10,
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '9 minutes')`,
  [owner, activeVersion, activeEnvelope, candidateId, candidateEnvelope]);
  const codes = newRecoveryCodes().slice(0, 2);
  assert.equal(new Set(codes).size, 2);
  for (const [index, code] of codes.entries()) {
    await client.query(`INSERT INTO owner_mfa_recovery("codeHash","userId","enrollmentVersion",
      "createdAt","usedAt") VALUES ($1,$2,$3,clock_timestamp()-interval '2 hours',
      CASE WHEN $4 THEN clock_timestamp()-interval '1 hour' ELSE NULL END)`,
    [recoveryHash(code, owner, activeVersion), owner, activeVersion, index === 1]);
  }

  const sessions = [
    { state: 'anonymous', minutes: 4, failed: 0, expired: false },
    { state: 'pending_mfa', minutes: 3, failed: 3, expired: false },
    { state: 'authenticated', minutes: 660, failed: 0, expired: false },
    { state: 'authenticated', minutes: -60, failed: 0, expired: true },
  ];
  for (const session of sessions) {
    const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    await client.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
      INSERT INTO auth_sessions("tokenHash","csrfToken",state,"userId",
      "credentialVersion","createdAt","lastSeenAt","expiresAt","failedAttempts","mfaVerifiedAt")
      SELECT $1,$2,$3::varchar,$4::uuid,$5::uuid,
        now-CASE WHEN $8 THEN interval '13 hours'
          WHEN $3='authenticated' THEN interval '1 hour' ELSE interval '2 minutes' END,
        now-CASE WHEN $8 THEN interval '2 hours' ELSE interval '1 minute' END,
        now+$6*interval '1 minute',$7::integer,
        CASE WHEN $3='authenticated' THEN
          now-CASE WHEN $8 THEN interval '13 hours' ELSE interval '1 hour' END ELSE NULL END
      FROM moment`,
    [tokenHash, randomBytes(32).toString('base64url'), session.state,
      session.state === 'anonymous' ? null : owner,
      session.state === 'anonymous' ? null : credentialVersion,
      session.minutes, session.failed, session.expired]);
  }

  // Exact row preservation below includes encrypted bytes and all timestamps;
  // this separate cryptographic oracle proves envelopes remain usable as envelopes.
  return async () => {
    const factors = (await client.query('SELECT * FROM owner_mfa WHERE id=1')).rows;
    assert.equal(factors.length, 1);
    const factor = factors[0];
    assert.ok(cipher.decrypt(factor.activeEnvelope, owner, activeVersion) === activeSecret,
      'Retained active ciphertext authenticates with its original context');
    assert.ok(cipher.decrypt(factor.candidateEnvelope, owner, candidateId) === candidateSecret,
      'Retained candidate ciphertext authenticates with its original context');
    const stored = JSON.stringify(factor);
    assert.ok(!stored.includes(activeSecret) && !stored.includes(candidateSecret),
      'No plaintext factor secret is stored');
    const recovery = (await client.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"')).rows;
    assert.equal(recovery.length, 2);
    for (const [index, code] of codes.entries()) {
      const retained = recovery.find(row => row.codeHash === recoveryHash(code, owner, activeVersion));
      assert.ok(retained, 'Production recovery digest remains present');
      assert.equal(retained.usedAt !== null, index === 1);
      assert.ok(!JSON.stringify(recovery).includes(code), 'No plaintext recovery code is stored');
    }
  };
}

async function seedPreviousThirteen(client) {
  // Valid predecessor rows are inserted in this freshly created allowlisted DB.
  // The current service may require migration14, so it cannot construct a13 fixture.
  const owners = (await client.query('SELECT id FROM users ORDER BY email')).rows;
  assert.equal(owners.length, 2);
  await client.query('BEGIN');
  try {
    for (const [index, { id: owner }] of owners.entries()) {
      const account = randomUUID(), instrument = randomUUID(), otherInstrument = randomUUID();
      const accountRequest = randomUUID();
      const name = `Preserved manual account ${index}`;
      await client.query(`INSERT INTO manual_accounts(id,"ownerId","requestId","canonicalPayload",name,"currentRevision","createdAt")
        VALUES($1,$2,$3,$4,$5,NULL,'2025-01-01T00:00:00Z')`,
      [account, owner, accountRequest, JSON.stringify({ name }), name]);
      for (const [offset, id] of [instrument, otherInstrument].entries()) {
        const instrumentName = `Preserved manual instrument ${index}-${offset}`;
        await client.query(`INSERT INTO accounting_instruments(id,"ownerId","requestId","canonicalPayload",name,symbol,namespace,"createdAt")
          VALUES($1,$2,$3,$4,$5,'SAME','manual','2025-01-01T00:00:00Z')`,
        [id, owner, randomUUID(), JSON.stringify({ name: instrumentName, symbol: 'SAME' }), instrumentName]);
      }
      for (const revision of [1, 2]) {
        const asOf = `2025-01-0${revision}T00:00:00.000Z`;
        const positions = [
          { instrumentId: instrument, quantity: revision === 1 ? '9007199254740993.000000000000000001' : '1',
            costStatus: 'known', totalCostUsd: revision === 1 ? '123.450000000000000001' : '0' },
          { instrumentId: otherInstrument, quantity: '0.000000000000000000000000000001',
            costStatus: 'unknown', totalCostUsd: null },
        ].sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
        await client.query(`INSERT INTO account_opening_snapshots("ownerId","accountId",revision,"requestId","canonicalPayload","asOf","createdAt")
          VALUES($1,$2,$3,$4,$5,$6,$6)`, [owner, account, revision, randomUUID(),
          JSON.stringify({ expectedRevision: revision - 1, asOf, positions }), asOf]);
        for (const position of positions) {
          await client.query(`INSERT INTO account_opening_positions("ownerId","accountId",revision,"instrumentId",quantity,"costStatus","totalCostUsd")
            VALUES($1,$2,$3,$4,$5,$6,$7)`, [owner, account, revision, position.instrumentId,
            position.quantity, position.costStatus, position.totalCostUsd]);
        }
      }
      await client.query('UPDATE manual_accounts SET "currentRevision"=2 WHERE id=$1', [account]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function verifyPopulatedAuthUpgrade(previousCount) {
  assert.ok([11, 12, 13].includes(previousCount));
  const target = previousCount === 11 ? previousElevenName : previousCount === 12 ? previousTwelveName : previousThirteenName;
  const scenario = previousCount === 11 ? 'LIMIT-006-A' : previousCount === 12 ? 'OPEN-004-B' : 'TRADE-005-A';
  const addedTables = [...(previousCount === 11 ? ['auth_request_limits'] : []),
    ...(previousCount < 13 ? accountingTables : []), ...tradeTables];
  stage = `${scenario} previous${previousCount} schema and populated fixture`;
  const client = new Client(connection(target));
  const directory = mkdtempSync(join(tmpdir(), 'capital-migration-mfa-'));
  let connected = false;
  try {
    await client.connect(); connected = true;
    await createPreviousSchema(client, target, previousCount);
    // This key is newly generated inside the disposable test container. No owner
    // key/environment is read, and the private directory is removed in finally.
    const file = join(directory, 'key');
    writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 });
    const { MfaCipher } = require('/app/backend/dist/auth/mfa-crypto.js');
    const cipher = new MfaCipher(new ConfigService({ MFA_KEY_FILE: file, MFA_KEY_ID: 'migration-fixture' }));
    const verifyFactors = await seedPreviousEleven(client, cipher);
    await verifyFactors();
    if (previousCount >= 12) {
      for (const [scope, hits, seconds] of [
        ['csrf-ip', 29, 60], ['login-ip', 5, 60], ['mfa-ip', 3, 60], ['login-account', 9, 600],
      ]) {
        const subject = scope === 'login-account' ? 'migration-owner@example.invalid' : 'v4:192.0.2.42/32';
        const digest = createHash('sha256')
          .update(JSON.stringify(['ct-auth-request-v1', scope, subject])).digest('hex');
        await client.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
          INSERT INTO auth_request_limits(scope,"subjectHash",hits,"windowStartedAt","expiresAt")
          SELECT $1,$2,$3,now,now+$4*interval '1 second' FROM moment`, [scope, digest, hits, seconds]);
      }
      assert.equal((await client.query(`SELECT count(*)::int AS count FROM auth_request_limits
        WHERE "expiresAt">clock_timestamp() AND hits>0`)).rows[0].count, 4,
      'Predecessor contains live nonzero admissions for every policy');
    }
    if (previousCount === 13) await seedPreviousThirteen(client);
    const before = await snapshot(client);
    assert.equal(before.rows.migrations.length, previousCount);
    if (previousCount === 13) {
      for (const table of accountingTables) assert.ok(before.rows[table].length >= 2, 'Both owners have retained accounting history');
    }
    for (const table of addedTables) assert.equal(before.rows[table], undefined, 'Additive table absent before upgrade');
    for (const table of ['users', 'assets', 'liabilities', 'crypto_wallets', 'user_currency_preferences']) {
      assert.equal(before.rows[table].length, 2, `Both principals have populated ${table}`);
    }
    assert.equal(before.rows.owner_auth.length, 1);
    assert.equal(before.rows.owner_mfa.length, 1);
    const factor = JSON.parse(before.rows.owner_mfa[0].row);
    assert.equal(factor.candidateAttempts, 3);
    assert.equal(factor.failedAttempts, 10);
    assert.ok(factor.lastCounter && factor.failureWindowStart && factor.blockedUntil);
    const sessionRows = before.rows.auth_sessions.map(({ row }) => JSON.parse(row));
    assert.deepEqual(sessionRows.map(row => row.state).sort(),
      ['anonymous', 'authenticated', 'authenticated', 'pending_mfa']);
    assert.equal(sessionRows.find(row => row.state === 'pending_mfa').failedAttempts, 3);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM auth_sessions
      WHERE "expiresAt" <= clock_timestamp()`)).rows[0].count, 1, 'Fixture includes an expired full session');

    stage = `${scenario} current migration preserves every previous row and schema object`;
    const upgraded = runMigration(target);
    assert.equal(upgraded.status, 0, 'Populated upgrade must run the actual migration CLI successfully');
    const after = await snapshot(client);
    for (const table of addedTables) assert.deepEqual(after.rows[table], [], 'New tables must be empty');
    for (const [table, rows] of Object.entries(before.rows)) {
      if (table !== 'migrations') {
        assert.deepEqual(after.rows[table], rows, `Preserve every previous ${table} row, including all session classes`);
      }
    }
    const oldMigrationNames = migrationNames.slice(0, previousCount);
    assert.deepEqual(after.rows.migrations.filter(({ row }) => oldMigrationNames.includes(JSON.parse(row).name)),
      before.rows.migrations, 'Every prior migration record is unchanged');
    const records = (await client.query('SELECT id,timestamp,name FROM migrations ORDER BY timestamp')).rows;
    assert.deepEqual(records.map(row => row.name), migrationNames);
    for (let index = previousCount; index < migrationNames.length; index++) {
      assert.equal(records[index].id, records[index - 1].id + 1, 'Migration history appends each record exactly once');
      assert.equal(String(records[index].timestamp), ['1790020000000', '1790030000000', '1790040000000'][index - 11]);
    }
    for (const [kind, tableKey] of [
      ['tables', 'tablename'], ['columns', 'table_name'], ['constraints', 'relname'], ['indexes', 'tablename'],
    ]) {
      assert.deepEqual(after[kind].filter(row => !addedTables.includes(row[tableKey])), before[kind],
        `Every previous ${kind} entry remains unchanged`);
    }
    assert.deepEqual(after.enums, before.enums);
    assert.deepEqual(after.extensions, before.extensions);
    const oldSequence = before.sequences.find(row => row.sequencename === 'migrations_id_seq');
    const newSequence = after.sequences.find(row => row.sequencename === 'migrations_id_seq');
    assert.ok(oldSequence && newSequence, 'Migration record sequence must exist');
    assert.equal(BigInt(newSequence.last_value), BigInt(oldSequence.last_value) + BigInt(migrationNames.length - previousCount));
    assert.deepEqual(after.sequences.map(row => row.sequencename === 'migrations_id_seq'
      ? { ...row, last_value: oldSequence.last_value } : row), before.sequences,
    'Only the migration record sequence advances; all sequence definitions are preserved');
    await verifyFactors();

    stage = `${scenario} current migration populated replay`;
    const replay = runMigration(target);
    assert.equal(replay.status, 0);
    assert.deepEqual(await snapshot(client), after, 'Replay is identical across all schema, data, sessions and migration state');
    await verifyFactors();
    console.log(`PASS ${scenario} populated${previousCount}-to14 preserves every prior row/schema/session/admission, authentic encrypted factors and used/unused recovery; empty additive tables and exact replay`);
  } finally {
    try { if (connected) await client.end(); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
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
  stage = 'MIG-002 migration lock contention'; await verifyLockContention();
  stage = 'ISO-001 fresh schema and replay'; await verifyFresh();
  stage = 'ISO-002 populated destructive legacy refusal'; await verifyLegacy(legacyName);
  stage = 'ISO-002 empty destructive legacy refusal'; await verifyLegacy(emptyLegacyName, true);
  stage = 'OWN-MIG-001 previous8 upgrade'; await verifyAdditiveOwnerUpgrade();
  stage = 'SES-MIG-001 previous9 upgrade'; await verifyAdditiveOwnerUpgrade(9);
  stage = 'MFA-MIG-001 previous10 upgrade and session revocation'; await verifyAdditiveOwnerUpgrade(10);
  await verifyPopulatedAuthUpgrade(11);
  await verifyPopulatedAuthUpgrade(12);
  await verifyPopulatedAuthUpgrade(13);
}

main().catch(() => {
  console.error(`FAIL isolated migration acceptance at stage: ${stage} (credential-bearing assertion details withheld)`);
  process.exitCode = 1;
});
