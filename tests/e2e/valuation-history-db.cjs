'use strict';
// Guarded fresh synthetic PostgreSQL; compiled production services, no repositories mocked.
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
const database = 'capital_tracker_chart_e2e';
const at = '2025-01-04T00:00:00.000Z';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const modulePath = '/app/backend/dist/accounting/valuation-history.service.js';
let stage = 'synthetic configuration';
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
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trades: make('trade.service', 'TradeService'),
    carry: make('carry-in.service', 'CarryInService'),
    prices: make('manual-price.service', 'ManualPriceService'),
    history: make('valuation-history.service', 'ValuationHistoryService'),
  };
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
const rejected = (action, status) =>
  assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status,
  );
async function account(s, owner, name, initialize = true) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  if (initialize)
    await s.trades.initialize(owner, id, {
      requestId: randomUUID(),
      coverageFrom,
      assertEmpty: true,
    });
  return id;
}
const execution = (instrumentId, revision, changes = {}) => ({
  requestId: randomUUID(),
  expectedJournalRevision: revision,
  instrumentId,
  side: 'buy',
  occurredAt: at,
  orderWithinTimestamp: revision,
  quantity: '1',
  grossUsd: '100',
  feeUsd: '0',
  ...changes,
});
const quote = (revision, priceUsd = '300', observedAt = at) => ({
  requestId: randomUUID(),
  expectedRevision: revision,
  observedAt,
  priceUsd,
  assertReviewed: true,
});
const series = (s, owner, id, from = coverageFrom, to = at) =>
  s.history.getSeries(owner, id, { from, to });
const newInstrument = async (s, owner, name) =>
  (await s.accounting.createInstrument(owner, { requestId: randomUUID(), name, symbol: 'SAME' }))
    .value.id;
function point(at, totalValueUsd, missingPriceCount = 0, pricedSubtotalUsd = totalValueUsd ?? '0') {
  return {
    at,
    completeness: missingPriceCount ? 'incomplete' : 'complete',
    missingPriceCount,
    pricedSubtotalUsd,
    totalValueUsd,
  };
}
async function timeline(db, s, owner, other) {
  stage = 'VCH-TIMELINE/RANGE/PRIVATE coherent exact samples, gaps, zero, correction, void';
  const instrument = await newInstrument(s, owner, 'Chart timeline');
  const id = await account(s, owner, 'Timeline');
  await s.trades.create(
    owner,
    id,
    execution(instrument, 0, { occurredAt: '2025-01-02T00:00:00.000Z' }),
  );
  await s.trades.create(
    owner,
    id,
    execution(instrument, 1, { occurredAt: '2025-01-03T00:00:00.000Z', grossUsd: '200' }),
  );
  await s.trades.create(
    owner,
    id,
    execution(instrument, 2, { side: 'sell', quantity: '1.5', grossUsd: '450' }),
  );
  const first = await s.prices.set(owner, instrument, quote(0, '100', '2025-01-02T00:00:00.000Z'));
  await s.prices.set(owner, instrument, quote(1, '300'));
  const noHistory = await account(s, owner, 'Unknown history', false);
  const before = await fingerprint(db);
  const result = await series(s, owner, id);
  assert.deepEqual(result, {
    accountId: id,
    from: coverageFrom,
    to: at,
    coverageFrom,
    journalRevision: 3,
    originKind: 'declared-empty',
    openingRevision: null,
    basis: 'current-effective-history',
    priceSource: 'manual',
    quoteCurrency: 'USD',
    pricePolicy: 'exact-instant',
    sampling: '24h-from-start-and-end',
    points: [
      point(coverageFrom, '0'),
      point('2025-01-02T00:00:00.000Z', '100'),
      point('2025-01-03T00:00:00.000Z', null, 1),
      point(at, '150'),
    ],
  });
  assert.deepEqual(await series(s, owner, id), result);
  const uneven = await series(s, owner, id, coverageFrom, '2025-01-02T12:00:00.000Z');
  assert.deepEqual(uneven.points, [
    point(coverageFrom, '0'),
    point('2025-01-02T00:00:00.000Z', '100'),
    point('2025-01-02T12:00:00.000Z', null, 1),
  ]);
  assert.deepEqual((await series(s, owner, id, at, at)).points, [point(at, '150')]);
  await rejected(() => series(s, other, id), 404);
  await rejected(() => series(s, owner, randomUUID()), 404);
  await rejected(() => series(s, owner, noHistory), 409);
  await rejected(() => series(s, owner, id, '2024-12-31T23:59:59.999Z', at), 409);
  await rejected(() => series(s, owner, id, at, coverageFrom), 400);
  await rejected(() => series(s, owner, id, coverageFrom, '2025-01-31T00:00:00.001Z'), 400);
  assert.equal(
    await fingerprint(db),
    before,
    'All successful/refused series reads preserve every row',
  );
  await s.prices.set(owner, instrument, quote(2, '0', '2025-01-03T00:00:00.000Z'));
  await s.prices.set(owner, instrument, quote(3, '320'));
  assert.deepEqual((await series(s, owner, id)).points, [
    point(coverageFrom, '0'),
    point('2025-01-02T00:00:00.000Z', '100'),
    point('2025-01-03T00:00:00.000Z', '0'),
    point(at, '160'),
  ]);
  await s.prices.void(owner, instrument, {
    requestId: randomUUID(),
    expectedRevision: 4,
    observedAt: at,
    assertReviewed: true,
  });
  assert.deepEqual(
    (await series(s, owner, id)).points[3],
    point(at, null, 1),
    'Voided latest point cannot fall back to prior revision',
  );
  assert.deepEqual(
    (await s.prices.history(owner, instrument, { observedAt: '2025-01-02T00:00:00.000Z' })).items,
    [first.value],
  );
  console.log('PASS VCH-TIMELINE/RANGE/PRIVATE');
}
async function coherent(db, s, owner) {
  stage = 'VCH-SNAPSHOT actual separate-connection RR across price/trade correction';
  const instrument = await newInstrument(s, owner, 'Coherent chart');
  const id = await account(s, owner, 'Coherent chart');
  const start = '2025-01-02T00:00:00.000Z';
  const end = '2025-01-03T00:00:00.000Z';
  const buy = await s.trades.create(owner, id, execution(instrument, 0, { occurredAt: start }));
  await s.prices.set(owner, instrument, quote(0, '100', start));
  await s.prices.set(owner, instrument, quote(1, '200', end));
  const old = await series(s, owner, id, start, end);
  assert.deepEqual(old.points, [point(start, '100'), point(end, '200')]);
  const reader = source();
  await reader.initialize();
  let release, arrived, pending;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const barrier = new Promise((resolve) => {
    arrived = resolve;
  });
  const statements = [];
  const original = reader.createQueryRunner.bind(reader);
  let paused = false;
  reader.createQueryRunner = (...args) => {
    const runner = original(...args);
    const query = runner.query.bind(runner);
    runner.query = async (sql, ...rest) => {
      statements.push(sql);
      if (!paused && /SELECT.*account_trade_versions/s.test(sql)) {
        paused = true;
        assert.ok(runner.isTransactionActive);
        const [{ pid }] = await query('SELECT pg_backend_pid() AS pid');
        arrived(pid);
        await gate;
      }
      return query(sql, ...rest);
    };
    return runner;
  };
  const timeout = setTimeout(() => release(), 10000);
  try {
    pending = series(services(reader), owner, id, start, end);
    const pid = await Promise.race([
      barrier,
      pending.then(() => {
        throw new Error('Missing series read barrier');
      }),
    ]);
    assert.notEqual(pid, (await db.query('SELECT pg_backend_pid() AS pid'))[0].pid);
    assert.ok(statements.some((q) => /REPEATABLE READ/.test(q)));
    assert.ok(statements.some((q) => /READ ONLY/.test(q)));
    await s.prices.set(owner, instrument, quote(2, '110', start));
    await s.trades.correct(
      owner,
      id,
      buy.value.trade.tradeId,
      execution(instrument, 1, { occurredAt: start, quantity: '2' }),
    );
    const saved = await fingerprint(db);
    release();
    assert.deepEqual(await pending, old, 'All points belong to anchored old snapshot');
    const current = await series(s, owner, id, start, end);
    assert.equal(current.journalRevision, 2);
    assert.deepEqual(current.points, [point(start, '220'), point(end, '400')]);
    assert.equal(await fingerprint(db), saved);
  } finally {
    clearTimeout(timeout);
    release();
    await pending?.catch(() => {});
    await reader.destroy();
  }
  console.log('PASS VCH-SNAPSHOT');
}
async function maximum(db, s, owner) {
  stage = 'VCH-SNAPSHOT31 samples across100 baseline lots plus1000 maximum trades';
  const instrument = await newInstrument(s, owner, 'Maximum chart');
  const id = await account(s, owner, 'Maximum chart', false);
  await s.accounting.saveOpening(owner, id, {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: coverageFrom,
    positions: [
      { instrumentId: instrument, quantity: '100', costStatus: 'known', totalCostUsd: '100' },
    ],
  });
  await s.carry.initialize(owner, id, {
    requestId: randomUUID(),
    expectedOpeningRevision: 1,
    assertReviewed: true,
    lots: Array.from({ length: 100 }, (_, i) => ({
      instrumentId: instrument,
      acquiredAt: coverageFrom,
      orderWithinTimestamp: i,
      originalQuantity: '1',
      originalCostUsd: '1',
      remainingQuantity: '1',
    })),
  });
  const max = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
  const seeded = Array.from({ length: 999 }, (_, i) => ({
    id: randomUUID(),
    requestId: randomUUID(),
    revision: i + 1,
    order: i,
    payload: JSON.stringify({
      kind: 'create',
      expectedJournalRevision: i,
      instrumentId: instrument,
      side: 'buy',
      occurredAt: coverageFrom,
      orderWithinTimestamp: i,
      quantity: max,
      grossUsd: max,
      feeUsd: '0',
    }),
  }));
  await db.transaction(async (m) => {
    await m.query(
      `INSERT INTO account_trades(id,"ownerId","accountId","currentVersion","createdAt")
      SELECT x.id,$1,$2,1,clock_timestamp() FROM jsonb_to_recordset($3::jsonb) AS x(id uuid)`,
      [owner, id, JSON.stringify(seeded)],
    );
    await m.query(
      `INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision","requestId",
      "canonicalPayload",kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
      SELECT $1,$2,x.id,1,x.revision,x."requestId",x.payload,'create',$4,'buy',$5::timestamptz,x."order",$6::numeric,$6::numeric,0,clock_timestamp()
      FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,"requestId" uuid,revision integer,"order" integer,payload text)`,
      [owner, id, JSON.stringify(seeded), instrument, coverageFrom, max],
    );
    await m.query(
      'UPDATE account_trade_journals SET "currentRevision"=999 WHERE "ownerId"=$1 AND "accountId"=$2',
      [owner, id],
    );
  });
  await s.trades.create(
    owner,
    id,
    execution(instrument, 999, { occurredAt: coverageFrom, quantity: max, grossUsd: max }),
  );
  const dates = Array.from({ length: 31 }, (_, i) =>
    new Date(Date.parse(coverageFrom) + i * 86400000).toISOString(),
  );
  for (const [i, date] of dates.entries())
    await s.prices.set(owner, instrument, quote(i, max, date));
  const before = await fingerprint(db);
  const statements = [];
  const traced = source();
  const create = traced.createQueryRunner.bind(traced);
  traced.createQueryRunner = (...args) => {
    const runner = create(...args);
    const query = runner.query.bind(runner);
    runner.query = (sql, ...rest) => {
      statements.push(sql);
      return query(sql, ...rest);
    };
    return runner;
  };
  let result;
  await traced.initialize();
  statements.length = 0;
  const started = performance.now();
  try {
    result = await series(services(traced), owner, id, coverageFrom, dates[30]);
  } finally {
    await traced.destroy();
  }
  const elapsed = Math.round(performance.now() - started);
  assert.equal(result.journalRevision, 1000);
  assert.equal(result.originKind, 'known-cost-carry-in');
  assert.equal(result.openingRevision, 1);
  // Independent Python Decimal precision220 oracle, retained from point valuation tests.
  const exact =
    '1000000000000000000000000000000000000000000000000099999999999999999999999999997999999999999999999999.999999999999999999999999999900000000000000000000000000001';
  assert.deepEqual(
    result.points,
    dates.map((date) => point(date, exact)),
  );
  for (const table of [
    'account_trade_journals',
    'account_carry_in_lots',
    'manual_usd_price_versions',
  ]) {
    assert.equal(
      statements.filter((sql) => /SELECT/.test(sql) && sql.includes(table)).length,
      1,
      `Load ${table} exactly once, no per-point round trips`,
    );
  }
  const tradeReads = statements.filter((sql) => /SELECT/.test(sql) && sql.includes('account_trade_versions'));
  assert.equal(tradeReads.filter((sql) => /count\(\*\)/i.test(sql)).length, 1,
    'One bounded component size preflight, never one per chart point');
  assert.equal(tradeReads.filter((sql) => !/count\(\*\)/i.test(sql)).length, 1,
    'Materialize trade history exactly once, never one per chart point');
  assert.equal(await fingerprint(db), before);
  console.log(
    `PASS VCH-MAX31 exact full-history samples in${elapsed}ms (host observation, no SLA)`,
  );
}
async function main() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact synthetic settings required');
  assert.ok(
    require('node:fs').existsSync(modulePath),
    'Missing module is prerequisite failure, not behavioral RED',
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
      'Never reuse/drop existing databases',
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
  assert.equal(migrated.status, 0, 'Actual migration19');
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 43);
    const [owner, other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('chart-owner@example.invalid','synthetic-not-a-hash',true),('chart-other@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    await timeline(db, s, owner.id, other.id);
    await coherent(db, s, owner.id);
    await maximum(db, s, owner.id);
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}
const watchdog = setTimeout(() => {
  console.error(`FAIL timeout at ${stage}`);
  process.exit(1);
}, 180000);
watchdog.unref();
main()
  .catch((error) => {
    console.error(`FAIL ${stage}: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
