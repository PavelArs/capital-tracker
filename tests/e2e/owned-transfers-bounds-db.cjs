'use strict';

// Real compiled services, a fresh guarded PostgreSQL database, and schema-valid bulk fixture rows.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
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
const database = 'capital_tracker_owned_transfer_bounds_e2e';
const coverage = '2025-01-01T00:00:00.000Z';
const buyAt = '2025-01-02T00:00:00.000Z';
const moveAt = '2025-01-03T00:00:00.000Z';
const at = '2025-01-04T00:00:00.000Z';
let stage = 'isolated configuration';

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: database }),
  ).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  assert.equal(options.database, database);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function services(db) {
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trade: make('trade.service', 'TradeService'),
    transfer: make('owned-transfer.service', 'OwnedTransferService'),
    carry: make('carry-in.service', 'CarryInService'),
    history: make('historical-accounting.service', 'HistoricalAccountingService'),
    valuation: make('historical-valuation.service', 'HistoricalValuationService'),
    series: make('valuation-history.service', 'ValuationHistoryService'),
    portfolio: make('manual-portfolio-valuation.service', 'ManualPortfolioValuationService'),
  };
}
async function createDatabase() {
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
      'Never reuse or drop an existing database',
    );
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
}
function migrate() {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend',
    env: { ...process.env, ...settings, DB_NAME: database },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.status, 0, 'Actual guarded production migration CLI');
  assert.match(result.stdout, /Migrations applied: 45/);
}
async function account(s, owner, name, initialize = true) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  if (initialize)
    await s.trade.initialize(owner, id, {
      requestId: randomUUID(),
      coverageFrom: coverage,
      assertEmpty: true,
    });
  return id;
}
async function status(action, expected) {
  await assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === expected,
    `Expected domain HTTP ${expected}, not a SQL or runtime failure`,
  );
}
async function fingerprint(db) {
  const tables = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const rows = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    rows.push([
      tablename,
      await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`),
    ]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

// These rows obey the same immutable identity/version, canonical payload, numeric,
// chronology and owner constraints as the compiled write path. Commands under test
// (transfers, sale, correction) still run through production services.
async function instruments(db, owner, count, prefix) {
  const ids = Array.from({ length: count }, () => randomUUID());
  const requests = ids.map(() => randomUUID());
  const names = ids.map((_, index) => `${prefix} ${index}`);
  const payloads = names.map((name) => JSON.stringify({ name, symbol: null }));
  await db.query(
    `INSERT INTO accounting_instruments
    (id,"ownerId","requestId","canonicalPayload",name,symbol)
    SELECT x.id,$1,x.request,x.payload,x.name,NULL
    FROM unnest($2::uuid[],$3::uuid[],$4::text[],$5::text[]) AS x(id,request,name,payload)`,
    [owner, ids, requests, names, payloads],
  );
  return ids;
}
async function buyFixture(db, owner, accountId, instrumentIds) {
  const ids = instrumentIds.map(() => randomUUID());
  const requests = ids.map(() => randomUUID());
  const payloads = instrumentIds.map((instrumentId, index) =>
    JSON.stringify({
      kind: 'create',
      expectedJournalRevision: index,
      instrumentId,
      side: 'buy',
      occurredAt: buyAt,
      orderWithinTimestamp: index,
      quantity: '1',
      grossUsd: '1',
      feeUsd: '0',
    }),
  );
  await db.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO account_trades(id,"ownerId","accountId","currentVersion")
      SELECT x.id,$1,$2,1 FROM unnest($3::uuid[]) AS x(id)`,
      [owner, accountId, ids],
    );
    await manager.query(
      `INSERT INTO account_trade_versions
      ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",
       kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd")
      SELECT $1,$2,x.id,1,x.ordinal,x.request,x.payload,'create',x.instrument,'buy',
        $7::timestamptz,x.ordinal-1,1,1,0
      FROM unnest($3::uuid[],$4::uuid[],$5::text[],$6::uuid[])
        WITH ORDINALITY AS x(id,request,payload,instrument,ordinal)`,
      [owner, accountId, ids, requests, payloads, instrumentIds, buyAt],
    );
    await manager.query(
      `UPDATE account_trade_journals SET "currentRevision"=$3
      WHERE "ownerId"=$1 AND "accountId"=$2`,
      [owner, accountId, ids.length],
    );
  });
  return ids;
}
async function priceFixture(db, owner, instrumentIds) {
  const requests = instrumentIds.map(() => randomUUID());
  const payloads = instrumentIds.map(() =>
    JSON.stringify({
      kind: 'set',
      expectedRevision: 0,
      observedAt: at,
      priceUsd: '2',
    }),
  );
  await db.query(
    `INSERT INTO manual_usd_price_versions
    ("ownerId","instrumentId",revision,"requestId","canonicalPayload",kind,"observedAt","priceUsd")
    SELECT $1,x.instrument,1,x.request,x.payload,'set',$5::timestamptz,2
    FROM unnest($2::uuid[],$3::uuid[],$4::text[]) AS x(instrument,request,payload)`,
    [owner, instrumentIds, requests, payloads, at],
  );
}
const transfer = (from, to, instrumentId, fromRevision, toRevision, order, quantity) => ({
  requestId: randomUUID(),
  fromAccountId: from,
  toAccountId: to,
  expectedFromJournalRevision: fromRevision,
  expectedToJournalRevision: toRevision,
  assertInternal: true,
  instrumentId,
  occurredAt: moveAt,
  orderWithinTimestamp: order,
  quantity: String(quantity),
  feeInstrumentId: null,
  feeQuantity: '0',
});

async function oneComponentRead(db, action) {
  const statements = [];
  const original = db.createQueryRunner;
  db.createQueryRunner = function (...args) {
    const runner = original.apply(this, args);
    const query = runner.query.bind(runner);
    runner.query = (sql, ...rest) => { statements.push(sql); return query(sql, ...rest); };
    return runner;
  };
  try {
    const result = await action();
    assert.equal(statements.filter(sql => sql === 'SET TRANSACTION READ ONLY').length, 1);
    const tradeReads = statements.filter(sql => /SELECT/.test(sql) && sql.includes('account_trade_versions'));
    assert.equal(tradeReads.filter(sql => /count\(\*\)/i.test(sql)).length, 1, 'One component capacity preflight');
    assert.equal(tradeReads.filter(sql => !/count\(\*\)/i.test(sql)).length, 1, 'One trade materialization across all selected accounts or sample instants');
    assert.equal(statements.filter(sql => /SELECT/.test(sql) && sql.includes('manual_usd_price_versions')).length, 1, 'One batched exact price read');
    return result;
  } finally { db.createQueryRunner = original; }
}

async function distinctPositions(db, s, owner) {
  stage = 'TRANSFER-004-C 1101 complete priced historical positions';
  const receiver = await account(s, owner, 'Many distinct positions receiver');
  const sender = await account(s, owner, 'Many distinct positions source');
  const ids = await instruments(db, owner, 1101, 'Bounded position');
  await buyFixture(db, owner, receiver, ids.slice(0, 1000));
  await buyFixture(db, owner, sender, ids.slice(1000));
  for (let index = 0; index < 101; index++) {
    const saved = await s.transfer.create(
      owner,
      transfer(sender, receiver, ids[1000 + index], 101 + index, 1000 + index, index, 1),
    );
    assert.equal(saved.created, true);
  }
  const journal = (await s.trade.getJournal(owner, receiver)).journal;
  assert.equal(journal.journalRevision, 1101);
  assert.equal(journal.summary.remainingCostUsd, '1101');
  assert.equal(journal.transferSummary.receivedBasisUsd, '101');
  const first = await s.history.getSnapshot(owner, receiver, { at, limit: '100' });
  assert.equal(first.items.length, 100);
  assert.equal(first.nextOffset, 100);
  const last = await s.history.getSnapshot(owner, receiver, {
    at,
    journalRevision: '1101',
    offset: '1100',
    limit: '100',
  });
  assert.equal(last.items.length, 1, 'No 1100-position truncation');
  assert.deepEqual(
    [last.items[0].quantity, last.items[0].costUsd, last.nextOffset],
    ['1', '1', null],
  );
  assert.equal(new Set([...first.items, ...last.items].map((item) => item.instrumentId)).size, 101);
  await priceFixture(db, owner, ids);
  const value = await s.valuation.getSnapshot(owner, receiver, { at });
  assert.equal(value.items.length, 1101, 'All distinct original instrument UUIDs priced');
  assert.equal(value.missingPriceCount, 0);
  assert.equal(value.completeness, 'complete');
  assert.equal(value.pricedSubtotalUsd, '2202');
  assert.equal(value.totalValueUsd, '2202');
  assert.ok(
    value.items.every(
      (item) =>
        item.quantity === '1' &&
        item.costUsd === '1' &&
        item.price?.priceUsd === '2' &&
        item.valueUsd === '2',
    ),
  );
  const beforeReads = await fingerprint(db);
  const selected = await oneComponentRead(db, () => s.portfolio.preview(owner, { at, accountIds: [sender, receiver] }, {}));
  assert.equal(selected.totalValueUsd, '2202', 'Principal is never double counted across selected accounts');
  assert.equal(selected.accounts.find(row => row.accountId === sender).totalValueUsd, '0');
  assert.equal(selected.accounts.find(row => row.accountId === receiver).items.length, 1101);
  assert.ok(selected.accounts.every(row => !Object.hasOwn(row, 'transferSummary')), 'Selected account metadata retains explicit field selection');
  const series = await oneComponentRead(db, () => s.series.getSeries(owner, receiver, { from: buyAt, to: at }));
  assert.deepEqual(series.revisionBudget, { used: 1101, limit: 10000 });
  assert.equal(Object.hasOwn(series, 'transferSummary'), false, 'No from-point summary presented as whole-series totals');
  assert.deepEqual(series.points.map(point => [point.at, point.totalValueUsd, point.missingPriceCount]),
    [[buyAt, null, 1000], [moveAt, null, 1101], [at, '2202', 0]]);
  assert.equal(await fingerprint(db), beforeReads, 'Portfolio/series reads preserve every row');
  console.log('PASS TRANSFER-004-C 1101 priced positions, offset1100, coherent series/portfolio and once-only loads');
}

async function carryInTwo(s, owner, receiver, instrumentId) {
  await s.accounting.saveOpening(owner, receiver, {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: coverage,
    positions: [{ instrumentId, quantity: '2', costStatus: 'known', totalCostUsd: '2' }],
  });
  const lots = [0, 1].map((orderWithinTimestamp) => ({
    instrumentId,
    acquiredAt: '2024-12-31T00:00:00.000Z',
    orderWithinTimestamp,
    originalQuantity: '1',
    originalCostUsd: '1',
    remainingQuantity: '1',
  }));
  const saved = await s.carry.initialize(owner, receiver, {
    requestId: randomUUID(),
    expectedOpeningRevision: 1,
    lots,
    assertReviewed: true,
  });
  assert.equal(saved.created, true);
}

async function wideMatches(db, s, owner) {
  stage = 'TRANSFER-004-D 10001 sale matches and pinned allocation';
  const [instrumentId] = await instruments(db, owner, 1, 'Wide match asset');
  const receiver = await account(s, owner, 'Wide match receiver', false);
  await carryInTwo(s, owner, receiver, instrumentId);
  const counts = [999, ...Array(9).fill(1000)];
  const sources = [];
  for (const [index, count] of counts.entries()) {
    const accountId = await account(s, owner, `Wide match source ${index}`);
    const trades = await buyFixture(db, owner, accountId, Array(count).fill(instrumentId));
    sources.push({ accountId, count, trades });
  }
  let firstTransfer;
  for (const [index, source] of sources.entries()) {
    const saved = await s.transfer.create(
      owner,
      transfer(source.accountId, receiver, instrumentId, source.count, index, index, source.count),
    );
    assert.equal(saved.created, true);
    if (index === 0) firstTransfer = saved.value.transfer.transferId;
  }
  assert.ok(firstTransfer);
  const receiverBefore = (await s.trade.getJournal(owner, receiver)).journal;
  assert.equal(receiverBefore.journalRevision, 10);
  assert.equal(receiverBefore.summary.remainingCostUsd, '10001');
  assert.equal(receiverBefore.transferSummary.receivedBasisUsd, '9999');
  const lastLot = await s.trade.listLots(owner, receiver, {
    journalRevision: '10',
    offset: '10000',
    limit: '100',
  });
  assert.equal(lastLot.items.length, 1, 'All 10001 held fragments remain pageable');
  assert.equal(lastLot.nextOffset, null);
  assert.deepEqual((await s.trade.listLots(owner, receiver, { journalRevision: '10', offset: '99999' })).items, []);
  assert.equal(lastLot.items[0].sourceKind, 'transfer');
  assert.deepEqual(
    [lastLot.items[0].remainingQuantity, lastLot.items[0].remainingCostUsd],
    ['1', '1'],
  );
  const initialAllocation = await s.transfer.allocation(owner, firstTransfer, { limit: '50' });
  assert.equal(initialAllocation.principalBasisUsd, '999');
  assert.equal(initialAllocation.feeConsumedBasisUsd, '0');
  assert.equal(initialAllocation.items.length, 50);
  assert.equal(initialAllocation.nextOffset, 50);
  assert.equal(initialAllocation.items[0].origin.tradeId, sources[0].trades[0]);
  assert.deepEqual(
    [initialAllocation.items[0].intervalStart, initialAllocation.items[0].intervalEnd],
    ['0', '1'],
  );
  const allocationNext = await s.transfer.allocation(owner, firstTransfer, {
    fromJournalRevision: String(initialAllocation.fromJournalRevision),
    toJournalRevision: String(initialAllocation.toJournalRevision),
    offset: '50',
    limit: '50',
  });
  assert.equal(allocationNext.items.length, 50);
  assert.equal(allocationNext.items[0].origin.tradeId, sources[0].trades[50]);
  assert.deepEqual(
    [allocationNext.principalBasisUsd, allocationNext.feeConsumedBasisUsd],
    ['999', '0'],
    'Every page repeats whole allocation totals',
  );
  const sale = await s.trade.create(owner, receiver, {
    requestId: randomUUID(),
    expectedJournalRevision: 10,
    instrumentId,
    side: 'sell',
    occurredAt: at,
    orderWithinTimestamp: 0,
    quantity: '10001',
    grossUsd: '20002',
    feeUsd: '0',
  });
  const afterSale = (await s.trade.getJournal(owner, receiver)).journal;
  assert.deepEqual(
    [
      afterSale.summary.consumedCostUsd,
      afterSale.summary.realizedUsd,
      afterSale.summary.remainingCostUsd,
    ],
    ['10001', '10001', '0'],
  );
  assert.equal(afterSale.journalRevision, 11);
  const lastMatch = await s.trade.listMatches(owner, receiver, sale.value.trade.tradeId, {
    journalRevision: '11',
    offset: '10000',
    limit: '100',
  });
  assert.equal(lastMatch.items.length, 1, 'All 10001 sale matches remain pageable');
  assert.equal(lastMatch.nextOffset, null);
  assert.deepEqual((await s.trade.listMatches(owner, receiver, sale.value.trade.tradeId, { journalRevision: '11', offset: '99999' })).items, []);
  const lastSource = [...sources.slice(1)]
    .sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0))
    .at(-1);
  assert.equal(lastMatch.items[0].origin.tradeId, lastSource.trades[999]);
  assert.deepEqual([lastMatch.items[0].quantity, lastMatch.items[0].costUsd], ['1', '1']);
  await status(
    () => s.trade.listTrades(owner, receiver, { offset: '10000', journalRevision: '11' }),
    400,
  );
  const pinned = await s.transfer.allocation(owner, firstTransfer, { limit: '50' });
  assert.equal(pinned.principalBasisUsd, '999');
  const sourceRevision = (await s.trade.getJournal(owner, sources[0].accountId)).journal
    .journalRevision;
  const correction = await s.trade.correct(owner, sources[0].accountId, sources[0].trades[0], {
    requestId: randomUUID(),
    expectedJournalRevision: sourceRevision,
    instrumentId,
    side: 'buy',
    occurredAt: buyAt,
    orderWithinTimestamp: 0,
    quantity: '1',
    grossUsd: '2',
    feeUsd: '0',
  });
  assert.equal(correction.created, true);
  const afterCorrection = (await s.trade.getJournal(owner, receiver)).journal;
  assert.deepEqual(
    [
      afterCorrection.summary.consumedCostUsd,
      afterCorrection.summary.realizedUsd,
      afterCorrection.summary.remainingCostUsd,
    ],
    ['10002', '10000', '0'],
  );
  const beforeRejection = await fingerprint(db);
  await status(
    () =>
      s.transfer.allocation(owner, firstTransfer, {
        fromJournalRevision: String(pinned.fromJournalRevision),
        toJournalRevision: String(pinned.toJournalRevision),
        offset: '50',
        limit: '50',
      }),
    409,
  );
  await status(
    () =>
      s.trade.listMatches(owner, receiver, sale.value.trade.tradeId, {
        journalRevision: '11',
        offset: '10000',
        limit: '100',
      }),
    409,
  );
  assert.equal(
    await fingerprint(db),
    beforeRejection,
    'Stale reads cannot reserve or mutate any row',
  );
  const refreshed = await s.transfer.allocation(owner, firstTransfer, { limit: '50' });
  assert.equal(refreshed.principalBasisUsd, '1000');
  assert.equal(refreshed.items[0].costUsd, '2');
  assert.equal(refreshed.feeConsumedBasisUsd, '0');
  console.log('PASS TRANSFER-004-D 10001 matches/lot paging/allocation pin and restatement');
}

async function main() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact isolated synthetic settings required');
  assert.ok(
    existsSync('/app/backend/dist/accounting/owned-transfer.service.js'),
    'Missing compiled service is prerequisite failure, not behavioral RED',
  );
  await createDatabase();
  migrate();
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 45);
    const [{ id: owner }] = await db.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES('transfer-bounds@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    await distinctPositions(db, s, owner);
    await wideMatches(db, s, owner);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM portfolio_flow_versions'))[0].n,
      0,
      'Internal moves do not create external cash flows',
    );
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}
const watchdog = setTimeout(() => {
  console.error(`FAIL timeout at ${stage}`);
  process.exit(1);
}, 300000);
watchdog.unref();
main()
  .catch((error) => {
    console.error(`FAIL ${stage}: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
