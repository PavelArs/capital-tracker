'use strict';
// Guarded fresh synthetic PostgreSQL; compiled production services, no repositories mocked.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_valuation_e2e';
const at = '2025-01-04T00:00:00.000Z';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const modulePath = '/app/backend/dist/accounting/historical-valuation.service.js';
let stage = 'synthetic configuration';
function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function services(db) {
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  return { accounting: make('accounting.service', 'AccountingService'),
    trades: make('trade.service', 'TradeService'), carry: make('carry-in.service', 'CarryInService'),
    prices: make('manual-price.service', 'ManualPriceService'),
    valuation: make('historical-valuation.service', 'HistoricalValuationService') };
}
async function fingerprint(db) {
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const rows = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    rows.push([tablename, await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`)]);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
const rejected = (action, status) => assert.rejects(async () => action(), (error) => error.getStatus?.() === status);
async function account(s, owner, name, initialize = true) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  if (initialize) await s.trades.initialize(owner, id, { requestId: randomUUID(), coverageFrom, assertEmpty: true });
  return id;
}
const execution = (instrumentId, revision, changes = {}) => ({ requestId: randomUUID(),
  expectedJournalRevision: revision, instrumentId, side: 'buy', occurredAt: at,
  orderWithinTimestamp: revision, quantity: '1', grossUsd: '100', feeUsd: '0', ...changes });
const quote = (revision, priceUsd = '300', observedAt = at) => ({ requestId: randomUUID(),
  expectedRevision: revision, observedAt, priceUsd, assertReviewed: true });
const read = (s, owner, id, instant = at) => s.valuation.getSnapshot(owner, id, { at: instant });
async function exactAndGaps(db, s, f) {
  stage = 'VAL-EXACT/GAPS/PRIVATE exact points, corrections, voids, null versus zero';
  const { owner, other, first, second } = f;
  const id = await account(s, owner, 'Valuation timeline');
  await s.trades.create(owner, id, execution(first, 0, { occurredAt: '2025-01-02T00:00:00Z' }));
  await s.trades.create(owner, id, execution(first, 1, { occurredAt: '2025-01-03T00:00:00Z', grossUsd: '200' }));
  await s.trades.create(owner, id, execution(first, 2, { side: 'sell', quantity: '1.5', grossUsd: '450' }));
  await s.trades.create(owner, id, execution(second, 3, { quantity: '2', grossUsd: '400' }));
  const saved = await s.prices.set(owner, first, quote(0));
  // Adjacent instants cannot stand in for missing exact points, including explicit0.
  await s.prices.set(owner, second, quote(0, '999', '2025-01-03T23:59:59.999Z'));
  await s.prices.set(owner, second, quote(1, '999', '2025-01-04T00:00:00.001Z'));
  const before = await fingerprint(db);
  const snapshot = await read(s, owner, id);
  assert.deepEqual(Object.keys(snapshot).sort(), ['accountId','at','coverageFrom','journalRevision','basis','originKind',
    'openingRevision','priceSource','quoteCurrency','pricePolicy','completeness','missingPriceCount','pricedSubtotalUsd','totalValueUsd','items'].sort());
  assert.equal(snapshot.accountId, id);
  assert.equal(snapshot.at, at);
  assert.equal(snapshot.coverageFrom, coverageFrom);
  assert.equal(snapshot.journalRevision, 4);
  assert.equal(snapshot.basis, 'current-effective-history');
  assert.equal(snapshot.originKind, 'declared-empty');
  assert.equal(snapshot.openingRevision, null);
  assert.equal(snapshot.priceSource, 'manual');
  assert.equal(snapshot.quoteCurrency, 'USD');
  assert.equal(snapshot.pricePolicy, 'exact-instant');
  assert.equal(snapshot.completeness, 'incomplete');
  assert.equal(snapshot.missingPriceCount, 1);
  assert.equal(snapshot.pricedSubtotalUsd, '150');
  assert.equal(snapshot.totalValueUsd, null);
  assert.deepEqual(snapshot.items.map((r) => r.instrumentId), [first, second].sort());
  assert.deepEqual(snapshot.items.find((r) => r.instrumentId === first), { instrumentId: first,
    instrumentName: 'Valuation first', instrumentSymbol: 'SAME', quantity: '0.5', costUsd: '100',
    price: { priceUsd: '300', observedAt: at, revision: 1 }, valueUsd: '150' });
  assert.deepEqual(snapshot.items.find((r) => r.instrumentId === second), { instrumentId: second,
    instrumentName: 'Valuation second', instrumentSymbol: 'SAME', quantity: '2', costUsd: '400', price: null, valueUsd: null });
  await rejected(() => read(s, other, id), 404);
  await rejected(() => read(s, owner, randomUUID()), 404);
  await rejected(() => read(s, owner, 'invalid'), 400);
  await rejected(() => s.valuation.getSnapshot(owner, id, { at, limit: '1' }), 400);
  assert.equal(await fingerprint(db), before, 'Successful/refused reads preserve every row');
  await s.prices.set(owner, second, quote(2, '0'));
  const complete = await read(s, owner, id);
  assert.equal(complete.totalValueUsd, '150');
  assert.equal(complete.completeness, 'complete');
  assert.equal(complete.items.find((r) => r.instrumentId === second).valueUsd, '0');
  await s.prices.set(owner, first, quote(1, '320'));
  assert.equal((await read(s, owner, id)).totalValueUsd, '160');
  await s.prices.void(owner, first, { requestId: randomUUID(), expectedRevision: 2, observedAt: at, assertReviewed: true });
  const voided = await read(s, owner, id);
  assert.equal(voided.totalValueUsd, null);
  assert.equal(voided.pricedSubtotalUsd, '0');
  assert.equal(voided.missingPriceCount, 1);
  assert.equal(voided.items.find((r) => r.instrumentId === first).price, null, 'Never fall back to prior version');
  assert.deepEqual((await s.prices.history(owner, first, { observedAt: at })).items[2], saved.value);
  console.log('PASS VAL-EXACT/GAPS/PRIVATE');
}
async function coverage(db, s, f) {
  stage = 'VAL-COVERAGE inclusive zero-cost carry-in and sold-out empty';
  const { owner, first } = f;
  const empty = await account(s, owner, 'Valuation empty');
  const missing = await account(s, owner, 'No journal', false);
  const carry = await account(s, owner, 'Zero cost carry-in', false);
  await s.accounting.saveOpening(owner, carry, { requestId: randomUUID(), expectedRevision: 0, asOf: coverageFrom,
    positions: [{ instrumentId: first, quantity: '2', costStatus: 'known', totalCostUsd: '0' }] });
  await s.carry.initialize(owner, carry, { requestId: randomUUID(), expectedOpeningRevision: 1, assertReviewed: true,
    lots: [{ instrumentId: first, acquiredAt: coverageFrom, orderWithinTimestamp: 0,
      originalQuantity: '2', originalCostUsd: '0', remainingQuantity: '2' }] });
  await s.prices.set(owner, first, quote(3, '10', coverageFrom));
  const sale = await s.trades.create(owner, carry, execution(first, 0, { side: 'sell', occurredAt: coverageFrom, quantity: '0.5' }));
  const before = await fingerprint(db);
  const carryValue = await read(s, owner, carry, coverageFrom);
  assert.equal(carryValue.originKind, 'known-cost-carry-in');
  assert.equal(carryValue.openingRevision, 1);
  assert.equal(carryValue.items[0].quantity, '1.5');
  assert.equal(carryValue.items[0].costUsd, '0');
  assert.equal(carryValue.totalValueUsd, '15');
  const zero = await read(s, owner, empty, coverageFrom);
  assert.equal(zero.completeness, 'complete');
  assert.equal(zero.totalValueUsd, '0');
  assert.equal(zero.missingPriceCount, 0);
  assert.deepEqual(zero.items, []);
  await rejected(() => read(s, owner, missing), 409);
  await rejected(() => read(s, owner, carry, '2024-12-31T23:59:59.999Z'), 409);
  assert.equal(await fingerprint(db), before);
  await s.trades.correct(owner, carry, sale.value.trade.tradeId, execution(first, 1, { side: 'sell', occurredAt: coverageFrom, quantity: '2' }));
  const sold = await read(s, owner, carry, at); // This point was voided; sold-out needs no price.
  assert.equal(sold.totalValueUsd, '0');
  assert.deepEqual(sold.items, []);
  console.log('PASS VAL-COVERAGE');
}
async function coherent(db, s, f) {
  stage = 'VAL-SNAPSHOT separate PostgreSQL connections across price and trade commits';
  const { owner, second } = f;
  const id = await account(s, owner, 'Coherent valuation');
  const buy = await s.trades.create(owner, id, execution(second, 0));
  await s.prices.set(owner, second, quote(3, '10'));
  const old = await read(s, owner, id);
  assert.equal(old.totalValueUsd, '10');
  const reader = source();
  await reader.initialize();
  let release;
  let arrived;
  const gate = new Promise((resolve) => { release = resolve; });
  const barrier = new Promise((resolve) => { arrived = resolve; });
  const statements = [];
  const createRunner = reader.createQueryRunner.bind(reader);
  let paused = false;
  let pending;
  reader.createQueryRunner = (...args) => {
    const runner = createRunner(...args);
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
  try {
    pending = read(services(reader), owner, id);
    const timeout = setTimeout(() => { release(); }, 10000);
    try {
      const readerPid = await Promise.race([barrier, pending.then(() => { throw new Error('Missing actual read barrier'); })]);
      const [{ pid: writerPid }] = await db.query('SELECT pg_backend_pid() AS pid');
      assert.notEqual(readerPid, writerPid);
      assert.ok(statements.some((sql) => /REPEATABLE READ/.test(sql)));
      assert.ok(statements.some((sql) => /READ ONLY/.test(sql)));
      await s.prices.set(owner, second, quote(4, '20'));
      await s.trades.correct(owner, id, buy.value.trade.tradeId, execution(second, 1, { quantity: '2' }));
      const savedRows = await fingerprint(db);
      release();
      assert.deepEqual(await pending, old, 'No mixing of old quantities and new prices');
      const current = await read(s, owner, id);
      assert.equal(current.journalRevision, 2);
      assert.equal(current.totalValueUsd, '40');
      assert.equal(current.items[0].quantity, '2');
      assert.equal(current.items[0].price.revision, 5);
      assert.equal(await fingerprint(db), savedRows);
    } finally { clearTimeout(timeout); }
  } finally { release(); await pending?.catch(() => {}); await reader.destroy(); }
  console.log('PASS VAL-SNAPSHOT');
}
async function maxima(db, s, f) {
  stage = 'VAL-PRECISION real100 carry-in lots plus1000 trades and scale60 tiny price';
  const { owner, first } = f;
  const tinyId = await account(s, owner, 'Tiny value');
  const atom = '0.000000000000000000000000000001';
  const tinyAt = '2025-01-05T00:00:00.000Z';
  await s.trades.create(owner, tinyId, execution(first, 0, { quantity: atom, occurredAt: tinyAt }));
  await s.prices.set(owner, first, quote(4, atom, tinyAt));
  assert.equal((await read(s, owner, tinyId, tinyAt)).totalValueUsd, `0.${'0'.repeat(59)}1`);
  const id = await account(s, owner, 'Maximum valuation', false);
  await s.accounting.saveOpening(owner, id, { requestId: randomUUID(), expectedRevision: 0, asOf: coverageFrom,
    positions: [{ instrumentId: first, quantity: '100', costStatus: 'known', totalCostUsd: '100' }] });
  await s.carry.initialize(owner, id, { requestId: randomUUID(), expectedOpeningRevision: 1, assertReviewed: true,
    lots: Array.from({ length: 100 }, (_, i) => ({ instrumentId: first, acquiredAt: coverageFrom,
      orderWithinTimestamp: i, originalQuantity: '1', originalCostUsd: '1', remainingQuantity: '1' })) });
  const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
  const seeded = Array.from({ length: 999 }, (_, i) => ({ id: randomUUID(), requestId: randomUUID(), revision: i + 1,
    order: i, payload: JSON.stringify({ kind: 'create', ...execution(first, i, { quantity: maximum, grossUsd: maximum }) }) }));
  // Valid bulk fixture only in guarded synthetic database; final service write recomputes all history.
  await db.transaction(async (m) => {
    await m.query(`INSERT INTO account_trades(id,"ownerId","accountId","currentVersion","createdAt")
      SELECT x.id,$1,$2,1,clock_timestamp() FROM jsonb_to_recordset($3::jsonb) AS x(id uuid)`, [owner,id,JSON.stringify(seeded)]);
    await m.query(`INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision","requestId",
      "canonicalPayload",kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
      SELECT $1,$2,x.id,1,x.revision,x."requestId",x.payload,'create',$4,'buy',$5::timestamptz,x."order",$6::numeric,$6::numeric,0,clock_timestamp()
      FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,"requestId" uuid,revision integer,"order" integer,payload text)`,
      [owner,id,JSON.stringify(seeded),first,at,maximum]);
    await m.query('UPDATE account_trade_journals SET "currentRevision"=999 WHERE "ownerId"=$1 AND "accountId"=$2',[owner,id]);
  });
  await s.trades.create(owner,id,execution(first,999,{quantity:maximum,grossUsd:maximum}));
  await s.prices.set(owner,first,quote(5,maximum));
  const before=await fingerprint(db);
  const snapshot=await read(s,owner,id);
  assert.equal(snapshot.journalRevision,1000);
  assert.equal(snapshot.items[0].quantity,'1000000000000000000000000000000000000000000000000099.999999999999999999999999999');
  // Independent Python Decimal precision220 oracle; all sixty places retained until final canonical formatting.
  assert.equal(snapshot.totalValueUsd,'1000000000000000000000000000000000000000000000000099999999999999999999999999997999999999999999999999.999999999999999999999999999900000000000000000000000000001');
  assert.equal(await fingerprint(db),before);
  console.log('PASS VAL-PRECISION');
}
async function main() {
  for (const [key,value] of Object.entries(settings)) assert.equal(process.env[key],value,'Exact isolated settings required');
  assert.ok(require('node:fs').existsSync(modulePath),'Missing implementation is a prerequisite failure, not behavioral RED');
  const admin = new Client({host:settings.DB_HOST,port:5432,user:settings.DB_USERNAME,password:settings.DB_PASSWORD,database:settings.DB_NAME});
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0,'Refuse existing DB, never drop data');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated=spawnSync(process.execPath,['/app/backend/dist/migrate.js'],{cwd:'/app/backend',env:{...process.env,...settings,DB_NAME:database},encoding:'utf8',timeout:60000});
  assert.equal(migrated.status,0,'Actual18 migrations');
  const db=source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n,18);
    const [owner,other]=await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('valuation-owner@example.invalid','synthetic-not-a-hash',true),('valuation-other@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s=services(db);
    const first=(await s.accounting.createInstrument(owner.id,{requestId:randomUUID(),name:'Valuation first',symbol:'SAME'})).value.id;
    const second=(await s.accounting.createInstrument(owner.id,{requestId:randomUUID(),name:'Valuation second',symbol:'SAME'})).value.id;
    const f={owner:owner.id,other:other.id,first,second};
    for (const check of [exactAndGaps,coverage,coherent,maxima]) await check(db,s,f);
  } finally { if(db.isInitialized) await db.destroy(); }
}
const watchdog=setTimeout(()=>{console.error(`FAIL timeout at ${stage}`);process.exit(1);},180000);
watchdog.unref();
main().catch((error)=>{console.error(`FAIL ${stage}: ${error.message}`);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
