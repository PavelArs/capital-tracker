'use strict';

// Real compiled services and a fresh synthetic PostgreSQL database; no backend mocks.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, readdirSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_asset_rewards_e2e';
const predecessor = 'capital_tracker_asset_rewards_previous_e2e';
const rewardTables = ['account_rewards', 'account_reward_versions'];
const coverage = '2025-01-01T00:00:00.000Z';
const rewardAt = '2025-01-02T00:00:00.000Z';
const transferAt = '2025-01-03T00:00:00.000Z';
const saleAt = '2025-01-04T00:00:00.000Z';
let stage = 'isolated prerequisites';
function source(name = database) {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: name })).createTypeOrmOptions();
  assert.equal(options.synchronize, false); assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function services(db) {
  const make = (file, type) => new (require(`/app/backend/dist/accounting/${file}.js`)[type])(db);
  return { accounting: make('accounting.service', 'AccountingService'), reward: make('asset-reward.service', 'AssetRewardService'),
    csv: make('csv-import.service', 'CsvImportService'),
    trade: make('trade.service', 'TradeService'), transfer: make('owned-transfer.service', 'OwnedTransferService'),
    history: make('historical-accounting.service', 'HistoricalAccountingService'),
    valuation: make('historical-valuation.service', 'HistoricalValuationService'),
    prices: make('manual-price.service', 'ManualPriceService'),
    series: make('valuation-history.service', 'ValuationHistoryService'),
    portfolio: make('manual-portfolio-valuation.service', 'ManualPortfolioValuationService') };
}
// AST-2 adds three classification columns to accounting_instruments; upgrade comparisons
// strip only those keys and check their defaults separately.
async function fingerprint(db, excluded = [], withoutClassification = false) {
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const values = [];
  for (const { tablename } of tables) {
    if (excluded.includes(tablename)) continue;
    assert.match(tablename, /^[a-z_]+$/);
    // Upgrades add owner_mfa."consecutiveFailures" and auth_sessions.device
    // (asserted to be 0 and null separately).
    const row = withoutClassification && tablename === 'accounting_instruments'
      ? "to_jsonb(t) - 'assetType' - 'valuationCurrency' - 'priceSource'"
      : withoutClassification && tablename === 'owner_mfa' ? "to_jsonb(t) - 'consecutiveFailures'"
        : withoutClassification && tablename === 'auth_sessions' ? "to_jsonb(t) - 'device'" : 'to_jsonb(t)';
    values.push([tablename, await db.query(`SELECT (${row})::text AS row FROM "${tablename}" t ORDER BY row`)]);
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
async function unchanged(db, action, status) {
  const before = await fingerprint(db);
  await assert.rejects(async () => action(), error => error.getStatus?.() === status,
    'Specified domain error, never incidental SQL/type failure');
  assert.equal(await fingerprint(db), before, 'Every table including request identity is unchanged');
}
async function createDatabase(name) {
  assert.ok([database, predecessor].includes(name));
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0,
      'Never reuse/drop an existing database');
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally { await admin.end(); }
}
function migrate(name) {
  assert.ok([database, predecessor].includes(name));
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `Actual guarded CLI: ${result.stderr}`);
  return result.stdout;
}
async function account(s, owner, name) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  await s.trade.initialize(owner, id, { requestId: randomUUID(), coverageFrom: coverage, assertEmpty: true });
  return id;
}
const input = (instrumentId, revision, changes = {}) => ({ requestId: randomUUID(), expectedJournalRevision: revision,
  assertReward: true, instrumentId, category: 'staking', occurredAt: rewardAt, orderWithinTimestamp: 0,
  quantity: '2', acquisitionBasisUsd: null, incomeValueUsd: '40', ...changes });
const correction = (version, revision, changes = {}) => ({ requestId: randomUUID(), expectedJournalRevision: revision,
  expectedVersion: version.version, assertReward: true, instrumentId: version.instrumentId,
  category: version.category, occurredAt: version.occurredAt, orderWithinTimestamp: version.orderWithinTimestamp,
  quantity: version.quantity, acquisitionBasisUsd: version.acquisitionBasisUsd, incomeValueUsd: version.incomeValueUsd, ...changes });
const journal = async (s, owner, id) => (await s.trade.getJournal(owner, id)).journal;

async function migrationPreservation() {
  stage = 'REWARD-006 fresh22/populated20/no-op';
  await createDatabase(predecessor);
  const db = source(predecessor);
  db.setOptions({ migrations: readdirSync('/app/backend/dist/migrations').filter(file => file.endsWith('.js') && file < '1790200000000')
    .map(file => `/app/backend/dist/migrations/${file}`) });
  await db.initialize();
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.runMigrations({ transaction: 'all' });
    assert.equal((await db.query('SELECT count(*)::int n FROM migrations'))[0].n, 20);
    const [{ id: owner }] = await db.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES('reward-predecessor@example.invalid','synthetic-no-login',true) RETURNING id`);
    // Freeze predecessor rows using their original schema, not current services that
    // may query new reward tables before the migration exists.
    const accountId = randomUUID(), instrumentId = randomUUID(), tradeId = randomUUID(), requestId = randomUUID();
    const execution = { kind: 'create', expectedJournalRevision: 0, instrumentId, side: 'buy', occurredAt: rewardAt,
      orderWithinTimestamp: 0, quantity: '2', grossUsd: '100', feeUsd: '0' };
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO manual_accounts(id,"ownerId",name,"requestId","canonicalPayload")
        VALUES($1,$2,'Previous account',$3,$4)`, [accountId, owner, randomUUID(), JSON.stringify({ name: 'Previous account' })]);
      await manager.query(`INSERT INTO accounting_instruments(id,"ownerId",name,symbol,"requestId","canonicalPayload")
        VALUES($1,$2,'Previous asset','SAME',$3,$4)`, [instrumentId, owner, randomUUID(), JSON.stringify({ name: 'Previous asset', symbol: 'SAME' })]);
      await manager.query(`INSERT INTO account_trade_journals("ownerId","accountId","requestId","canonicalPayload","originKind","coverageFrom","currentRevision")
        VALUES($1,$2,$3,$4,'declared-empty',$5,1)`, [owner, accountId, randomUUID(), JSON.stringify({ coverageFrom: coverage, assertEmpty: true }), coverage]);
      await manager.query(`INSERT INTO account_trades(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1)`, [tradeId, owner, accountId]);
      await manager.query(`INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind,
        "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd")
        VALUES($1,$2,$3,1,1,$4,$5,'create',$6,'buy',$7,0,2,100,0)`,
        [owner, accountId, tradeId, requestId, JSON.stringify(execution), instrumentId, rewardAt]);
    });
    const credential = randomUUID(), enrollment = randomUUID();
    await db.query('INSERT INTO owner_auth(id,"userId","credentialVersion") VALUES(1,$1,$2)', [owner, credential]);
    // Synthetic schema-valid authentication evidence, never used to bypass login.
    await db.query(`INSERT INTO auth_sessions("tokenHash","csrfToken",state,"userId","credentialVersion",
      "createdAt","lastSeenAt","expiresAt","mfaVerifiedAt")
      VALUES($1,$2,'authenticated',$3,$4,$5,$5,$6,$5)`,
      ['a'.repeat(64), 'b'.repeat(43), owner, credential, coverage, saleAt]);
    await db.query(`INSERT INTO owner_mfa(id,"userId","activeVersion","activeEnvelope","lastCounter")
      VALUES(1,$1,$2,$3,1234)`, [owner, enrollment, { syntheticPreservationEvidence: true }]);
    await db.query(`INSERT INTO owner_mfa_recovery("codeHash","userId","enrollmentVersion") VALUES($1,$2,$3)`,
      ['c'.repeat(64), owner, enrollment]);
    await db.query(`INSERT INTO auth_request_limits(scope,"subjectHash",hits,"windowStartedAt","expiresAt")
      VALUES('login-account',$1,2,$2,$2::timestamptz+interval '600 seconds')`, ['d'.repeat(64), coverage]);
    const csvBytes = Buffer.from('instrument,quantity\nSAME,2\n');
    await db.query(`INSERT INTO account_csv_imports(id,"ownerId","accountId",sha256,"originalBytes","byteLength",filename,state)
      VALUES($1,$2,$3,$4,$5,$6,'prior.csv','draft')`,
      [randomUUID(), owner, accountId, createHash('sha256').update(csvBytes).digest('hex'), csvBytes, csvBytes.length]);
    const before = await fingerprint(db, ['migrations'], true);
    assert.match(migrate(predecessor), /Migrations applied: 30/);
    assert.deepEqual(await db.query('SELECT "consecutiveFailures" FROM owner_mfa'), [{ consecutiveFailures: 0 }]);
    assert.deepEqual(await db.query('SELECT device FROM auth_sessions'), [{ device: null }]);
    assert.equal(await fingerprint(db, [...rewardTables, 'account_swaps', 'account_swap_versions', 'wallet_addresses', 'wallet_address_transactions', 'price_observations', 'sync_sources', 'fx_rates', 'owner_settings', 'portfolio_snapshots', 'portfolio_snapshot_state', 'account_trade_version_payments', 'account_trade_version_comments', 'account_trade_version_settlements', 'account_trade_version_purposes', 'chain_transaction_classifications', 'chain_transaction_classification_versions', 'password_reset_tokens', 'wallet_stake_accounts', 'wallet_stake_moves', 'wallet_stake_rewards', 'wallet_stake_scans', 'wallet_xpub_addresses', 'wallet_ether_stake_positions', 'wallet_ether_stake_moves', 'wallet_ether_stake_rewards', 'bybit_accounts', 'wallet_tron_accounts', 'wallet_tron_stake_moves', 'wallet_stellar_accounts', 'migrations'], true), before);
    assert.deepEqual(await db.query('SELECT "assetType","valuationCurrency","priceSource" FROM accounting_instruments'),
      [{ assetType: 'manual', valuationCurrency: 'USD', priceSource: 'manual' }]);
    for (const table of [...rewardTables, 'account_swaps', 'account_swap_versions']) assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`))[0].n, 0);
    const s = services(db);
    const { kind: _kind, ...body } = execution;
    const replay = await s.trade.create(owner, accountId, { ...body, requestId });
    assert.equal(replay.created, false); assert.equal(replay.value.trade.tradeId, tradeId);
    assert.equal((await journal(s, owner, accountId)).summary.remainingCostUsd, '100');
    const after = await fingerprint(db);
    assert.match(migrate(predecessor), /Migrations applied: 0/);
    assert.equal(await fingerprint(db), after);
    const { AddAssetRewards1790200000000 } = require('/app/backend/dist/migrations/1790200000000-AddAssetRewards.js');
    await assert.rejects(() => new AddAssetRewards1790200000000().down(), /recovery|downgrade/i);
    assert.equal(await fingerprint(db), after);
  } finally { await db.destroy(); }
  console.log('PASS REWARD-006 populated20/fresh22 preservation, immutable prior replay, no-op, downgrade refusal');
}

async function economics(db, s, f) {
  stage = 'REWARD-001/002/003 quantity, unknown cost, income, movement and restatement';
  const a = await account(s, f.owner, 'Rewards A'), b = await account(s, f.owner, 'Rewards B');
  const command = input(f.token, 0);
  const created = await s.reward.create(f.owner, a, command);
  assert.equal(created.created, true);
  const saved = JSON.parse(JSON.stringify(created.value));
  const rewardId = saved.reward.rewardId;
  assert.equal(saved.journalRevision, 1); assert.equal(saved.reward.acquisitionBasisUsd, null);
  assert.equal(saved.reward.incomeValueUsd, '40');
  const state = await journal(s, f.owner, a);
  assert.equal(state.versionCount, 0);
  assert.equal(state.summary.grossBuysUsd, '0'); assert.equal(state.summary.realizedUsd, '0');
  assert.equal(state.summary.remainingCostUsd, null);
  assert.equal(state.rewardSummary.declaredIncomeUsd, '40');
  await s.prices.set(f.owner, f.token, { requestId: randomUUID(), expectedRevision: 0, assertReviewed: true, observedAt: rewardAt, priceUsd: '5' });
  const valuation = await s.valuation.getSnapshot(f.owner, a, { at: rewardAt });
  assert.equal(valuation.totalValueUsd, '10'); assert.equal(valuation.completeness, 'complete');
  assert.equal(valuation.items[0].costUsd, null); assert.equal(valuation.items[0].unknownCostQuantity, '2');
  const movement = { requestId: randomUUID(), fromAccountId: a, toAccountId: b,
    expectedFromJournalRevision: 1, expectedToJournalRevision: 0, assertInternal: true,
    instrumentId: f.token, occurredAt: transferAt, orderWithinTimestamp: 0, quantity: '1', feeInstrumentId: null, feeQuantity: '0' };
  const transfer = (await s.transfer.create(f.owner, movement)).value;
  const sale = await s.trade.create(f.owner, b, { requestId: randomUUID(), expectedJournalRevision: 1,
    instrumentId: f.token, side: 'sell', occurredAt: saleAt, orderWithinTimestamp: 0,
    quantity: '1', grossUsd: '80', feeUsd: '0' });
  assert.equal(sale.created, true);
  const oldPin = (await journal(s, f.owner, b)).journalRevision;
  assert.equal((await journal(s, f.owner, b)).summary.realizedUsd, null);
  const corrected = await s.reward.correct(f.owner, a, rewardId, correction(saved.reward, 3, { acquisitionBasisUsd: '120' }));
  assert.equal(corrected.created, true); assert.equal(corrected.value.reward.version, 2);
  assert.equal((await journal(s, f.owner, a)).summary.remainingCostUsd, '60');
  const receiver = await journal(s, f.owner, b);
  assert.equal(receiver.summary.consumedCostUsd, '60'); assert.equal(receiver.summary.realizedUsd, '20');
  assert.equal(receiver.journalRevision, oldPin + 1); assert.equal(receiver.versionCount, 1);
  await unchanged(db, () => s.trade.listLots(f.owner, b, { journalRevision: String(oldPin) }), 409);
  assert.deepEqual(await s.reward.create(f.owner, a, command), { created: false, value: saved });
  assert.deepEqual(await s.transfer.create(f.owner, movement), { created: false, value: transfer });
  await unchanged(db, () => s.reward.void(f.owner, a, rewardId, { requestId: randomUUID(), expectedJournalRevision: 4, expectedVersion: 2 }), 409);
  await unchanged(db, () => s.reward.correct(f.owner, a, rewardId, correction(corrected.value.reward, 4, { quantity: '0.5' })), 409);
  assert.equal((await s.reward.listVersions(f.owner, a, rewardId, {})).items.length, 2);
  assert.equal((await s.reward.list(f.owner, a, {})).versionCount, 2);
  const match = (await s.trade.listMatches(f.owner, b, sale.value.trade.tradeId, {})).items[0];
  assert.equal(match.origin.kind, 'reward'); assert.equal(match.origin.rewardId, rewardId);
  assert.equal(match.origin.version, 2); assert.equal(match.costUsd, '60');
  console.log('PASS REWARD-001/002/003 exact quantity/null basis/independent value/income, transfer sale restatement and immutable receipts');
}

async function lifecycle(db, s, f) {
  stage = 'REWARD-003/006 explicit0, unclassified, terminal void and private errors';
  const a = await account(s, f.owner, 'Zero and unresolved');
  const first = input(f.token, 0, { acquisitionBasisUsd: '0', incomeValueUsd: '0' });
  const saved = (await s.reward.create(f.owner, a, first)).value;
  assert.equal((await journal(s, f.owner, a)).summary.remainingCostUsd, '0');
  const second = input(f.token, 1, { orderWithinTimestamp: 1, category: 'unclassified', acquisitionBasisUsd: '0' });
  const unresolved = (await s.reward.create(f.owner, a, second)).value;
  const state = await journal(s, f.owner, a);
  assert.equal(state.rewardSummary.declaredIncomeUsd, null);
  assert.equal(state.rewardSummary.knownIncomeSubtotalUsd, '0'); assert.equal(state.rewardSummary.unclassifiedCount, 1);
  for (const [field, value] of [['quantity', 2], ['acquisitionBasisUsd', undefined], ['incomeValueUsd', undefined], ['category', 'deposit'], ['assertReward', false]]) {
    await unchanged(db, () => s.reward.create(f.owner, a, { ...input(f.token, 2), [field]: value }), 400);
  }
  await unchanged(db, () => s.reward.create(f.owner, a, input(f.foreignToken, 2)), 404);
  await unchanged(db, () => s.reward.list(f.other, a, {}), 404);
  await unchanged(db, () => s.reward.listVersions(f.other, a, saved.reward.rewardId, {}), 404);
  await unchanged(db, () => s.reward.create(f.owner, a, { ...first, acquisitionBasisUsd: null }), 409);
  await unchanged(db, () => s.reward.list(f.owner, a, { offset: '1' }), 400);
  const voidInput = { requestId: randomUUID(), expectedJournalRevision: 2, expectedVersion: 1 };
  const voided = (await s.reward.void(f.owner, a, unresolved.reward.rewardId, voidInput)).value;
  assert.equal(voided.reward.kind, 'void'); assert.equal(voided.reward.category, 'unclassified');
  await unchanged(db, () => s.reward.void(f.owner, a, unresolved.reward.rewardId, { ...voidInput, requestId: randomUUID(), expectedVersion: 2, expectedJournalRevision: 3 }), 409);
  assert.deepEqual(await s.reward.void(f.owner, a, unresolved.reward.rewardId, voidInput), { created: false, value: voided });
  assert.equal((await journal(s, f.owner, a)).rewardSummary.declaredIncomeUsd, '0');
  console.log('PASS REWARD-003/006 known0, unresolved subtype, full immutable void/replay and private validation');
}

async function constraintsAndCommit(db, s, f) {
  stage = 'REWARD-003/006 SQL constraints and deferred COMMIT rollback witness';
  const a = await account(s, f.owner, 'Constraint account');
  const command = input(f.token, 0);
  const saved = (await s.reward.create(f.owner, a, command)).value;
  const rewardId = saved.reward.rewardId;
  for (const [field, value, code] of [
    ['quantity', '0', '23514'], ['quantity', 'NaN', '23514'],
    ['quantity', 'Infinity', '22003'], ['acquisitionBasisUsd', 'NaN', '23514'],
    ['incomeValueUsd', '-1', '23514'], ['category', 'deposit', '23514'],
    ['instrumentId', f.foreignToken, '23503'],
  ]) {
    assert.ok(['quantity', 'acquisitionBasisUsd', 'incomeValueUsd', 'category', 'instrumentId'].includes(field));
    const before = await fingerprint(db);
    await assert.rejects(() => db.query(
      `UPDATE account_reward_versions SET "${field}"=$1 WHERE "ownerId"=$2 AND "accountId"=$3 AND "rewardId"=$4 AND version=1`,
      [value, f.owner, a, rewardId]), error => error.code === code,
      `SQL ${field} rejects invalid direct data for the intended constraint`);
    assert.equal(await fingerprint(db), before);
  }
  const beforeHead = await fingerprint(db);
  await assert.rejects(() => db.query(
    'UPDATE account_rewards SET "currentVersion"=2 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
    [f.owner, a, rewardId]), error => error.code === '23503');
  assert.equal(await fingerprint(db), beforeHead);

  await db.query('CREATE SEQUENCE reward_commit_witness');
  await db.query(`CREATE FUNCTION fail_reward_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM account_rewards r JOIN account_trade_journals j
        ON j."ownerId"=r."ownerId" AND j."accountId"=r."accountId"
        WHERE r."ownerId"=NEW."ownerId" AND r."accountId"=NEW."accountId"
        AND r.id=NEW."rewardId" AND r."currentVersion"=NEW.version
        AND j."currentRevision"=NEW."journalRevision") THEN
        RAISE EXCEPTION 'reward write path incomplete';
      END IF;
      PERFORM nextval('reward_commit_witness');
      RAISE EXCEPTION 'synthetic deferred reward failure';
    END $$`);
  await db.query(`CREATE CONSTRAINT TRIGGER reward_commit_failure AFTER INSERT ON account_reward_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_reward_commit()`);
  const replacement = correction(saved.reward, 1, { acquisitionBasisUsd: '100' });
  const before = await fingerprint(db);
  try {
    await assert.rejects(() => s.reward.correct(f.owner, a, rewardId, replacement),
      /synthetic deferred reward failure/);
    const [witness] = await db.query('SELECT last_value::text,is_called FROM reward_commit_witness');
    assert.deepEqual(witness, { last_value: '1', is_called: true },
      'Nontransactional sequence proves version/head/pin writes reached deferred COMMIT');
    assert.equal(await fingerprint(db), before, 'Commit failure rolls back every saved row/key/pin');
  } finally {
    await db.query('DROP TRIGGER reward_commit_failure ON account_reward_versions');
    await db.query('DROP FUNCTION fail_reward_commit()');
    await db.query('DROP SEQUENCE reward_commit_witness');
  }
  const accepted = await s.reward.correct(f.owner, a, rewardId, replacement);
  assert.equal(accepted.created, true);
  assert.equal(accepted.value.reward.version, 2, 'Same request key was not reserved by failed commit');
  console.log('PASS REWARD-003/006 actual SQL constraints/deferred post-write witness/whole-command rollback/same-key recovery');
}

async function coherentSnapshot(db, s, f) {
  stage = 'REWARD-004 real two-connection connected snapshot';
  const a = await account(s, f.owner, 'Snapshot reward source');
  const b = await account(s, f.owner, 'Snapshot reward recipient');
  const saved = (await s.reward.create(f.owner, a, input(f.token, 0, { acquisitionBasisUsd: '100' }))).value;
  await s.transfer.create(f.owner, { requestId: randomUUID(), fromAccountId: a, toAccountId: b,
    expectedFromJournalRevision: 1, expectedToJournalRevision: 0, assertInternal: true,
    instrumentId: f.token, occurredAt: transferAt, orderWithinTimestamp: 0, quantity: '1',
    feeInstrumentId: null, feeQuantity: '0' });
  const readDb = source();
  await readDb.initialize();
  let signal, release;
  const seen = new Promise(resolve => { signal = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let armed = true;
  const createRunner = readDb.createQueryRunner.bind(readDb);
  readDb.createQueryRunner = (...args) => {
    const runner = createRunner(...args);
    const query = runner.query.bind(runner);
    runner.query = async (sql, ...rest) => {
      const result = await query(sql, ...rest); // Every query still executes against PostgreSQL.
      if (armed && /SELECT \* FROM account_trade_journals/.test(sql)) {
        armed = false;
        const [isolation] = await query('SHOW transaction_isolation');
        const [readOnly] = await query('SHOW transaction_read_only');
        assert.equal(isolation.transaction_isolation, 'repeatable read');
        assert.equal(readOnly.transaction_read_only, 'on');
        signal();
        await gate;
      }
      return result;
    };
    return runner;
  };
  let pending;
  try {
    const [writerPid] = await db.query('SELECT pg_backend_pid() AS pid');
    const [readerPid] = await readDb.query('SELECT pg_backend_pid() AS pid');
    assert.notEqual(writerPid.pid, readerPid.pid);
    const before = await fingerprint(db);
    pending = services(readDb).history.getSnapshot(f.owner, b, { at: transferAt });
    // A query exception must fail directly rather than leave a silent barrier timeout.
    await Promise.race([seen, pending.then(() => { throw new Error('Reader never reached expected real barrier'); })]);
    await s.reward.correct(f.owner, a, saved.reward.rewardId, correction(saved.reward, 2, { acquisitionBasisUsd: '120' }));
    const afterWriter = await fingerprint(db);
    assert.notEqual(afterWriter, before);
    release();
    const old = await pending;
    assert.equal(old.journalRevision, 1); assert.equal(old.items[0].costUsd, '50');
    const next = await s.history.getSnapshot(f.owner, b, { at: transferAt });
    assert.equal(next.journalRevision, 2); assert.equal(next.items[0].costUsd, '60');
    assert.equal(await fingerprint(db), afterWriter, 'Read-only requests never add further mutations');
  } finally {
    release();
    if (pending) await Promise.allSettled([pending]);
    await readDb.destroy();
  }
  console.log('PASS REWARD-004 actual RR/read-only two-PID snapshot and connected old/new evidence');
}

async function connectedCsv(db, s, f) {
  stage = 'REWARD-003/004 reward-aware CSV completeness, invalidation and rollback';
  const a = await account(s, f.owner, 'Reward CSV source'), b = await account(s, f.owner, 'Reward CSV sale');
  const rewardCommand = input(f.token, 0);
  const reward = (await s.reward.create(f.owner, a, rewardCommand)).value;
  await s.transfer.create(f.owner, { requestId: randomUUID(), fromAccountId: a, toAccountId: b,
    expectedFromJournalRevision: 1, expectedToJournalRevision: 0, assertInternal: true,
    instrumentId: f.token, occurredAt: transferAt, orderWithinTimestamp: 0,
    quantity: '1', feeInstrumentId: null, feeQuantity: '0' });
  const bytes = Buffer.from(`instrument,side,time,order,quantity,gross,fee\nTOKEN,sell,${saleAt},0,1,80,0\n`);
  const batch = (await s.csv.upload(f.owner, b, { filename: 'reward-sale.csv', bytes })).value;
  const settings = { format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: { columns: { instrument: 0, side: 1, occurredAt: 2, order: 3, quantity: 4, grossUsd: 5, feeUsd: 6 },
      instruments: [{ source: 'TOKEN', instrumentId: f.token }], sides: [{ source: 'sell', side: 'sell' }] }, assertUsd: true };
  const preview = await s.csv.preview(f.owner, b, batch.batchId, settings);
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.candidateSummary.realizedUsd, null);
  assert.equal(preview.candidateSummary.consumedCostUsd, null);
  assert.deepEqual(preview.candidateSummary.basisCoverage.realized, { knownSubtotalUsd: '0', unknownCount: 1 });
  const command = value => ({ requestId: randomUUID(), expectedJournalRevision: value.journalRevision,
    parserVersion: 'usd-csv-v1', ...settings, previewHash: value.previewHash });
  const stale = command(preview);
  await s.reward.correct(f.owner, a, reward.reward.rewardId, correction(reward.reward, 2, { acquisitionBasisUsd: '120' }));
  await unchanged(db, () => s.csv.confirm(f.owner, b, batch.batchId, stale), 409);
  const fresh = await s.csv.preview(f.owner, b, batch.batchId, settings);
  assert.notEqual(fresh.previewHash, preview.previewHash);
  assert.equal(fresh.journalRevision, 2);
  assert.equal(fresh.candidateSummary.consumedCostUsd, '60');
  assert.equal(fresh.candidateSummary.realizedUsd, '20');
  assert.equal(fresh.candidateSummary.basisCoverage, undefined);
  const accepted = command(fresh);
  const receipt = (await s.csv.confirm(f.owner, b, batch.batchId, accepted)).value;
  assert.equal((await journal(s, f.owner, a)).journalRevision, 4);
  assert.equal((await journal(s, f.owner, a)).versionCount, 0);
  assert.equal((await journal(s, f.owner, b)).journalRevision, 3);
  assert.equal((await journal(s, f.owner, b)).versionCount, 1);
  const rollbackCommand = { requestId: randomUUID(), expectedJournalRevision: 3 };
  const rollback = (await s.csv.rollback(f.owner, b, batch.batchId, rollbackCommand)).value;
  const receiver = await journal(s, f.owner, b);
  assert.equal(receiver.summary.remainingCostUsd, '60');
  assert.equal(receiver.summary.realizedUsd, '0');
  assert.equal(receiver.versionCount, 2); assert.equal(receiver.journalRevision, 4);
  assert.equal((await journal(s, f.owner, a)).journalRevision, 5);
  const before = await fingerprint(db);
  assert.deepEqual(await s.csv.confirm(f.owner, b, batch.batchId, accepted), { created: false, value: receipt });
  assert.deepEqual(await s.csv.rollback(f.owner, b, batch.batchId, rollbackCommand), { created: false, value: rollback });
  assert.deepEqual(await s.reward.create(f.owner, a, rewardCommand), { created: false, value: reward });
  assert.deepEqual((await db.query('SELECT "originalBytes" FROM account_csv_imports WHERE id=$1', [batch.batchId]))[0].originalBytes, bytes);
  assert.equal(await fingerprint(db), before);
  console.log('PASS REWARD-003/004 real CSV nullable preview/upstream invalidation/pins/rollback/original receipts and bytes');
}

async function onceLoadedReadModels(db, s, f) {
  stage = 'REWARD-004 inclusive series and connected selected valuation load rewards once';
  const a = await account(s, f.owner, 'Series rewards'), b = await account(s, f.owner, 'Selected reward recipient');
  const reward = (await s.reward.create(f.owner, a, input(f.token, 0))).value;
  await s.transfer.create(f.owner, { requestId: randomUUID(), fromAccountId: a, toAccountId: b,
    expectedFromJournalRevision: 1, expectedToJournalRevision: 0, assertInternal: true,
    instrumentId: f.token, occurredAt: transferAt, orderWithinTimestamp: 0,
    quantity: '1', feeInstrumentId: null, feeQuantity: '0' });
  // Price revisions belong to the instrument, across all instants. Economics
  // already wrote revision1 at rewardAt; these append revisions2 and3.
  for (const [index, at] of [transferAt, saleAt].entries()) await s.prices.set(f.owner, f.token,
    { requestId: randomUUID(), expectedRevision: index + 1, assertReviewed: true, observedAt: at, priceUsd: '5' });
  const statements = [];
  const createRunner = db.createQueryRunner.bind(db);
  db.createQueryRunner = (...args) => {
    const runner = createRunner(...args), query = runner.query.bind(runner);
    runner.query = async (sql, ...rest) => { statements.push(sql); return query(sql, ...rest); };
    return runner;
  };
  const once = () => {
    assert.equal(statements.filter(sql => /SELECT v\.\*,i\.name[\s\S]*FROM account_reward_versions/.test(sql)).length, 1,
      'One full reward materialization, not one per point or selected connected account');
    for (const table of ['account_reward_versions', 'account_swap_versions']) {
      const capacityReads = statements.filter(sql => /SELECT v\."accountId",count\(\*\) FILTER/.test(sql)
        && sql.includes(`FROM ${table} v`));
      assert.equal(capacityReads.length, 1, `One ${table} capacity preflight before materialization`);
    }
    assert.equal(statements.filter(sql => /SELECT v\.\*[\s\S]*FROM account_swap_versions/.test(sql)).length, 1,
      'One swap materialization, including an empty swap history, not one per point or selected account');
    assert.equal(statements.filter(sql => /SET TRANSACTION READ ONLY/.test(sql)).length, 1);
    assert.equal(statements.filter(sql => /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/.test(sql)).length, 1);
  };
  try {
    const before = await fingerprint(db);
    statements.length = 0;
    const series = await s.series.getSeries(f.owner, a, { from: coverage, to: saleAt });
    once();
    assert.equal(series.rewardSummary, undefined);
    assert.equal(series.transferSummary, undefined);
    assert.deepEqual(series.points.map(point => point.totalValueUsd), ['0', '10', '5', '5']);
    assert.equal(series.journalRevision, 2);
    statements.length = 0;
    const portfolio = await s.portfolio.preview(f.owner, { at: transferAt, accountIds: [a, b] }, {});
    once();
    assert.equal(portfolio.totalValueUsd, '10');
    assert.deepEqual(portfolio.accounts.map(account => account.totalValueUsd), ['5', '5']);
    assert.equal(await fingerprint(db), before);
    await s.reward.correct(f.owner, a, reward.reward.rewardId, correction(reward.reward, 2, { acquisitionBasisUsd: '100' }));
    const next = await s.series.getSeries(f.owner, a, { from: coverage, to: saleAt });
    assert.equal(next.journalRevision, 3);
    assert.deepEqual(next.points, series.points, 'Cost-only restatement does not invent a market value');
    const history = await s.history.getSnapshot(f.owner, a, { at: transferAt });
    assert.equal(history.items[0].costUsd, '50');
    assert.equal(history.rewardSummary.declaredIncomeUsd, '40');
    assert.equal((await s.history.getSnapshot(f.owner, b, { at: transferAt })).rewardSummary, undefined);
  } finally { db.createQueryRunner = createRunner; }
  console.log('PASS REWARD-004 once-only reward loads, exact inclusive series/selected valuation, distinct price and basis');
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value);
  assert.ok(existsSync('/app/backend/dist/accounting/asset-reward.service.js'), 'Missing new module is a prerequisite failure, not RED');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 50/);
  assert.match(migrate(database), /Migrations applied: 0/);
  await migrationPreservation();
  const db = source();
  try {
    await db.initialize();
    for (const table of [...rewardTables, 'account_swaps', 'account_swap_versions']) assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`))[0].n, 0);
    const [owner, other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('reward-owner@example.invalid','synthetic-no-login',true),('reward-other@example.invalid','synthetic-no-login',true) RETURNING id`);
    const s = services(db);
    const token = (await s.accounting.createInstrument(owner.id, { requestId: randomUUID(), name: 'Reward asset', symbol: 'SAME' })).value.id;
    const foreignToken = (await s.accounting.createInstrument(other.id, { requestId: randomUUID(), name: 'Other owner asset', symbol: 'SAME' })).value.id;
    const mutable = [...rewardTables, 'manual_accounts', 'account_trade_journals', 'account_trades', 'account_trade_versions',
      'owner_transfer_journals', 'owned_transfers', 'owned_transfer_versions', 'manual_usd_price_versions',
      'account_csv_imports', 'account_csv_import_commands', 'account_csv_import_rows'];
    const before = await fingerprint(db, mutable);
    const fixture = { owner: owner.id, other: other.id, token, foreignToken };
    await economics(db, s, fixture);
    await lifecycle(db, s, fixture);
    await constraintsAndCommit(db, s, fixture);
    await coherentSnapshot(db, s, fixture);
    await connectedCsv(db, s, fixture);
    await onceLoadedReadModels(db, s, fixture);
    assert.equal(await fingerprint(db, mutable), before, 'No external flows, auth, legacy or provider rows changed');
  } finally { if (db.isInitialized) await db.destroy(); }
}
const watchdog = setTimeout(() => { console.error(`FAIL timeout ${stage}`); process.exit(1); }, 120000);
watchdog.unref();
main().catch(error => { console.error(`FAIL ${stage}: ${error.stack}`); process.exitCode = 1; })
  .finally(() => clearTimeout(watchdog));
