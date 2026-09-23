'use strict';

// External synthetic PostgreSQL acceptance against compiled production services.
// A missing module/schema is a prerequisite failure, never behavioral RED.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const settings = {
  DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e',
};
const database = 'capital_tracker_usd_trades_e2e';
const tradeTables = ['account_trade_journals', 'account_trades', 'account_trade_versions'];
const accountingTables = ['manual_accounts', 'accounting_instruments',
  'account_opening_snapshots', 'account_opening_positions'];
const children = new Set();
const coverageFrom = '2025-01-01T00:00:00.000Z';
const zeros = { grossBuysUsd: '0', buyFeesUsd: '0', grossSalesUsd: '0', sellFeesUsd: '0',
  netSalesUsd: '0', consumedCostUsd: '0', realizedUsd: '0', remainingCostUsd: '0' };
let stage = 'isolated configuration';

function sentinel(worker = false) {
  for (const [key, value] of Object.entries(settings)) {
    assert.equal(process.env[key], worker && key === 'DB_NAME' ? database : value,
      'Exact isolated synthetic settings required');
  }
}

function productionSource(statements) {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database }))
    .createTypeOrmOptions();
  assert.equal(options.database, database);
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  // Observe the real statements without replacing any database operation/result.
  // Parameters are neither captured nor printed.
  if (statements) {
    options.logging = ['query'];
    options.logger = { logQuery: query => statements.push(query), logQueryError() {},
      logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {} };
  }
  return new DataSource(options);
}

function services(source) {
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  return { accounting: new AccountingService(source), trade: new TradeService(source) };
}

async function rows(source, table) {
  assert.match(table, /^[a-z_]+$/);
  return source.query(`SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY row`);
}

async function fingerprint(source, legacy = false) {
  const tables = await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const values = [];
  for (const { tablename } of tables) {
    if (legacy && [...tradeTables, ...accountingTables].includes(tablename)) continue;
    values.push([tablename, await rows(source, tablename)]);
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

async function status(action, expected) {
  let failed = false, actual;
  try { await action(); } catch (error) { failed = true; actual = error?.getStatus?.(); }
  assert.ok(failed, 'Expected a deliberate service rejection');
  assert.equal(actual, expected, 'Reject for the specified domain boundary, not incidental SQL failure');
}

async function rejectedSql(source, action, codes) {
  const runner = source.createQueryRunner();
  let failure;
  try {
    await runner.connect(); await runner.startTransaction();
    try { await action(runner); } catch (error) { failure = error; }
  } finally {
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
    finally { await runner.release(); }
  }
  assert.ok(codes.includes(failure?.driverError?.code ?? failure?.code),
    'Actual PostgreSQL must reject for the intended SQLSTATE');
}

const origin = (changes = {}) => ({ requestId: randomUUID(), coverageFrom, assertEmpty: true, ...changes });
const execution = (instrumentId, order, changes = {}) => ({ instrumentId, side: 'buy',
  occurredAt: '2025-01-02T00:00:00.000Z', orderWithinTimestamp: order,
  quantity: '1', grossUsd: '100', feeUsd: '0', ...changes });
const command = (instrumentId, revision, changes = {}) => ({ requestId: randomUUID(),
  expectedJournalRevision: revision, ...execution(instrumentId, revision, changes) });
const opening = (instrumentId, costStatus = 'known') => ({ requestId: randomUUID(), expectedRevision: 0,
  asOf: coverageFrom, positions: [{ instrumentId, quantity: '1', costStatus,
    totalCostUsd: costStatus === 'unknown' ? null : '0' }] });

async function newAccount(accounting, owner, name) {
  return (await accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
}

async function newJournal(accounting, trade, owner, name) {
  const account = await newAccount(accounting, owner, name);
  const initialized = await trade.initialize(owner, account, origin());
  assert.equal(initialized.created, true);
  assert.deepEqual((await trade.getJournal(owner, account)).journal.summary, zeros);
  return account;
}

async function seed(source, accounting) {
  const users = [];
  for (const email of ['usd-trades-owner@example.invalid', 'usd-trades-other@example.invalid']) {
    const [user] = await source.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES($1,'synthetic-pg-fixture-not-a-login-hash',true) RETURNING id`, [email]);
    users.push(user.id);
    await source.query(`INSERT INTO crypto_wallets("userId",type,address,balance)
      VALUES($1,'bitcoin',$2,'1.250000000000000001')`, [user.id, `synthetic-${email}`]);
    for (const [table, category] of [['assets', 'savings'], ['liabilities', 'loans']]) {
      await source.query(`INSERT INTO ${table}("userId",name,category,amount,"currencyId",date)
        SELECT $1,'Preserved synthetic finance',$2,'123.45',id,'2026-01-01' FROM currencies WHERE code='USD'`,
      [user.id, category]);
    }
  }
  const [owner, other] = users;
  await source.query('INSERT INTO owner_auth(id,"userId","credentialVersion") VALUES(1,$1,$2)', [owner, randomUUID()]);
  const instruments = [];
  for (let index = 0; index < 3; index++) {
    instruments.push((await accounting.createInstrument(owner, { requestId: randomUUID(),
      name: `Synthetic USD instrument ${index}`, symbol: 'SAME' })).value.id);
  }
  const foreignInstrument = (await accounting.createInstrument(other, { requestId: randomUUID(),
    name: 'Foreign same-symbol instrument', symbol: 'SAME' })).value.id;
  const foreignAccount = await newAccount(accounting, other, 'Foreign synthetic account');
  return { owner, other, instruments, foreignInstrument, foreignAccount };
}

async function originsAndOwnership(source, accounting, trade, fixture) {
  stage = 'TRADE-001 explicit origins, opening history, owner isolation';
  const { owner, other, instruments: [instrument], foreignAccount, foreignInstrument } = fixture;
  const account = await newAccount(accounting, owner, 'Explicit empty origin');
  assert.deepEqual(await trade.getJournal(owner, account), { accountId: account, eligible: true,
    ineligibilityReason: null, journal: null });
  const before = await fingerprint(source);
  for (const invalid of [false, 'true', 1, null, {}, []]) {
    await status(() => trade.initialize(owner, account, origin({ assertEmpty: invalid })), 400);
  }
  await status(() => trade.create(owner, account, command(instrument, 0)), 409);
  for (const method of ['listTrades', 'listLots', 'listRealizations']) {
    await status(() => trade[method](owner, account), 409);
  }
  await status(() => trade.initialize(owner, foreignAccount, origin()), 404);
  await status(() => trade.initialize(owner, randomUUID(), origin()), 404);
  assert.equal(await fingerprint(source), before);
  const input = origin({ coverageFrom: '2025-01-01T02:00:00+02:00' });
  const initialized = await trade.initialize(owner, account, input);
  assert.equal(initialized.created, true);
  assert.deepEqual(Object.keys(initialized.value).sort(),
    ['accountId', 'coverageFrom', 'createdAt', 'originKind', 'requestId'].sort());
  assert.equal(initialized.value.originKind, 'declared-empty');
  assert.equal(initialized.value.coverageFrom, coverageFrom);
  assert.equal((await source.query('SELECT "canonicalPayload" FROM account_trade_journals WHERE "accountId"=$1', [account]))[0].canonicalPayload,
    JSON.stringify({ coverageFrom, assertEmpty: true }));
  assert.deepEqual(await trade.initialize(owner, account.toUpperCase(), { ...input,
    requestId: input.requestId.toUpperCase(), coverageFrom }), { created: false, value: initialized.value });
  await status(() => trade.initialize(owner, account, origin()), 409);
  await status(() => trade.initialize(owner, account, { ...input, coverageFrom: '2025-01-02T00:00:00Z' }), 409);
  await status(() => trade.create(owner, account, command(foreignInstrument, 0)), 404);
  await status(() => trade.getJournal(other, account), 404);
  await status(() => accounting.saveOpening(owner, account, opening(instrument)), 409);
  for (const [costStatus, cost] of [['known', '0'], ['known', '100'], ['unknown', null]]) {
    const opened = await newAccount(accounting, owner, `Ineligible ${costStatus} opening`);
    const previousOpening = opening(instrument, costStatus);
    previousOpening.positions[0].totalCostUsd = cost;
    const saved = await accounting.saveOpening(owner, opened, previousOpening);
    const baseline = await fingerprint(source);
    assert.equal((await trade.getJournal(owner, opened)).ineligibilityReason, 'opening-history');
    await status(() => trade.initialize(owner, opened, origin()), 409);
    assert.equal(await fingerprint(source), baseline);
    assert.equal(saved.value.positions[0].totalCostUsd, cost);
    // A null pointer alone cannot erase real retained opening history.
    await source.query('UPDATE manual_accounts SET "currentRevision"=NULL WHERE id=$1', [opened]);
    await status(() => trade.initialize(owner, opened, origin()), 409);
    await source.query('UPDATE manual_accounts SET "currentRevision"=1 WHERE id=$1', [opened]);
  }
  console.log('PASS TRADE-001 explicit empty origin, zero/unknown/history exclusion, owner boundaries and blocked opening writes');
}

async function fifoVectors(source, accounting, trade, fixture) {
  stage = 'TRADE-002 exact FIFO, fees, residual allocation and provenance';
  const { owner, instruments: [instrument, sameSymbol] } = fixture;
  let retained;
  for (const fees of [false, true]) {
    const account = await newJournal(accounting, trade, owner, `Mandatory FIFO ${fees}`);
    const inputs = [command(instrument, 0, { feeUsd: fees ? '1' : '0' }),
      command(instrument, 1, { grossUsd: '200', feeUsd: fees ? '2' : '0' }),
      command(instrument, 2, { side: 'sell', quantity: '1.5', grossUsd: '450', feeUsd: fees ? '3' : '0' })];
    const receipts = [];
    for (const input of inputs) receipts.push((await trade.create(owner, account, input)).value);
    const storedFirst = (await source.query('SELECT "canonicalPayload" FROM account_trade_versions WHERE "accountId"=$1 AND "journalRevision"=1', [account]))[0];
    assert.equal(storedFirst.canonicalPayload, JSON.stringify({ kind: 'create', expectedJournalRevision: 0,
      ...execution(instrument, 0, { feeUsd: fees ? '1' : '0' }) }));
    const state = (await trade.getJournal(owner, account)).journal;
    assert.equal(state.journalRevision, 3); assert.equal(state.activeTradeCount, 3); assert.equal(state.versionCount, 3);
    assert.deepEqual(state.summary, { grossBuysUsd: '300', buyFeesUsd: fees ? '3' : '0', grossSalesUsd: '450',
      sellFeesUsd: fees ? '3' : '0', netSalesUsd: fees ? '447' : '450', consumedCostUsd: fees ? '202' : '200',
      realizedUsd: fees ? '245' : '250', remainingCostUsd: fees ? '101' : '100' });
    const lots = await trade.listLots(owner, account);
    assert.equal(lots.journalRevision, 3); assert.equal(lots.nextOffset, null); assert.equal(lots.items.length, 1);
    assert.deepEqual([lots.items[0].buyTradeId, lots.items[0].buyVersion, lots.items[0].remainingQuantity,
      lots.items[0].remainingCostUsd], [receipts[1].trade.tradeId, 1, '0.5', fees ? '101' : '100']);
    const matches = await trade.listMatches(owner, account, receipts[2].trade.tradeId);
    assert.deepEqual(matches.items, [
      { sellTradeId: receipts[2].trade.tradeId, sellVersion: 1, buyTradeId: receipts[0].trade.tradeId,
        buyVersion: 1, quantity: '1', costUsd: fees ? '101' : '100' },
      { sellTradeId: receipts[2].trade.tradeId, sellVersion: 1, buyTradeId: receipts[1].trade.tradeId,
        buyVersion: 1, quantity: '0.5', costUsd: fees ? '101' : '100' },
    ]);
    const realized = (await trade.listRealizations(owner, account)).items;
    assert.equal(realized.length, 1); assert.equal(realized[0].realizedUsd, fees ? '245' : '250');
    assert.equal(realized[0].instrumentId, instrument);
    if (!fees) retained = { account, inputs, receipts };
  }
  for (const [quantity, grossUsd, expectedCosts] of [
    ['3', '1', ['0.' + '3'.repeat(30), '0.' + '3'.repeat(30), '0.' + '3'.repeat(29) + '4']],
    ['7', '0.' + '0'.repeat(29) + '3', ['0', '0', '0.' + '0'.repeat(29) + '1', '0',
      '0.' + '0'.repeat(29) + '1', '0', '0.' + '0'.repeat(29) + '1']],
  ]) {
    const account = await newJournal(accounting, trade, owner, `Residual ${quantity}`);
    await trade.create(owner, account, command(instrument, 0, { quantity, grossUsd }));
    for (const [index, expected] of expectedCosts.entries()) {
      const sale = (await trade.create(owner, account, command(instrument, index + 1,
        { side: 'sell', grossUsd: '1' }))).value;
      assert.equal((await trade.listMatches(owner, account, sale.trade.tradeId)).items[0].costUsd, expected);
    }
    assert.deepEqual((await trade.listLots(owner, account)).items, []);
    assert.equal((await trade.getJournal(owner, account)).journal.summary.consumedCostUsd, grossUsd);
  }
  const negative = await newJournal(accounting, trade, owner, 'Negative net is exact');
  await trade.create(owner, negative, command(instrument, 0, { grossUsd: '10', feeUsd: '2' }));
  await trade.create(owner, negative, command(instrument, 1, { side: 'sell', grossUsd: '1', feeUsd: '3' }));
  assert.equal((await trade.listRealizations(owner, negative)).items[0].netUsd, '-2');
  assert.equal((await trade.getJournal(owner, negative)).journal.summary.realizedUsd, '-14');
  const separate = await newJournal(accounting, trade, owner, 'Same symbol does not merge identity');
  const large = '9007199254740993.000000000000000001';
  await trade.create(owner, separate, command(instrument, 0, { quantity: large, grossUsd: large }));
  const before = await fingerprint(source);
  await status(() => trade.create(owner, separate, command(sameSymbol, 1, { side: 'sell' })), 409);
  assert.equal(await fingerprint(source), before);
  assert.equal((await trade.listLots(owner, separate)).items[0].remainingQuantity, large);
  assert.equal((await trade.listLots(owner, separate)).items[0].remainingCostUsd, large);
  const wide = await newJournal(accounting, trade, owner, 'Wide aggregate and product fixture');
  const maximum = '9'.repeat(48) + '.' + '9'.repeat(30);
  for (const revision of [0, 1]) await trade.create(owner, wide, command(instrument, revision, { quantity: maximum, grossUsd: maximum }));
  assert.equal((await trade.getJournal(owner, wide)).journal.summary.remainingCostUsd, '1' + '9'.repeat(48) + '.' + '9'.repeat(29) + '8');
  const smallSale = (await trade.create(owner, wide, command(instrument, 2, { side: 'sell', grossUsd: '1' }))).value;
  assert.equal((await trade.listMatches(owner, wide, smallSale.trade.tradeId)).items[0].costUsd, '1');
  console.log('PASS TRADE-002 mandatory fee/profit vectors, independent residual atoms, negative net, wide products and exact identity provenance');
  return retained;
}

async function historyAndValidation(source, accounting, trade, fixture, retained) {
  stage = 'TRADE-003 corrections, immutable receipts, raw types, prefix validation and pages';
  const { owner, instruments: [instrument], foreignAccount, foreignInstrument } = fixture;
  const { account, inputs, receipts } = retained;
  const first = receipts[0].trade.tradeId;
  const correction = { ...inputs[0], requestId: randomUUID(), expectedJournalRevision: 3, grossUsd: '120' };
  const corrected = await trade.correct(owner, account, first, correction);
  assert.equal(corrected.value.trade.version, 2);
  assert.equal((await source.query('SELECT "canonicalPayload" FROM account_trade_versions WHERE "accountId"=$1 AND "journalRevision"=4', [account]))[0].canonicalPayload,
    JSON.stringify({ kind: 'correct', tradeId: first, expectedJournalRevision: 3, ...execution(instrument, 0, { grossUsd: '120' }) }));
  assert.equal((await trade.getJournal(owner, account)).journal.summary.realizedUsd, '230');
  assert.equal((await trade.getJournal(owner, account)).journal.summary.remainingCostUsd, '100');
  const restored = await trade.correct(owner, account, first, { ...correction, requestId: randomUUID(),
    expectedJournalRevision: 4, grossUsd: '100' });
  assert.equal(restored.value.trade.version, 3);
  assert.equal((await trade.getJournal(owner, account)).journal.summary.realizedUsd, '250');
  const beforeReplay = await fingerprint(source);
  assert.deepEqual(await trade.create(owner, account, inputs[0]), { created: false, value: receipts[0] });
  assert.deepEqual(await trade.correct(owner, account, first, correction), { created: false, value: corrected.value });
  const initial = (await source.query('SELECT "requestId","coverageFrom" FROM account_trade_journals WHERE "accountId"=$1', [account]))[0];
  const replayOrigin = await trade.initialize(owner, account, { requestId: initial.requestId, coverageFrom, assertEmpty: true });
  assert.equal(replayOrigin.created, false); assert.ok(!('journalRevision' in replayOrigin.value));
  assert.equal(await fingerprint(source), beforeReplay, 'Old receipts never rewind live heads/revision or rewrite history');
  const history = await trade.listVersions(owner, account, first, { limit: '2' });
  assert.deepEqual(history.items.map(row => row.version), [3, 2]); assert.equal(history.nextBeforeVersion, 2);
  const prior = await trade.listVersions(owner, account, first, { beforeVersion: '2', limit: '2' });
  assert.deepEqual(prior.items, [receipts[0].trade]); assert.equal(prior.nextBeforeVersion, null);
  const firstPage = await trade.listTrades(owner, account, { limit: '1' });
  assert.equal(firstPage.items.length, 1); assert.equal(firstPage.nextOffset, 1); assert.equal(firstPage.journalRevision, 5);
  assert.equal((await trade.listTrades(owner, account, { offset: '1', limit: '1', journalRevision: '5' })).items.length, 1);
  assert.deepEqual((await trade.listTrades(owner, account, { offset: '99', journalRevision: '5' })).items, []);
  const good = command(instrument, 5, { orderWithinTimestamp: 10 });
  const before = await fingerprint(source);
  const changes = [
    { quantity: 1 }, { grossUsd: { toString: '1' } }, { feeUsd: [] }, { instrumentId: [instrument] },
    { requestId: {} }, { side: { toString: 'buy' } }, { occurredAt: ['2025-01-02T00:00:00Z'] },
    { quantity: 'NaN' }, { quantity: 'Infinity' }, { quantity: '1e2' }, { quantity: '1.' + '0'.repeat(31) },
    { quantity: '0' }, { grossUsd: '0' }, { feeUsd: '-1' }, { feeUsd: '0'.repeat(257) },
    { expectedJournalRevision: '5' }, { expectedJournalRevision: true }, { expectedJournalRevision: 1.5 },
    { orderWithinTimestamp: '10' }, { orderWithinTimestamp: -1 }, { orderWithinTimestamp: 2147483648 },
    { occurredAt: '2025-02-29T00:00:00Z' }, { occurredAt: '2025-01-01' }, { surprise: true },
    { grossUsd: '9'.repeat(48) + '.' + '9'.repeat(30), feeUsd: '0.' + '0'.repeat(29) + '1' },
  ];
  for (const change of changes) {
    await status(() => trade.create(owner, account, { ...good, ...change }), 400);
    assert.equal(await fingerprint(source), before);
  }
  for (const change of [
    { expectedJournalRevision: 0 }, { occurredAt: '2024-12-31T23:59:59Z' },
    { orderWithinTimestamp: 0 }, { side: 'sell', quantity: '2' },
  ]) await status(() => trade.create(owner, account, { ...good, ...change }), 409);
  // A later buy cannot repair an earlier negative prefix.
  await status(() => trade.correct(owner, account, first, { ...correction, expectedJournalRevision: 5,
    requestId: randomUUID(), occurredAt: '2025-01-03T00:00:00Z' }), 409);
  await status(() => trade.create(owner, account, { ...good, instrumentId: foreignInstrument }), 404);
  await status(() => trade.create(owner, foreignAccount, good), 404);
  await status(() => trade.correct(owner, account, randomUUID(), good), 404);
  await status(() => trade.void(owner, account, first, { requestId: inputs[0].requestId, expectedJournalRevision: 0 }), 409);
  for (const query of [{ offset: '1' }, { limit: 1 }, { limit: '01' }, { limit: '101' },
    { offset: '-1' }, { journalRevision: ['5'] }, { surprise: '1' }]) {
    await status(() => trade.listTrades(owner, account, query), 400);
  }
  await status(() => trade.listLots(owner, account, { journalRevision: '4' }), 409);
  await status(() => trade.listMatches(owner, account, first), 409);
  assert.equal(await fingerprint(source), before, 'Every rejected command/read preserves all rows and keys');
  const reused = await trade.create(owner, account, { ...good, quantity: '0001.00',
    instrumentId: instrument.toUpperCase(), occurredAt: '2025-01-02T02:00:00+02:00' });
  assert.equal(reused.created, true);
  assert.deepEqual(await trade.create(owner, account, { ...good, quantity: '1' }), { created: false, value: reused.value });
  const voidInput = { requestId: randomUUID(), expectedJournalRevision: 6 };
  const voided = await trade.void(owner, account, reused.value.trade.tradeId, voidInput);
  assert.equal(voided.value.trade.version, 2); assert.equal(voided.value.trade.kind, 'void');
  assert.equal((await source.query('SELECT "canonicalPayload" FROM account_trade_versions WHERE "accountId"=$1 AND "journalRevision"=7', [account]))[0].canonicalPayload,
    JSON.stringify({ kind: 'void', tradeId: reused.value.trade.tradeId, expectedJournalRevision: 6 }));
  for (const field of Object.keys(execution(instrument, 0))) {
    assert.deepEqual(voided.value.trade[field], reused.value.trade[field], 'Void retains every execution field');
  }
  assert.deepEqual(await trade.void(owner, account, reused.value.trade.tradeId, voidInput), { created: false, value: voided.value });
  await status(() => trade.correct(owner, account, reused.value.trade.tradeId,
    { ...good, requestId: randomUUID(), expectedJournalRevision: 7 }), 409);
  await status(() => trade.void(owner, account, reused.value.trade.tradeId,
    { requestId: randomUUID(), expectedJournalRevision: 7 }), 409);
  await status(() => accounting.saveOpening(owner, account, opening(instrument)), 409);
  console.log('PASS TRADE-003 full atomic validation, historical prefix, old receipts, terminal void, canonical replay and revision-pinned pages');
}

async function fullCorrection(source, accounting, trade, fixture) {
  stage = 'TRADE-003 complete correction changes both instrument queues and terminal empty journal';
  const { owner, instruments: [firstInstrument, secondInstrument] } = fixture;
  const account = await newJournal(accounting, trade, owner, 'Every execution field changes');
  const originalInput = command(firstInstrument, 0, { quantity: '2', grossUsd: '10' });
  const original = (await trade.create(owner, account, originalInput)).value;
  const second = (await trade.create(owner, account, command(secondInstrument, 1, { quantity: '2', grossUsd: '20' }))).value;
  const input = command(secondInstrument, 2, { side: 'sell', occurredAt: '2025-01-03T00:00:00Z',
    orderWithinTimestamp: 22, quantity: '1', grossUsd: '40', feeUsd: '3' });
  const corrected = await trade.correct(owner, account, original.trade.tradeId, input);
  assert.equal(corrected.value.trade.version, 2);
  const lots = (await trade.listLots(owner, account)).items;
  assert.equal(lots.length, 1);
  assert.deepEqual([lots[0].instrumentId, lots[0].remainingQuantity, lots[0].remainingCostUsd], [secondInstrument, '1', '10']);
  assert.deepEqual((await trade.listMatches(owner, account, original.trade.tradeId)).items, [{
    sellTradeId: original.trade.tradeId, sellVersion: 2, buyTradeId: second.trade.tradeId,
    buyVersion: 1, quantity: '1', costUsd: '10',
  }]);
  assert.equal((await trade.getJournal(owner, account)).journal.summary.realizedUsd, '27');
  assert.deepEqual(await trade.create(owner, account, originalInput), { created: false, value: original });
  await status(() => trade.correct(owner, account, second.trade.tradeId, input), 409);
  const independent = await newJournal(accounting, trade, owner, 'Independent request namespace');
  assert.equal((await trade.create(owner, independent, originalInput)).created, true);
  await trade.void(owner, account, original.trade.tradeId, { requestId: randomUUID(), expectedJournalRevision: 3 });
  await trade.void(owner, account, second.trade.tradeId, { requestId: randomUUID(), expectedJournalRevision: 4 });
  const before = await fingerprint(source);
  const state = (await trade.getJournal(owner, account)).journal;
  assert.equal(state.activeTradeCount, 0); assert.equal(state.versionCount, 5); assert.deepEqual(state.summary, zeros);
  assert.equal((await trade.listTrades(owner, account)).items.length, 2, 'Both terminal void heads remain visible');
  await status(() => accounting.saveOpening(owner, account, opening(firstInstrument)), 409);
  assert.equal(await fingerprint(source), before);
  console.log('PASS TRADE-003 full correction recomputes both queues, request scope is per account, all voids retain origin/history');
}

async function sqlConstraints(source, fixture) {
  stage = 'TRADE-005 finite SQL, composite ownership and deferred heads';
  const { owner, other, foreignAccount, foreignInstrument } = fixture;
  const [version] = await source.query('SELECT * FROM account_trade_versions ORDER BY "createdAt" LIMIT 1');
  const before = await fingerprint(source);
  const columns = await source.query(`SELECT table_name,column_name,data_type,is_nullable,numeric_precision,numeric_scale,datetime_precision
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1)`, [tradeTables]);
  assert.ok(columns.length > 0);
  for (const column of columns) {
    assert.equal(column.is_nullable, 'NO');
    if (['quantity', 'grossUsd', 'feeUsd'].includes(column.column_name)) {
      assert.equal(column.data_type, 'numeric'); assert.equal(column.numeric_precision, 78); assert.equal(column.numeric_scale, 30);
    }
    if (['createdAt', 'occurredAt', 'coverageFrom'].includes(column.column_name)) assert.equal(column.datetime_precision, 3);
  }
  for (const field of ['quantity', 'grossUsd', 'feeUsd']) {
    for (const value of ['NaN', 'Infinity', '-Infinity', '-1', '1' + '0'.repeat(48), null,
      ...(field === 'feeUsd' ? [] : ['0'])]) {
      await rejectedSql(source, runner => runner.query(`UPDATE account_trade_versions SET "${field}"=$1
        WHERE "ownerId"=$2 AND "accountId"=$3 AND "tradeId"=$4 AND version=$5`,
      [value, owner, version.accountId, version.tradeId, version.version]), ['23514', '22003', '23502']);
    }
  }
  for (const [table, field] of [['account_trade_versions', 'occurredAt'], ['account_trade_journals', 'coverageFrom'],
    ...tradeTables.map(table => [table, 'createdAt'])]) {
    for (const value of ['infinity', '-infinity', null,
      ...(field === 'createdAt' ? [] : ['1969-12-31T23:59:59.999Z', '10000-01-01T00:00:00Z'])]) {
      await rejectedSql(source, runner => runner.query(`UPDATE ${table} SET "${field}"=$1 WHERE "ownerId"=$2`, [value, owner]),
        ['23514', '23502']);
    }
  }
  for (const [field, value, code] of [['instrumentId', foreignInstrument, '23503'], ['ownerId', other, '23503'],
    ['accountId', foreignAccount, '23503'], ['quantity', null, '23502'], ['side', 'transfer', '23514'],
    ['kind', 'restore', '23514'], ['version', 0, '23514'], ['journalRevision', 10001, '23514'],
    ['orderWithinTimestamp', -1, '23514']]) {
    await rejectedSql(source, runner => runner.query(`UPDATE account_trade_versions SET "${field}"=$1
      WHERE "ownerId"=$2 AND "accountId"=$3 AND "tradeId"=$4 AND version=$5`,
    [value, owner, version.accountId, version.tradeId, version.version]), [code]);
  }
  const [headConstraint] = await source.query(`SELECT condeferrable,condeferred FROM pg_constraint
    WHERE conrelid='account_trades'::regclass AND confrelid='account_trade_versions'::regclass AND contype='f'`);
  assert.deepEqual(headConstraint, { condeferrable: true, condeferred: true });
  await rejectedSql(source, async runner => {
    await runner.query('UPDATE account_trades SET "currentVersion"=9999 WHERE id=$1', [version.tradeId]);
    await runner.query('SET CONSTRAINTS ALL IMMEDIATE');
  }, ['23503']);
  const deferred = source.createQueryRunner();
  let headFailure;
  try {
    await deferred.connect(); await deferred.startTransaction();
    await deferred.query('UPDATE account_trades SET "currentVersion"=9999 WHERE id=$1', [version.tradeId]);
    try { await deferred.commitTransaction(); } catch (error) { headFailure = error; }
  } finally {
    try { if (deferred.isTransactionActive) await deferred.rollbackTransaction(); }
    finally { await deferred.release(); }
  }
  assert.equal(headFailure?.driverError?.code ?? headFailure?.code, '23503', 'Actual COMMIT cannot retain a dangling head');
  const distinct = (await source.query(`SELECT "requestId","journalRevision" FROM account_trade_versions
    WHERE "accountId"=$1 AND "requestId"<>$2 LIMIT 1`, [version.accountId, version.requestId]))[0];
  assert.ok(distinct);
  for (const field of ['requestId', 'journalRevision']) {
    await rejectedSql(source, runner => runner.query(`UPDATE account_trade_versions SET "${field}"=$1
      WHERE "accountId"=$2 AND "tradeId"=$3 AND version=$4`,
    [distinct[field], version.accountId, version.tradeId, version.version]), ['23505']);
  }
  for (const table of ['manual_accounts', 'accounting_instruments', 'users']) {
    const key = table === 'manual_accounts' ? version.accountId : table === 'accounting_instruments' ? version.instrumentId : owner;
    await rejectedSql(source, runner => runner.query(`DELETE FROM ${table} WHERE id=$1`, [key]), ['23503']);
  }
  const runner = source.createQueryRunner();
  try {
    await runner.connect(); await runner.startTransaction();
    await runner.query('DELETE FROM owner_auth WHERE id=1');
    for (const table of tradeTables) assert.deepEqual(await rows(runner, table), await rows(source, table));
  } finally {
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
    finally { await runner.release(); }
  }
  assert.equal(await fingerprint(source), before);
  console.log('PASS TRADE-005 real finite/composite/RESTRICT SQL boundaries and deferred head integrity; old owner binding is not a history parent');
}

async function workerMain() {
  sentinel(true);
  const statements = [];
  const source = productionSource(statements);
  await source.initialize();
  try {
    const commandReady = new Promise(resolve => process.once('message', resolve));
    process.send({ type: 'ready', pid: process.pid });
    const { service, method, args, readBarrier } = await commandReady;
    const allowed = service === 'accounting' ? ['saveOpening'] :
      ['initialize', 'create', 'correct', 'void', 'getJournal', 'listTrades', 'listLots', 'listRealizations', 'listMatches'];
    assert.ok(allowed.includes(method));
    statements.length = 0;
    let paused = false;
    if (readBarrier) {
      const { readSync, writeSync } = require('node:fs');
      const capture = source.logger.logQuery;
      source.logger.logQuery = query => {
        if (!paused && /^\s*SELECT\b/i.test(query) && /accounting_instruments/i.test(query)) {
          assert.ok(statements.some(sql => /^\s*SELECT\b/i.test(sql) && /account_trade_journals/i.test(sql)),
            'The real read must anchor its snapshot before the observed label query');
          assert.ok(statements.some(sql => /REPEATABLE READ/i.test(sql)), 'Actual transaction must request RR');
          assert.ok(statements.some(sql => /READ ONLY/i.test(sql)), 'Actual transaction must be read-only');
          paused = true;
          writeSync(1, 'SYNTHETIC_READ_BARRIER\n');
          const byte = Buffer.alloc(1);
          assert.equal(readSync(0, byte, 0, 1, null), 1);
          assert.equal(byte[0], 1);
        }
        capture(query);
      };
    }
    let result;
    try { result = { ok: true, result: await services(source)[service][method](...args), statements, paused }; }
    catch (error) { result = { ok: false, status: error?.getStatus?.() ?? null }; }
    process.send({ type: 'result', result });
  } finally { await source.destroy(); process.disconnect(); }
}

function startWorker() {
  const child = spawn(process.execPath, [__filename, '--worker'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  children.add(child);
  let readyResolve, readyReject, resultResolve, resultReject, barrierResolve, barrierReject, result;
  let output = '', errors = '', released = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const finished = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const barrier = new Promise((resolve, reject) => { barrierResolve = resolve; barrierReject = reject; });
  ready.catch(() => {}); finished.catch(() => {}); barrier.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  child.stdout.on('data', chunk => {
    output += chunk;
    if (output === 'SYNTHETIC_READ_BARRIER\n') barrierResolve();
    else if (Buffer.byteLength(output) > 1024) child.kill('SIGKILL');
  });
  child.stderr.on('data', chunk => { errors += chunk; if (Buffer.byteLength(errors) > 16384) child.kill('SIGKILL'); });
  child.stdin.on('error', () => {}); // Child exit is checked independently; cleanup must not emit an unhandled EPIPE.
  child.on('message', message => {
    if (message.type === 'ready') readyResolve(message.pid);
    if (message.type === 'result') result = message.result;
  });
  const fail = () => {
    const error = new Error('Isolated trade worker failed (private details withheld)');
    readyReject(error); resultReject(error); barrierReject(error);
  };
  child.on('error', fail);
  child.on('exit', (code, signal) => {
    clearTimeout(timer); children.delete(child);
    if (code !== 0 || signal || result === undefined || errors !== '' || !['', 'SYNTHETIC_READ_BARRIER\n'].includes(output)) fail();
    else { resultResolve(result); if (!result.paused) barrierReject(new Error('Read stage was not observed')); }
  });
  return { child, ready, finished, barrier, go: command => child.send(command),
    release: () => {
      if (!released && !child.stdin.destroyed) { released = true; child.stdin.write(Buffer.from([1])); }
    } };
}

async function stopWorkers(workers) {
  for (const worker of workers) if (children.has(worker.child)) worker.child.kill('SIGKILL');
  await Promise.allSettled(workers.map(worker => worker.finished));
}

async function processRace(source, account, commands) {
  const workers = commands.map(() => startWorker());
  const blocker = source.createQueryRunner();
  try {
    const pids = await Promise.all(workers.map(worker => worker.ready));
    assert.equal(new Set(pids).size, commands.length);
    await blocker.connect(); await blocker.startTransaction();
    await blocker.query('SELECT id FROM manual_accounts WHERE id=$1 FOR UPDATE', [account]);
    workers.forEach((worker, index) => worker.go(commands[index]));
    const deadline = performance.now() + 5000;
    let observed = false;
    while (performance.now() < deadline) {
      const [{ waiting }] = await source.query(`SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname=$1 AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0
        AND position('manual_accounts' in query)>0`, [database]);
      if (waiting === workers.length) { observed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observed, 'Both real production processes reach a persisted account lock wait');
    await blocker.commitTransaction();
    return await Promise.all(workers.map(worker => worker.finished));
  } finally {
    try {
      try { if (blocker.isTransactionActive) await blocker.rollbackTransaction(); }
      finally { await blocker.release(); }
    } finally { await stopWorkers(workers); }
  }
}

async function races(source, accounting, trade, fixture) {
  stage = 'TRADE-001/004 real two-process initialization, opening and revision contention';
  const { owner, instruments: [instrument] } = fixture;
  for (const collision of [false, true]) {
    const account = await newAccount(accounting, owner, `Origin race ${collision}`);
    const input = origin();
    const commands = [{ service: 'trade', method: 'initialize', args: [owner, account, input] },
      collision ? { service: 'accounting', method: 'saveOpening', args: [owner, account, opening(instrument)] }
        : { service: 'trade', method: 'initialize', args: [owner, account, input] }];
    const result = await processRace(source, account, commands);
    if (collision) {
      assert.equal(result.filter(row => row.ok).length, 1);
      assert.equal(result.find(row => !row.ok).status, 409);
      const [{ journals, openings }] = await source.query(`SELECT
        (SELECT count(*)::int FROM account_trade_journals WHERE "accountId"=$1) AS journals,
        (SELECT count(*)::int FROM account_opening_snapshots WHERE "accountId"=$1) AS openings`, [account]);
      assert.equal(journals + openings, 1, 'No overlap between empty-origin journal and actual opening history');
    } else {
      assert.ok(result.every(row => row.ok));
      assert.deepEqual(result.map(row => row.result.created).sort(), [false, true]);
      assert.deepEqual(result[0].result.value, result[1].result.value);
    }
  }
  const account = await newJournal(accounting, trade, owner, 'CAS and identical-command race');
  const first = command(instrument, 0);
  const same = await processRace(source, account, [0, 1].map(() =>
    ({ service: 'trade', method: 'create', args: [owner, account, first] })));
  assert.ok(same.every(row => row.ok));
  assert.deepEqual(same.map(row => row.result.created).sort(), [false, true]);
  assert.deepEqual(same[0].result.value, same[1].result.value);
  const competing = [command(instrument, 1), command(instrument, 1, { grossUsd: '200' })];
  const outcomes = await processRace(source, account, competing.map(input =>
    ({ service: 'trade', method: 'create', args: [owner, account, input] })));
  assert.equal(outcomes.filter(row => row.ok).length, 1);
  assert.equal(outcomes.find(row => !row.ok).status, 409);
  const state = (await trade.getJournal(owner, account)).journal;
  assert.equal(state.journalRevision, 2); assert.equal(state.versionCount, 2); assert.equal(state.activeTradeCount, 2);
  const stored = await source.query('SELECT "requestId" FROM account_trade_versions WHERE "accountId"=$1', [account]);
  assert.equal(stored.length, 2);
  assert.ok(stored.some(row => row.requestId === first.requestId));
  assert.ok(stored.some(row => row.requestId === outcomes.find(row => row.ok).result.value.trade.requestId));

  // Both purchases remain financially valid and have distinct chronology. Only
  // the stale expected revision can reject the second command after the lock wait.
  stage = 'TRADE-004 distinct-chronology buys isolate the concurrent CAS boundary';
  const casAccount = await newJournal(accounting, trade, owner, 'Distinct-order CAS race');
  const buys = [command(instrument, 0, { orderWithinTimestamp: 0, grossUsd: '10' }),
    command(instrument, 0, { orderWithinTimestamp: 1, grossUsd: '20' })];
  const buyResults = await processRace(source, casAccount, buys.map(input =>
    ({ service: 'trade', method: 'create', args: [owner, casAccount, input] })));
  assert.equal(buyResults.filter(row => row.ok).length, 1);
  assert.equal(buyResults.find(row => !row.ok).status, 409);
  assert.equal(buyResults.find(row => row.ok).result.created, true);
  const rejectedBuy = buys[buyResults.findIndex(row => !row.ok)];
  const buyRows = await source.query('SELECT "requestId" FROM account_trade_versions WHERE "accountId"=$1', [casAccount]);
  assert.deepEqual(buyRows, [{ requestId: buyResults.find(row => row.ok).result.value.trade.requestId }]);
  const beforeBuyRetry = await fingerprint(source);
  await status(() => trade.create(owner, casAccount, rejectedBuy), 409);
  assert.equal(await fingerprint(source), beforeBuyRetry);
  assert.equal((await trade.create(owner, casAccount, { ...rejectedBuy, expectedJournalRevision: 1 })).created, true,
    'A rejected CAS request reserves no key and becomes legal after explicit revision refresh');
  const bought = (await trade.getJournal(owner, casAccount)).journal;
  assert.equal(bought.journalRevision, 2); assert.equal(bought.versionCount, 2); assert.equal(bought.activeTradeCount, 2);
  assert.equal(bought.summary.remainingCostUsd, '30');

  stage = 'TRADE-004 distinct-order competing sales cannot overspend one owned unit';
  const saleAccount = await newJournal(accounting, trade, owner, 'Competing sale race');
  const purchase = (await trade.create(owner, saleAccount, command(instrument, 0))).value;
  const sales = [1, 2].map(order => command(instrument, 1,
    { side: 'sell', orderWithinTimestamp: order, quantity: '0.75', grossUsd: '90' }));
  const saleResults = await processRace(source, saleAccount, sales.map(input =>
    ({ service: 'trade', method: 'create', args: [owner, saleAccount, input] })));
  assert.equal(saleResults.filter(row => row.ok).length, 1);
  assert.equal(saleResults.find(row => !row.ok).status, 409);
  const wonSale = saleResults.find(row => row.ok).result;
  assert.equal(wonSale.created, true);
  const rejectedSale = sales[saleResults.findIndex(row => !row.ok)];
  const sold = (await trade.getJournal(owner, saleAccount)).journal;
  assert.equal(sold.journalRevision, 2); assert.equal(sold.versionCount, 2); assert.equal(sold.activeTradeCount, 2);
  assert.deepEqual(sold.summary, { grossBuysUsd: '100', buyFeesUsd: '0', grossSalesUsd: '90',
    sellFeesUsd: '0', netSalesUsd: '90', consumedCostUsd: '75', realizedUsd: '15', remainingCostUsd: '25' });
  const remaining = (await trade.listLots(owner, saleAccount)).items;
  assert.equal(remaining.length, 1);
  assert.deepEqual([remaining[0].buyTradeId, remaining[0].remainingQuantity, remaining[0].remainingCostUsd],
    [purchase.trade.tradeId, '0.25', '25']);
  const saleRows = await source.query(`SELECT "requestId",side,quantity::text AS quantity,version
    FROM account_trade_versions WHERE "accountId"=$1 ORDER BY "journalRevision"`, [saleAccount]);
  assert.deepEqual(saleRows, [
    { requestId: purchase.trade.requestId, side: 'buy', quantity: '1.' + '0'.repeat(30), version: 1 },
    { requestId: wonSale.value.trade.requestId, side: 'sell', quantity: '0.75' + '0'.repeat(28), version: 1 },
  ]);
  assert.equal((await source.query('SELECT count(*)::int AS count FROM account_trades WHERE "accountId"=$1', [saleAccount]))[0].count, 2);
  assert.equal((await trade.listRealizations(owner, saleAccount)).items.length, 1);

  const beforeSaleRetry = await fingerprint(source);
  await status(() => trade.create(owner, saleAccount, rejectedSale), 409);
  await status(() => trade.create(owner, saleAccount, { ...rejectedSale, expectedJournalRevision: 2 }), 409);
  assert.equal(await fingerprint(source), beforeSaleRetry,
    'Both stale CAS and refreshed-but-oversold retries leave the losing key unreserved');
  // Replenish before either sale, so the original rejected execution becomes
  // valid irrespective of which order won. Its only changed field is the revision.
  await trade.create(owner, saleAccount, command(instrument, 2, { quantity: '0.5', grossUsd: '50',
    occurredAt: '2025-01-01T12:00:00.000Z', orderWithinTimestamp: 0 }));
  const refreshedSale = { ...rejectedSale, expectedJournalRevision: 3 };
  const recovered = await trade.create(owner, saleAccount, refreshedSale);
  assert.equal(recovered.created, true); assert.equal(recovered.value.journalRevision, 4);
  assert.equal(recovered.value.trade.requestId, rejectedSale.requestId);
  const completed = (await trade.getJournal(owner, saleAccount)).journal;
  assert.equal(completed.activeTradeCount, 4); assert.equal(completed.versionCount, 4);
  assert.deepEqual(completed.summary, { grossBuysUsd: '150', buyFeesUsd: '0', grossSalesUsd: '180',
    sellFeesUsd: '0', netSalesUsd: '180', consumedCostUsd: '150', realizedUsd: '30', remainingCostUsd: '0' });
  assert.deepEqual((await trade.listLots(owner, saleAccount)).items, []);
  const beforeSaleReplay = await fingerprint(source);
  assert.deepEqual(await trade.create(owner, saleAccount, refreshedSale), { created: false, value: recovered.value });
  assert.equal(await fingerprint(source), beforeSaleReplay);
  console.log('PASS TRADE-004 observed two-process waits, independent CAS, exact competing-sale conservation and rejected-key reuse; opening/init remains exclusive');
}

async function deferredCommitFailure(source, accounting, trade, fixture) {
  stage = 'TRADE-004 actual deferred COMMIT failure after all trade writes';
  const { owner, instruments: [instrument] } = fixture;
  const account = await newJournal(accounting, trade, owner, 'Deferred trade commit fixture');
  const input = command(instrument, 0, { quantity: '987654321.123456789', grossUsd: '876543210.987654321' });
  const marker = 'synthetic-trade-commit-private-marker';
  const before = await fingerprint(source);
  let installed = false;
  try {
    await source.query('CREATE SEQUENCE synthetic_trade_commit_attempt START 1'); installed = true;
    await source.query(`CREATE FUNCTION synthetic_trade_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."requestId"='${input.requestId}'::uuid THEN
          IF NOT EXISTS(SELECT 1 FROM account_trades WHERE "ownerId"=NEW."ownerId"
              AND "accountId"=NEW."accountId" AND id=NEW."tradeId" AND "currentVersion"=NEW.version)
            OR NOT EXISTS(SELECT 1 FROM account_trade_journals WHERE "ownerId"=NEW."ownerId"
              AND "accountId"=NEW."accountId" AND "currentRevision"=NEW."journalRevision") THEN
            RAISE EXCEPTION 'synthetic trade fixture missed complete writes';
          END IF;
          PERFORM nextval('synthetic_trade_commit_attempt');
          RAISE EXCEPTION '${marker}' USING DETAIL=NEW."canonicalPayload";
        END IF;
        RETURN NULL;
      END $$`);
    await source.query(`CREATE CONSTRAINT TRIGGER synthetic_trade_commit_failure AFTER INSERT ON account_trade_versions
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_trade_commit_failure()`);
    let failure;
    try { await trade.create(owner, account, input); } catch (error) { failure = error; }
    assert.equal(failure?.driverError?.code ?? failure?.code, 'P0001');
    assert.ok(String(failure.message).includes(marker));
    assert.deepEqual((await source.query('SELECT last_value::text AS value,is_called FROM synthetic_trade_commit_attempt'))[0],
      { value: '1', is_called: true }, 'Nontransactional marker proves every write reached exactly one deferred commit attempt');
    assert.equal(await fingerprint(source), before, 'Commit failure rolls back identity, immutable version, head, revision and key');
  } finally {
    if (installed) {
      await source.query('DROP TRIGGER IF EXISTS synthetic_trade_commit_failure ON account_trade_versions');
      await source.query('DROP FUNCTION IF EXISTS synthetic_trade_commit_failure()');
      await source.query('DROP SEQUENCE synthetic_trade_commit_attempt');
    }
  }
  const retry = await trade.create(owner, account, input);
  assert.equal(retry.created, true); assert.equal(retry.value.journalRevision, 1);
  assert.deepEqual(await trade.create(owner, account, input), { created: false, value: retry.value });
  console.log('PASS TRADE-004 true deferred COMMIT rollback, one nontransactional stage marker and explicit retry exactly once');
}

async function repeatableRead(source, accounting, trade, fixture) {
  stage = 'TRADE-004 observed reader scheduling barrier and real concurrent correction';
  const { owner, instruments: [instrument] } = fixture;
  const account = await newJournal(accounting, trade, owner, 'Coherent snapshot fixture');
  const input = command(instrument, 0);
  const first = (await trade.create(owner, account, input)).value;
  const sale = (await trade.create(owner, account, command(instrument, 1,
    { side: 'sell', quantity: '0.25', grossUsd: '50', orderWithinTimestamp: 10 }))).value;
  for (const method of ['getJournal', 'listTrades', 'listLots', 'listRealizations', 'listMatches']) {
    const target = method === 'listMatches' ? sale.trade.tradeId : undefined;
    const args = target ? [owner, account, target] : [owner, account];
    const before = await trade[method](...args);
    const currentRevision = (await trade.getJournal(owner, account)).journal.journalRevision;
    const historyBefore = await trade.listVersions(owner, account, first.trade.tradeId);
    const reader = startWorker();
    const writer = startWorker();
    try {
      const pids = await Promise.all([reader.ready, writer.ready]);
      assert.notEqual(pids[0], pids[1]);
      reader.go({ service: 'trade', method, args, readBarrier: true });
      await reader.barrier;
      writer.go({ service: 'trade', method: 'correct', args: [owner, account, first.trade.tradeId,
        { ...input, requestId: randomUUID(), expectedJournalRevision: currentRevision,
          grossUsd: String(200 + currentRevision) }] });
      const written = await writer.finished;
      assert.equal(written.ok, true); assert.equal(written.result.created, true);
      reader.release();
      const read = await reader.finished;
      assert.equal(read.ok, true); assert.equal(read.paused, true);
      assert.deepEqual(read.result, before, 'Every current response uses the old committed revision, heads, values and immutable labels');
      assert.ok(read.statements.some(sql => /REPEATABLE READ/i.test(sql)));
      assert.ok(read.statements.some(sql => /READ ONLY/i.test(sql)));
      const after = await trade[method](...args);
      const oldRevision = method === 'getJournal' ? before.journal.journalRevision : before.journalRevision;
      const newRevision = method === 'getJournal' ? after.journal.journalRevision : after.journalRevision;
      assert.equal(newRevision, oldRevision + 1);
      const historyAfter = await trade.listVersions(owner, account, first.trade.tradeId);
      assert.deepEqual(historyAfter.items.slice(1), historyBefore.items);
    } finally {
      try { reader.release(); }
      finally { await stopWorkers([reader, writer]); }
    }
  }
  console.log('PASS TRADE-004 observed real RR/read-only SQL and label-read barrier across actual committed service corrections; old response is coherent');
}

async function capacity(source, accounting, trade, fixture) {
  stage = 'TRADE-003 complete valid synthetic histories at active/version caps';
  const { owner, instruments: [instrument] } = fixture;
  const activeAccount = await newJournal(accounting, trade, owner, '1000 active trades fixture');
  const activeInput = command(instrument, 0, { grossUsd: '1' });
  const activeFirst = (await trade.create(owner, activeAccount, activeInput)).value;
  // These are fixture-only inserts in the newly created allowlisted database.
  // Every head has one actual immutable version, unique chronology and revision;
  // the next real service write recomputes the complete 1000-trade history.
  const activeRows = Array.from({ length: 999 }, (_, offset) => {
    const revision = offset + 2, tradeId = randomUUID(), requestId = randomUUID();
    const value = execution(instrument, revision - 1, { grossUsd: '1' });
    return { tradeId, requestId, revision, order: value.orderWithinTimestamp,
      canonicalPayload: JSON.stringify({ kind: 'create', expectedJournalRevision: revision - 1, ...value }) };
  });
  await source.transaction(async runner => {
    await runner.query(`INSERT INTO account_trades(id,"ownerId","accountId","currentVersion","createdAt")
      SELECT x."tradeId",$1,$2,1,$4::timestamptz
      FROM jsonb_to_recordset($3::jsonb) AS x("tradeId" uuid)`, [owner, activeAccount, JSON.stringify(activeRows), activeFirst.trade.createdAt]);
    await runner.query(`INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision","requestId",
      "canonicalPayload",kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
      SELECT $1,$2,x."tradeId",1,x.revision,x."requestId",x."canonicalPayload",'create',$4,'buy',
        '2025-01-02T00:00:00Z',x."order",1,1,0,$5::timestamptz
      FROM jsonb_to_recordset($3::jsonb) AS x("tradeId" uuid,"requestId" uuid,revision integer,"order" integer,"canonicalPayload" text)`,
    [owner, activeAccount, JSON.stringify(activeRows), instrument, activeFirst.trade.createdAt]);
    await runner.query('UPDATE account_trade_journals SET "currentRevision"=1000 WHERE "accountId"=$1', [activeAccount]);
  });
  let state = (await trade.getJournal(owner, activeAccount)).journal;
  assert.equal(state.activeTradeCount, 1000); assert.equal(state.versionCount, 1000); assert.equal(state.journalRevision, 1000);
  assert.equal(state.summary.remainingCostUsd, '1000');
  assert.equal((await trade.listLots(owner, activeAccount, { offset: '900', limit: '100', journalRevision: '1000' })).items.length, 100);
  let before = await fingerprint(source);
  const rejectedKey = command(instrument, 1000, { grossUsd: '1' });
  await status(() => trade.create(owner, activeAccount, rejectedKey), 409);
  assert.deepEqual(await trade.create(owner, activeAccount, activeInput), { created: false, value: activeFirst });
  assert.equal(await fingerprint(source), before);
  const correction = await trade.correct(owner, activeAccount, activeFirst.trade.tradeId,
    { ...activeInput, requestId: randomUUID(), expectedJournalRevision: 1000, grossUsd: '2' });
  assert.equal(correction.value.journalRevision, 1001);
  assert.equal((await trade.getJournal(owner, activeAccount)).journal.summary.remainingCostUsd, '1001');
  await trade.void(owner, activeAccount, activeFirst.trade.tradeId, { requestId: randomUUID(), expectedJournalRevision: 1001 });
  const next = await trade.create(owner, activeAccount, { ...rejectedKey, expectedJournalRevision: 1002 });
  assert.equal(next.created, true);
  state = (await trade.getJournal(owner, activeAccount)).journal;
  assert.equal(state.activeTradeCount, 1000); assert.equal(state.versionCount, 1003);
  assert.equal(state.summary.remainingCostUsd, '1000');

  const versionAccount = await newJournal(accounting, trade, owner, '10000 immutable versions fixture');
  const versionInput = command(instrument, 0, { grossUsd: '1' });
  const first = (await trade.create(owner, versionAccount, versionInput)).value;
  // One trade is repeatedly fully corrected, retaining the same valid execution.
  // The fixture stops at9999 so the real service commits the final legal version.
  const versionRows = Array.from({ length: 9998 }, (_, offset) => {
    const version = offset + 2, requestId = randomUUID();
    return { version, requestId, canonicalPayload: JSON.stringify({ kind: 'correct', tradeId: first.trade.tradeId,
      expectedJournalRevision: version - 1, ...execution(instrument, 0, { grossUsd: '1' }) }) };
  });
  await source.transaction(async runner => {
    await runner.query(`INSERT INTO account_trade_versions("ownerId","accountId","tradeId",version,"journalRevision","requestId",
      "canonicalPayload",kind,"instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
      SELECT $1,$2,$3,x.version,x.version,x."requestId",x."canonicalPayload",'correct',$5,'buy',
        '2025-01-02T00:00:00Z',0,1,1,0,$6::timestamptz
      FROM jsonb_to_recordset($4::jsonb) AS x(version integer,"requestId" uuid,"canonicalPayload" text)`,
    [owner, versionAccount, first.trade.tradeId, JSON.stringify(versionRows), instrument, first.trade.createdAt]);
    await runner.query('UPDATE account_trades SET "currentVersion"=9999 WHERE id=$1', [first.trade.tradeId]);
    await runner.query('UPDATE account_trade_journals SET "currentRevision"=9999 WHERE "accountId"=$1', [versionAccount]);
  });
  const lastInput = { ...versionInput, requestId: randomUUID(), expectedJournalRevision: 9999, grossUsd: '2' };
  const last = await trade.correct(owner, versionAccount, first.trade.tradeId, lastInput);
  assert.equal(last.created, true); assert.equal(last.value.trade.version, 10000); assert.equal(last.value.journalRevision, 10000);
  state = (await trade.getJournal(owner, versionAccount)).journal;
  assert.equal(state.activeTradeCount, 1); assert.equal(state.versionCount, 10000);
  assert.equal(state.summary.remainingCostUsd, '2');
  assert.deepEqual(state.limits, { activeTrades: 1000, versions: 10000 });
  before = await fingerprint(source);
  await status(() => trade.create(owner, versionAccount, command(instrument, 10000)), 409);
  await status(() => trade.correct(owner, versionAccount, first.trade.tradeId,
    { ...lastInput, requestId: randomUUID(), expectedJournalRevision: 10000 }), 409);
  await status(() => trade.void(owner, versionAccount, first.trade.tradeId,
    { requestId: randomUUID(), expectedJournalRevision: 10000 }), 409);
  assert.deepEqual(await trade.create(owner, versionAccount, versionInput), { created: false, value: first });
  assert.deepEqual(await trade.correct(owner, versionAccount, first.trade.tradeId, lastInput), { created: false, value: last.value });
  assert.equal(await fingerprint(source), before, 'Capacity rejection and old replays cannot mutate heads/versions or reserve keys');
  const newest = await trade.listVersions(owner, versionAccount, first.trade.tradeId, { limit: '20' });
  assert.equal(newest.items.length, 20); assert.equal(newest.items[0].version, 10000); assert.equal(newest.nextBeforeVersion, 9981);
  assert.deepEqual((await trade.listVersions(owner, versionAccount, first.trade.tradeId, { beforeVersion: '2' })).items, [first.trade]);
  console.log('PASS TRADE-003 valid 1000-active and 10000-version histories, final legal production recomputation, bounded pages and replay before caps');
}

async function main() {
  sentinel();
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0,
      'Refuse preexisting fixture databases; never reuse/drop any owner data');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(migrated.error, undefined); assert.equal(migrated.signal, null); assert.equal(migrated.status, 0);
  const source = productionSource(); await source.initialize();
  try {
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    const migrations = await source.query('SELECT name FROM migrations ORDER BY timestamp');
    assert.equal(migrations.length, 14); assert.equal(migrations[13].name, 'AddUsdTradeJournal1790040000000');
    for (const table of tradeTables) assert.deepEqual(await rows(source, table), []);
    const { accounting, trade } = services(source);
    const fixture = await seed(source, accounting);
    const legacy = await fingerprint(source, true);
    await originsAndOwnership(source, accounting, trade, fixture);
    const priorAccounting = new Map();
    for (const table of accountingTables) priorAccounting.set(table, await rows(source, table));
    const preservePrior = async () => {
      assert.equal(await fingerprint(source, true), legacy, 'Every prior financial/owner/admission/migration row remains exact');
      for (const [table, previous] of priorAccounting) {
        const current = new Set((await rows(source, table)).map(value => value.row));
        for (const value of previous) assert.ok(current.has(value.row), 'Every preexisting manual identity/opening row remains byte-exact');
      }
    };
    const retained = await fifoVectors(source, accounting, trade, fixture);
    await historyAndValidation(source, accounting, trade, fixture, retained);
    await fullCorrection(source, accounting, trade, fixture);
    await preservePrior();
    for (const run of [sqlConstraints, races, deferredCommitFailure, repeatableRead, capacity]) {
      if (run === sqlConstraints) await run(source, fixture);
      else await run(source, accounting, trade, fixture);
      await preservePrior();
    }
    console.log('PASS isolated USD trade production-service and PostgreSQL acceptance; prior financial and authentication rows preserved');
  } finally { await source.destroy(); }
}

const watchdog = setTimeout(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL bounded isolated trade fixture at stage: ${stage}`);
  process.exit(1);
}, 180000);
watchdog.unref();
(process.argv[2] === '--worker' ? workerMain() : main()).catch(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL isolated trade database acceptance at stage: ${stage} (private assertion details withheld)`);
  process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));
