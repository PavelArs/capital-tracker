'use strict';
// wallet-removal (WALLET-REMOVE) against fresh synthetic PostgreSQL: stopping to track an
// address or a wallet keeps every stored transaction, answer and entry; the address only leaves
// the lists, the balances and the sync schedule, and adding it again brings its history back.
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
const database = 'capital_tracker_wallet_removal_e2e';
const modulePath = '/app/backend/dist/wallet-addresses/wallet-removal.js';
const now = new Date('2026-10-04T12:30:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const txid = (n) => sha256(`wr-wallet-removal:${n}`);
const ADDRESS = {
  a: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  b: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  c: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
};
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
  const classifications = make(
    'chain-classification.service',
    'ChainClassificationService',
    trades,
    make('asset-reward.service', 'AssetRewardService'),
    make('owned-transfer.service', 'OwnedTransferService'),
  );
  const { WalletSyncService } = require('/app/backend/dist/wallet-addresses/wallet-sync.service.js');
  const {
    WalletAddressService,
  } = require('/app/backend/dist/wallet-addresses/wallet-address.service.js');
  // No adapters: the probe stores raw rows itself, as a sync would.
  const sync = new WalletSyncService(db, new ConfigService({}), [], classifications);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    portfolio: make('portfolio-valuation.service', 'PortfolioValuationService'),
    operations: make('operation-list.service', 'OperationListService'),
    classifications,
    sync,
    addresses: new WalletAddressService(db, sync),
  };
}
const rejected = (action, status) =>
  assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status,
  );
async function rawFingerprint(db, owner) {
  const rows = await db.query(
    `SELECT to_jsonb(t)::text AS row FROM wallet_address_transactions t
      WHERE "ownerId"=$1 ORDER BY row`,
    [owner],
  );
  return sha256(JSON.stringify(rows));
}
async function account(s, owner, name) {
  return (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
}
// A registered address, as the API adds it.
async function track(s, owner, key, accountId) {
  const result = await s.addresses.register(owner, {
    network: 'bitcoin',
    address: ADDRESS[key],
    accountId,
  });
  return result;
}
// The raw rows a sync stores: received, sent and fee in satoshis, never edited afterwards.
async function raw(db, owner, addressId, n, received, sent, blockTime) {
  await db.query(
    `INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockHash",
      "blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10)`,
    [
      owner,
      addressId,
      txid(n),
      800000 + n,
      sha256(`block:${n}`),
      blockTime,
      received,
      sent,
      Number(received) > 0 ? 'in' : 'out',
      JSON.stringify({ txid: txid(n) }),
    ],
  );
}
const listed = async (s, owner) =>
  (await s.addresses.list(owner)).map((item) => item.id).sort();
const count = async (s, owner) => (await s.classifications.needsClassificationCount(owner)).count;
const rows = async (s, owner) =>
  (await s.operations.read(owner, {}, now)).operations.filter((operation) => operation.chain);
async function held(s, owner, accountId) {
  const portfolio = await s.portfolio.read(owner, {}, now);
  if (!portfolio.accounts.some((item) => item.accountId === accountId)) return null;
  return portfolio.assets.flatMap((asset) =>
    asset.holdings.filter((holding) => holding.accountId === accountId).map((h) => h.quantity),
  );
}

async function removeAddress(db, s, owner) {
  stage = 'synthetic wallets: Trust holds A (answered) and B (unanswered); Empty holds C';
  const trust = await account(s, owner, 'Trust Wallet');
  const empty = await account(s, owner, 'Empty wallet');
  const a = (await track(s, owner, 'a', trust)).value.id;
  const b = (await track(s, owner, 'b', trust)).value.id;
  const c = (await track(s, owner, 'c', empty)).value.id;
  await db.query(
    `INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
      SELECT 'BTC','USD','kraken',d,60000,'daily-close'
      FROM generate_series(timestamptz '2026-01-01 00:00+00', timestamptz '2026-10-04 00:00+00', interval '1 day') d`,
  );
  // A receives 0.6 BTC and the owner answers it as a purchase; B receives 0.1 BTC, unanswered.
  await raw(db, owner, a, 1, '60000000', '0', '2026-06-20T08:00:00.000Z');
  await raw(db, owner, b, 2, '10000000', '0', '2026-06-21T08:00:00.000Z');
  await s.classifications.classify(owner, a, txid(1), {
    requestId: randomUUID(),
    hidden: false,
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '30000' },
  });
  const before = await rawFingerprint(db, owner);
  assert.equal(await count(s, owner), 1, 'B waits for an answer');
  assert.equal((await rows(s, owner)).length, 2);
  assert.deepEqual(await held(s, owner, trust), ['0.7'], 'Both addresses count');

  stage = 'WALLET-REMOVE removing B drops its unanswered movement from every count';
  await s.addresses.remove(owner, b);
  assert.deepEqual(await listed(s, owner), [a, c].sort(), 'B left the list');
  assert.equal(await count(s, owner), 0, 'Nothing is left to classify');
  assert.deepEqual((await rows(s, owner)).map((row) => row.wallet.id), [a], "B's row is gone");
  assert.deepEqual(await held(s, owner, trust), ['0.6'], "B's coins are not counted");
  assert.equal(await rawFingerprint(db, owner), before, 'Stored transactions are untouched');
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM wallet_addresses WHERE id=$1', [b]))[0].n,
    1,
    'The address row stays',
  );

  stage = 'WALLET-REMOVE a removed address cannot be read, changed, synced or removed again';
  await rejected(() => s.addresses.remove(owner, b), 404);
  await rejected(() => s.addresses.sync(owner, b), 404);
  await rejected(() => s.addresses.update(owner, b, { label: 'Again' }), 404);
  await rejected(() => s.addresses.transactions(owner, b, {}), 404);
  await rejected(() => s.addresses.syncRuns(owner, b), 404);
  await rejected(() => s.addresses.remove(randomUUID(), a), 404);

  stage = 'WALLET-REMOVE the sync schedule skips a removed address';
  await s.sync.runDue(now);
  const sources = (await db.query(`SELECT key FROM sync_sources WHERE key LIKE 'wallet:%'`)).map(
    (row) => row.key,
  );
  assert.ok(!sources.includes(`wallet:${b}`), 'B was never scheduled again');

  stage = 'WALLET-REMOVE an answered address keeps its entry; only the unanswered rows go';
  await s.addresses.remove(owner, a);
  assert.deepEqual((await rows(s, owner)).map((row) => row.wallet.id), [a], "A's answered row stays");
  const trade = (await s.operations.read(owner, {}, now)).operations.find(
    (operation) => operation.chain?.txid === txid(1),
  );
  assert.deepEqual([trade.status, trade.type], ['recorded', 'buy'], 'The purchase stays recorded');

  stage = 'WALLET-REMOVE adding a removed address again brings its history back';
  const back = await track(s, owner, 'b', trust);
  assert.equal(back.created, true);
  assert.equal(back.value.id, b, 'The same address row returns');
  assert.equal(back.value.transactionCount, 1, 'Its stored history is still there');
  const again = await track(s, owner, 'a', trust);
  assert.equal(again.created, true);
  assert.deepEqual(await listed(s, owner), [a, b, c].sort());
  assert.equal(await count(s, owner), 1, 'B waits for an answer again');
  assert.deepEqual(await held(s, owner, trust), ['0.7']);
  const repeat = await track(s, owner, 'b', trust);
  assert.equal(repeat.created, false, 'A tracked address is returned as it is');
  assert.equal(await rawFingerprint(db, owner), before, 'Stored transactions are untouched');
  console.log('PASS WALLET-REMOVE-ADDRESS');
  return { trust, empty, a, b, c };
}

async function removeWallet(db, s, owner, f) {
  stage = 'WALLET-REMOVE-ACCOUNT a wallet with recorded transactions stays';
  await rejected(() => s.accounting.removeAccount(owner, f.trust), 409);
  assert.ok((await s.accounting.listAccounts(owner)).items.some((item) => item.id === f.trust));
  assert.equal((await listed(s, owner)).length, 3, 'Nothing was stopped');

  stage = 'WALLET-REMOVE-ACCOUNT an empty wallet leaves the lists with its addresses';
  await s.accounting.removeAccount(owner, f.empty);
  assert.ok(!(await s.accounting.listAccounts(owner)).items.some((item) => item.id === f.empty));
  assert.ok(!(await listed(s, owner)).includes(f.c), 'Its address stopped too');
  assert.equal(await held(s, owner, f.empty), null, 'It is not in the portfolio');
  await rejected(() => s.accounting.removeAccount(owner, f.empty), 404);
  await rejected(() => s.accounting.getAccount(owner, f.empty), 404);
  await rejected(() => s.accounting.renameAccount(owner, f.empty, { name: 'Back' }), 404);
  await rejected(
    () => s.addresses.register(owner, { network: 'bitcoin', address: ADDRESS.c, accountId: f.empty }),
    404,
  );
  await rejected(() => s.accounting.removeAccount(randomUUID(), f.trust), 404);

  stage = 'WALLET-REMOVE-ACCOUNT an address added again without a wallet comes back alone';
  const alone = await s.addresses.register(owner, { network: 'bitcoin', address: ADDRESS.c });
  assert.equal(alone.created, true);
  assert.equal(alone.value.id, f.c);
  assert.equal(alone.value.accountId, null);
  console.log('PASS WALLET-REMOVE-ACCOUNT');
}

async function exchangeKey(db, s, owner) {
  stage = 'WALLET-REMOVE removing a Bybit account wipes its stored API key';
  const wallet = randomUUID();
  await db.query(
    `INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES ($1,$2,'bybit','100200300')`,
    [wallet, owner],
  );
  await db.query(
    `INSERT INTO bybit_accounts("ownerId","walletId",credentials,"keyHint","ipBound","historyFrom",
        "tradesReadTo","depositsReadTo","internalReadTo","withdrawalsReadTo")
      VALUES ($1,$2,'{"sealed":"synthetic"}'::jsonb,'AbCd',false,now(),now(),now(),now(),now())`,
    [owner, wallet],
  );
  await s.addresses.remove(owner, wallet);
  const [stored] = await db.query('SELECT credentials FROM bybit_accounts WHERE "walletId"=$1', [
    wallet,
  ]);
  assert.deepEqual(stored.credentials, {}, 'No key is kept for an account nobody tracks');
  console.log('PASS WALLET-REMOVE-KEY');
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
  assert.match(migrated.stdout, /Migrations applied: 57/);
  const db = source();
  try {
    await db.initialize();
    const [owner, other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('removal-owner@example.invalid','synthetic-not-a-hash',true),
      ('removal-other@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = await removeAddress(db, s, owner.id);
    await removeWallet(db, s, owner.id, f);
    await exchangeKey(db, s, owner.id);
    assert.deepEqual(await listed(s, other.id), [], 'Another owner sees nothing of it');
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
