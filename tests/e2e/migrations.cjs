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
const previousFourteenName = 'capital_tracker_previous_fourteen_e2e';
const previousFifteenName = 'capital_tracker_previous_fifteen_e2e';
const previousSixteenName = 'capital_tracker_previous_sixteen_e2e';
const previousEighteenName = 'capital_tracker_previous_eighteen_e2e';
const previousTwentyOneName = 'capital_tracker_previous_twenty_one_e2e';
const swapTables = ['account_swaps', 'account_swap_versions'];
const walletTables = ['wallet_addresses', 'wallet_address_transactions', 'wallet_xpub_addresses', 'bybit_accounts', 'wallet_tron_accounts', 'wallet_tron_stake_moves', 'chain_tokens', 'wallet_stellar_accounts', 'wallet_zcash_accounts', 'wallet_sync_runs'];
const marketPriceTables = ['price_observations', 'sync_sources'];
const threeCurrencyTables = ['fx_rates', 'owner_settings'];
const snapshotTables = ['portfolio_snapshots', 'portfolio_snapshot_state'];
const paidCurrencyTables = ['account_trade_version_payments'];
const commentTables = ['account_trade_version_comments'];
const settlementTables = ['account_trade_version_settlements'];
const purposeTables = ['account_trade_version_purposes'];
const classificationTables = ['chain_transaction_classifications', 'chain_transaction_classification_versions'];
const resetTables = ['password_reset_tokens'];
const stakeTables = ['wallet_stake_accounts', 'wallet_stake_moves', 'wallet_stake_rewards', 'wallet_stake_scans'];
const etherStakeTables = ['wallet_ether_stake_positions', 'wallet_ether_stake_moves', 'wallet_ether_stake_rewards'];
const rewardTables = ['account_rewards', 'account_reward_versions'];
const transferTables = ['owner_transfer_journals', 'owned_transfers', 'owned_transfer_versions'];
const fxTables = ['display_fx_collection', 'display_fx_observations'];
const priceTables = ['manual_usd_price_versions'];
const flowTables = ['portfolio_flow_journals', 'portfolio_flow_versions'];
const carryTables = ['account_carry_in_lots'];
const csvTables = ['account_csv_imports', 'account_csv_import_commands', 'account_csv_import_rows'];
const tradeTables = ['account_trade_journals', 'account_trades', 'account_trade_versions'];
const accountingTables = [
  'manual_accounts', 'accounting_instruments',
  'account_opening_snapshots', 'account_opening_positions',
];
const testDatabases = [
  freshName, legacyName, emptyLegacyName, previousName,
  previousNineName, previousTenName, previousElevenName, previousTwelveName, previousThirteenName, previousFourteenName, previousFifteenName, previousSixteenName, previousEighteenName, previousTwentyOneName,
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
  'AddUsdCsvImports1790050000000',
  'AddKnownCostCarryIn1790060000000',
  'AddExternalUsdFlows1790070000000',
  'AddManualUsdPrices1790080000000',
  'AddDailyDisplayFx1790090000000',
  'AddOwnedTransfers1790100000000',
  'AddAssetRewards1790200000000',
  'AddAssetSwaps1790300000000',
  'AddWalletAddressImport1790400000000',
  'ClassifyAssets1790700000000',
  'AddHourlyPrices1790800000000',
  'AccountInThreeCurrencies1790900000000',
  'RecordPortfolioSnapshots1791000000000',
  'PaidCurrencyTrades1791100000000',
  'TradeComments1791200000000',
  'TradeSettlements1791300000000',
  'TradePurposes1791400000000',
  'BindWalletsToAccounts1791600000000',
  'ClassifyChainTransactions1791700000000',
  'LinkOwnTransfers1791800000000',
  'TrackEthereumWallets1792000000000',
  'TrackSolanaWallets1792100000000',
  'CapMfaFailureStreak1792200000000',
  'AddPasswordResetTokens1792500000000',
  'TrackSolanaStake1792600000000',
  'ChainDustThreshold1792700000000',
  'AddSessionDevice1792800000000',
  'ScanBitcoinXpub1792900000000',
  'LinkChainSwaps1793100000000',
  'TrackEthereumStake1793200000000',
  'SyncBybitAccount1793300000000',
  'TrackTronWallets1793600000000',
  'ReadBybitEarn1794000000000',
  'ReadBybitConverts1794400000000',
  'PriceBybitCoins1794500000000',
  'TrackAnyChainToken1794900000000',
  'TrackStellarWallets1795000000000',
  'HideChainTokens1795200000000',
  'TrackZcashWallets1795300000000',
  'TrackEvmChains1796000000000',
  'JournalWalletSyncs1796100000000',
  'KindOfWallet1796200000000',
  'StopTrackingWallets1796300000000',
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
    assert.deepEqual(ledger.map((row) => row.name), migrationNames, 'Exactly fifty-seven migrations');
    const tables = (await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )).rows.map((row) => row.tablename);
    for (const table of ['users', 'assets', 'liabilities', 'currencies', 'crypto_wallets', 'user_currency_preferences', 'owner_auth', 'auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits', ...accountingTables, ...tradeTables, ...csvTables, ...carryTables, ...flowTables, ...priceTables, ...fxTables, ...transferTables, ...rewardTables, ...swapTables, ...walletTables, ...marketPriceTables, ...threeCurrencyTables, ...snapshotTables, ...paidCurrencyTables, ...commentTables, ...settlementTables, ...purposeTables, ...classificationTables, ...resetTables, ...stakeTables, ...etherStakeTables]) {
      assert.ok(tables.includes(table), `Missing current table ${table}`);
    }
    assert.equal((await client.query('SELECT count(*)::int AS count FROM auth_request_limits')).rows[0].count, 0);
    for (const table of [...accountingTables, ...tradeTables, ...csvTables, ...carryTables, ...flowTables, ...priceTables, ...fxTables, ...transferTables, ...rewardTables, ...swapTables, ...walletTables, ...marketPriceTables, ...threeCurrencyTables, ...snapshotTables, ...paidCurrencyTables, ...commentTables, ...settlementTables, ...purposeTables, ...classificationTables, ...resetTables, ...stakeTables, ...etherStakeTables]) {
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

// The release compares normalized pg_dump output of production and its restored backup.
// PostgreSQL re-parses some CHECK expressions into an equivalent different text; each such
// constraint needs an exact reviewed pair in scripts/normalize-release-snapshot.awk, else
// every release fails "Isolated backup restore fingerprint mismatch" before migrating.
const reparsedChecks = [
  'account_csv_imports.account_csv_imports_check',
  'account_csv_imports.account_csv_imports_filename_check',
  'account_trade_version_payments.account_trade_version_payments_currency_check',
  'account_trade_version_payments.account_trade_version_payments_rateSource_check',
  'auth_sessions.auth_sessions_state_check',
  'owner_settings.owner_settings_mainCurrency_check',
];

async function verifyRestoredCheckForms() {
  const client = new Client(connection(freshName));
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND k.contype = 'c' ORDER BY c.relname, k.conname`);
    assert.ok(rows.length > 100, 'Current schema must expose its CHECK constraints');
    const reparsed = [];
    await client.query('BEGIN');
    try {
      for (const { relname, conname, definition } of rows) {
        // What pg_restore does with the dumped text, rolled back with everything else.
        await client.query(`ALTER TABLE public.${quoteIdentifier(relname)}
          ADD CONSTRAINT restore_form_probe ${definition} NOT VALID`);
        const restored = (await client.query(
          `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
           WHERE conrelid = $1::regclass AND conname = 'restore_form_probe'`,
          [`public.${quoteIdentifier(relname)}`],
        )).rows[0].definition;
        await client.query(`ALTER TABLE public.${quoteIdentifier(relname)} DROP CONSTRAINT restore_form_probe`);
        assert.ok(restored.endsWith(' NOT VALID'));
        if (restored.slice(0, -' NOT VALID'.length) !== definition) reparsed.push(`${relname}.${conname}`);
      }
    } finally {
      await client.query('ROLLBACK');
    }
    assert.deepEqual(reparsed.sort(), reparsedChecks, 'Reparsed CHECK forms must match the reviewed normalizer pairs');
    console.log('PASS REL-RESTORE-001 restored CHECK forms are covered by the release normalizer');
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
  assert.ok([8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 21].includes(previousCount));
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
      'auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits', ...accountingTables, ...tradeTables, ...csvTables, ...carryTables, ...flowTables, ...priceTables, ...fxTables, ...transferTables, ...rewardTables, ...swapTables, ...walletTables, ...marketPriceTables, ...threeCurrencyTables, ...snapshotTables, ...paidCurrencyTables, ...commentTables, ...settlementTables, ...purposeTables, ...classificationTables, ...resetTables, ...stakeTables, ...etherStakeTables];
    assert.deepEqual(after.rows.owner_mfa, [], 'No implicit MFA enrollment');
    assert.deepEqual(after.rows.owner_mfa_recovery, [], 'No implicit recovery codes');
    assert.deepEqual(after.rows.auth_request_limits, [], 'Migration creates no request admissions');
    for (const table of [...accountingTables, ...tradeTables, ...csvTables, ...carryTables, ...flowTables, ...priceTables, ...fxTables, ...transferTables, ...rewardTables, ...swapTables, ...walletTables, ...marketPriceTables, ...threeCurrencyTables, ...snapshotTables, ...paidCurrencyTables, ...commentTables, ...settlementTables, ...purposeTables, ...classificationTables, ...resetTables, ...stakeTables, ...etherStakeTables]) assert.deepEqual(after.rows[table], [], 'No implicit opening state');
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

async function fixtureTrade(client, owner, account, tradeId, version, journalRevision, kind, input, instrumentName, instrumentSymbol = 'SAME') {
  // Write only columns present in migration 14. The deferred head FK is resolved
  // by the surrounding transaction, just as it was by the original command.
  if (version === 1) await client.query(
    'INSERT INTO account_trades(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1)',
    [tradeId, owner, account]);
  const fields = { instrumentId: input.instrumentId, side: input.side,
    occurredAt: input.occurredAt, orderWithinTimestamp: input.orderWithinTimestamp,
    quantity: input.quantity, grossUsd: input.grossUsd, feeUsd: input.feeUsd };
  const payload = JSON.stringify({kind, ...(kind === 'create' ? {} : {tradeId}),
    expectedJournalRevision: input.expectedJournalRevision,
    ...(kind === 'void' ? {} : fields)});
  const {rows:[row]} = await client.query(`INSERT INTO account_trade_versions
    ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind,
      "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd")
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING "createdAt"`,
  [owner,account,tradeId,version,journalRevision,input.requestId,payload,kind,
    fields.instrumentId,fields.side,fields.occurredAt,fields.orderWithinTimestamp,
    fields.quantity,fields.grossUsd,fields.feeUsd]);
  await client.query('UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
    [owner,account,tradeId,version]);
  return {created:true,value:{accountId:account,journalRevision,trade:{tradeId,version,journalRevision,
    requestId:input.requestId,kind,createdAt:row.createdAt.toISOString(),...fields,
    instrumentName,instrumentSymbol}}};
}

function fixtureJournal(account, originReceipt, revision, activeTradeCount, versionCount, summary) {
  return {accountId:account,eligible:false,ineligibilityReason:'already-initialized',journal:{
    ...originReceipt.value,journalRevision:revision,activeTradeCount,versionCount,
    limits:{activeTrades:1000,versions:10000},summary}};
}

async function seedPreviousFourteen(client, target) {
  // Construct predecessor history with its actual schema. Current TradeService
  // reads connected-transfer tables that did not exist in predecessor 14.
  const source = new DataSource({ type: 'postgres', host: settings.DB_HOST,
    port: Number(settings.DB_PORT), username: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: target, synchronize: false,
    migrationsRun: false, installExtensions: false });
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const saved = [];
  await source.initialize();
  try {
    const accounting = new AccountingService(source), trade = new TradeService(source);
    const owners = (await client.query('SELECT id FROM users ORDER BY email')).rows;
    assert.equal(owners.length, 2);
    for (const [index, { id: owner }] of owners.entries()) {
      const account = (await accounting.createAccount(owner, {
        requestId: randomUUID(), name: `Preserved USD account ${index}` })).value.id;
      const instrument = await previousInstrument(source, owner, `Preserved USD instrument ${index}`, 'SAME');
      const origin = { requestId: randomUUID(), coverageFrom: '2025-01-01T00:00:00.000Z', assertEmpty: true };
      const originReceipt = await trade.initialize(owner, account, origin);
      const execution = (day, grossUsd, extra = {}) => ({ instrumentId: instrument, side: 'buy',
        occurredAt: `2025-01-0${day}T00:00:00.000Z`, orderWithinTimestamp: 0,
        quantity: '1', grossUsd, feeUsd: '0', ...extra });
      const create = (revision, fields) => ({ requestId: randomUUID(), expectedJournalRevision: revision, ...fields });
      const firstInput = create(0, execution(2, '100'));
      const secondInput = create(1, execution(3, '200'));
      const saleInput = create(2, execution(4, '150', { side: 'sell', quantity: '0.5' }));
      const correction = create(3, execution(2, '120'));
      const voidInput = { requestId: randomUUID(), expectedJournalRevision: 4 };
      const firstId = randomUUID(), secondId = randomUUID(), saleId = randomUUID();
      await client.query('BEGIN');
      let first, voided;
      try {
        first = await fixtureTrade(client, owner, account, firstId, 1, 1, 'create', firstInput,
          `Preserved USD instrument ${index}`);
        await fixtureTrade(client, owner, account, secondId, 1, 2, 'create', secondInput,
          `Preserved USD instrument ${index}`);
        await fixtureTrade(client, owner, account, saleId, 1, 3, 'create', saleInput,
          `Preserved USD instrument ${index}`);
        await fixtureTrade(client, owner, account, firstId, 2, 4, 'correct', correction,
          `Preserved USD instrument ${index}`);
        voided = await fixtureTrade(client, owner, account, secondId, 2, 5, 'void',
          {...secondInput,...voidInput}, `Preserved USD instrument ${index}`);
        await client.query('UPDATE account_trade_journals SET "currentRevision"=5 WHERE "ownerId"=$1 AND "accountId"=$2',
          [owner, account]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      const journal = fixtureJournal(account, originReceipt, 5, 2, 5,
        {grossBuysUsd:'120',buyFeesUsd:'0',grossSalesUsd:'150',sellFeesUsd:'0',
          netSalesUsd:'150',consumedCostUsd:'60',realizedUsd:'90',remainingCostUsd:'60'});
      assert.equal(journal.journal.journalRevision, 5);
      assert.equal(journal.journal.activeTradeCount, 2);
      assert.deepEqual(journal.journal.summary, { grossBuysUsd: '120', buyFeesUsd: '0',
        grossSalesUsd: '150', sellFeesUsd: '0', netSalesUsd: '150', consumedCostUsd: '60',
        realizedUsd: '90', remainingCostUsd: '60' });
      saved.push({ owner, account, origin, originReceipt, firstInput, first,
        secondTrade: secondId, voidInput, voided, journal });
    }
  } finally { await source.destroy(); }
  return async () => {
    await source.initialize();
    try {
      const trade = new TradeService(source);
      for (const item of saved) {
        assert.deepEqual(await trade.getJournal(item.owner, item.account), item.journal,
          'Populated predecessor corrections and terminal void retain exact90/60 current FIFO');
        assert.deepEqual(await trade.initialize(item.owner, item.account, item.origin),
          { created: false, value: item.originReceipt.value });
        assert.deepEqual(await trade.create(item.owner, item.account, item.firstInput),
          { created: false, value: item.first.value }, 'Old create receipt replays after correction');
        assert.deepEqual(await trade.void(item.owner, item.account, item.secondTrade, item.voidInput),
          { created: false, value: item.voided.value }, 'Terminal void receipt replays unchanged');
      }
    } finally { await source.destroy(); }
  };
}

// The only changes allowed to a pre-existing journal schema are the reviewed
// source link and replacement origin CHECK. No prior row or entire table is excluded.
// Predecessor schemas have no classification columns (AST-2): write the original column list.
async function previousInstrument(source, owner, name, symbol) {
  const [{ id }] = await source.query(`INSERT INTO accounting_instruments
    (id,"ownerId","requestId","canonicalPayload",name,symbol) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
  [randomUUID(), owner, randomUUID(), JSON.stringify({ name, symbol }), name, symbol]);
  return id;
}
// ClassifyAssets1790700000000 adds exactly these columns and checks to accounting_instruments.
// PostgreSQL 18 also lists each new NOT NULL column as a named contype 'n' constraint.
const classificationColumns = ['assetType', 'valuationCurrency', 'priceSource'];
const classificationChecks = ['accounting_instruments_asset_classification', 'accounting_instruments_asset_values'];
function classificationAddition(kind, row) {
  if (kind === 'columns') return row.table_name === 'accounting_instruments' && classificationColumns.includes(row.column_name);
  if (kind === 'constraints') return row.relname === 'accounting_instruments' && (classificationChecks.includes(row.conname)
    || (row.contype === 'n' && classificationColumns.some((column) =>
      row.conname === `accounting_instruments_${column}_not_null` && row.definition === `NOT NULL "${column}"`)));
  return false;
}
// AddPasswordResetTokens1792500000000 widens the admission scope check by 'reset-ip'.
const resetScopeCheck = "CHECK ((scope = ANY (ARRAY['csrf-ip'::text, 'login-ip'::text, 'mfa-ip'::text, 'login-account'::text, 'reset-ip'::text])))";
function replacedScopeCheck(kind, row) {
  return kind === 'constraints' && row.relname === 'auth_request_limits' && row.conname === 'auth_request_limits_scope_check';
}
// CapMfaFailureStreak1792200000000 adds one defaulted owner factor column and its checks.
function mfaStreakAddition(kind, row) {
  if (kind === 'columns') return row.table_name === 'owner_mfa' && row.column_name === 'consecutiveFailures';
  return kind === 'constraints' && row.relname === 'owner_mfa'
    && ['owner_mfa_consecutiveFailures_check', 'owner_mfa_consecutiveFailures_not_null'].includes(row.conname);
}
// AddSessionDevice1792800000000 adds one nullable browser name to sessions, no constraint.
function sessionDeviceAddition(kind, row) {
  return kind === 'columns' && row.table_name === 'auth_sessions' && row.column_name === 'device';
}
// KindOfWallet1796200000000 adds one nullable column and its check to manual_accounts;
// StopTrackingWallets1796300000000 adds one nullable removedAt column to it and to wallet_addresses.
function walletKindAddition(kind, row) {
  if (kind === 'columns') return (row.table_name === 'manual_accounts' && row.column_name === 'kind')
    || (['manual_accounts', 'wallet_addresses'].includes(row.table_name) && row.column_name === 'removedAt');
  return kind === 'constraints' && row.relname === 'manual_accounts' && row.conname === 'manual_accounts_kind_check';
}
function replacedOriginCheck(kind, row) {
  return kind === 'constraints' && row.relname === 'account_trade_journals'
    && row.conname === 'account_trade_journals_originKind_check';
}
function carryInJournalAddition(kind, row) {
  if (kind === 'columns') return row.table_name === 'account_trade_journals' && row.column_name === 'openingRevision';
  if (kind === 'constraints') return row.relname === 'account_trade_journals' && [
    'account_trade_journals_origin_check', 'account_trade_journals_opening_fk',
    'account_trade_journals_opening_key',
  ].includes(row.conname);
  if (kind === 'indexes') return row.tablename === 'account_trade_journals'
    && row.indexname === 'account_trade_journals_opening_key';
  return false;
}

async function seedPreviousFifteen(client, target) {
  const source = new DataSource({ type:'postgres', host:settings.DB_HOST,
    port:Number(settings.DB_PORT), username:settings.DB_USERNAME,
    password:settings.DB_PASSWORD, database:target, synchronize:false,
    migrationsRun:false, installExtensions:false });
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const { CsvImportService } = require('/app/backend/dist/accounting/csv-import.service.js');
  const saved = [];
  await source.initialize();
  try {
    const accounting = new AccountingService(source), trade = new TradeService(source);
    const owners = (await client.query('SELECT id FROM users ORDER BY email')).rows;
    assert.equal(owners.length,2);
    for (const [index,{id:owner}] of owners.entries()) {
      const account = (await accounting.createAccount(owner,{requestId:randomUUID(),name:`Preserved CSV account ${index}`})).value.id;
      const instrument = await previousInstrument(source, owner, `Preserved CSV instrument ${index}`, 'TOKEN');
      const origin = {requestId:randomUUID(),coverageFrom:'2025-01-01T00:00:00.000Z',assertEmpty:true};
      await trade.initialize(owner,account,origin);
      const settings = {format:{delimiter:',',decimalSeparator:'.',timestampMode:'offset'},
        mapping:{columns:{instrument:0,side:1,occurredAt:2,order:3,quantity:4,grossUsd:5,feeUsd:6},
          instruments:[{source:'TOKEN',instrumentId:instrument}],sides:[{source:'buy',side:'buy'}]},assertUsd:true};
      const batches = [];
      let revision = 0;
      for (const [order,state] of ['draft','committed','rolled-back'].entries()) {
        const bytes = Buffer.from('\uFEFFinstrument,side,time,order,quantity,gross,fee\r\n' +
          `TOKEN,buy,2025-01-02T00:00:00Z,${order},1,50,0\r\n`);
        const upload = {filename:`Сохранённый ${state}.csv`,bytes};
        const batchId = randomUUID(), sha256 = createHash('sha256').update(bytes).digest('hex');
        const {rows:[savedBatch]} = await client.query(`INSERT INTO account_csv_imports
          (id,"ownerId","accountId",sha256,"originalBytes","byteLength",filename,state,"acceptedSettings")
          VALUES($1,$2,$3,$4,$5,$6,$7,'draft',NULL) RETURNING "createdAt"`,
        [batchId,owner,account,sha256,bytes,bytes.length,upload.filename]);
        const accepted = {created:true,value:{batchId,sha256,byteLength:bytes.length,
          createdAt:savedBatch.createdAt.toISOString()}};
        let confirmInput,confirmReceipt,rollbackInput,rollbackReceipt;
        if (state !== 'draft') {
          const execution = {instrumentId:instrument,side:'buy',occurredAt:'2025-01-02T00:00:00.000Z',
            orderWithinTimestamp:order,quantity:'1',grossUsd:'50',feeUsd:'0'};
          const formatTuple = [',','.','offset',null];
          const mappingTuple = [[0,1,2,3,4,5,6,null],[['TOKEN',instrument]],[['buy','buy']]];
          const previewHash = createHash('sha256').update(JSON.stringify([
            'usd-csv-preview-v1','usd-csv-v1',account,batchId,sha256,formatTuple,mappingTuple,true,
            [[1,2,[instrument,'buy',execution.occurredAt,order,'1','50','0']]],revision,
          ]),'utf8').digest('hex');
          confirmInput = {...settings,requestId:randomUUID(),expectedJournalRevision:revision,
            parserVersion:'usd-csv-v1',previewHash};
          await client.query('BEGIN');
          try {
            const tradeId = randomUUID(), rowRequest = randomUUID();
            await fixtureTrade(client,owner,account,tradeId,1,revision+1,'create',
              {...execution,requestId:rowRequest,expectedJournalRevision:revision},
              `Preserved CSV instrument ${index}`,'TOKEN');
            await client.query(`INSERT INTO account_csv_import_rows
              ("ownerId","accountId","batchId",ordinal,"startLine","tradeId","createVersion","rollbackVersion")
              VALUES($1,$2,$3,1,2,$4,1,NULL)`,[owner,account,batchId,tradeId]);
            await client.query(`UPDATE account_csv_imports SET state='committed',"acceptedSettings"=$4::jsonb
              WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3`,
            [owner,account,batchId,JSON.stringify({parserVersion:'usd-csv-v1',...settings})]);
            const canonical = JSON.stringify(['usd-csv-command-v1','confirm',batchId,revision,
              'usd-csv-v1',formatTuple,mappingTuple,true,previewHash]);
            const {rows:[command]} = await client.query(`INSERT INTO account_csv_import_commands
              ("ownerId","accountId","requestId","batchId",kind,"canonicalPayload","rowCount","firstJournalRevision","lastJournalRevision")
              VALUES($1,$2,$3,$4,'confirm',$5,1,$6,$6) RETURNING "createdAt"`,
            [owner,account,confirmInput.requestId,batchId,canonical,revision+1]);
            confirmReceipt = {created:true,value:{accountId:account,batchId,
              requestId:confirmInput.requestId,kind:'confirm',rowCount:1,
              firstJournalRevision:revision+1,lastJournalRevision:revision+1,
              createdAt:command.createdAt.toISOString()}};
            revision++;
            if (state === 'rolled-back') {
              rollbackInput = {requestId:randomUUID(),expectedJournalRevision:revision};
              await fixtureTrade(client,owner,account,tradeId,2,revision+1,'void',
                {...execution,...rollbackInput},`Preserved CSV instrument ${index}`,'TOKEN');
              await client.query(`UPDATE account_csv_import_rows SET "rollbackVersion"=2
                WHERE "ownerId"=$1 AND "accountId"=$2 AND "batchId"=$3`,[owner,account,batchId]);
              await client.query(`UPDATE account_csv_imports SET state='rolled-back'
                WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3`,[owner,account,batchId]);
              const rollbackPayload = JSON.stringify(['usd-csv-command-v1','rollback',batchId,revision]);
              const {rows:[rolled]} = await client.query(`INSERT INTO account_csv_import_commands
                ("ownerId","accountId","requestId","batchId",kind,"canonicalPayload","rowCount","firstJournalRevision","lastJournalRevision")
                VALUES($1,$2,$3,$4,'rollback',$5,1,$6,$6) RETURNING "createdAt"`,
              [owner,account,rollbackInput.requestId,batchId,rollbackPayload,revision+1]);
              rollbackReceipt = {created:true,value:{accountId:account,batchId,
                requestId:rollbackInput.requestId,kind:'rollback',rowCount:1,
                firstJournalRevision:revision+1,lastJournalRevision:revision+1,
                createdAt:rolled.createdAt.toISOString()}};
              revision++;
            }
            await client.query('UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=$2',
              [owner,account,revision]);
            await client.query('COMMIT');
          } catch (error) { await client.query('ROLLBACK'); throw error; }
        }
        batches.push({batchId,state,upload,accepted,confirmInput,confirmReceipt,rollbackInput,rollbackReceipt});
      }
      const [originRow] = (await client.query('SELECT "requestId","coverageFrom","createdAt" FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2',
        [owner,account])).rows;
      const journal = fixtureJournal(account,{value:{accountId:account,requestId:originRow.requestId,
        originKind:'declared-empty',coverageFrom:originRow.coverageFrom.toISOString(),
        createdAt:originRow.createdAt.toISOString()}},3,1,3,
      {grossBuysUsd:'50',buyFeesUsd:'0',grossSalesUsd:'0',sellFeesUsd:'0',
        netSalesUsd:'0',consumedCostUsd:'0',realizedUsd:'0',remainingCostUsd:'50'});
      assert.equal(journal.journal.journalRevision,3);
      assert.deepEqual(journal.journal.summary,{grossBuysUsd:'50',buyFeesUsd:'0',grossSalesUsd:'0',sellFeesUsd:'0',
        netSalesUsd:'0',consumedCostUsd:'0',realizedUsd:'0',remainingCostUsd:'50'});
      for (const batch of batches) {
        const review = {journalRevision:3,eligible:batch.state==='committed',
          reason:batch.state==='committed'?null:'not-committed',
          removedTradeCount:batch.state==='committed'?1:0,
          additionalVersionCount:batch.state==='committed'?1:0,
          summaryBefore:journal.journal.summary,
          summaryAfter:batch.state==='committed'?
            {grossBuysUsd:'0',buyFeesUsd:'0',grossSalesUsd:'0',sellFeesUsd:'0',
              netSalesUsd:'0',consumedCostUsd:'0',realizedUsd:'0',remainingCostUsd:'0'}:null};
        batch.detail = {batch:{...batch.accepted.value,accountId:account,
          filename:batch.upload.filename,state:batch.state},
          acceptedSettings:batch.state==='draft'?null:{parserVersion:'usd-csv-v1',...settings},
          confirmReceipt:batch.confirmReceipt?.value??null,
          rollbackReceipt:batch.rollbackReceipt?.value??null,rollbackReview:review};
      }
      saved.push({owner,account,journal,batches});
    }
    assert.deepEqual((await client.query('SELECT state,count(*)::int AS count FROM account_csv_imports GROUP BY state ORDER BY state')).rows,
      [{state:'committed',count:2},{state:'draft',count:2},{state:'rolled-back',count:2}]);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM account_csv_import_commands')).rows[0].count,6);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM account_csv_import_rows')).rows[0].count,4);
  } finally { await source.destroy(); }
  return async () => {
    await source.initialize();
    try {
      const trade = new TradeService(source), csv = new CsvImportService(source);
      for (const value of saved) {
        assert.deepEqual(await trade.getJournal(value.owner,value.account),value.journal);
        for (const batch of value.batches) {
          assert.deepEqual(await csv.upload(value.owner,value.account,batch.upload),{created:false,value:batch.accepted.value});
          assert.deepEqual(await csv.detail(value.owner,value.account,batch.batchId),batch.detail);
          if (batch.confirmInput) assert.deepEqual(await csv.confirm(value.owner,value.account,batch.batchId,batch.confirmInput),
            {created:false,value:batch.confirmReceipt.value});
          if (batch.rollbackInput) assert.deepEqual(await csv.rollback(value.owner,value.account,batch.batchId,batch.rollbackInput),
            {created:false,value:batch.rollbackReceipt.value});
        }
      }
    } finally { await source.destroy(); }
  };
}

async function seedPreviousSixteen(client, target) {
  const source = new DataSource({ type: 'postgres', host: settings.DB_HOST,
    port: Number(settings.DB_PORT), username: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: target, synchronize: false,
    migrationsRun: false, installExtensions: false });
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const { CarryInService } = require('/app/backend/dist/accounting/carry-in.service.js');
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const saved = [];
  await source.initialize();
  try {
    const accounting = new AccountingService(source), carry = new CarryInService(source), trade = new TradeService(source);
    const owners = (await client.query('SELECT id FROM users ORDER BY email')).rows;
    assert.equal(owners.length, 2);
    for (const [index, { id: owner }] of owners.entries()) {
      const account = (await accounting.createAccount(owner,
        { requestId: randomUUID(), name: `Preserved carry account ${index}` })).value.id;
      const instrument = await previousInstrument(source, owner, `Preserved carry instrument ${index}`, 'CARRY');
      const openingInput = { requestId: randomUUID(), expectedRevision: 0,
        asOf: '2025-01-01T00:00:00.000Z', positions: [
          { instrumentId: instrument, quantity: '2', costStatus: 'known', totalCostUsd: '300' },
        ] };
      const opening = await accounting.saveOpening(owner, account, openingInput);
      const carryInput = { requestId: randomUUID(), expectedOpeningRevision: 1, assertReviewed: true,
        lots: [{ instrumentId: instrument, acquiredAt: '2024-01-01T00:00:00.000Z',
          orderWithinTimestamp: 0, originalQuantity: '4', remainingQuantity: '2', originalCostUsd: '600' }] };
      const accepted = await carry.initialize(owner, account, carryInput);
      assert.equal(accepted.created, true);
      const saleInput = { requestId: randomUUID(), expectedJournalRevision: 0, instrumentId: instrument,
        side: 'sell', occurredAt: '2025-01-02T00:00:00.000Z', orderWithinTimestamp: 0,
        quantity: '0.5', grossUsd: '100', feeUsd: '0' };
      await client.query('BEGIN');
      let sale;
      try {
        sale = await fixtureTrade(client, owner, account, randomUUID(), 1, 1, 'create', saleInput,
          `Preserved carry instrument ${index}`, 'CARRY');
        await client.query('UPDATE account_trade_journals SET "currentRevision"=1 WHERE "ownerId"=$1 AND "accountId"=$2',
          [owner, account]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      const lots = await carry.listLots(owner, account);
      assert.equal(lots.items[0].priorDisposedQuantity, '2');
      assert.equal(lots.items[0].priorAllocatedCostUsd, '300');
      const journal = fixtureJournal(account, accepted, 1, 1, 1,
        {grossBuysUsd:'0',buyFeesUsd:'0',grossSalesUsd:'100',sellFeesUsd:'0',
          netSalesUsd:'100',consumedCostUsd:'75',realizedUsd:'25',remainingCostUsd:'225'});
      assert.equal(journal.journal.summary.consumedCostUsd, '75');
      assert.equal(journal.journal.summary.realizedUsd, '25');
      assert.equal(journal.journal.summary.remainingCostUsd, '225');
      saved.push({ owner, account, openingInput, opening, carryInput, accepted, saleInput, sale, lots, journal });
    }
  } finally { await source.destroy(); }
  return async () => {
    await source.initialize();
    try {
      const accounting = new AccountingService(source), carry = new CarryInService(source), trade = new TradeService(source);
      for (const row of saved) {
        assert.deepEqual(await accounting.saveOpening(row.owner, row.account, row.openingInput), { created: false, value: row.opening.value });
        assert.deepEqual(await carry.initialize(row.owner, row.account, row.carryInput), { created: false, value: row.accepted.value });
        assert.deepEqual(await trade.create(row.owner, row.account, row.saleInput), { created: false, value: row.sale.value });
        assert.deepEqual(await carry.listLots(row.owner, row.account), row.lots);
        assert.deepEqual(await trade.getJournal(row.owner, row.account), row.journal);
      }
    } finally { await source.destroy(); }
  };
}

async function seedPreviousEighteen(client) {
  for (const { id: owner } of (await client.query('SELECT id FROM users ORDER BY email')).rows) {
    const { rows: instruments } = await client.query('SELECT id FROM accounting_instruments WHERE "ownerId"=$1 ORDER BY id LIMIT 1', [owner]);
    assert.equal(instruments.length, 1);
    await client.query(`INSERT INTO portfolio_flow_journals
      ("ownerId","requestId","canonicalPayload","coverageFrom","currentRevision")
      VALUES ($1,$2,'synthetic-preserved-origin','2025-01-01',1)`, [owner, randomUUID()]);
    await client.query(`INSERT INTO portfolio_flow_versions
      ("ownerId","flowId",version,"journalRevision","requestId","canonicalPayload",kind,direction,"occurredAt","amountUsd")
      VALUES ($1,$2,1,1,$3,'synthetic-preserved-flow','create','contribution','2025-01-02',123.45678901234567890123456789)`, [owner,randomUUID(),randomUUID()]);
    await client.query(`INSERT INTO manual_usd_price_versions
      ("ownerId","instrumentId",revision,"requestId","canonicalPayload",kind,"observedAt","priceUsd")
      VALUES ($1,$2,1,$3,'synthetic-preserved-price','set','2025-01-02',0.12345678901234567890123456789)`, [owner,instruments[0].id,randomUUID()]);
  }
}

async function verifyPopulatedAuthUpgrade(previousCount) {
  assert.ok([11, 12, 13, 14, 15, 16, 18, 21].includes(previousCount));
  const target = { 11: previousElevenName, 12: previousTwelveName, 13: previousThirteenName, 14: previousFourteenName, 15: previousFifteenName, 16: previousSixteenName, 18: previousEighteenName, 21: previousTwentyOneName }[previousCount];
  const scenario = { 11: 'LIMIT-006-A', 12: 'OPEN-004-B', 13: 'TRADE-MIG-001', 14: 'CSV-MIG-001', 15: 'CARRY-MIG-001', 16: 'FLOW-MIG-001', 18: 'DFX-MIGRATE', 21: 'SWAP-006' }[previousCount];
  const addedTables = [...(previousCount === 11 ? ['auth_request_limits'] : []),
    ...(previousCount < 13 ? accountingTables : []), ...(previousCount < 14 ? tradeTables : []), ...(previousCount < 15 ? csvTables : []), ...(previousCount < 16 ? carryTables : []), ...(previousCount < 17 ? flowTables : []), ...(previousCount < 18 ? priceTables : []), ...(previousCount < 19 ? fxTables : []), ...(previousCount < 20 ? transferTables : []), ...(previousCount < 21 ? rewardTables : []), ...swapTables, ...walletTables, ...marketPriceTables, ...threeCurrencyTables, ...snapshotTables, ...paidCurrencyTables, ...commentTables, ...settlementTables, ...purposeTables, ...classificationTables, ...resetTables, ...stakeTables, ...etherStakeTables];
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
    if (previousCount >= 13) await seedPreviousThirteen(client);
    const verifyTrades = previousCount >= 14 ? await seedPreviousFourteen(client, target) : async () => {};
    const verifyCsv = previousCount >= 15 ? await seedPreviousFifteen(client, target) : async () => {};
    const verifyCarry = previousCount >= 16 ? await seedPreviousSixteen(client, target) : async () => {};
    if (previousCount >= 18) await seedPreviousEighteen(client);
    const verifyRewardsAndTransfers = previousCount >= 21
      ? await require('./migration-reward-predecessor.cjs').seedRewardPredecessor(client, connection(target))
      : async () => {};
    const before = await snapshot(client);
    assert.equal(before.rows.migrations.length, previousCount);
    if (previousCount >= 13) {
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
    assert.deepEqual(after.constraints.filter(row => replacedScopeCheck('constraints', row)).map(row => row.definition),
      [resetScopeCheck], 'Admissions accept the reset scope and every earlier one');
    const streak = after.columns.filter(row => mfaStreakAddition('columns', row));
    assert.deepEqual(streak.map(row => [row.data_type, row.is_nullable]), [['integer', 'NO']]);
    assert.deepEqual(after.constraints.filter(row => mfaStreakAddition('constraints', row)).map(row => row.conname).sort(),
      ['owner_mfa_consecutiveFailures_check', 'owner_mfa_consecutiveFailures_not_null']);
    assert.deepEqual(after.columns.filter(row => sessionDeviceAddition('columns', row))
      .map(row => [row.data_type, row.is_nullable, row.column_default]), [['character varying', 'YES', null]]);
    assert.equal(after.constraints.some(row => row.relname === 'auth_sessions' && row.conname.includes('device')), false);
    const link = after.columns.filter(row => row.table_name === 'account_trade_journals' && row.column_name === 'openingRevision');
    assert.equal(link.length,1);
    assert.equal(link[0].data_type,'integer');
    assert.equal(link[0].is_nullable,'YES');
    assert.equal(link[0].column_default,null);
    assert.equal(after.constraints.some(row => replacedOriginCheck('constraints',row)),false);
    assert.deepEqual(after.constraints.filter(row => carryInJournalAddition('constraints',row)).map(row => row.conname).sort(),
      ['account_trade_journals_opening_fk','account_trade_journals_opening_key','account_trade_journals_origin_check']);
    for (const table of addedTables) assert.deepEqual(after.rows[table], [], 'New tables must be empty');
    if (previousCount >= 13) {
      assert.deepEqual(after.columns.filter(row => classificationAddition('columns', row))
        .map(row => [row.column_name, row.data_type, row.is_nullable, row.column_default]), [
        ['assetType', 'text', 'NO', "'manual'::text"],
        ['valuationCurrency', 'text', 'NO', "'USD'::text"],
        ['priceSource', 'text', 'NO', "'manual'::text"],
      ]);
      assert.deepEqual(after.constraints.filter(row => classificationAddition('constraints', row) && row.contype === 'c')
        .map(row => row.conname), classificationChecks);
    }
    for (const [table, rows] of Object.entries(before.rows)) {
      if (table !== 'migrations') {
        if (table === 'account_trade_journals' && previousCount < 16) {
          const originals = values => values.map(({ row }) => JSON.parse(row));
          const oldRows = originals(rows), newRows = originals(after.rows[table]);
          for (const row of newRows) {
            assert.equal(row.openingRevision, null, 'Prior journals gain only a NULL source link');
            delete row.openingRevision;
          }
          const ordered = values => values.sort((a,b) => a.accountId.localeCompare(b.accountId));
          assert.deepEqual(ordered(newRows), ordered(oldRows), 'Every old journal column/value remains identical');
        } else if (table === 'accounting_instruments') {
          const parsed = after.rows[table].map(({ row }) => JSON.parse(row));
          for (const row of parsed) {
            assert.deepEqual(classificationColumns.map((key) => row[key]), ['manual', 'USD', 'manual'],
              'Prior instruments without a market ticker become manual, USD, manual');
            for (const key of classificationColumns) delete row[key];
          }
          const ordered = (values) => values.sort((a, b) => a.id.localeCompare(b.id));
          assert.deepEqual(ordered(parsed), ordered(rows.map(({ row }) => JSON.parse(row))),
            'Every old instrument column/value remains identical');
        } else if (table === 'manual_accounts') {
          const parsed = after.rows[table].map(({ row }) => JSON.parse(row));
          for (const row of parsed) {
            assert.equal(row.kind, null, 'Prior accounts have no wallet kind');
            delete row.kind;
          }
          assert.deepEqual(parsed, rows.map(({ row }) => JSON.parse(row)),
            'Every old account column/value remains identical');
        } else if (table === 'owner_mfa') {
          const parsed = after.rows[table].map(({ row }) => JSON.parse(row));
          for (const row of parsed) {
            assert.equal(row.consecutiveFailures, 0, 'Prior factors start with an empty failure streak');
            delete row.consecutiveFailures;
          }
          assert.deepEqual(parsed, rows.map(({ row }) => JSON.parse(row)),
            'Every old owner factor column/value remains identical');
        } else if (table === 'auth_sessions') {
          const parsed = after.rows[table].map(({ row }) => JSON.parse(row));
          for (const row of parsed) {
            assert.equal(row.device, null, 'Prior sessions have no browser name');
            delete row.device;
          }
          assert.deepEqual(parsed, rows.map(({ row }) => JSON.parse(row)),
            'Preserve every previous session row and class');
        } else {
          assert.deepEqual(after.rows[table], rows, `Preserve every previous ${table} row, including all session classes`);
        }
      }
    }
    const oldMigrationNames = migrationNames.slice(0, previousCount);
    assert.deepEqual(after.rows.migrations.filter(({ row }) => oldMigrationNames.includes(JSON.parse(row).name)),
      before.rows.migrations, 'Every prior migration record is unchanged');
    const records = (await client.query('SELECT id,timestamp,name FROM migrations ORDER BY timestamp')).rows;
    assert.deepEqual(records.map(row => row.name), migrationNames);
    for (let index = previousCount; index < migrationNames.length; index++) {
      assert.equal(records[index].id, records[index - 1].id + 1, 'Migration history appends each record exactly once');
      assert.equal(String(records[index].timestamp), ['1790020000000', '1790030000000', '1790040000000', '1790050000000', '1790060000000', '1790070000000', '1790080000000', '1790090000000', '1790100000000', '1790200000000', '1790300000000', '1790400000000', '1790700000000', '1790800000000', '1790900000000', '1791000000000', '1791100000000', '1791200000000', '1791300000000', '1791400000000', '1791600000000', '1791700000000', '1791800000000', '1792000000000', '1792100000000', '1792200000000', '1792500000000', '1792600000000', '1792700000000', '1792800000000', '1792900000000', '1793100000000', '1793200000000', '1793300000000', '1793600000000', '1794000000000', '1794400000000', '1794500000000', '1794900000000', '1795000000000', '1795200000000', '1795300000000', '1796000000000', '1796100000000', '1796200000000', '1796300000000'][index - 11]);
    }
    for (const [kind, tableKey] of [
      ['tables', 'tablename'], ['columns', 'table_name'], ['constraints', 'relname'], ['indexes', 'tablename'],
    ]) {
      const prior = before[kind].filter(row => !(previousCount < 16 && replacedOriginCheck(kind,row)) && !replacedScopeCheck(kind, row));
      const retained = after[kind].filter(row => !addedTables.includes(row[tableKey]) && !(previousCount < 16 && carryInJournalAddition(kind,row))
        && !(previousCount >= 13 && classificationAddition(kind, row))
        && !mfaStreakAddition(kind, row) && !sessionDeviceAddition(kind, row) && !walletKindAddition(kind, row) && !replacedScopeCheck(kind, row));
      assert.deepEqual(retained, prior, `Every previous ${kind} entry (only pre16 permits the reviewed carry-in schema change) remains unchanged`);
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
    await verifyTrades();
    await verifyCsv();
    await verifyCarry();
    await verifyRewardsAndTransfers();

    stage = `${scenario} current migration populated replay`;
    const replay = runMigration(target);
    assert.equal(replay.status, 0);
    assert.deepEqual(await snapshot(client), after, 'Replay is identical across all schema, data, sessions and migration state');
    await verifyFactors();
    await verifyTrades();
    await verifyCsv();
    await verifyCarry();
    await verifyRewardsAndTransfers();
    if (previousCount === 21) {
      const { AddAssetSwaps1790300000000 } = require('/app/backend/dist/migrations/1790300000000-AddAssetSwaps.js');
      await assert.rejects(() => new AddAssetSwaps1790300000000().down(), /recovery plan/);
      assert.deepEqual(await snapshot(client), after, 'Refused downgrade preserves all data and schema');
    }
    console.log(`PASS ${scenario} populated${previousCount}-to27 preserves every prior row/schema/session/admission, authentic encrypted factors and used/unused recovery; empty additive tables and exact replay`);
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
  if (process.argv[2] === '--economic-predecessors') {
    await verifyFresh();
    for (const previousCount of [14, 15, 16, 18]) await verifyPopulatedAuthUpgrade(previousCount);
    return;
  }
  if (process.argv[2] === '--from18' || process.argv[2] === '--from21') {
    await verifyFresh();
    await verifyPopulatedAuthUpgrade(process.argv[2] === '--from21' ? 21 : 18);
    return;
  }
  assert.equal(process.argv.length, 2, 'Unknown fixture selection');
  stage = 'MIG-002 migration lock contention'; await verifyLockContention();
  stage = 'ISO-001 fresh schema and replay'; await verifyFresh();
  stage = 'REL-RESTORE-001 reparsed CHECK forms need reviewed normalizer pairs'; await verifyRestoredCheckForms();
  stage = 'ISO-002 populated destructive legacy refusal'; await verifyLegacy(legacyName);
  stage = 'ISO-002 empty destructive legacy refusal'; await verifyLegacy(emptyLegacyName, true);
  stage = 'OWN-MIG-001 previous8 upgrade'; await verifyAdditiveOwnerUpgrade();
  stage = 'SES-MIG-001 previous9 upgrade'; await verifyAdditiveOwnerUpgrade(9);
  stage = 'MFA-MIG-001 previous10 upgrade and session revocation'; await verifyAdditiveOwnerUpgrade(10);
  await verifyPopulatedAuthUpgrade(11);
  await verifyPopulatedAuthUpgrade(12);
  await verifyPopulatedAuthUpgrade(13);
  await verifyPopulatedAuthUpgrade(14);
  await verifyPopulatedAuthUpgrade(15);
  await verifyPopulatedAuthUpgrade(16);
  await verifyPopulatedAuthUpgrade(18);
  await verifyPopulatedAuthUpgrade(21);
}

main().catch(() => {
  console.error(`FAIL isolated migration acceptance at stage: ${stage} (credential-bearing assertion details withheld)`);
  process.exitCode = 1;
});
