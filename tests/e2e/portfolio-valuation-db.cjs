'use strict';
// Only fresh synthetic PostgreSQL; production compiled services and actual queries.
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
const database = 'capital_tracker_portfolio_valuation_e2e';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const modulePath = '/app/backend/dist/accounting/portfolio-valuation.service.js';
const now = new Date();
const ago = (minutes) => new Date(now.getTime() - minutes * 60_000);
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
    prices: make('manual-price.service', 'ManualPriceService'),
    transfers: make('owned-transfer.service', 'OwnedTransferService'),
    portfolio: make('portfolio-valuation.service', 'PortfolioValuationService'),
    hidden: make('hidden-asset.service', 'HiddenAssetService'),
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
async function providerRequests() {
  const response = await fetch('http://providers:8080/__control/requests');
  assert.equal(response.status, 200);
  return response.json();
}
const rejected = (action, status) =>
  assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status,
  );
async function instrument(s, owner, body) {
  return (await s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body })).value
    .id;
}
async function account(s, owner, name, start = coverageFrom) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  if (start)
    await s.trades.initialize(owner, id, {
      requestId: randomUUID(),
      coverageFrom: start,
      assertEmpty: true,
    });
  return { id, revision: 0 };
}
async function trade(s, owner, target, instrumentId, side, occurredAt, quantity, grossUsd) {
  await s.trades.create(owner, target.id, {
    requestId: randomUUID(),
    expectedJournalRevision: target.revision,
    instrumentId,
    side,
    occurredAt,
    orderWithinTimestamp: 0,
    quantity,
    grossUsd,
    feeUsd: '0',
  });
  target.revision++;
}
async function observe(db, asset, price, observedAt, source = 'kraken') {
  await db.query(
    `INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ($1,'USD',$2,$3,$4,'hourly-close')`,
    [asset, source, observedAt, price],
  );
}
const read = (s, owner, query = {}) => s.portfolio.read(owner, query, now);
const asset = (report, id) => report.assets.find((entry) => entry.instrumentId === id);
const shares = (slices) => slices.map((slice) => [slice.label, slice.percent]);

async function wholePortfolio(db, s, f) {
  stage = 'PV-TOTAL/MARKET/STALE/MANUAL/FIXED/REALIZED/ALLOC every account, stored prices, FIFO';
  const { owner, other } = f;
  const btc = await instrument(s, owner, { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const eth = await instrument(s, owner, { name: 'Ethereum', symbol: 'eth', assetType: 'crypto' });
  const usd = await instrument(s, owner, { name: 'US dollar', symbol: 'USD', assetType: 'fiat' });
  const deposit = await instrument(s, owner, {
    name: 'Deposit',
    assetType: 'manual',
    valuationCurrency: 'USD',
  });
  const ton = await instrument(s, owner, { name: 'Toncoin', symbol: 'TON', assetType: 'crypto' });
  const trust = await account(s, owner, 'Trust Wallet');
  const bybit = await account(s, owner, 'Bybit');
  await account(s, owner, 'No journal yet', null);
  await trade(s, owner, bybit, btc, 'buy', '2025-01-02T00:00:00.000Z', '0.05', '3500');
  await trade(s, owner, bybit, btc, 'buy', '2025-01-02T01:00:00.000Z', '0.01', '600');
  await trade(s, owner, bybit, eth, 'buy', '2025-01-02T02:00:00.000Z', '1', '1000');
  await trade(s, owner, bybit, eth, 'buy', '2025-01-02T03:00:00.000Z', '1', '1500');
  await trade(s, owner, bybit, eth, 'sell', '2025-01-04T00:00:00.000Z', '1', '1800');
  await trade(s, owner, bybit, usd, 'buy', '2025-01-04T01:00:00.000Z', '1500', '1500');
  await trade(s, owner, bybit, deposit, 'buy', '2025-01-04T02:00:00.000Z', '1', '2000');
  await s.transfers.create(owner, {
    requestId: randomUUID(),
    fromAccountId: bybit.id,
    toAccountId: trust.id,
    expectedFromJournalRevision: bybit.revision,
    expectedToJournalRevision: trust.revision,
    assertInternal: true,
    instrumentId: btc,
    occurredAt: '2025-01-03T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '0.03',
    feeInstrumentId: null,
    feeQuantity: '0',
  });
  // Market: latest at or before now wins; a future observation is ignored; ETH only has a stale one.
  await observe(db, 'BTC', '60000', ago(180));
  await observe(db, 'BTC', '70000', ago(30), 'coingecko');
  await observe(db, 'BTC', '99999', new Date(now.getTime() + 3_600_000));
  await observe(db, 'ETH', '2000', ago(180));
  // The price a day earlier gives the 24-hour change; ETH has none from then.
  await observe(db, 'BTC', '56000', ago(24 * 60 + 30));
  // Manual: the later point is voided and the future one is not yet effective.
  const point = (revision, observedAt, priceUsd) => ({
    requestId: randomUUID(),
    expectedRevision: revision,
    observedAt,
    priceUsd,
    assertReviewed: true,
  });
  await s.prices.set(owner, deposit, point(0, '2025-01-05T00:00:00.000Z', '2300'));
  await s.prices.set(owner, deposit, point(1, '2025-01-06T00:00:00.000Z', '9999'));
  await s.prices.void(owner, deposit, {
    requestId: randomUUID(),
    expectedRevision: 2,
    observedAt: '2025-01-06T00:00:00.000Z',
    assertReviewed: true,
  });
  await s.prices.set(owner, deposit, point(3, '2099-01-01T00:00:00.000Z', '1'));
  // Another owner's holdings and prices never mix in.
  const foreignBtc = await instrument(s, other, {
    name: 'Foreign bitcoin',
    symbol: 'BTC',
    assetType: 'crypto',
  });
  const foreign = await account(s, other, 'Foreign');
  await trade(s, other, foreign, foreignBtc, 'buy', '2025-01-02T00:00:00.000Z', '5', '1');

  const before = await fingerprint(db);
  const providers = await providerRequests();
  const report = await read(s, owner);
  assert.deepEqual(
    Object.keys(report).sort(),
    [
      'at',
      'currency',
      'mainCurrency',
      'rates',
      'completeness',
      'totalValue',
      'pricedSubtotal',
      'missingPriceCount',
      'stalePriceCount',
      'unavailableAccountCount',
      'depositsValue',
      'unratedDepositCount',
      'costBasis',
      'knownCostSubtotal',
      'unknownCostCount',
      'missingRateCount',
      'unrealizedPnl',
      'unrealizedReturnPercent',
      'knownUnrealizedPnl',
      'knownUnrealizedReturnPercent',
      'realizedPnl',
      'knownRealizedSubtotal',
      'unknownRealizedCount',
      'assets',
      'allocation',
      'accounts',
      'real',
    ].sort(),
  );
  // No Bank of Russia rate is stored here: USD is the default main currency and needs none.
  assert.deepEqual(
    [report.currency, report.mainCurrency, report.rates, report.missingRateCount],
    ['USD', 'USD', [], 0],
  );
  assert.equal(report.at, now.toISOString());
  assert.equal(report.completeness, 'complete');
  assert.equal(report.totalValue, '10000');
  assert.deepEqual([report.depositsValue, report.unratedDepositCount], ['0', 0], 'No bank deposits');
  assert.equal(report.stalePriceCount, 1);
  assert.equal(report.costBasis, '9100');
  assert.equal(report.unrealizedPnl, '900');
  assert.equal(report.unrealizedReturnPercent, '9.89');
  assert.equal(report.realizedPnl, '800');
  assert.deepEqual(
    report.assets.map((entry) => entry.name),
    ['Bitcoin', 'Deposit', 'Ethereum', 'US dollar', 'Toncoin'],
  );
  const bitcoin = asset(report, btc);
  assert.deepEqual(bitcoin.price, {
    value: '70000',
    observedAt: ago(30).toISOString(),
    source: 'coingecko',
    status: 'fresh',
  });
  assert.equal(bitcoin.quantity, '0.06');
  assert.equal(bitcoin.value, '4200');
  assert.equal(bitcoin.costBasis, '4100');
  assert.equal(bitcoin.averageBuyPrice, '68333.333333333333333333333333333333');
  assert.equal(bitcoin.unrealizedPnl, '100');
  assert.deepEqual(
    bitcoin.holdings.map((h) => [h.accountName, h.quantity, h.value]),
    [
      ['Bybit', '0.03', '2100'],
      ['Trust Wallet', '0.03', '2100'],
    ],
    'A transferred lot counts once',
  );
  const ether = asset(report, eth);
  assert.deepEqual(ether.price, {
    value: '2000',
    observedAt: ago(180).toISOString(),
    source: 'kraken',
    status: 'stale',
  });
  assert.equal(ether.quantity, '1');
  assert.equal(ether.costBasis, '1500');
  assert.equal(ether.averageBuyPrice, '1500');
  assert.equal(ether.realizedPnl, '800');
  assert.equal(ether.unrealizedPnl, '500');
  assert.deepEqual(asset(report, deposit).price, {
    value: '2300',
    observedAt: '2025-01-05T00:00:00.000Z',
    source: 'manual',
    status: 'manual',
  });
  assert.deepEqual(asset(report, usd).price, {
    value: '1',
    observedAt: null,
    source: 'fixed',
    status: 'fixed',
  });
  assert.equal(asset(report, usd).value, '1500');
  assert.deepEqual(
    report.assets.map((entry) => [entry.name, entry.priceChange24hPercent]),
    [
      ['Bitcoin', '25.00'],
      ['Deposit', '0.00'],
      ['Ethereum', null],
      ['US dollar', '0.00'],
      ['Toncoin', null],
    ],
    'PV-24H daily price change',
  );
  assert.equal(asset(report, ton).quantity, '0');
  assert.equal(asset(report, ton).value, '0');
  assert.equal(asset(report, ton).missingPrice, 'no-price');
  assert.deepEqual(shares(report.allocation.byAsset), [
    ['Bitcoin', '42.00'],
    ['Deposit', '23.00'],
    ['Ethereum', '20.00'],
    ['US dollar', '15.00'],
  ]);
  assert.deepEqual(shares(report.allocation.byType), [
    ['Crypto', '62.00'],
    ['Manual', '23.00'],
    ['Cash', '15.00'],
  ]);
  assert.deepEqual(shares(report.allocation.byAccount), [
    ['Bybit', '79.00'],
    ['Trust Wallet', '21.00'],
  ]);
  assert.deepEqual(report.accounts.map((entry) => [entry.name, entry.coverage]).sort(), [
    ['Bybit', 'covered'],
    ['No journal yet', 'not-started'],
    ['Trust Wallet', 'covered'],
  ]);
  assert.ok(
    !report.assets.some((entry) => entry.instrumentId === foreignBtc),
    'Foreign instruments are absent',
  );
  assert.ok(
    report.accounts.every((entry) => entry.accountId !== foreign.id),
    'Foreign accounts are absent',
  );

  const foreignReport = await read(s, other);
  assert.equal(foreignReport.totalValue, '350000');
  assert.deepEqual(
    foreignReport.assets.map((entry) => entry.instrumentId),
    [foreignBtc],
  );
  await rejected(() => read(s, owner, { at: now.toISOString() }), 400);
  await rejected(() => read(s, owner, []), 400);
  await rejected(() => s.portfolio.read('not-a-uuid', {}, now), 400);
  assert.equal(await fingerprint(db), before, 'Every read and refusal preserves all rows');
  assert.deepEqual(await providerRequests(), providers, 'Reads never call any provider');
  console.log('PASS PV-TOTAL/MARKET/STALE/MANUAL/FIXED/REALIZED/ALLOC/PRIVATE/24H');

  stage = 'INFL-REAL-PF the held lots in today money: unknown without data, flat and rising prices';
  const bitcoinOf = (view) => asset(view, btc);
  assert.deepEqual(report.real, { official: null, personal: null }, 'No inflation data stored');
  assert.deepEqual(bitcoinOf(report).real, { official: null, personal: null });
  await db.query(
    `INSERT INTO inflation_manual_months ("ownerId", currency, month, "changePercent")
     SELECT $1, 'USD', month::date, 0 FROM generate_series('2024-10-01'::date, date_trunc('month', now())::date, '1 month') month`,
    [owner],
  );
  try {
    // No own rate: the own-rate reading follows the official one and says so.
    const flat = await read(s, owner);
    assert.deepEqual(flat.real.personal, { ...flat.real.official, ownRate: false });
    // No price change at all: every lot keeps its value, so real equals nominal.
    assert.equal(flat.real.official.costBasis, flat.costBasis);
    assert.equal(flat.real.official.unrealizedPnl, flat.unrealizedPnl);
    assert.equal(bitcoinOf(flat).real.official.costBasis, bitcoinOf(flat).costBasis);
    assert.equal(bitcoinOf(flat).real.official.unrealizedPnl, bitcoinOf(flat).unrealizedPnl);
    // A held asset has a reading, an asset with nothing held none.
    assert.deepEqual(asset(flat, ton).real, { official: null, personal: null });
    await db.query(
      `INSERT INTO inflation_personal_rates ("ownerId", currency, "annualPercent") VALUES ($1, 'USD', 10)`,
      [owner],
    );
    const rising = await read(s, owner);
    assert.equal(rising.real.personal.ownRate, true);
    assert.ok(Number(rising.real.personal.costBasis) > Number(rising.costBasis), 'Cost grows');
    assert.ok(Number(rising.real.personal.unrealizedPnl) < Number(rising.unrealizedPnl), 'Profit shrinks');
    assert.deepEqual(rising.real.official, flat.real.official, 'The official reading is the same');
    assert.equal(rising.costBasis, flat.costBasis, 'The nominal figures do not change');
    // INFL-REAL-LOTS: the lots of one asset add up to the asset's own reading.
    const lotsOf = await s.portfolio.lots(owner, btc, {}, now);
    assert.equal(lotsOf.instrumentId, btc);
    assert.equal(lotsOf.currency, rising.currency);
    assert.ok(lotsOf.lots.length > 0, 'A held asset lists its lots');
    // Exact decimal sums: a float tolerance would let a lost fraction or whole units pass.
    const SCALE = 60;
    const exact = (text) => {
      const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text));
      assert.ok(match, `${text} is not a decimal amount`);
      const fraction = match[3] ?? '';
      assert.ok(fraction.length <= SCALE, `${text} has more than ${SCALE} decimals`);
      const value = BigInt(`${match[2]}${fraction.padEnd(SCALE, '0')}`);
      return match[1] === '-' ? -value : value;
    };
    const sum = (pick) =>
      lotsOf.lots.reduce((total, lot) => total + (pick(lot) === null ? 0n : exact(pick(lot))), 0n);
    const same = (total, expected) =>
      assert.equal(total, expected === null ? 0n : exact(expected), `${total} is not ${expected}`);
    // Bitcoin here holds only purchases (0.05 for 3500 and 0.01 for 600 USD, no sale), so its held
    // cost is 4100 and the purchase lots add up to that subtotal. A reward or a gift in this
    // fixture would make the asset-wide figures larger than the purchases; then compare to the
    // purchase subtotal instead.
    same(exact(bitcoinOf(rising).costBasis), '4100');
    same(sum((lot) => lot.paid), '4100');
    same(sum((lot) => lot.real.official.costBasis), bitcoinOf(rising).real.official.costBasis);
    same(sum((lot) => lot.real.personal.costBasis), bitcoinOf(rising).real.personal.costBasis);
    assert.ok(lotsOf.lots.every((lot) => lot.real.personal.ownRate === true));
    const days = lotsOf.lots.map((lot) => lot.acquiredAt);
    assert.deepEqual(days, [...days].sort().reverse(), 'Newest first');
    await assert.rejects(s.portfolio.lots(owner, randomUUID(), {}, now), /Not found/);
  } finally {
    await db.query('DELETE FROM inflation_manual_months WHERE "ownerId" = $1', [owner]);
    await db.query('DELETE FROM inflation_personal_rates WHERE "ownerId" = $1', [owner]);
  }
  console.log('PASS INFL-REAL-PF real cost and profit: flat prices equal nominal, a 10% rate lowers it');
}

async function gapsAndInvalidHistory(db, s, f) {
  stage = 'PV-NONE/PV-FIXED no price, no rate, later coverage and invalid saved FIFO';
  const { third } = f;
  const sol = await instrument(s, third, { name: 'Solana', symbol: 'SOL', assetType: 'crypto' });
  const rub = await instrument(s, third, { name: 'Rubles', symbol: 'RUB', assetType: 'fiat' });
  const usd = await instrument(s, third, { name: 'Cash', symbol: 'USD', assetType: 'fiat' });
  const cash = await account(s, third, 'Cash');
  await trade(s, third, cash, sol, 'buy', '2025-01-02T00:00:00.000Z', '3', '300');
  await trade(s, third, cash, rub, 'buy', '2025-01-02T01:00:00.000Z', '100000', '1200');
  await trade(s, third, cash, usd, 'buy', '2025-01-02T02:00:00.000Z', '10', '10');
  const report = await read(s, third);
  assert.equal(report.completeness, 'incomplete');
  assert.equal(report.totalValue, null);
  assert.equal(report.pricedSubtotal, '10');
  assert.equal(report.missingPriceCount, 2);
  assert.equal(report.unrealizedPnl, null);
  assert.equal(asset(report, sol).missingPrice, 'no-price');
  assert.equal(asset(report, sol).value, null);
  assert.equal(asset(report, rub).missingPrice, 'no-rate');
  assert.equal(asset(report, rub).allocationPercent, null);
  assert.equal(report.allocation.complete, false);
  assert.deepEqual(shares(report.allocation.byAsset), [['Cash', '100.00']]);
  await account(s, third, 'Starts later', new Date(now.getTime() + 86_400_000).toISOString());
  const later = await read(s, third);
  assert.equal(later.unavailableAccountCount, 1);
  assert.equal(later.costBasis, null);
  assert.equal(
    later.accounts.find((entry) => entry.name === 'Starts later').coverage,
    'before-coverage',
  );

  const before = await fingerprint(db);
  await db.query(
    `UPDATE account_trade_versions SET side='sell' WHERE "ownerId"=$1 AND "accountId"=$2`,
    [third, cash.id],
  );
  try {
    const invalid = await fingerprint(db);
    await rejected(() => read(s, third), 409);
    assert.equal(await fingerprint(db), invalid, 'Invalid history is not hidden or repaired');
  } finally {
    await db.query(
      `UPDATE account_trade_versions SET side='buy' WHERE "ownerId"=$1 AND "accountId"=$2`,
      [third, cash.id],
    );
  }
  assert.equal(await fingerprint(db), before, 'Synthetic corruption restored exactly');
  console.log('PASS PV-NONE/PV-FIXED gaps and invalid history');
}

async function hiddenAssets(db, s, f) {
  stage = 'ASSET-HIDE a hidden asset leaves the portfolio and comes back';
  const { fourth, other } = f;
  const first = await instrument(s, fourth, {
    name: 'Hide A',
    symbol: 'ZEC',
    assetType: 'crypto',
  });
  const second = await instrument(s, fourth, {
    name: 'Hide B',
    symbol: 'TRX',
    assetType: 'crypto',
  });
  const exchange = await account(s, fourth, 'Exchange');
  await trade(s, fourth, exchange, first, 'buy', '2025-01-02T00:00:00.000Z', '2', '150');
  await trade(s, fourth, exchange, second, 'buy', '2025-01-02T01:00:00.000Z', '3', '24');
  await observe(db, 'ZEC', '100', ago(30));
  await observe(db, 'TRX', '10', ago(30));
  assert.equal((await read(s, fourth)).totalValue, '230');
  assert.deepEqual(await s.hidden.list(fourth), { items: [] });

  const hid = await s.hidden.hide(fourth, second);
  assert.deepEqual([hid.instrumentId, hid.symbol, hid.name], [second, 'TRX', 'Hide B']);
  assert.equal(
    (await s.hidden.hide(fourth, second)).hiddenAt,
    hid.hiddenAt,
    'Hiding twice keeps the first time',
  );
  const report = await read(s, fourth);
  assert.equal(asset(report, second), undefined, 'A hidden asset is not listed');
  assert.equal(report.totalValue, '200', 'A hidden asset is not in the total');
  assert.equal(report.pricedSubtotal, '200');
  assert.deepEqual(
    (await s.hidden.list(fourth)).items.map((item) => item.instrumentId),
    [second],
  );
  assert.equal((await s.hidden.list(other)).items.length, 0, 'Another owner sees none of it');
  await rejected(() => s.hidden.hide(other, first), 404);
  await rejected(() => s.hidden.show(other, second), 404);
  await rejected(() => s.hidden.hide(fourth, 'not-an-id'), 400);

  assert.deepEqual(await s.hidden.show(fourth, second), { instrumentId: second, hidden: false });
  assert.deepEqual(await s.hidden.show(fourth, second), { instrumentId: second, hidden: false });
  assert.equal((await read(s, fourth)).totalValue, '230', 'Showing the asset brings it back');
  assert.equal(asset(await read(s, fourth), second).quantity, '3');
  assert.deepEqual(await s.hidden.list(fourth), { items: [] });
  console.log('PASS ASSET-HIDE hide, list, show and the portfolio without it');
}

async function handValueCurrency(db, s) {
  stage = 'AST-MANUAL-VALUE a hand value keeps the currency it was set in';
  // Runs last: the Bank of Russia rates it stores are shared by every owner.
  const [{ id: owner }] = await db.query(`INSERT INTO users(email,password)
    VALUES ('portfolio-rub@example.invalid','synthetic-not-a-hash') RETURNING id`);
  const flat = await instrument(s, owner, {
    name: 'Studio',
    assetType: 'manual',
    valuationCurrency: 'RUB',
  });
  const home = await account(s, owner, 'Home');
  await trade(s, owner, home, flat, 'buy', '2025-01-05T00:00:00.000Z', '1', '6250');
  // 80 RUB a dollar when the value was set, 100 RUB a dollar from yesterday on.
  await db.query(`INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit") VALUES
    ('USD','cbr','2025-01-05',80), ('EUR','cbr','2025-01-05',90),
    ('USD','cbr',(now() AT TIME ZONE 'Europe/Moscow')::date - 1,100),
    ('EUR','cbr',(now() AT TIME ZONE 'Europe/Moscow')::date - 1,110),
    ('USD','cbr',(now() AT TIME ZONE 'Europe/Moscow')::date,100),
    ('EUR','cbr',(now() AT TIME ZONE 'Europe/Moscow')::date,110)
    ON CONFLICT DO NOTHING`);
  const command = {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: '2025-01-05T00:00:00.000Z',
    price: '500000.00',
    currency: 'RUB',
    assertReviewed: true,
  };
  const saved = await s.prices.set(owner, flat, command);
  assert.equal(saved.created, true);
  assert.deepEqual(
    [saved.value.price, saved.value.quoteCurrency, saved.value.priceUsd],
    ['500000', 'RUB', null],
    'The receipt states the price in rubles and claims no dollar price',
  );
  assert.deepEqual(
    await db.query(
      `SELECT "priceUsd"::text AS price, "quoteCurrency" FROM manual_usd_price_versions
        WHERE "instrumentId"=$1`,
      [flat],
    ),
    [{ price: '500000.000000000000000000000000000000', quoteCurrency: 'RUB' }],
  );
  // A replay is the same price; the same request with another currency is refused.
  assert.equal((await s.prices.set(owner, flat, command)).created, false);
  await rejected(() => s.prices.set(owner, flat, { ...command, currency: 'EUR' }), 409);
  await rejected(
    () => s.prices.set(owner, flat, { ...command, requestId: randomUUID(), currency: 'GBP' }),
    400,
  );
  const book = await s.prices.list(owner, flat, {});
  assert.equal(book.quoteCurrency, 'RUB', 'The book is in the currency the asset is valued in');
  assert.deepEqual(
    book.items.map((item) => [item.price, item.quoteCurrency]),
    [['500000', 'RUB']],
  );
  // The rate moved from 80 to 100, yet 500,000 RUB is still 500,000 RUB, and 5,000 USD today.
  const rub = asset(await read(s, owner, { currency: 'RUB' }), flat);
  assert.deepEqual([rub.price.value, rub.value], ['500000', '500000']);
  assert.equal(rub.price.status, 'manual');
  const usd = asset(await read(s, owner, { currency: 'USD' }), flat);
  assert.deepEqual([usd.price.value, usd.value], ['5000', '5000']);
  const eur = asset(await read(s, owner, { currency: 'EUR' }), flat);
  assert.equal(eur.value, '4545.454545454545454545454545454545');
  console.log('PASS AST-MANUAL-VALUE a ruble hand value stays in rubles as the dollar rate moves');
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
  const db = source();
  try {
    await db.initialize();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 67);
    const [owner, other, third, fourth] =
      await db.query(`INSERT INTO users(email,password) VALUES
      ('portfolio-owner@example.invalid','synthetic-not-a-hash'),
      ('portfolio-other@example.invalid','synthetic-not-a-hash'),
      ('portfolio-third@example.invalid','synthetic-not-a-hash'),
      ('portfolio-fourth@example.invalid','synthetic-not-a-hash') RETURNING id`);
    const s = services(db);
    const f = { owner: owner.id, other: other.id, third: third.id, fourth: fourth.id };
    for (const check of [wholePortfolio, gapsAndInvalidHistory, hiddenAssets])
      await check(db, s, f);
    await handValueCurrency(db, s);
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
