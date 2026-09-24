'use strict';

// Production services and real isolated PostgreSQL. No repository or auth mocks.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const settings = {
  DB_HOST: 'postgres',
  DB_PORT: '5432',
  DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e',
  DB_NAME: 'capital_tracker_e2e',
};
const database = 'capital_tracker_asset_swaps_e2e';
const coverage = '2025-01-01T00:00:00.000Z';
const swapAt = '2025-01-03T00:00:00.000Z';
const transferAt = '2025-01-04T00:00:00.000Z';
const saleAt = '2025-01-05T00:00:00.000Z';
let stage = 'isolated prerequisites';

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: database }),
  ).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function services(db) {
  const make = (file, type) => new (require(`/app/backend/dist/accounting/${file}.js`)[type])(db);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    swap: make('asset-swap.service', 'AssetSwapService'),
    reward: make('asset-reward.service', 'AssetRewardService'),
    trade: make('trade.service', 'TradeService'),
    transfer: make('owned-transfer.service', 'OwnedTransferService'),
    history: make('historical-accounting.service', 'HistoricalAccountingService'),
  };
}
async function fingerprint(db) {
  const values = [];
  for (const { tablename } of await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  )) {
    assert.match(tablename, /^[a-z_]+$/);
    values.push([
      tablename,
      await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`),
    ]);
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
async function unchanged(db, action, status) {
  const before = await fingerprint(db);
  await assert.rejects(
    action,
    (error) => error.getStatus?.() === status,
    'Expected domain refusal, never incidental SQL/type failure',
  );
  assert.equal(await fingerprint(db), before, 'Every table including command keys stays unchanged');
}
async function account(s, owner, name) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  await s.trade.initialize(owner, id, {
    requestId: randomUUID(),
    coverageFrom: coverage,
    assertEmpty: true,
  });
  return id;
}
const journal = async (s, owner, id) => (await s.trade.getJournal(owner, id)).journal;
const tradeInput = (instrumentId, revision, changes = {}) => ({
  requestId: randomUUID(),
  expectedJournalRevision: revision,
  instrumentId,
  side: 'buy',
  occurredAt: coverage,
  orderWithinTimestamp: revision,
  quantity: '1',
  grossUsd: '100',
  feeUsd: '0',
  ...changes,
});
const input = (outgoingInstrumentId, incomingInstrumentId, revision, changes = {}) => ({
  requestId: randomUUID(),
  expectedJournalRevision: revision,
  assertExecuted: true,
  outgoingInstrumentId,
  incomingInstrumentId,
  occurredAt: swapAt,
  orderWithinTimestamp: 0,
  outgoingQuantity: '1',
  incomingQuantity: '3',
  considerationUsd: '150',
  feeSource: null,
  feeInstrumentId: null,
  feeQuantity: '0',
  ...changes,
});

async function connectedEconomics(db, s, f) {
  stage = 'SWAP-001/003/004 connected acquisition, correction and retained receipts';
  const a = await account(s, f.owner, 'Swap source');
  const b = await account(s, f.owner, 'Swap recipient');
  const buyCommand = tradeInput(f.token, 0);
  const bought = (await s.trade.create(f.owner, a, buyCommand)).value;
  const command = input(f.token, f.other, 1);
  const saved = (await s.swap.create(f.owner, a, command)).value;
  const id = saved.swap.swapId;
  const transferCommand = {
    requestId: randomUUID(),
    fromAccountId: a,
    toAccountId: b,
    expectedFromJournalRevision: 2,
    expectedToJournalRevision: 0,
    assertInternal: true,
    instrumentId: f.other,
    occurredAt: transferAt,
    orderWithinTimestamp: 0,
    quantity: '2',
    feeInstrumentId: null,
    feeQuantity: '0',
  };
  const moved = (await s.transfer.create(f.owner, transferCommand)).value;
  const saleCommand = tradeInput(f.other, 1, { side: 'sell', occurredAt: saleAt, grossUsd: '80' });
  const sold = (await s.trade.create(f.owner, b, saleCommand)).value;
  assert.equal((await journal(s, f.owner, b)).summary.realizedUsd, '30');
  const correction = {
    ...command,
    requestId: randomUUID(),
    expectedJournalRevision: 4,
    expectedVersion: 1,
    considerationUsd: '180',
  };
  const corrected = (await s.swap.correct(f.owner, a, id, correction)).value;
  assert.equal(corrected.swap.version, 2);
  const receiver = await journal(s, f.owner, b);
  assert.equal(receiver.journalRevision, 3);
  assert.equal(receiver.versionCount, 1);
  assert.equal(receiver.summary.realizedUsd, '20');
  assert.equal(receiver.summary.remainingCostUsd, '60');
  assert.equal(
    receiver.swapSummary,
    undefined,
    'Received provenance never duplicates source result',
  );
  assert.equal((await journal(s, f.owner, a)).swapSummary.realizedUsd, '80');
  const match = (await s.trade.listMatches(f.owner, b, sold.trade.tradeId, {})).items[0];
  assert.equal(match.origin.kind, 'swap');
  assert.equal(match.origin.swapId, id);
  assert.equal(match.origin.version, 2);
  assert.equal(match.costUsd, '60');
  for (const [action, value] of [
    [() => s.trade.create(f.owner, a, buyCommand), bought],
    [() => s.swap.create(f.owner, a, command), saved],
    [() => s.transfer.create(f.owner, transferCommand), moved],
    [() => s.trade.create(f.owner, b, saleCommand), sold],
  ])
    assert.deepEqual(await action(), { created: false, value });
  await unchanged(
    db,
    () =>
      s.swap.void(f.owner, a, id, {
        requestId: randomUUID(),
        expectedJournalRevision: 5,
        expectedVersion: 2,
      }),
    409,
  );
  await unchanged(
    db,
    () =>
      s.swap.correct(f.owner, a, id, {
        ...correction,
        requestId: randomUUID(),
        expectedJournalRevision: 5,
        expectedVersion: 2,
        incomingQuantity: '1',
      }),
    409,
  );
  await unchanged(db, () => s.trade.listLots(f.owner, b, { journalRevision: '2' }), 409);
  assert.equal((await s.swap.listVersions(f.owner, a, id, {})).items.length, 2);
  console.log(
    'PASS SWAP-001/003/004 connected correction, recipient FIFO, immutable predecessor and swap receipts, atomic invalid void',
  );
}

async function feeEvidence(db, s, f) {
  stage = 'SWAP-002 exact explicit fee provenance and unknown/zero evidence';
  const a = await account(s, f.owner, 'Incoming fee evidence');
  await s.trade.create(f.owner, a, tradeInput(f.token, 0));
  const oldOther = (await s.trade.create(f.owner, a, tradeInput(f.other, 1, { grossUsd: '1' })))
    .value;
  const command = input(f.token, f.other, 2, {
    feeSource: 'incoming',
    feeInstrumentId: f.other,
    feeQuantity: '0.1',
  });
  const receipt = (await s.swap.create(f.owner, a, command)).value;
  const id = receipt.swap.swapId;
  let allocation = await s.swap.getAllocation(f.owner, a, id, {});
  assert.equal(allocation.feeConsumedBasisUsd, '5');
  assert.equal(allocation.realizedUsd, '45');
  assert.equal(allocation.items[1].origin.swapId, id);
  const lots = (await s.trade.listLots(f.owner, a, {})).items;
  assert.equal(lots.find((l) => l.buyTradeId === oldOther.trade.tradeId).remainingQuantity, '1');
  assert.equal(lots.find((l) => l.sourceKind === 'swap').remainingCostUsd, '145');
  await s.swap.correct(f.owner, a, id, {
    ...command,
    requestId: randomUUID(),
    expectedJournalRevision: 3,
    expectedVersion: 1,
    feeSource: 'held',
  });
  allocation = await s.swap.getAllocation(f.owner, a, id, {});
  assert.equal(allocation.feeConsumedBasisUsd, '0.1');
  assert.equal(allocation.realizedUsd, '49.9');
  assert.equal(allocation.items[1].origin.tradeId, oldOther.trade.tradeId);
  await s.swap.correct(f.owner, a, id, {
    ...command,
    requestId: randomUUID(),
    expectedJournalRevision: 4,
    expectedVersion: 2,
    considerationUsd: null,
  });
  allocation = await s.swap.getAllocation(f.owner, a, id, {});
  assert.equal(allocation.principalBasisUsd, '100');
  assert.equal(allocation.feeConsumedBasisUsd, null);
  assert.equal(allocation.realizedUsd, null);
  assert.deepEqual(allocation.coverage.realized, { knownSubtotalUsd: '0', unknownCount: 1 });
  await s.swap.correct(f.owner, a, id, {
    ...command,
    requestId: randomUUID(),
    expectedJournalRevision: 5,
    expectedVersion: 3,
    considerationUsd: '0',
  });
  allocation = await s.swap.getAllocation(f.owner, a, id, {});
  assert.equal(allocation.feeConsumedBasisUsd, '0');
  assert.equal(allocation.realizedUsd, '-100');
  await unchanged(db, () => s.swap.getAllocation(f.owner, a, id, { offset: '1' }), 400);
  await unchanged(
    db,
    () => s.swap.getAllocation(f.owner, a, id, { journalRevision: '3', expectedVersion: '1' }),
    409,
  );
  const page = await s.swap.getAllocation(f.owner, a, id, { limit: '1' });
  assert.equal(page.items.length, 1);
  assert.equal(page.nextOffset, 1);
  const next = await s.swap.getAllocation(f.owner, a, id, {
    limit: '1',
    offset: '1',
    journalRevision: '6',
    expectedVersion: '4',
  });
  assert.equal(next.items[0].kind, 'fee');
  assert.equal(next.nextOffset, null);
  assert.equal(next.realizedUsd, page.realizedUsd, 'Full totals survive pagination');
  const voidCommand = { requestId: randomUUID(), expectedJournalRevision: 6, expectedVersion: 4 };
  const voided = (await s.swap.void(f.owner, a, id, voidCommand)).value;
  assert.equal(voided.swap.kind, 'void');
  assert.equal((await journal(s, f.owner, a)).swapSummary.activeCount, 0);
  assert.deepEqual(await s.swap.create(f.owner, a, command), { created: false, value: receipt });
  assert.deepEqual(await s.swap.void(f.owner, a, id, voidCommand), {
    created: false,
    value: voided,
  });
  await unchanged(
    db,
    () =>
      s.swap.correct(f.owner, a, id, {
        ...command,
        requestId: randomUUID(),
        expectedJournalRevision: 7,
        expectedVersion: 5,
      }),
    409,
  );
  console.log(
    'PASS SWAP-002/003/004 explicit held/incoming fees, null versus zero, pinned complete allocations, terminal void',
  );
}

async function deferredCommit(db, s, f) {
  stage = 'SWAP-003/006 deferred COMMIT failure and private validation';
  const a = await account(s, f.owner, 'Deferred swap');
  await s.trade.create(f.owner, a, tradeInput(f.token, 0));
  const command = input(f.token, f.other, 1);
  await unchanged(
    db,
    () => s.swap.create(f.owner, a, { ...command, outgoingInstrumentId: f.foreignToken }),
    404,
  );
  await unchanged(db, () => s.swap.create(f.owner, a, { ...command, ownerId: f.owner }), 400);
  await unchanged(db, () => s.swap.list(f.foreign, a, {}), 404);
  const marker = `acceptance_swap_${randomUUID().replaceAll('-', '')}`;
  await db.query(`CREATE SEQUENCE ${marker} START 1`);
  await db.query(`CREATE FUNCTION ${marker}() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM account_swaps WHERE id=NEW."swapId" AND "currentVersion"=NEW.version)
        OR NOT EXISTS(SELECT 1 FROM account_trade_journals WHERE "accountId"=NEW."accountId" AND "currentRevision"=NEW."journalRevision")
      THEN RAISE EXCEPTION 'Synthetic writes incomplete'; END IF;
      PERFORM nextval('${marker}');
      RAISE EXCEPTION 'Synthetic deferred swap failure' USING ERRCODE='23514';
    END $body$`);
  await db.query(`CREATE CONSTRAINT TRIGGER ${marker} AFTER INSERT ON account_swap_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${marker}()`);
  try {
    const before = await fingerprint(db);
    await assert.rejects(() => s.swap.create(f.owner, a, command));
    assert.deepEqual(
      await db.query(`SELECT last_value::text AS value,is_called AS called FROM ${marker}`),
      [{ value: '1', called: true }],
      'Nontransactional witness proves COMMIT reached after all writes',
    );
    assert.equal(await fingerprint(db), before);
  } finally {
    await db.query(`DROP TRIGGER ${marker} ON account_swap_versions`);
    await db.query(`DROP FUNCTION ${marker}()`);
    await db.query(`DROP SEQUENCE ${marker}`);
  }
  const saved = await s.swap.create(f.owner, a, command);
  assert.equal(saved.created, true);
  assert.equal(saved.value.journalRevision, 2);
  console.log(
    'PASS SWAP-003/006 actual deferred COMMIT rollback witness, reusable uncommitted key and owner/input boundaries',
  );
}

async function main() {
  assert.equal(
    process.env.DB_HOST,
    settings.DB_HOST,
    'Only the isolated Compose PostgreSQL is allowed',
  );
  const admin = new Client({
    host: settings.DB_HOST,
    port: 5432,
    user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD,
    database: settings.DB_NAME,
  });
  await admin.connect();
  try {
    assert.equal(
      (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount,
      0,
      'Never reuse/drop an existing database',
    );
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: database },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.match(migrated.stdout, /Migrations applied: 22/);
  const db = source();
  await db.initialize();
  try {
    const s = services(db);
    const [{ id: owner }] = await db.query(
      `INSERT INTO users(email,password,"emailVerified") VALUES('swap-owner@example.invalid','synthetic-no-login',true) RETURNING id`,
    );
    const [{ id: foreign }] = await db.query(
      `INSERT INTO users(email,password,"emailVerified") VALUES('swap-foreign@example.invalid','synthetic-no-login',true) RETURNING id`,
    );
    const instrument = async (who, name) =>
      (await s.accounting.createInstrument(who, { requestId: randomUUID(), name, symbol: 'SAME' }))
        .value.id;
    const f = {
      owner,
      foreign,
      token: await instrument(owner, 'Outgoing'),
      other: await instrument(owner, 'Incoming'),
      foreignToken: await instrument(foreign, 'Foreign'),
    };
    await connectedEconomics(db, s, f);
    await feeEvidence(db, s, f);
    await deferredCommit(db, s, f);
  } finally {
    await db.destroy();
  }
}
main().catch((error) => {
  console.error(`FAIL ${stage}`, error);
  process.exitCode = 1;
});
