'use strict';
// classify-chain-transactions (M12) against fresh synthetic PostgreSQL: the compiled
// classification service writes its versions and the journal entries they stand for, and the
// actual read model lists the result. All data is synthetic.
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
const database = 'capital_tracker_chain_classification_e2e';
const modulePath = '/app/backend/dist/accounting/chain-classification.service.js';
const now = new Date();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const txid = (n) => sha256(`ct-chain-classification:${n}`);
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
    rewards,
    operations: make('operation-list.service', 'OperationListService'),
    classifications: make(
      'chain-classification.service',
      'ChainClassificationService',
      trades,
      rewards,
      make('owned-transfer.service', 'OwnedTransferService'),
    ),
  };
}
const rejected = (action, status) =>
  assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status,
  );
async function rawFingerprint(db, addressId) {
  const rows = await db.query(
    `SELECT to_jsonb(t)::text AS row FROM wallet_address_transactions t
      WHERE "addressId"=$1 ORDER BY row`,
    [addressId],
  );
  return sha256(JSON.stringify(rows));
}
async function account(s, owner, name) {
  return (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
}
async function wallet(db, owner, accountId, address) {
  const [{ id }] = await db.query(
    `INSERT INTO wallet_addresses(id,"ownerId",network,address,"accountId")
      VALUES ($1,$2,'bitcoin',$3,$4) RETURNING id`,
    [randomUUID(), owner, address, accountId],
  );
  return id;
}
// The raw rows a sync stores: received, sent and fee in satoshis, never edited afterwards.
async function raw(db, owner, addressId, n, direction, received, sent, fee, blockTime) {
  await db.query(
    `INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockHash",
      "blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT ("addressId",txid) DO NOTHING`,
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
const count = async (s, owner) => (await s.classifications.needsClassificationCount(owner)).count;
const listed = async (s, owner, n) =>
  (await s.operations.read(owner, {}, now)).operations.find(
    (operation) => operation.chain?.txid === txid(n),
  );
const lots = async (s, owner, accountId) =>
  (await s.trades.listLots(owner, accountId, {})).items.map((lot) => [
    lot.instrumentSymbol,
    lot.remainingQuantity,
    lot.remainingCostUsd,
  ]);
const tradeVersions = (db, tradeId) =>
  db.query(
    `SELECT version, kind, side, trim_scale(quantity)::text AS quantity, trim_scale("grossUsd")::text AS "grossUsd"
      FROM account_trade_versions WHERE "tradeId"=$1 ORDER BY version`,
    [tradeId],
  );

async function buyAndCount(db, s, f) {
  stage = 'CLS-COUNT / CLS-BUY a receipt classified as a buy';
  const { owner } = f;
  const trust = await account(s, owner, 'Trust Wallet');
  const address = await wallet(db, owner, trust, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  await raw(db, owner, address, 1, 'in', '918359', '0', '500', '2025-06-20T08:00:00.000Z');
  await raw(db, owner, address, 2, 'in', '1000000', '0', '400', '2025-06-21T08:00:00.000Z');
  await raw(db, owner, address, 3, 'out', '5700', '66000', '300', '2025-06-22T08:00:00.000Z');
  await raw(db, owner, address, 4, 'in', '546', '0', '200', '2025-06-23T08:00:00.000Z');
  const before = await rawFingerprint(db, address);
  assert.equal(await count(s, owner), 4, 'CLS-COUNT: every new chain transaction counts');

  const body = {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USDT', amount: '1000' },
    comment: 'From the exchange',
  };
  const requestId = randomUUID();
  const saved = await classify(s, owner, address, 1, { ...body, requestId });
  assert.equal(saved.created, true);
  assert.deepEqual(
    [saved.value.version, saved.value.status, saved.value.type, saved.value.comment],
    [1, 'classified', 'buy', 'From the exchange'],
  );
  assert.equal(saved.value.operation.kind, 'trade');
  assert.equal(saved.value.operation.accountId, trust);
  assert.equal(await count(s, owner), 3, 'CLS-BUY: the count drops by one');
  assert.deepEqual(await lots(s, owner, trust), [['BTC', '0.00918359', '1000']]);
  const row = await listed(s, owner, 1);
  assert.deepEqual(
    [row.type, row.status, row.source, row.valueUsd, row.account.id, row.comment],
    ['buy', 'recorded', 'chain', '1000', trust, 'From the exchange'],
  );
  const list = await s.operations.read(owner, {}, now);
  assert.equal(list.needsClassificationCount, 3);
  assert.equal(
    list.operations.filter((operation) => operation.kind === 'trade').length,
    0,
    'The produced buy is listed once, on its chain row',
  );

  stage = 'CLS-BUY replay, stale version, misfit and refusals';
  const replay = await classify(s, owner, address, 1, { ...body, requestId });
  assert.equal(replay.created, false);
  assert.deepEqual(replay.value, saved.value);
  await rejected(() => classify(s, owner, address, 1, { ...body, requestId, comment: 'x' }), 409);
  await rejected(() => classify(s, owner, address, 1, body), 409);
  await rejected(
    () =>
      classify(s, owner, address, 2, {
        expectedVersion: 0,
        classification: { type: 'expense', valueUsd: '5' },
      }),
    422,
  );
  await rejected(
    () =>
      classify(s, owner, address, 2, {
        expectedVersion: 0,
        classification: { type: 'buy', currency: 'USD', amount: '0' },
      }),
    400,
  );
  await rejected(
    () => s.classifications.classify(owner, address, 'f'.repeat(64), {
        ...body,
        hidden: false,
        requestId: randomUUID(),
      }),
    404,
  );
  await rejected(() => classify(s, f.other, address, 2, { ...body }), 404);
  const unbound = await wallet(db, owner, null, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  await raw(db, owner, unbound, 9, 'in', '1000', '0', '0', '2025-06-24T08:00:00.000Z');
  await rejected(() => classify(s, owner, unbound, 9, body), 422);
  // Hiding needs no account: nothing is recorded.
  await classify(s, owner, unbound, 9, { expectedVersion: 0, hidden: true, classification: null });
  assert.equal(await count(s, owner), 3);

  stage = 'PR-OPS-9 an outgoing payment sold: proceeds stay as cash';
  await classify(s, owner, address, 2, {
    expectedVersion: 0,
    classification: { type: 'income', valueUsd: '650' },
  });
  const sale = await classify(s, owner, address, 3, {
    expectedVersion: 0,
    classification: { type: 'sell', currency: 'USDT', amount: '40' },
  });
  assert.equal(sale.value.type, 'sell');
  const cash = (await lots(s, owner, trust)).find(([symbol]) => symbol === 'USDT');
  assert.deepEqual(cash, ['USDT', '40', '40']);
  assert.equal(await count(s, owner), 1);
  assert.equal(await rawFingerprint(db, address), before, 'Raw chain rows are never edited');
  console.log('PASS CLS-COUNT/CLS-BUY');
  return { trust, address };
}

async function hide(db, s, f, { address }) {
  stage = 'CLS-HIDE a dust receipt leaves holdings and the count, stays listed';
  const { owner } = f;
  const hidden = await classify(s, owner, address, 4, {
    expectedVersion: 0,
    hidden: true,
    classification: null,
    comment: 'Dust',
  });
  assert.deepEqual([hidden.value.status, hidden.value.operation], ['hidden', null]);
  assert.equal(await count(s, owner), 0);
  const row = await listed(s, owner, 4);
  assert.deepEqual([row.status, row.type, row.comment], ['hidden', null, 'Dust']);
  assert.deepEqual(row.classification, {
    version: 1,
    hidden: true,
    value: null,
    comment: 'Dust',
    automatic: false,
  });

  stage = 'CLS-HIDE hiding a classified receipt voids its entry; including restores it';
  const income = await classify(s, owner, address, 4, {
    expectedVersion: 1,
    classification: { type: 'reward', valueUsd: null },
  });
  assert.equal(income.value.operation.kind, 'reward');
  const rewardId = income.value.operation.id;
  await classify(s, owner, address, 4, {
    expectedVersion: 2,
    hidden: true,
    classification: { type: 'reward', valueUsd: null },
  });
  const [reward] = await db.query(
    `SELECT v.kind FROM account_rewards r JOIN account_reward_versions v ON v."rewardId"=r.id
      AND v.version=r."currentVersion" WHERE r.id=$1`,
    [rewardId],
  );
  assert.equal(reward.kind, 'void');
  assert.equal((await listed(s, owner, 4)).status, 'hidden');
  assert.equal(await count(s, owner), 0);
  const back = await classify(s, owner, address, 4, {
    expectedVersion: 3,
    classification: { type: 'reward', valueUsd: null },
  });
  assert.notEqual(back.value.operation.id, rewardId);
  assert.equal((await listed(s, owner, 4)).type, 'reward');
  console.log('PASS CLS-HIDE');

  stage = 'CLS-OTHER a receipt nobody can name counts without a purchase price or a deposit';
  const other = await classify(s, owner, address, 4, {
    expectedVersion: 4,
    classification: { type: 'other' },
    comment: 'Unknown origin',
  });
  assert.equal(other.value.operation.kind, 'reward');
  const [entry] = await db.query(
    `SELECT v.kind, v.category, v."acquisitionBasisUsd", v."incomeValueUsd"
      FROM account_rewards r JOIN account_reward_versions v ON v."rewardId"=r.id
        AND v.version=r."currentVersion" WHERE r.id=$1`,
    [other.value.operation.id],
  );
  assert.deepEqual(entry, {
    kind: 'create',
    category: 'unclassified',
    acquisitionBasisUsd: null,
    incomeValueUsd: null,
  });
  const row = await listed(s, owner, 4);
  assert.deepEqual(
    [row.type, row.status, row.valueUsd, row.costBasisUsd, row.comment],
    ['other', 'recorded', null, null, 'Unknown origin'],
  );
  assert.deepEqual(row.classification.value, { type: 'other' });
  assert.equal(await count(s, owner), 0);
  await rejected(
    () =>
      classify(s, owner, address, 3, {
        expectedVersion: 0,
        classification: { type: 'other' },
      }),
    422,
  );
  console.log('PASS CLS-OTHER');
}

async function reclassify(db, s, f, { trust, address }) {
  stage = 'CLS-RECLASSIFY income changed to buy voids the income and keeps both versions';
  const { owner } = f;
  const before = await listed(s, owner, 2);
  assert.equal(before.type, 'income');
  const [first] = await db.query(
    `SELECT "tradeId" FROM chain_transaction_classification_versions WHERE txid=$1 AND version=1`,
    [txid(2)],
  );
  // The sale of receipt 3 spent coins; the buy is added before the income is voided.
  const changed = await classify(s, owner, address, 2, {
    expectedVersion: 1,
    classification: { type: 'buy', currency: 'USD', amount: '600' },
  });
  assert.equal(changed.value.version, 2);
  assert.notEqual(changed.value.operation.id, first.tradeId);
  assert.deepEqual(
    (await tradeVersions(db, first.tradeId)).map((row) => [row.version, row.kind, row.grossUsd]),
    [
      [1, 'create', '650'],
      [2, 'void', '650'],
    ],
  );
  assert.deepEqual(
    (await tradeVersions(db, changed.value.operation.id)).map((row) => [row.kind, row.side]),
    [['create', 'buy']],
  );
  const versions = await db.query(
    `SELECT version, status, type FROM chain_transaction_classification_versions
      WHERE txid=$1 ORDER BY version`,
    [txid(2)],
  );
  assert.deepEqual(
    versions.map((row) => [row.version, row.status, row.type]),
    [
      [1, 'classified', 'income'],
      [2, 'classified', 'buy'],
    ],
  );
  assert.equal((await listed(s, owner, 2)).type, 'buy');
  assert.equal((await listed(s, owner, 2)).valueUsd, '600');

  stage = 'CLS-RESYNC a resync never changes or duplicates a classified transaction';
  const listBefore = await s.operations.read(owner, {}, now);
  const lotsBefore = await lots(s, owner, trust);
  await raw(db, owner, address, 1, 'in', '918359', '0', '500', '2025-06-20T08:00:00.000Z');
  await raw(db, owner, address, 2, 'in', '1000000', '0', '400', '2025-06-21T08:00:00.000Z');
  assert.deepEqual(await s.operations.read(owner, {}, now), listBefore);
  await assert.rejects(
    db.query('DELETE FROM wallet_address_transactions WHERE txid=$1', [txid(1)]),
    (error) => (error.driverError?.code ?? error.code) === '23001',
  );
  assert.deepEqual(await lots(s, owner, trust), lotsBefore);
  console.log('PASS CLS-RECLASSIFY/CLS-RESYNC');
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
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 34);
    const [owner, other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('classification-owner@example.invalid','synthetic-not-a-hash',true),
      ('classification-other@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = { owner: owner.id, other: other.id };
    const made = await buyAndCount(db, s, f);
    await hide(db, s, f, made);
    await reclassify(db, s, f, made);
    await rejected(() => s.classifications.classify(owner.id, made.address, txid(1), null), 400);
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
