'use strict';
// broker-connections (BROKER-CONNECT) against fresh synthetic PostgreSQL: a read-only T-Bank
// token is kept encrypted per broker account, never returned, replaced by a new one and removed
// with the connection. BROKER-SYNC: the account's T-Bank history is previewed and written into
// its empty records in one command, once. T-Bank itself is a stub; all data is synthetic.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
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
const database = 'capital_tracker_broker_connections_e2e';
const servicePath = '/app/backend/dist/brokers/broker-connections.service.js';
const MIGRATIONS = 68;
const token = 't.SyntheticToken000000000000000001';
const replacement = 't.SyntheticToken000000000000000002';
const brokerAccount = { id: '2000000001', name: 'Synthetic', open: true, access: 'read_only' };
let stage = 'synthetic configuration';

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: database }),
  ).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 2 } });
}
const rejected = (action, status) =>
  assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status,
  );
async function account(db, owner, assetClass) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO manual_accounts(id, "ownerId", "requestId", "canonicalPayload", name, "assetClass")
      VALUES ($1, $2, $3, 'synthetic', 'Synthetic broker', $4)`,
    [id, owner, randomUUID(), assetClass],
  );
  return id;
}

async function connection(db, service, owner, other) {
  stage = 'synthetic broker account connected, read back, replaced and disconnected';
  const broker = await account(db, owner, 'broker');
  const wallet = await account(db, owner, null);
  assert.deepEqual(await service.read(owner, broker), { connected: false });

  const accounts = await service.check(owner, broker, { token });
  assert.deepEqual(accounts, { accounts: [{ id: brokerAccount.id, name: 'Synthetic' }] });
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM broker_connections'))[0].n,
    0,
    'Checking a token stores nothing',
  );

  const shown = await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
  assert.equal(shown.connected, true);
  assert.equal(shown.provider, 'tbank');
  assert.equal(shown.tokenHint, '0001');
  assert.equal(shown.brokerAccountId, brokerAccount.id);
  assert.ok(!JSON.stringify(shown).includes(token), 'The token is never returned');
  const [stored] = await db.query(
    'SELECT credentials::text AS credentials FROM broker_connections WHERE "accountId" = $1',
    [broker],
  );
  assert.ok(!stored.credentials.includes(token), 'The token is stored encrypted');
  assert.deepEqual(await service.read(owner, broker), shown);

  const again = await service.connect(owner, broker, {
    token: replacement,
    brokerAccountId: brokerAccount.id,
  });
  assert.equal(again.tokenHint, '0002');
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM broker_connections'))[0].n,
    1,
    'A new token replaces the old one',
  );

  await rejected(() => service.read(other, broker), 404);
  await rejected(() => service.check(other, broker, { token }), 404);
  await rejected(() => service.connect(other, broker, { token, brokerAccountId: brokerAccount.id }), 404);
  await rejected(() => service.disconnect(other, broker), 404);
  await rejected(() => service.read(owner, wallet), 404);
  await rejected(
    () => service.connect(owner, wallet, { token, brokerAccountId: brokerAccount.id }),
    404,
  );
  await rejected(() => service.connect(owner, broker, { token, brokerAccountId: '9999999999' }), 422);

  await assert.rejects(
    db.query('DELETE FROM manual_accounts WHERE id = $1', [broker]),
    // PostgreSQL 18 reports RESTRICT as 23001, earlier versions as 23503.
    (error) => ['23001', '23503'].includes(error.code),
    'An account with a connection cannot be deleted',
  );
  await assert.rejects(
    db.query(`UPDATE broker_connections SET provider = 'other' WHERE "accountId" = $1`, [broker]),
    { code: '23514' },
  );
  await assert.rejects(
    db.query(`UPDATE broker_connections SET "tokenHint" = 'toolong' WHERE "accountId" = $1`, [broker]),
    { code: '23514' },
  );

  await service.disconnect(owner, broker);
  assert.deepEqual(await service.read(owner, broker), { connected: false });
  await service.disconnect(owner, broker);
  console.log('PASS BROKER-CONNECT');
}

async function removal(db, service, owner) {
  stage = 'removing an empty broker account scrubs its token';
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const broker = await account(db, owner, 'broker');
  await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
  assert.equal((await service.read(owner, broker)).connected, true);
  await new AccountingService(db).removeAccount(owner, broker);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM broker_connections WHERE "accountId" = $1', [broker]))[0].n,
    0,
    'The token goes with the account',
  );
  await rejected(() => service.read(owner, broker), 404);
  console.log('PASS BROKER-CONNECT-REMOVE');
}

async function heldPreview(db, service, imports, owner) {
  stage = 'the import preview counts an opening snapshot as held entries';
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const accounting = new AccountingService(db);
  const broker = await account(db, owner, 'broker');
  await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
  assert.equal((await imports.preview(owner, broker)).accountHasEntries, false);
  const instrument = (
    await accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Synthetic share' })
  ).value.id;
  const opening = await accounting.saveOpening(owner, broker, {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: '2025-01-01T00:00:00.000Z',
    positions: [{ instrumentId: instrument, quantity: '2', costStatus: 'known', totalCostUsd: '300' }],
  });
  assert.equal(opening.created, true);
  assert.equal(
    (await imports.preview(owner, broker)).accountHasEntries,
    true,
    'An opening snapshot is history the import would add to',
  );
  console.log('PASS BROKER-SYNC-PREVIEW-HELD');
  return instrument;
}

async function voidedTransferPreview(db, service, imports, owner, instrument) {
  stage = 'the import preview no longer counts a voided transfer';
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const { OwnedTransferService } = require('/app/backend/dist/accounting/owned-transfer.service.js');
  const sender = await account(db, owner, null);
  const broker = await account(db, owner, 'broker');
  await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
  await new TradeService(db).create(owner, sender, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    instrumentId: instrument,
    side: 'buy',
    occurredAt: '2025-01-02T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '1',
    grossUsd: '100',
    feeUsd: '0',
  });
  const transfers = new OwnedTransferService(db);
  const moved = await transfers.create(owner, {
    requestId: randomUUID(),
    fromAccountId: sender,
    toAccountId: broker,
    expectedFromJournalRevision: 1,
    expectedToJournalRevision: 0,
    assertInternal: true,
    instrumentId: instrument,
    occurredAt: '2025-01-03T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '0.5',
    feeInstrumentId: null,
    feeQuantity: '0',
  });
  assert.equal((await imports.preview(owner, broker)).accountHasEntries, true);
  await transfers.void(owner, moved.value.transfer.transferId, {
    requestId: randomUUID(),
    expectedVersion: 1,
    expectedFromJournalRevision: 2,
    expectedToJournalRevision: 1,
  });
  assert.equal(
    (await imports.preview(owner, broker)).accountHasEntries,
    false,
    'A voided transfer leaves nothing the import would add to',
  );
  console.log('PASS BROKER-SYNC-PREVIEW-VOIDED');
}

async function rewardRoomPreview(db, service, imports, owner, instrument) {
  stage = "the import preview counts the owner's rewards in other accounts";
  const { AssetRewardService } = require('/app/backend/dist/accounting/asset-reward.service.js');
  const broker = await account(db, owner, 'broker');
  const elsewhere = await account(db, owner, null);
  await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
  // 1000 synthetic dividends: exactly what one account's reward journal keeps.
  for (let index = 0; index < 1000; index += 1)
    history.push({
      id: String(700000000 + index),
      parentId: '',
      type: 'OPERATION_TYPE_DIVIDEND',
      state: 'executed',
      occurredAt: '2025-02-01T10:00:00Z',
      instrumentUid: '00000000-0000-4000-8000-000000000001',
      instrumentType: 'share',
      ticker: 'SYNTH',
      quantity: '0',
      payment: '1',
      paymentCurrency: 'rub',
      price: '',
      priceCurrency: '',
      commission: '',
      commissionCurrency: '',
      fills: [],
    });
  try {
    const before = await imports.preview(owner, broker);
    assert.deepEqual([before.rewards, before.fitsRewardLimit], [1000, true]);
    await new AssetRewardService(db).create(owner, elsewhere, {
      requestId: randomUUID(),
      expectedJournalRevision: 0,
      assertReward: true,
      instrumentId: instrument,
      category: 'staking',
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '2',
      acquisitionBasisUsd: '0',
      incomeValueUsd: '0',
    });
    assert.equal(
      (await imports.preview(owner, broker)).fitsRewardLimit,
      false,
      'One reward elsewhere leaves room for 999, not 1000',
    );
  } finally {
    history.length = 0;
  }
  console.log('PASS BROKER-SYNC-PREVIEW-REWARD-ROOM');
}

const shareUid = '10000000-0000-4000-8000-0000000000a1';
const otherUid = '10000000-0000-4000-8000-0000000000b2';
let history = [];
function operation(id, type, payment, over = {}) {
  return {
    id,
    parentId: '',
    type: `OPERATION_TYPE_${type}`,
    state: 'executed',
    occurredAt: '2024-03-01T07:00:00Z',
    instrumentUid: '',
    instrumentType: '',
    ticker: '',
    quantity: '0',
    payment,
    paymentCurrency: 'rub',
    price: '',
    priceCurrency: '',
    commission: '',
    commissionCurrency: '',
    fills: [],
    ...over,
  };
}
const share = (over) => ({ instrumentUid: shareUid, instrumentType: 'share', ticker: 'SYNTHA', ...over });

async function importing(db, service, imports, owner, other) {
  stage = 'BROKER-SYNC: a synthetic T-Bank history previewed and written into an empty account';
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const trades = new TradeService(db);
  await db.query(`INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit")
    SELECT c.currency,'cbr',d::date,c.rate FROM (VALUES ('USD',90),('EUR',100)) c(currency,rate)
    CROSS JOIN generate_series(date '2024-02-20', date '2024-03-31', interval '1 day') d`);
  const count = async (table, where = '') =>
    (await db.query(`SELECT count(*)::int AS n FROM ${table} ${where}`))[0].n;
  const broker = await account(db, owner, 'broker');
  await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
  history = [
    operation('100000001', 'INPUT', '10000'),
    operation('100000002', 'BUY', '-5000', share({
      occurredAt: '2024-03-01T08:00:00.123456789Z',
      quantity: '10',
      fills: [{ filledAt: '2024-03-01T08:00:01.5Z', quantity: '10', price: '500', priceCurrency: 'rub' }],
    })),
    operation('100000003', 'BROKER_FEE', '-15', { parentId: '100000002', occurredAt: '2024-03-01T08:00:00Z' }),
    operation('100000004', 'DIVIDEND', '90', share({ occurredAt: '2024-03-05T09:00:00Z', quantity: '0' })),
    operation('100000005', 'DIVIDEND_TAX', '-12', { occurredAt: '2024-03-05T09:00:00Z' }),
    operation('100000006', 'SELL', '2400', share({ occurredAt: '2024-03-10T10:00:00Z', quantity: '4' })),
    operation('100000007', 'BROKER_FEE', '-7', { parentId: '100000006', occurredAt: '2024-03-10T10:00:00Z' }),
    operation('100000008', 'OUTPUT', '-1000', { occurredAt: '2024-03-11T10:00:00Z' }),
    operation('100000009', 'BROKER_FEE', '0', { occurredAt: '2024-03-12T10:00:00Z' }),
    operation('100000010', 'BUY', '-1', share({ state: 'canceled', quantity: '1' })),
  ];
  const instrumentsBefore = await count('accounting_instruments');
  const preview = await imports.preview(owner, broker);
  assert.deepEqual(preview.problems, []);
  assert.equal(preview.accountHasEntries, false);
  assert.equal(preview.canImport, true);
  assert.match(preview.previewHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    preview.entries.map((entry) => [entry.record, entry.action, entry.amount, entry.fee]),
    [
      ['trade', 'deposit', '10000', '0'],
      ['trade', 'buy', '5000', '15'],
      ['reward', 'income', '90', '0'],
      ['trade', 'tax', '12', '0'],
      ['trade', 'sell', '2400', '7'],
      ['trade', 'withdrawal', '1000', '0'],
    ],
  );
  assert.deepEqual(preview.skipped.map((item) => [item.operationId, item.reason]), [['100000009', 'no-amount']]);
  assert.equal(await count('accounting_instruments'), instrumentsBefore, 'A preview creates nothing');
  assert.equal(await count('broker_imports'), 0);
  assert.equal(await count('account_trade_journals', `WHERE "accountId" = '${broker}'`), 0);

  const requestId = randomUUID();
  const first = await imports.import(owner, broker, { requestId, previewHash: preview.previewHash });
  assert.equal(first.created, true);
  assert.deepEqual(
    [first.value.trades, first.value.rewards, first.value.firstJournalRevision, first.value.lastJournalRevision],
    [5, 1, 1, 6],
  );
  const again = await imports.import(owner, broker, { requestId, previewHash: preview.previewHash });
  assert.deepEqual(again, { created: false, value: first.value }, 'A repeated request returns its receipt');
  await rejected(() => imports.import(owner, broker, { requestId, previewHash: 'f'.repeat(64) }), 409);
  await rejected(
    () => imports.import(owner, broker, { requestId: randomUUID(), previewHash: preview.previewHash }),
    409,
  );
  const after = await imports.preview(owner, broker);
  assert.deepEqual([after.accountHasEntries, after.canImport], [true, false]);

  const journal = await trades.getJournal(owner, broker);
  assert.deepEqual([journal.journal.journalRevision, journal.journal.activeTradeCount], [6, 5]);
  const [rub] = await db.query(
    `SELECT id FROM accounting_instruments WHERE "ownerId" = $1 AND "assetType" = 'fiat' AND symbol = 'RUB'`,
    [owner],
  );
  const [linked] = await db.query(
    `SELECT i.id, i.name, i.symbol, i."assetType", i."valuationCurrency", i."priceSource"
      FROM broker_instrument_links l JOIN accounting_instruments i ON i.id = l."instrumentId"
      WHERE l."ownerId" = $1 AND l."providerInstrumentId" = $2`,
    [owner, shareUid],
  );
  assert.deepEqual(
    [linked.name, linked.symbol, linked.assetType, linked.valuationCurrency, linked.priceSource],
    ['SYNTHA', 'SYNTHA', 'manual', 'RUB', 'manual'],
  );
  const at = '2024-04-01T00:00:00.000Z';
  // 10000 in, 5015 on the buy, 90 dividend, 12 tax, 2393 kept from the sale, 1000 out.
  assert.equal((await trades.available(owner, broker, { instrumentId: rub.id, at })).quantity, '6456');
  assert.equal((await trades.available(owner, broker, { instrumentId: linked.id, at })).quantity, '6');
  const [buy] = await db.query(
    `SELECT v."occurredAt", p.gross, p.fee, p."rateSource", s.quantity AS settled
      FROM account_trade_versions v
      JOIN account_trade_version_payments p USING ("ownerId", "accountId", "tradeId", version)
      JOIN account_trade_version_settlements s USING ("ownerId", "accountId", "tradeId", version)
      WHERE v."accountId" = $1 AND v."instrumentId" = $2 AND v.side = 'buy'`,
    [broker, linked.id],
  );
  assert.equal(buy.occurredAt.toISOString(), '2024-03-01T08:00:01.500Z', 'Dated by its last fill');
  const plain = (value) => value.replace(/\.?0+$/, '');
  assert.deepEqual(
    [plain(buy.gross), plain(buy.fee), buy.rateSource, plain(buy.settled)],
    ['5000', '15', 'bank-of-russia', '5015'],
  );
  assert.equal(
    await count('account_trade_version_purposes', `WHERE "accountId" = '${broker}' AND purpose = 'fee'`),
    1,
    'The dividend tax lowers the return only',
  );
  const [dividend] = await db.query(
    `SELECT quantity, category, "incomeValueUsd" FROM account_reward_versions WHERE "accountId" = $1`,
    [broker],
  );
  assert.deepEqual(
    [plain(dividend.quantity), dividend.category, plain(dividend.incomeValueUsd)],
    ['90', 'other', '1'],
  );
  const firstHistory = history;
  const recorded = await db.query(
    `SELECT "operationId", "tradeId" IS NOT NULL AS trade FROM broker_imported_operations
      WHERE "accountId" = $1 ORDER BY "operationId"`,
    [broker],
  );
  assert.deepEqual(
    recorded.map((row) => [row.operationId, row.trade]),
    [
      ['100000001', true],
      ['100000002', true],
      ['100000003', true],
      ['100000004', false],
      ['100000005', true],
      ['100000006', true],
      ['100000007', true],
      ['100000008', true],
    ],
  );
  await rejected(() => imports.preview(other, broker), 404);
  console.log('PASS BROKER-SYNC-IMPORT');

  stage = 'BROKER-SYNC: a second account reuses the linked instrument';
  const second = await account(db, owner, 'broker');
  await service.connect(owner, second, { token, brokerAccountId: brokerAccount.id });
  history = [
    operation('200000001', 'INPUT', '1000'),
    operation('200000002', 'BUY', '-500', share({ occurredAt: '2024-03-02T08:00:00Z', quantity: '1' })),
  ];
  const reused = await imports.preview(owner, second);
  await imports.import(owner, second, { requestId: randomUUID(), previewHash: reused.previewHash });
  assert.equal(await count('broker_instrument_links'), 1);
  assert.equal(await count('accounting_instruments', `WHERE symbol = 'SYNTHA'`), 1);
  console.log('PASS BROKER-SYNC-REUSE');

  stage = 'BROKER-SYNC: a history that cannot be written is refused whole';
  const third = await account(db, owner, 'broker');
  await service.connect(owner, third, { token, brokerAccountId: brokerAccount.id });
  history = [
    operation('300000001', 'INPUT', '100', { occurredAt: '2020-01-01T10:00:00Z' }),
    operation('300000002', 'SELL', '100', {
      occurredAt: '2024-03-03T10:00:00Z',
      instrumentUid: otherUid,
      instrumentType: 'share',
      ticker: 'SYNTHB',
      quantity: '1',
    }),
    operation('300000003', 'SOMETHING_NEW', '-1', { occurredAt: '2024-03-04T10:00:00Z' }),
  ];
  const refused = await imports.preview(owner, third);
  assert.equal(refused.canImport, false);
  assert.deepEqual(
    refused.problems.map((problem) => [problem.reason, problem.ticker, problem.operationIds]),
    [
      // The sale of SYNTHB units the history never shows held is left out by the plan itself.
      ['not-recordable', '', ['300000003', '300000002']],
      ['no-rate', '', ['300000001']],
    ],
  );
  const instruments = await count('accounting_instruments');
  await rejected(
    () => imports.import(owner, third, { requestId: randomUUID(), previewHash: refused.previewHash }),
    409,
  );
  assert.equal(await count('accounting_instruments'), instruments, 'A refused import writes nothing');
  assert.equal(await count('broker_imports', `WHERE "accountId" = '${third}'`), 0);
  console.log('PASS BROKER-SYNC-REFUSED');

  stage = 'BROKER-SYNC: one T-Bank account is never written twice, into any account';
  const fourth = await account(db, owner, 'broker');
  await service.connect(owner, fourth, { token, brokerAccountId: brokerAccount.id });
  history = firstHistory;
  const twice = await imports.preview(owner, fourth);
  assert.equal(twice.accountHasEntries, false);
  assert.equal(twice.canImport, false);
  assert.deepEqual(
    twice.problems.map((problem) => [problem.reason, problem.operationIds.length]),
    [['already-imported', 8]],
  );
  await rejected(
    () => imports.import(owner, fourth, { requestId: randomUUID(), previewHash: twice.previewHash }),
    409,
  );
  assert.equal(await count('broker_imports', `WHERE "accountId" = '${fourth}'`), 0);
  console.log('PASS BROKER-SYNC-ONCE');

  await assert.rejects(
    db.query('DELETE FROM manual_accounts WHERE id = $1', [broker]),
    (error) => ['23001', '23503'].includes(error.code),
    'An account with an import cannot be deleted',
  );
  await assert.rejects(
    db.query(`UPDATE broker_imported_operations SET "tradeId" = NULL WHERE "accountId" = $1`, [broker]),
    { code: '23514' },
  );

  stage = 'BROKER-SYNC-FX: dollars bought on the exchange are cash, gold an asset, a split order two entries';
  const fifth = await account(db, owner, 'broker');
  await service.connect(owner, fifth, { token, brokerAccountId: brokerAccount.id });
  const dollarsUid = '10000000-0000-4000-8000-0000000000d1';
  const goldUid = '10000000-0000-4000-8000-0000000000f1';
  const fx = (ticker, uid, over) => ({ instrumentUid: uid, instrumentType: 'currency', ticker, ...over });
  history = [
    operation('500000001', 'INPUT', '100000'),
    operation('500000002', 'BUY', '-90000', fx('USD000UTSTOM', dollarsUid, {
      occurredAt: '2024-03-02T08:00:00Z',
      quantity: '1000',
    })),
    operation('500000003', 'BROKER_FEE', '-45', { parentId: '500000002', occurredAt: '2024-03-02T08:00:00Z' }),
    operation('500000004', 'BUY', '-600', share({
      occurredAt: '2024-03-03T08:00:00Z',
      quantity: '2',
      paymentCurrency: 'usd',
      fills: [
        { filledAt: '2024-03-03T08:00:01Z', quantity: '1', price: '300', priceCurrency: 'usd' },
        { filledAt: '2024-03-04T08:00:01Z', quantity: '1', price: '300', priceCurrency: 'usd' },
      ],
    })),
    operation('500000005', 'SELL', '27000', fx('USD000UTSTOM', dollarsUid, {
      occurredAt: '2024-03-05T08:00:00Z',
      quantity: '300',
    })),
    operation('500000006', 'BUY', '-7000', fx('GLDRUB_TOM', goldUid, {
      occurredAt: '2024-03-06T08:00:00Z',
      quantity: '1',
    })),
  ];
  const exchanged = await imports.preview(owner, fifth);
  assert.deepEqual([exchanged.problems, exchanged.skipped], [[], []]);
  assert.deepEqual(
    exchanged.entries.map((entry) => [entry.action, entry.cash ?? '', entry.quantity, entry.operationIds]),
    [
      ['deposit', '', '100000', ['500000001']],
      ['buy', 'usd', '1000', ['500000002', '500000003']],
      ['buy', '', '1', ['500000004']],
      ['buy', '', '1', ['500000004#2']],
      ['sell', 'usd', '300', ['500000005']],
      ['buy', '', '1', ['500000006']],
    ],
  );
  await imports.import(owner, fifth, { requestId: randomUUID(), previewHash: exchanged.previewHash });
  const [usd] = await db.query(
    `SELECT id FROM accounting_instruments WHERE "ownerId" = $1 AND "assetType" = 'fiat' AND symbol = 'USD'`,
    [owner],
  );
  // 100000 in, 90045 for the dollars, 27000 back for 300 of them, 7000 on gold.
  assert.equal((await trades.available(owner, fifth, { instrumentId: rub.id, at })).quantity, '29955');
  // 1000 bought, 600 spent on the share in two parts, 300 sold.
  assert.equal((await trades.available(owner, fifth, { instrumentId: usd.id, at })).quantity, '100');
  const [goldAsset] = await db.query(
    `SELECT i.symbol, i."assetType", i."valuationCurrency" FROM broker_instrument_links l
      JOIN accounting_instruments i ON i.id = l."instrumentId"
      WHERE l."ownerId" = $1 AND l."providerInstrumentId" = $2`,
    [owner, goldUid],
  );
  assert.deepEqual(
    [goldAsset.symbol, goldAsset.assetType, goldAsset.valuationCurrency],
    ['GLDRUB_TOM', 'manual', 'RUB'],
  );
  assert.equal(await count('broker_instrument_links', `WHERE "providerInstrumentId" = '${dollarsUid}'`), 0);
  assert.deepEqual(
    (
      await db.query(
        `SELECT "operationId" FROM broker_imported_operations WHERE "accountId" = $1 ORDER BY "operationId"`,
        [fifth],
      )
    ).map((row) => row.operationId),
    ['500000001', '500000002', '500000003', '500000004', '500000004#2', '500000005', '500000006'],
  );
  console.log('PASS BROKER-SYNC-FX');

  stage = 'BROKER-SYNC-HASH: a rate stored after the preview does not let its hash write the history';
  const sixth = await account(db, owner, 'broker');
  await service.connect(owner, sixth, { token, brokerAccountId: brokerAccount.id });
  history = [operation('600000001', 'INPUT', '100', { occurredAt: '2019-12-20T10:00:00Z' })];
  const unrated = await imports.preview(owner, sixth);
  assert.deepEqual(unrated.problems.map((problem) => problem.reason), ['no-rate']);
  await db.query(`INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit")
    VALUES ('USD','cbr','2019-12-20',62),('EUR','cbr','2019-12-20',69)`);
  await rejected(
    () => imports.import(owner, sixth, { requestId: randomUUID(), previewHash: unrated.previewHash }),
    409,
  );
  assert.equal(await count('broker_imports', `WHERE "accountId" = '${sixth}'`), 0);
  const rated = await imports.preview(owner, sixth);
  assert.equal(rated.canImport, true);
  assert.notEqual(rated.previewHash, unrated.previewHash);
  console.log('PASS BROKER-SYNC-HASH');

  stage = 'BROKER-SYNC-REWARD-CAP: a history with more rewards than the journal keeps is previewed, not failed';
  const seventh = await account(db, owner, 'broker');
  await service.connect(owner, seventh, { token, brokerAccountId: brokerAccount.id });
  history = Array.from({ length: 1001 }, (_, index) =>
    operation(`7${String(index).padStart(8, '0')}`, 'DIVIDEND', '1', share({
      occurredAt: `2024-03-${String(1 + (index % 28)).padStart(2, '0')}T09:00:00Z`,
      quantity: '0',
    })),
  );
  const crowded = await imports.preview(owner, seventh);
  assert.equal(crowded.fitsRewardLimit, false);
  assert.equal(crowded.canImport, false);
  assert.deepEqual(crowded.problems.map((problem) => problem.reason), ['too-many-rewards']);
  console.log('PASS BROKER-SYNC-REWARD-CAP');
}

async function main() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact isolated settings required');
  assert.ok(
    require('node:fs').existsSync(servicePath),
    'Missing implementation is prerequisite failure, not RED',
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
      'Never reuse or drop an existing database',
    );
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend',
    env: { ...settings, ...process.env, DB_NAME: database },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(migrated.status, 0, 'Actual schema migration');
  assert.match(migrated.stdout, new RegExp(`Migrations applied: ${MIGRATIONS}`));
  const directory = mkdtempSync(join(tmpdir(), 'capital-broker-connections-'));
  const db = source();
  try {
    writeFileSync(join(directory, 'key'), randomBytes(32), { mode: 0o600 });
    await db.initialize();
    const [owner, other] = await db.query(`INSERT INTO users(email,password) VALUES
      ('broker-owner@example.invalid','synthetic-not-a-hash'),
      ('broker-other@example.invalid','synthetic-not-a-hash') RETURNING id`);
    const { BrokerConnectionsService } = require(servicePath);
    const { TBankTokenBox } = require('/app/backend/dist/brokers/tbank-token-box.js');
    const box = new TBankTokenBox(
      new ConfigService({ MFA_KEY_FILE: join(directory, 'key'), MFA_KEY_ID: 'probe-key' }),
    );
    const tbank = {
      accounts: async () => ({ ok: true, value: [brokerAccount] }),
      operations: async () => ({ ok: true, value: history }),
    };
    const service = new BrokerConnectionsService(db, tbank, box);
    await connection(db, service, owner.id, other.id);
    await removal(db, service, owner.id);
    const { BrokerImportService } = require('/app/backend/dist/brokers/broker-import.service.js');
    const imports = new BrokerImportService(db, service);
    const instrument = await heldPreview(db, service, imports, owner.id);
    await voidedTransferPreview(db, service, imports, owner.id, instrument);
    await rewardRoomPreview(db, service, imports, owner.id, instrument);
    await importing(db, service, imports, owner.id, other.id);
  } finally {
    if (db.isInitialized) await db.destroy();
    rmSync(directory, { recursive: true, force: true });
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
