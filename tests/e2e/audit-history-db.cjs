'use strict';
// audit-history (M27, BR 14) against fresh synthetic PostgreSQL: production compiled services
// write every journal kind, correct and void some of it, and the actual read model lists who
// changed what and when from the stored versions. All data is synthetic.
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
const database = 'capital_tracker_audit_history_e2e';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const modulePath = '/app/backend/dist/accounting/audit-history.service.js';
const now = new Date();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const txid = (n) => sha256(`ct-audit-history:${n}`);
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
function services(db) {
  const make = (file, name, ...rest) =>
    new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const rewards = make('asset-reward.service', 'AssetRewardService');
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trades,
    csv: make('csv-import.service', 'CsvImportService'),
    transfers: make('owned-transfer.service', 'OwnedTransferService'),
    swaps: make('asset-swap.service', 'AssetSwapService'),
    rewards,
    flows: make('portfolio-flow.service', 'PortfolioFlowService'),
    prices: make('manual-price.service', 'ManualPriceService'),
    classifications: make(
      'chain-classification.service',
      'ChainClassificationService',
      trades,
      rewards,
      make('owned-transfer.service', 'OwnedTransferService'),
    ),
    history: make('audit-history.service', 'AuditHistoryService'),
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
async function instrument(s, owner, body) {
  return (await s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body })).value
    .id;
}
async function account(s, owner, name) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  await s.trades.initialize(owner, id, {
    requestId: randomUUID(),
    coverageFrom,
    assertEmpty: true,
  });
  return id;
}
const revision = async (s, owner, id) =>
  (await s.trades.getJournal(owner, id)).journal.journalRevision;
async function trade(s, owner, accountId, instrumentId, side, occurredAt, quantity, grossUsd) {
  const saved = await s.trades.create(owner, accountId, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, accountId),
    instrumentId,
    side,
    occurredAt,
    orderWithinTimestamp: 0,
    quantity,
    grossUsd,
    feeUsd: '0',
  });
  return saved.value.trade;
}
async function csvBuy(s, owner, accountId, instrumentId, line) {
  const bytes = Buffer.from(`instrument,side,time,order,quantity,gross,fee\n${line}\n`);
  const batch = (await s.csv.upload(owner, accountId, { filename: 'synthetic-buys.csv', bytes }))
    .value;
  const settingsInput = {
    format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: {
      columns: {
        instrument: 0,
        side: 1,
        occurredAt: 2,
        order: 3,
        quantity: 4,
        grossUsd: 5,
        feeUsd: 6,
      },
      instruments: [{ source: 'BTC', instrumentId }],
      sides: [{ source: 'buy', side: 'buy' }],
    },
    assertUsd: true,
  };
  const preview = await s.csv.preview(owner, accountId, batch.batchId, settingsInput);
  assert.equal(preview.canConfirm, true);
  await s.csv.confirm(owner, accountId, batch.batchId, {
    requestId: randomUUID(),
    expectedJournalRevision: preview.journalRevision,
    parserVersion: 'usd-csv-v1',
    ...settingsInput,
    previewHash: preview.previewHash,
  });
}
async function wallet(db, owner, accountId, address) {
  const [{ id }] = await db.query(
    `INSERT INTO wallet_addresses(id,"ownerId",network,address,"accountId")
      VALUES ($1,$2,'bitcoin',$3,$4) RETURNING id`,
    [randomUUID(), owner, address, accountId],
  );
  return id;
}
async function raw(db, owner, addressId, n, direction, received, sent, blockTime, fee = '300') {
  await db.query(
    `INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockHash",
      "blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      owner,
      addressId,
      txid(n),
      800000 + n,
      sha256(`block:${n}`),
      blockTime,
      received,
      sent,
      fee,
      direction,
      JSON.stringify({ txid: txid(n) }),
    ],
  );
}
const classify = (s, owner, addressId, n, body) =>
  s.classifications.classify(owner, addressId, txid(n), {
    requestId: randomUUID(),
    hidden: false,
    ...body,
  });
const read = (s, owner, query = {}) => s.history.read(owner, query, now);
const labels = (event) => event.fields.map((field) => field.label);
const newestFirst = (events) =>
  events.every(
    (event, index) =>
      index === 0 ||
      events[index - 1].at > event.at ||
      (events[index - 1].at === event.at && events[index - 1].id > event.id),
  );
const find = (history, title, change) =>
  history.events.filter((event) => event.title === title && event.change === change);

async function seed(db, s, f) {
  stage = 'AUDIT-LIST every journal kind: created, changed and deleted versions';
  const { owner, other } = f;
  const btc = await instrument(s, owner, { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const usdt = await instrument(s, owner, { name: 'Tether', symbol: 'USDT', assetType: 'crypto' });
  const bybit = await account(s, owner, 'Bybit');
  const cold = await account(s, owner, 'Cold storage');
  const first = await trade(s, owner, bybit, btc, 'buy', '2025-06-13T00:00:00.000Z', '0.01', '1000');
  await s.trades.correct(owner, bybit, first.tradeId, {
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
  const dropped = await trade(s, owner, bybit, btc, 'buy', '2025-06-15T00:00:00.000Z', '0.5', '40000');
  await s.trades.void(owner, bybit, dropped.tradeId, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, bybit),
  });
  await csvBuy(s, owner, bybit, btc, 'BTC,buy,2025-06-14T10:30:00Z,0,0.02,2100,1.25');
  await trade(s, owner, bybit, usdt, 'buy', '2025-06-16T00:00:00.000Z', '1000', '1000');
  await s.swaps.create(owner, bybit, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, bybit),
    assertExecuted: true,
    outgoingInstrumentId: usdt,
    incomingInstrumentId: btc,
    occurredAt: '2025-06-17T00:00:00.000Z',
    orderWithinTimestamp: 0,
    outgoingQuantity: '500',
    incomingQuantity: '0.005',
    considerationUsd: '500',
    feeSource: null,
    feeInstrumentId: null,
    feeQuantity: '0',
  });
  await s.transfers.create(owner, {
    requestId: randomUUID(),
    fromAccountId: bybit,
    toAccountId: cold,
    expectedFromJournalRevision: await revision(s, owner, bybit),
    expectedToJournalRevision: await revision(s, owner, cold),
    assertInternal: true,
    instrumentId: btc,
    occurredAt: '2025-06-18T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '0.005',
    feeInstrumentId: btc,
    feeQuantity: '0.0001',
  });
  await s.rewards.create(owner, cold, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, cold),
    assertReward: true,
    instrumentId: btc,
    category: 'staking',
    occurredAt: '2025-06-19T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '0.0002',
    acquisitionBasisUsd: null,
    incomeValueUsd: '20',
  });
  await s.flows.initialize(owner, { requestId: randomUUID(), coverageFrom, assertReviewed: true });
  const flow = {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    direction: 'contribution',
    occurredAt: '2025-06-12T00:00:00.000Z',
    amountUsd: '2000',
    assertExternal: true,
  };
  await s.flows.create(owner, flow);
  const withdrawal = await s.flows.create(owner, {
    ...flow,
    requestId: randomUUID(),
    expectedJournalRevision: 1,
    direction: 'withdrawal',
    amountUsd: '5',
  });
  await s.flows.void(owner, withdrawal.value.flow.flowId, {
    requestId: randomUUID(),
    expectedJournalRevision: 2,
  });
  const point = '2025-06-20T12:00:00.000Z';
  const price = (expectedRevision, priceUsd) => ({
    requestId: randomUUID(),
    expectedRevision,
    priceUsd,
    observedAt: point,
    assertReviewed: true,
  });
  await s.prices.set(owner, usdt, price(0, '1'));
  await s.prices.set(owner, usdt, price(1, '1.01'));
  await s.prices.void(owner, usdt, {
    requestId: randomUUID(),
    expectedRevision: 2,
    observedAt: point,
    assertReviewed: true,
  });
  // A receipt hidden as dust, then recorded as a reward, then hidden again.
  const address = await wallet(db, owner, cold, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  await raw(db, owner, address, 1, 'in', '918359', '0', '2025-06-20T08:00:00.000Z');
  await classify(s, owner, address, 1, {
    expectedVersion: 0,
    hidden: true,
    classification: null,
    comment: 'Dust',
  });
  await classify(s, owner, address, 1, {
    expectedVersion: 1,
    classification: { type: 'reward', valueUsd: null },
  });
  // The app links a transfer between two of the owner's wallets without asking (D7).
  const savings = await wallet(db, owner, bybit, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  await raw(db, owner, address, 2, 'out', '0', '500100', '2025-06-21T08:00:00.000Z', '100');
  await raw(db, owner, savings, 2, 'in', '500000', '0', '2025-06-21T08:00:00.000Z', '100');
  assert.deepEqual(await s.classifications.linkOwnTransfers(owner), { linked: 1 });
  // Another owner's history never mixes in.
  const foreignBtc = await instrument(s, other, {
    name: 'Foreign bitcoin',
    symbol: 'BTC',
    assetType: 'crypto',
  });
  const foreign = await account(s, other, 'Foreign');
  await trade(s, other, foreign, foreignBtc, 'buy', '2025-06-13T00:00:00.000Z', '5', '1');

  const before = await fingerprint(db);
  const history = await read(s, owner);
  assert.deepEqual(Object.keys(history).sort(), ['at', 'events', 'next']);
  assert.equal(history.at, now.toISOString());
  assert.equal(history.next, null);
  assert.ok(newestFirst(history.events), 'Newest first, ties by key');

  const created = find(history, 'Buy BTC', 'created');
  assert.equal(created.length, 3, 'Two manual buys and one CSV buy');
  assert.deepEqual(created.map((event) => event.actor).sort(), ['csv', 'owner', 'owner']);
  const [correction] = find(history, 'Buy BTC', 'changed');
  assert.deepEqual(
    correction.fields.map((field) => [field.label, field.before?.value ?? null, field.after?.value]),
    [
      ['Amount', '1000', '1010'],
      ['Comment', null, 'Corrected amount'],
    ],
    'A correction lists only what changed, with the values before and after',
  );
  assert.deepEqual([correction.version, correction.account], [2, 'Bybit']);
  const [removed] = find(history, 'Buy BTC', 'deleted');
  assert.equal(removed.fields.find((field) => field.label === 'Quantity').before.value, '0.5');
  assert.ok(removed.fields.every((field) => field.after === null));
  const deposit = find(history, 'Deposit', 'created');
  assert.equal(deposit.length, 1);
  assert.equal(find(history, 'Withdrawal', 'deleted').length, 1);
  assert.equal(find(history, 'Withdrawal', 'created').length, 1);
  assert.deepEqual(
    find(history, 'Swap USDT → BTC', 'created')[0].fields.map((field) => [
      field.label,
      field.after.value,
      field.after.unit,
    ]),
    [
      ['Gave', '500', 'USDT'],
      ['Got', '0.005', 'BTC'],
      ['Value', '500', null],
      ['Date', '2025-06-17T00:00:00.000Z', null],
    ],
  );
  const [transfer] = find(history, 'Transfer BTC', 'created').filter(
    (event) => event.actor === 'owner',
  );
  assert.deepEqual(
    [transfer.account, labels(transfer)],
    ['Bybit', ['Quantity', 'To', 'Fee', 'Date']],
  );
  // The hand-made staking reward and the one the classification recorded.
  assert.deepEqual(
    find(history, 'Reward BTC', 'created').map((event) => event.fields[0].after.value),
    ['Other', 'Staking'],
  );
  assert.deepEqual(
    ['created', 'changed', 'deleted'].map((change) => find(history, 'Manual price USDT', change).length),
    [1, 1, 1],
  );
  assert.deepEqual(
    find(history, 'Manual price USDT', 'changed')[0].fields.map((field) => [
      field.label,
      field.before.value,
      field.after.value,
    ]),
    [['Price', '1', '1.01']],
  );
  const linked = history.events.filter((event) => event.actor === 'automatic');
  assert.deepEqual(
    linked.map((event) => [event.entity, event.change]).sort(),
    [
      ['classification', 'created'],
      ['classification', 'created'],
      ['transfer', 'created'],
    ],
    'The transfer the app linked and the two answers it wrote are marked as the app',
  );
  const classifications = history.events.filter(
    (event) => event.entity === 'classification' && event.actor === 'owner',
  );
  assert.deepEqual(
    classifications.map((event) => [event.title, event.change, event.account, event.version]),
    [
      ['Incoming BTC', 'changed', 'Cold storage', 2],
      ['Incoming BTC', 'created', 'Cold storage', 1],
    ],
  );
  assert.deepEqual(
    classifications[1].fields.map((field) => [field.label, field.after.value]),
    [
      ['Status', 'Hidden'],
      ['Comment', 'Dust'],
    ],
  );
  assert.deepEqual(
    classifications[0].fields.map((field) => [
      field.label,
      field.before?.value ?? null,
      field.after?.value ?? null,
    ]),
    [
      ['Status', 'Hidden', 'Classified'],
      ['Type', null, 'Reward'],
      ['Comment', 'Dust', null],
    ],
  );
  assert.ok(
    history.events.every((event) => !event.account || event.account !== 'Foreign'),
    'Foreign history is absent',
  );
  assert.equal(await fingerprint(db), before, 'Every read preserves all rows');
  console.log('PASS AUDIT-LIST/AUDIT-DIFF/AUDIT-PRIVATE');
  return { total: history.events.length, history };
}

async function filters(db, s, f, { total, history }) {
  stage = 'AUDIT-FILTER entity, change, source and date range';
  const { owner } = f;
  const only = async (query) => (await read(s, owner, query)).events;
  const trades = await only({ entity: 'trade' });
  assert.ok(trades.length > 0 && trades.every((event) => event.entity === 'trade'));
  const deleted = await only({ change: 'deleted' });
  assert.ok(deleted.length >= 3 && deleted.every((event) => event.change === 'deleted'));
  assert.deepEqual(
    (await only({ actor: 'csv' })).map((event) => [event.title, event.change]),
    [['Buy BTC', 'created']],
  );
  assert.equal((await only({ actor: 'automatic' })).length, 3);
  // The seed may straddle midnight UTC: the days of the oldest and newest event hold everything.
  const days = [history.events.at(-1), history.events[0]].map((event) => event.at.slice(0, 10));
  assert.equal((await only({ from: days[0], to: days[1] })).length, total);
  const newest = history.events[0].at.slice(0, 10);
  assert.ok((await only({ from: newest, to: newest })).every((event) => event.at.startsWith(newest)));
  assert.equal((await only({ from: '2999-01-01' })).length, 0);
  assert.equal((await only({ to: '2000-01-01' })).length, 0);
  const combined = await only({ entity: 'trade', change: 'changed' });
  assert.equal(combined.length, 1);

  stage = 'AUDIT-PAGE newest first in pages that join without gaps or repeats';
  const pages = [];
  let cursor;
  for (;;) {
    const page = await read(s, owner, cursor ? { limit: '4', before: cursor } : { limit: '4' });
    pages.push(...page.events);
    if (!page.next) break;
    assert.equal(page.events.length, 4);
    cursor = page.next;
  }
  assert.deepEqual(
    pages.map((event) => event.id),
    history.events.map((event) => event.id),
  );

  stage = 'AUDIT-INPUT refusals';
  for (const query of [
    { entity: 'account' },
    { change: 'removed' },
    { actor: 'robot' },
    { from: '2025-13-01' },
    { to: '2025-02-30' },
    { from: '2025-06-02', to: '2025-06-01' },
    { limit: '0' },
    { limit: '201' },
    { limit: 'abc' },
    { before: 'not-a-cursor' },
    { owner: 'x' },
    [],
    null,
  ])
    await rejected(() => read(s, owner, query), 400);
  await rejected(() => s.history.read('not-a-uuid', {}, now), 400);
  console.log('PASS AUDIT-FILTER/AUDIT-PAGE/AUDIT-INPUT');
}

async function emptyOwner(db, s, f) {
  stage = 'AUDIT-EMPTY an owner without history';
  assert.deepEqual(await read(s, f.third), { at: now.toISOString(), events: [], next: null });
  console.log('PASS AUDIT-EMPTY');
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
    const [owner, other, third] =
      await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('history-owner@example.invalid','synthetic-not-a-hash',true),
      ('history-other@example.invalid','synthetic-not-a-hash',true),
      ('history-third@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = { owner: owner.id, other: other.id, third: third.id };
    const seeded = await seed(db, s, f);
    await filters(db, s, f, seeded);
    await emptyOwner(db, s, f);
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
