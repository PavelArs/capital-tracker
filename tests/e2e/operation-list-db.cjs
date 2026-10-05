'use strict';
// list-all-operations against fresh synthetic PostgreSQL: production compiled services
// write every journal and the actual read model query lists them. All data is synthetic.
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
const database = 'capital_tracker_operation_list_e2e';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const modulePath = '/app/backend/dist/accounting/operation-list.service.js';
const now = new Date();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const txid = (n) => sha256(`ct-operation-list:${n}`);
const walletAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
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
    csv: make('csv-import.service', 'CsvImportService'),
    transfers: make('owned-transfer.service', 'OwnedTransferService'),
    swaps: make('asset-swap.service', 'AssetSwapService'),
    rewards: make('asset-reward.service', 'AssetRewardService'),
    carry: make('carry-in.service', 'CarryInService'),
    flows: make('portfolio-flow.service', 'PortfolioFlowService'),
    operations: make('operation-list.service', 'OperationListService'),
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
  return id;
}
const revision = async (s, owner, id) =>
  (await s.trades.getJournal(owner, id)).journal.journalRevision;
async function trade(
  s,
  owner,
  accountId,
  instrumentId,
  side,
  occurredAt,
  quantity,
  grossUsd,
  feeUsd = '0',
) {
  const saved = await s.trades.create(owner, accountId, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, accountId),
    instrumentId,
    side,
    occurredAt,
    orderWithinTimestamp: 0,
    quantity,
    grossUsd,
    feeUsd,
  });
  return saved.value.trade.tradeId;
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
async function chainRows(db, owner) {
  const [{ id }] = await db.query(
    `INSERT INTO wallet_addresses(id,"ownerId",network,address)
    VALUES ($1,$2,'bitcoin',$3) RETURNING id`,
    [randomUUID(), owner, walletAddress],
  );
  const insert = (n, direction, received, sent, fee, blockTime) =>
    db.query(
      `INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockHash","blockTime",
      "receivedUnits","sentUnits","feeUnits",direction,raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        owner,
        id,
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
  await insert(1, 'in', '918359', '0', '500', '2025-06-20T08:00:00.000Z');
  await insert(2, 'out', '1000', '51000', '300', '2025-06-21T08:00:00.000Z');
  return id;
}
const read = (s, owner, query = {}) => s.operations.read(owner, query, now);
const row = (operation) => [
  operation.type,
  operation.asset.symbol,
  operation.quantity,
  operation.valueUsd,
  operation.account?.name ?? null,
  operation.status,
  operation.source,
];

async function everyJournal(db, s, f) {
  stage = 'OPS-LIST manual, CSV, chain and every journal kind in one list';
  const { owner, other } = f;
  const btc = await instrument(s, owner, { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const usdt = await instrument(s, owner, { name: 'Tether', symbol: 'USDT', assetType: 'crypto' });
  const bybit = await account(s, owner, 'Bybit');
  const cold = await account(s, owner, 'Cold storage');
  await trade(s, owner, bybit, btc, 'buy', '2025-06-13T00:00:00.000Z', '0.00918359', '1000');
  await csvBuy(s, owner, bybit, btc, 'BTC,buy,2025-06-14T10:30:00Z,0,0.01,1050.5,1.25');
  // A voided operation has left the books and the list.
  const voided = await trade(
    s,
    owner,
    bybit,
    btc,
    'buy',
    '2025-06-15T00:00:00.000Z',
    '0.5',
    '40000',
  );
  await s.trades.void(owner, bybit, voided, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, bybit),
  });
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
  // Known-cost carry-in: the journal starts with the lots of its opening.
  const trust = (
    await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Trust Wallet' })
  ).value.id;
  await s.accounting.saveOpening(owner, trust, {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: coverageFrom,
    positions: [{ instrumentId: btc, quantity: '0.3', costStatus: 'known', totalCostUsd: '15000' }],
  });
  await s.carry.initialize(owner, trust, {
    requestId: randomUUID(),
    expectedOpeningRevision: 1,
    assertReviewed: true,
    lots: [
      {
        instrumentId: btc,
        acquiredAt: '2024-12-01T00:00:00.000Z',
        orderWithinTimestamp: 0,
        originalQuantity: '0.4',
        originalCostUsd: '20000',
        remainingQuantity: '0.3',
      },
    ],
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
  const wallet = await chainRows(db, owner);
  await db.query(
    `INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ('BTC','USD','kraken',$1,'84945','hourly-close')`,
    [new Date(now.getTime() - 30 * 60_000)],
  );
  // Another owner's operations never mix in.
  const foreignBtc = await instrument(s, other, {
    name: 'Foreign bitcoin',
    symbol: 'BTC',
    assetType: 'crypto',
  });
  const foreign = await account(s, other, 'Foreign');
  await trade(s, other, foreign, foreignBtc, 'buy', '2025-06-13T00:00:00.000Z', '5', '1');

  const before = await fingerprint(db);
  const providers = await providerRequests();
  const list = await read(s, owner);
  assert.deepEqual(Object.keys(list).sort(), [
    'at',
    'needsClassificationCount',
    'operations',
    'quoteCurrency',
  ]);
  assert.equal(list.at, now.toISOString());
  assert.equal(list.quoteCurrency, 'USD');
  assert.equal(list.needsClassificationCount, 2);
  assert.deepEqual(list.operations.map(row), [
    [null, 'BTC', '0.0005', null, null, 'needs-classification', 'chain'],
    [null, 'BTC', '0.00918359', null, null, 'needs-classification', 'chain'],
    ['staking-reward', 'BTC', '0.0002', '20', 'Cold storage', 'recorded', 'manual'],
    ['transfer', 'BTC', '0.005', null, 'Bybit', 'recorded', 'manual'],
    ['swap', 'USDT', '500', '500', 'Bybit', 'recorded', 'manual'],
    ['buy', 'USDT', '1000', '1000', 'Bybit', 'recorded', 'manual'],
    ['buy', 'BTC', '0.01', '1050.5', 'Bybit', 'recorded', 'csv'],
    ['buy', 'BTC', '0.00918359', '1000', 'Bybit', 'recorded', 'manual'],
    ['deposit', 'USD', '2000', '2000', null, 'recorded', 'manual'],
    ['opening-balance', 'BTC', '0.3', null, 'Trust Wallet', 'recorded', 'manual'],
  ]);
  const [out, receipt, , transfer, swap, , imported] = list.operations;
  assert.deepEqual(receipt.wallet, {
    id: wallet,
    network: 'bitcoin',
    address: walletAddress,
    label: null,
  });
  assert.equal(receipt.account, null, 'An address in no wallet yet has no account');
  assert.equal(receipt.direction, 'in');
  assert.equal(receipt.estimatedValueUsd, '780.10005255');
  assert.equal(receipt.fee, null);
  assert.deepEqual(receipt.chain, {
    txid: txid(1),
    blockHeight: 800001,
    priceObservedAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
  });
  assert.equal(out.direction, 'out');
  assert.deepEqual(out.fee, {
    asset: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
    quantity: '0.000003',
  });
  assert.equal(transfer.counterAccount.name, 'Cold storage');
  assert.deepEqual(transfer.fee, {
    asset: { instrumentId: btc, symbol: 'BTC', name: 'Bitcoin' },
    quantity: '0.0001',
  });
  assert.deepEqual([swap.counterAsset.symbol, swap.counterQuantity], ['BTC', '0.005']);
  assert.deepEqual(
    [imported.feeUsd, imported.occurredAt, imported.version],
    ['1.25', '2025-06-14T10:30:00.000Z', 1],
  );
  assert.equal(list.operations.at(-1).costBasisUsd, '15000');
  assert.equal(list.operations.at(-1).occurredAt, '2024-12-01T00:00:00.000Z');
  assert.ok(
    list.operations.every((operation) => operation.asset.instrumentId !== foreignBtc),
    'Foreign rows are absent',
  );

  const foreignList = await read(s, other);
  assert.deepEqual(foreignList.operations.map(row), [
    ['buy', 'BTC', '5', '1', 'Foreign', 'recorded', 'manual'],
  ]);
  assert.equal(foreignList.needsClassificationCount, 0);
  await rejected(() => read(s, owner, { asset: 'BTC' }), 400);
  await rejected(() => read(s, owner, []), 400);
  await rejected(() => s.operations.read('not-a-uuid', {}, now), 400);
  assert.equal(await fingerprint(db), before, 'Every read and refusal preserves all rows');
  assert.deepEqual(await providerRequests(), providers, 'Reads never call any provider');
  console.log('PASS OPS-LIST/OPS-KINDS/OPS-PRIVATE');

  // WAL-ACCOUNT / WAL-RENAME: chain rows show the wallet their address belongs to, under its
  // current name; a rename changes only the name.
  stage = 'WAL-ACCOUNT chain rows carry their account; WAL-RENAME renames only the name';
  await db.query(
    `UPDATE wallet_addresses SET "accountId"=$3, label='Savings' WHERE "ownerId"=$1 AND id=$2`,
    [owner, wallet, trust],
  );
  const journalBefore = await fingerprint(db);
  const renamed = await s.accounting.renameAccount(owner, trust, { name: '  Ledger  ' });
  assert.deepEqual([renamed.id, renamed.name], [trust, 'Ledger']);
  const bound = await read(s, owner);
  const chainRowsBound = bound.operations.filter((operation) => operation.kind === 'chain');
  assert.equal(chainRowsBound.length, 2);
  for (const operation of chainRowsBound) {
    assert.deepEqual(operation.account, { id: trust, name: 'Ledger' });
    assert.equal(operation.wallet.label, 'Savings');
    assert.equal(operation.status, 'needs-classification');
  }
  assert.equal(bound.operations.at(-1).account.name, 'Ledger', 'Recorded rows show the new name');
  assert.equal(bound.needsClassificationCount, 2);
  await rejected(() => s.accounting.renameAccount(other, trust, { name: 'Taken' }), 404);
  await rejected(() => s.accounting.renameAccount(owner, randomUUID(), { name: 'Absent' }), 404);
  for (const body of [{}, { name: '' }, { name: 'x'.repeat(121) }, { name: 'a\nb' }, { name: 'A', requestId: randomUUID() }])
    await rejected(() => s.accounting.renameAccount(owner, trust, body), 400);
  await s.accounting.renameAccount(owner, trust, { name: 'Trust Wallet' });
  assert.equal(await fingerprint(db), journalBefore, 'Renaming back restores every row exactly');
  await db.query(
    `UPDATE wallet_addresses SET "accountId"=NULL, label=NULL WHERE "ownerId"=$1 AND id=$2`,
    [owner, wallet],
  );
  console.log('PASS WAL-ACCOUNT/WAL-RENAME chain rows show their wallet; rename keeps every journal row');
}

async function emptyOwner(db, s, f) {
  stage = 'OPS-EMPTY an owner without operations';
  const list = await read(s, f.third);
  assert.deepEqual(list, {
    at: now.toISOString(),
    quoteCurrency: 'USD',
    needsClassificationCount: 0,
    operations: [],
  });
  console.log('PASS OPS-EMPTY');
}

async function threeCurrencies(db, s, f) {
  stage = 'OPS-CURRENCY values in EUR or RUB at the Bank of Russia rate of the date';
  await db.query(
    `INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit") VALUES
      ('USD','cbr','2025-06-13','80'),('EUR','cbr','2025-06-13','92')`,
  );
  const rub = await read(s, f.other, { currency: 'RUB' });
  assert.equal(rub.quoteCurrency, 'RUB');
  assert.deepEqual(
    rub.operations.map((operation) => [operation.valueUsd, operation.value, operation.feeValue]),
    [['1', '80', '0']],
  );
  // Without an asked currency the list uses the owner's main currency.
  await db.query(`INSERT INTO owner_settings("ownerId","mainCurrency") VALUES ($1,'EUR')`, [
    f.other,
  ]);
  const eur = await read(s, f.other);
  assert.equal(eur.quoteCurrency, 'EUR');
  assert.equal(eur.operations[0].value, '0.869565217391304347826086956522');
  assert.equal((await read(s, f.owner)).quoteCurrency, 'USD');
  await rejected(() => read(s, f.other, { currency: 'GBP' }), 400);
  await rejected(() => read(s, f.other, { currency: 'RUB', asset: 'BTC' }), 400);
  console.log('PASS OPS-CURRENCY');
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
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 33);
    const [owner, other, third] =
      await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('operations-owner@example.invalid','synthetic-not-a-hash',true),
      ('operations-other@example.invalid','synthetic-not-a-hash',true),
      ('operations-third@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = { owner: owner.id, other: other.id, third: third.id };
    for (const check of [everyJournal, emptyOwner, threeCurrencies]) await check(db, s, f);
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
