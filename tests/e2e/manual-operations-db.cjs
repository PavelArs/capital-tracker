'use strict';
// M9 simplify manual operations against fresh synthetic PostgreSQL: the production compiled
// trade service starts journals itself, orders same-day trades, keeps comments with each
// version, reports what an account can sell and refuses a deletion a later sale depends on.
// All data is synthetic.
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
const database = 'capital_tracker_manual_operations_e2e';
const modulePath = '/app/backend/dist/accounting/available-quantity.js';
const now = new Date();
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
    operations: make('operation-list.service', 'OperationListService'),
    transfers: make('owned-transfer.service', 'OwnedTransferService'),
    rewards: make('asset-reward.service', 'AssetRewardService'),
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
const rejected = (action, status, check = () => true) =>
  assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status && check(error.getResponse?.()),
  );
async function instrument(s, owner, name, symbol) {
  return (
    await s.accounting.createInstrument(owner, {
      requestId: randomUUID(),
      name,
      symbol,
      assetType: 'crypto',
    })
  ).value.id;
}
async function account(s, owner, name) {
  return (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
}
const revision = async (s, owner, id) =>
  (await s.trades.getJournal(owner, id)).journal?.journalRevision ?? 0;
async function trade(s, owner, accountId, fields) {
  const saved = await s.trades.create(owner, accountId, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, accountId),
    feeUsd: '0',
    ...fields,
  });
  assert.equal(saved.created, true);
  return saved.value.trade;
}
const day = (date) => `${date}T00:00:00.000Z`;
const listed = async (s, owner) =>
  (await s.operations.read(owner, {}, now)).operations.filter(({ kind }) => kind === 'trade');

async function addWithoutJournal(db, s, f) {
  stage = 'OPS-ADD-BUY the first trade starts the journal of an account';
  const { owner, btc } = f;
  const bybit = await account(s, owner, 'Bybit');
  assert.equal((await s.trades.getJournal(owner, bybit)).journal, null);
  const first = await trade(s, owner, bybit, {
    instrumentId: btc,
    side: 'buy',
    occurredAt: day('2025-06-13'),
    quantity: '0.00918359',
    grossUsd: '1000',
    expectedJournalRevision: 0,
  });
  assert.equal(first.orderWithinTimestamp, 0);
  assert.equal(first.journalRevision, 1);
  const state = await s.trades.getJournal(owner, bybit);
  assert.equal(state.journal.originKind, 'declared-empty');
  assert.equal(state.journal.coverageFrom, '1970-01-01T00:00:00.000Z');
  assert.equal(state.journal.journalRevision, 1);
  assert.equal(state.journal.summary.grossBuysUsd, '1000');
  assert.equal(state.journal.summary.remainingCostUsd, '1000');

  // An account opened with balances still needs its carry-in first; nothing is written.
  const opened = await account(s, owner, 'Opened with balances');
  await s.accounting.saveOpening(owner, opened, {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: day('2025-01-01'),
    positions: [{ instrumentId: btc, quantity: '1', costStatus: 'known', totalCostUsd: '100' }],
  });
  const before = await fingerprint(db);
  await rejected(
    () =>
      s.trades.create(owner, opened, {
        requestId: randomUUID(),
        expectedJournalRevision: 0,
        instrumentId: btc,
        side: 'buy',
        occurredAt: day('2025-06-13'),
        quantity: '1',
        grossUsd: '100',
        feeUsd: '0',
      }),
    409,
  );
  // A stale revision on an account that has a journal is still refused.
  await rejected(
    () =>
      s.trades.create(owner, bybit, {
        requestId: randomUUID(),
        expectedJournalRevision: 0,
        instrumentId: btc,
        side: 'buy',
        occurredAt: day('2025-06-13'),
        quantity: '1',
        grossUsd: '100',
        feeUsd: '0',
      }),
    409,
  );
  assert.equal(await fingerprint(db), before);
  f.bybit = bybit;
  f.first = first;
  console.log('PASS OPS-ADD-BUY first trade starts the journal; opened accounts still refused');
}

async function sameDay(db, s, f) {
  stage = 'OPS-SAME-DAY and OPS-COMMENT';
  const { owner, btc, bybit, first } = f;
  const second = await trade(s, owner, bybit, {
    instrumentId: btc,
    side: 'buy',
    occurredAt: day('2025-06-13'),
    quantity: '0.01',
    grossUsd: '1050',
    comment: '  Second buy that day \n',
  });
  assert.equal(second.orderWithinTimestamp, 1);
  assert.equal(second.comment, 'Second buy that day');
  const lots = await s.trades.listLots(owner, bybit);
  assert.deepEqual(
    lots.items.map(({ buyTradeId, orderWithinTimestamp }) => [buyTradeId, orderWithinTimestamp]),
    [
      [first.tradeId, 0],
      [second.tradeId, 1],
    ],
  );
  const rows = await listed(s, owner);
  assert.deepEqual(
    rows.map(({ id, orderWithinTimestamp, comment }) => [id, orderWithinTimestamp, comment]),
    [
      [`trade:${second.tradeId}`, 1, 'Second buy that day'],
      [`trade:${first.tradeId}`, 0, null],
    ],
  );
  const before = await fingerprint(db);
  await rejected(
    () =>
      s.trades.create(owner, bybit, {
        requestId: randomUUID(),
        expectedJournalRevision: 2,
        instrumentId: btc,
        side: 'buy',
        occurredAt: day('2025-06-14'),
        quantity: '1',
        grossUsd: '1',
        feeUsd: '0',
        comment: 'x'.repeat(501),
      }),
    400,
  );
  assert.equal(await fingerprint(db), before);
  f.second = second;
  console.log('PASS OPS-SAME-DAY automatic order in entry order; OPS-COMMENT stored per version');
}

async function edit(db, s, f) {
  stage = 'OPS-EDIT a correction keeps the original in history';
  const { owner, btc, bybit, first } = f;
  const corrected = await s.trades.correct(owner, bybit, first.tradeId, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, bybit),
    instrumentId: btc,
    side: 'buy',
    occurredAt: first.occurredAt,
    orderWithinTimestamp: first.orderWithinTimestamp,
    quantity: first.quantity,
    grossUsd: '1010',
    feeUsd: '0',
    comment: 'Corrected amount',
  });
  assert.equal(corrected.value.trade.version, 2);
  assert.equal(corrected.value.trade.orderWithinTimestamp, 0);
  const state = await s.trades.getJournal(owner, bybit);
  assert.equal(state.journal.summary.grossBuysUsd, '2060');
  const versions = await s.trades.listVersions(owner, bybit, first.tradeId);
  assert.deepEqual(
    versions.items.map(({ version, kind, grossUsd, comment }) => [
      version,
      kind,
      grossUsd,
      comment,
    ]),
    [
      [2, 'correct', '1010', 'Corrected amount'],
      [1, 'create', '1000', undefined],
    ],
  );
  console.log('PASS OPS-EDIT cost follows the correction and history keeps both versions');
}

async function overspend(db, s, f) {
  stage = 'OPS-OVERSPEND what an account can sell on a date';
  const { owner, other, btc, eth } = f;
  const trust = await account(s, owner, 'Trust Wallet');
  const buy = await trade(s, owner, trust, {
    instrumentId: btc,
    side: 'buy',
    occurredAt: day('2025-03-01'),
    quantity: '1',
    grossUsd: '80000',
    expectedJournalRevision: 0,
  });
  const sale = await trade(s, owner, trust, {
    instrumentId: btc,
    side: 'sell',
    occurredAt: day('2025-05-01'),
    quantity: '0.8',
    grossUsd: '76000',
  });
  const available = (at, extra = {}) =>
    s.trades.available(owner, trust, { instrumentId: btc, at: day(at), ...extra });
  assert.deepEqual(await available('2025-04-01'), {
    accountId: trust,
    instrumentId: btc,
    at: day('2025-04-01'),
    journalRevision: 2,
    quantity: '0.2',
  });
  assert.equal((await available('2025-02-01')).quantity, '0');
  assert.equal((await available('2025-06-01')).quantity, '0.2');
  assert.equal((await available('2025-05-01', { excludeTradeId: sale.tradeId })).quantity, '1');
  assert.equal(
    (await s.trades.available(owner, trust, { instrumentId: eth, at: day('2025-04-01') })).quantity,
    '0',
  );
  const empty = await account(s, owner, 'Empty');
  assert.equal(
    (await s.trades.available(owner, empty, { instrumentId: btc, at: day('2025-04-01') })).quantity,
    '0',
  );
  await rejected(
    () => s.trades.available(other, trust, { instrumentId: btc, at: day('2025-04-01') }),
    404,
  );
  await rejected(() => s.trades.available(owner, trust, { instrumentId: btc }), 400);

  const sell = (quantity) => ({
    requestId: randomUUID(),
    expectedJournalRevision: 2,
    instrumentId: btc,
    side: 'sell',
    occurredAt: day('2025-04-01'),
    quantity,
    grossUsd: '1',
    feeUsd: '0',
  });
  const before = await fingerprint(db);
  await rejected(
    () => s.trades.create(owner, trust, sell('0.3')),
    409,
    (body) => body?.dependent?.operationId === `trade:${sale.tradeId}`,
  );
  assert.equal(await fingerprint(db), before);
  const fits = await s.trades.create(owner, trust, sell('0.2'));
  assert.equal(fits.created, true);
  assert.equal((await available('2025-04-01')).quantity, '0');
  f.trust = trust;
  f.buy = buy;
  f.sale = sale;
  f.fits = fits.value.trade;
  console.log('PASS OPS-OVERSPEND available is the lowest balance from the date; more is refused');
}

async function remove(db, s, f) {
  stage = 'OPS-DELETE-GUARD and OPS-DELETE';
  const { owner, trust, buy, sale, fits } = f;
  const voidTrade = async (tradeId) =>
    s.trades.void(owner, trust, tradeId, {
      requestId: randomUUID(),
      expectedJournalRevision: await revision(s, owner, trust),
    });
  const before = await fingerprint(db);
  await rejected(
    () => voidTrade(buy.tradeId),
    409,
    (body) =>
      body?.message === 'A later operation depends on this trade' &&
      body.dependent.operationId === `trade:${fits.tradeId}` &&
      body.dependent.accountId === trust &&
      body.dependent.occurredAt === day('2025-04-01'),
  );
  assert.equal(await fingerprint(db), before, 'A refused deletion changes nothing');
  // The HTTP body the browser reads comes from the global filter, which must keep `dependent`.
  const refusal = await voidTrade(buy.tradeId).then(
    () => assert.fail('The deletion was not refused'),
    (error) => error,
  );
  const {
    GlobalExceptionFilter,
  } = require('/app/backend/dist/shared/filters/global-exception.filter.js');
  let body;
  new GlobalExceptionFilter({ setContext() {}, warn() {}, error() {} }).catch(refusal, {
    switchToHttp: () => ({
      getResponse: () => ({
        status() {
          return this;
        },
        json(value) {
          body = value;
        },
      }),
      getRequest: () => ({ method: 'POST', url: '/api/accounting/void', ip: '192.0.2.1' }),
    }),
  });
  assert.equal(body.statusCode, 409);
  assert.equal(body.dependent?.operationId, `trade:${fits.tradeId}`);
  assert.equal(await fingerprint(db), before);

  for (const later of [fits, sale]) assert.equal((await voidTrade(later.tradeId)).created, true);
  const deleted = await voidTrade(buy.tradeId);
  assert.equal(deleted.value.trade.kind, 'void');
  const versions = await s.trades.listVersions(owner, trust, buy.tradeId);
  assert.deepEqual(
    versions.items.map(({ version, kind }) => [version, kind]),
    [
      [2, 'void'],
      [1, 'create'],
    ],
  );
  const state = await s.trades.getJournal(owner, trust);
  assert.equal(state.journal.activeTradeCount, 0);
  assert.equal(state.journal.summary.remainingCostUsd, '0');
  const rows = await listed(s, owner);
  for (const gone of [buy, sale, fits])
    assert.ok(
      !rows.some(({ id }) => id === `trade:${gone.tradeId}`),
      'Deleted trade left the list',
    );
  console.log(
    'PASS OPS-DELETE-GUARD names the dependent sale; OPS-DELETE keeps the void in history',
  );
}

async function cash(db, s, f) {
  stage = 'OPS-SELL-CASH and OPS-BUY-CASH proceeds stay as cash and a buy spends it first';
  const { cashOwner: owner } = f;
  const btc = await instrument(s, owner, 'Bitcoin', 'BTC');
  const exchange = await account(s, owner, 'Exchange');
  const flows = () =>
    db.transaction('REPEATABLE READ', async (manager) => {
      const {
        readValuationInputs,
      } = require('/app/backend/dist/accounting/portfolio-valuation.service.js');
      const { capitalFlows } = require('/app/backend/dist/portfolio-snapshots/capital-flows.js');
      return capitalFlows(await readValuationInputs(manager, owner)).map((flow) => [
        new Date(flow.at).toISOString(),
        String(flow.usd / 10n ** 30n),
      ]);
    });
  const usdtRows = () =>
    db.query(
      `SELECT id,"assetType","priceSource" FROM accounting_instruments
        WHERE "ownerId"=$1 AND upper(symbol)='USDT'`,
      [owner],
    );
  const lots = async () =>
    (await s.trades.listLots(owner, exchange, {})).items.map((lot) => [
      lot.instrumentSymbol,
      lot.remainingQuantity,
      lot.remainingCostUsd,
    ]);
  await trade(s, owner, exchange, {
    instrumentId: btc,
    side: 'buy',
    occurredAt: day('2026-03-01'),
    quantity: '0.5',
    grossUsd: '25000',
    expectedJournalRevision: 0,
  });
  assert.deepEqual(await usdtRows(), [], 'No cash asset before a sale needs one');

  // OPS-SELL-CASH: 0.5 BTC bought for 25000 USD sold for 30000 USDT with fee 0.
  const saleRequest = {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, exchange),
    instrumentId: btc,
    side: 'sell',
    occurredAt: day('2026-04-01'),
    quantity: '0.5',
    grossUsd: '30000',
    feeUsd: '0',
    settlementCurrency: 'USDT',
  };
  const sold = await s.trades.create(owner, exchange, saleRequest);
  assert.equal(sold.created, true);
  const [usdt] = await usdtRows();
  assert.deepEqual(
    { assetType: usdt.assetType, priceSource: usdt.priceSource },
    { assetType: 'crypto', priceSource: 'market' },
    'The sale created the USDT cash asset, priced by the market',
  );
  assert.deepEqual(sold.value.trade.settlement, {
    instrumentId: usdt.id,
    instrumentName: 'Tether',
    instrumentSymbol: 'USDT',
    quantity: '30000',
  });
  const replay = await s.trades.create(owner, exchange, saleRequest);
  assert.equal(replay.created, false);
  assert.equal((await usdtRows()).length, 1, 'A replay creates no second cash asset');
  let state = await s.trades.getJournal(owner, exchange);
  assert.equal(state.journal.summary.realizedUsd, '5000');
  assert.deepEqual(await lots(), [['USDT', '30000', '30000']]);
  assert.equal(
    (await s.trades.available(owner, exchange, { instrumentId: usdt.id, at: day('2026-04-02') }))
      .quantity,
    '30000',
  );
  assert.deepEqual(
    await flows(),
    [['2026-03-01T00:00:00.000Z', '25000']],
    'Net flow of the sale is 0',
  );
  const sale = (await listed(s, owner)).find(({ type }) => type === 'sell');
  assert.deepEqual(sale.settlement, {
    asset: { instrumentId: usdt.id, symbol: 'USDT', name: 'Tether' },
    quantity: '30000',
  });
  console.log('PASS OPS-SELL-CASH proceeds stay as 30000 USDT; realized +5000; no flow');

  // OPS-BUY-CASH: with 30000 USDT held, a buy for 40000 USDT spends it; 10000 is a deposit.
  const bought = await trade(s, owner, exchange, {
    instrumentId: btc,
    side: 'buy',
    occurredAt: day('2026-05-01'),
    quantity: '0.4',
    grossUsd: '40000',
    settlementCurrency: 'USDT',
  });
  assert.equal(bought.settlement.quantity, '30000');
  assert.deepEqual(await lots(), [['BTC', '0.4', '40000']]);
  state = await s.trades.getJournal(owner, exchange);
  assert.equal(
    state.journal.summary.realizedUsd,
    '5000',
    'Spending cash at its cost gains nothing',
  );
  assert.deepEqual(await flows(), [
    ['2026-03-01T00:00:00.000Z', '25000'],
    ['2026-05-01T00:00:00.000Z', '10000'],
  ]);

  // Deleting the sale would leave the buy spending cash the account never had.
  const before = await fingerprint(db);
  await rejected(
    async () =>
      s.trades.void(owner, exchange, sold.value.trade.tradeId, {
        requestId: randomUUID(),
        expectedJournalRevision: await revision(s, owner, exchange),
      }),
    409,
    (body) =>
      body?.dependent?.operationId === `trade:${bought.tradeId}` &&
      body.dependent.instrumentId === usdt.id,
  );
  assert.equal(await fingerprint(db), before, 'A refused deletion changes nothing');

  // A buy in a currency the owner keeps no cash in is all new money and creates nothing.
  const rubles = await trade(s, owner, exchange, {
    instrumentId: btc,
    side: 'buy',
    occurredAt: day('2026-05-02'),
    quantity: '0.01',
    feeUsd: undefined,
    paid: { currency: 'RUB', gross: '80000', fee: '0', perUsd: '80' },
    settlementCurrency: 'RUB',
  });
  assert.equal(rubles.settlement, undefined);
  assert.deepEqual(
    await db.query(`SELECT 1 FROM accounting_instruments WHERE "ownerId"=$1 AND symbol='RUB'`, [
      owner,
    ]),
    [],
  );
  // Settling in the asset traded is refused.
  await rejected(
    async () =>
      s.trades.create(owner, exchange, {
        requestId: randomUUID(),
        expectedJournalRevision: await revision(s, owner, exchange),
        instrumentId: usdt.id,
        side: 'buy',
        occurredAt: day('2026-05-03'),
        quantity: '10',
        grossUsd: '10',
        feeUsd: '0',
        settlementCurrency: 'USDT',
      }),
    400,
  );
  console.log('PASS OPS-BUY-CASH spends 30000 USDT first; only 10000 is a deposit');
}

async function kinds(db, s, f) {
  stage = 'PR-OPS-2 income, expense, fee, transfer and reward without journal ceremony';
  const { kindsOwner: owner } = f;
  const btc = await instrument(s, owner, 'Bitcoin', 'BTC');
  const wallet = await account(s, owner, 'Wallet');
  const cold = await account(s, owner, 'Cold storage');
  const staking = await account(s, owner, 'Staking');
  const flows = () =>
    db.transaction('REPEATABLE READ', async (manager) => {
      const {
        readValuationInputs,
      } = require('/app/backend/dist/accounting/portfolio-valuation.service.js');
      const { capitalFlows } = require('/app/backend/dist/portfolio-snapshots/capital-flows.js');
      return capitalFlows(await readValuationInputs(manager, owner)).map((flow) => [
        new Date(flow.at).toISOString(),
        String(flow.usd / 10n ** 30n),
      ]);
    });
  const types = async () =>
    (await s.operations.read(owner, {}, now)).operations
      .map((operation) => [operation.type, operation.direction, operation.quantity])
      .reverse();

  // Income starts the journal like a first buy and is a deposit at its value.
  const income = await trade(s, owner, wallet, {
    instrumentId: btc,
    side: 'buy',
    purpose: 'income',
    occurredAt: day('2026-01-10'),
    quantity: '0.03',
    grossUsd: '2400',
    expectedJournalRevision: 0,
  });
  assert.equal(income.purpose, 'income');
  const expense = await trade(s, owner, wallet, {
    instrumentId: btc,
    side: 'sell',
    purpose: 'expense',
    occurredAt: day('2026-02-01'),
    quantity: '0.01',
    grossUsd: '900',
  });
  assert.equal(expense.purpose, 'expense');
  await trade(s, owner, wallet, {
    instrumentId: btc,
    side: 'sell',
    purpose: 'fee',
    occurredAt: day('2026-02-02'),
    quantity: '0.001',
    grossUsd: '85',
    feeUsd: '85',
  });
  const summary = (await s.trades.getJournal(owner, wallet)).journal.summary;
  assert.equal(summary.realizedUsd, '20', 'The expense gains 100; the fee loses its cost of 80');
  // A fee needs its value as both gross and fee; a purpose never settles in cash.
  await rejected(
    async () =>
      s.trades.create(owner, wallet, {
        requestId: randomUUID(),
        expectedJournalRevision: await revision(s, owner, wallet),
        instrumentId: btc,
        side: 'sell',
        purpose: 'fee',
        occurredAt: day('2026-02-03'),
        quantity: '0.001',
        grossUsd: '85',
        feeUsd: '0',
      }),
    400,
  );

  // A transfer into an account without a journal starts it and places itself.
  const transfer = async (fields) =>
    (
      await s.transfers.create(owner, {
        requestId: randomUUID(),
        expectedFromJournalRevision: await revision(s, owner, wallet),
        expectedToJournalRevision: await revision(s, owner, cold),
        fromAccountId: wallet,
        toAccountId: cold,
        assertInternal: true,
        instrumentId: btc,
        occurredAt: day('2026-03-01'),
        quantity: '0.008',
        feeInstrumentId: null,
        feeQuantity: '0',
        ...fields,
      })
    ).value;
  assert.equal((await s.trades.getJournal(owner, cold)).journal, null);
  const first = await transfer({});
  const second = await transfer({ feeInstrumentId: btc, feeQuantity: '0.0001' });
  assert.deepEqual(
    [first.transfer.orderWithinTimestamp, second.transfer.orderWithinTimestamp],
    [0, 1],
    'Same-instant transfers keep entry order',
  );
  assert.equal((await s.trades.getJournal(owner, cold)).journal.originKind, 'declared-empty');

  // A reward on an account without a journal starts it too; it is no flow.
  const reward = await s.rewards.create(owner, staking, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    assertReward: true,
    instrumentId: btc,
    category: 'other',
    occurredAt: day('2026-03-05'),
    quantity: '0.0005',
    acquisitionBasisUsd: '50',
    incomeValueUsd: '50',
  });
  assert.equal(reward.created, true);
  assert.equal(reward.value.reward.orderWithinTimestamp, 0);
  // A correction without an order keeps the reward's place.
  const corrected = await s.rewards.correct(owner, staking, reward.value.reward.rewardId, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, staking),
    expectedVersion: 1,
    assertReward: true,
    instrumentId: btc,
    category: 'other',
    occurredAt: day('2026-03-05'),
    quantity: '0.0005',
    acquisitionBasisUsd: '45',
    incomeValueUsd: '45',
  });
  assert.deepEqual(
    [corrected.value.reward.version, corrected.value.reward.orderWithinTimestamp],
    [2, 0],
  );
  // Editing a transfer may spend what it moved itself, fee included.
  const walletHolds = async (extra) =>
    (await s.trades.available(owner, wallet, { instrumentId: btc, at: day('2026-03-01'), ...extra }))
      .quantity;
  assert.equal(await walletHolds({}), '0.0029');
  assert.equal(await walletHolds({ exclude: `transfer:${second.transfer.transferId}` }), '0.011');
  await rejected(() => walletHolds({ exclude: `swap:${second.transfer.transferId}` }), 400);

  // The cold storage spends both transfers; deleting the first would leave it short.
  const spent = await trade(s, owner, cold, {
    instrumentId: btc,
    side: 'sell',
    occurredAt: day('2026-04-01'),
    quantity: '0.016',
    grossUsd: '1600',
  });
  const before = await fingerprint(db);
  await rejected(
    async () =>
      s.transfers.void(owner, first.transfer.transferId, {
        requestId: randomUUID(),
        expectedVersion: 1,
        expectedFromJournalRevision: await revision(s, owner, wallet),
        expectedToJournalRevision: await revision(s, owner, cold),
      }),
    409,
    (body) =>
      body?.dependent?.operationId === `trade:${spent.tradeId}` && body.dependent.accountId === cold,
  );
  assert.equal(await fingerprint(db), before, 'A refused deletion changes nothing');

  assert.deepEqual(await types(), [
    ['income', 'in', '0.03'],
    ['expense', 'out', '0.01'],
    ['fee', 'out', '0.001'],
    ['transfer', 'internal', '0.008'],
    ['transfer', 'internal', '0.008'],
    ['reward', 'in', '0.0005'],
    ['sell', 'out', '0.016'],
  ]);
  assert.deepEqual(await flows(), [
    ['2026-01-10T00:00:00.000Z', '2400'],
    ['2026-02-01T00:00:00.000Z', '-900'],
    ['2026-04-01T00:00:00.000Z', '-1600'],
  ]);
  console.log(
    'PASS PR-OPS-2 income and expense are flows at value, a fee and transfers are not; transfers and rewards start journals and keep entry order',
  );
}

async function main() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact isolated settings required');
  assert.ok(
    require('node:fs').existsSync(modulePath),
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
  assert.match(migrated.stdout, /Migrations applied: 49/);
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 49);
    const [owner, other, cashOwner, kindsOwner] =
      await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('manual-ops-owner@example.invalid','synthetic-not-a-hash',true),
      ('manual-ops-other@example.invalid','synthetic-not-a-hash',true),
      ('manual-ops-cash@example.invalid','synthetic-not-a-hash',true),
      ('manual-ops-kinds@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = {
      owner: owner.id,
      other: other.id,
      cashOwner: cashOwner.id,
      kindsOwner: kindsOwner.id,
    };
    f.btc = await instrument(s, f.owner, 'Bitcoin', 'BTC');
    f.eth = await instrument(s, f.owner, 'Ether', 'ETH');
    for (const check of [addWithoutJournal, sameDay, edit, overspend, remove, cash, kinds])
      await check(db, s, f);
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
