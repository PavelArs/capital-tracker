'use strict';
// swap-chain-coins (CLS-SWAP) against fresh synthetic PostgreSQL: the compiled classification
// service pairs an outgoing and an incoming raw chain transaction of the owner's addresses as
// one swap of any coin for any other, in one wallet or paid from another, and the books, the
// holdings and the operation list follow. All data is synthetic.
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
const database = 'capital_tracker_chain_swaps_e2e';
const modulePath = '/app/backend/dist/accounting/chain-swap.js';
const now = new Date('2026-10-04T12:30:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hash = (n) => sha256(`ct-chain-swaps:${n}`);
let stage = 'synthetic configuration';

// Exact decimal comparison at scale 30 (no floating point).
function scaled(value) {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const digits = BigInt(whole + fraction.padEnd(30, '0').slice(0, 30));
  return negative ? -digits : digits;
}
const same = (actual, expected, message) => assert.equal(scaled(actual), scaled(expected), message);

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
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trades,
    operations: make('operation-list.service', 'OperationListService'),
    portfolio: make('portfolio-valuation.service', 'PortfolioValuationService'),
    classifications: make(
      'chain-classification.service',
      'ChainClassificationService',
      trades,
      make('asset-reward.service', 'AssetRewardService'),
      make('owned-transfer.service', 'OwnedTransferService'),
      make('asset-swap.service', 'AssetSwapService'),
    ),
    exports: new (require('/app/backend/dist/owner-export/owner-export.service.js').OwnerExportService)(db),
  };
}
const rejected = (action, status, message) =>
  assert.rejects(
    async () => action(),
    (error) =>
      error.getStatus?.() === status && (message === undefined || error.message === message),
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
async function wallet(db, owner, accountId, network, address) {
  const [{ id }] = await db.query(
    `INSERT INTO wallet_addresses(id,"ownerId",network,address,"accountId")
      VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [randomUUID(), owner, network, address, accountId],
  );
  return id;
}
// The raw rows a sync stores, in base units, never edited afterwards.
async function raw(db, owner, addressId, leg) {
  await db.query(
    `INSERT INTO wallet_address_transactions("ownerId","addressId",txid,asset,"blockHeight",
      "blockHash","blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      owner,
      addressId,
      leg.txid,
      leg.asset ?? null,
      leg.height,
      sha256(`block:${leg.height}`),
      leg.at,
      leg.received,
      leg.sent,
      leg.fee,
      leg.direction,
      JSON.stringify({ hash: leg.txid }),
    ],
  );
}
const classify = (s, owner, addressId, txid, body) =>
  s.classifications.classify(owner, addressId, txid, {
    requestId: randomUUID(),
    hidden: false,
    ...body,
  });
const swapWith = (addressId, txid, valueUsd = null) => ({
  type: 'swap',
  with: { addressId, txid },
  valueUsd,
});
const count = async (s, owner) => (await s.classifications.needsClassificationCount(owner)).count;
const listed = async (s, owner) => (await s.operations.read(owner, {}, now)).operations;
const journal = async (s, owner, accountId) =>
  (await s.trades.getJournal(owner, accountId)).journal;
const answer = async (db, addressId, txid) =>
  (
    await db.query(
      `SELECT v.version, v.status, v.type, v.details, v."accountId", v."swapAccountId", v."swapId",
          v."transferId", v."pairedAddressId", v."pairedTxid"
        FROM chain_transaction_classifications h
        JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
          AND v.txid=h.txid AND v.version=h."currentVersion"
        WHERE h."addressId"=$1 AND h.txid=$2`,
      [addressId, txid],
    )
  )[0];
const swapKind = async (db, swapId) =>
  (
    await db.query(
      `SELECT v.kind FROM account_swaps s JOIN account_swap_versions v ON v."ownerId"=s."ownerId"
        AND v."accountId"=s."accountId" AND v."swapId"=s.id AND v.version=s."currentVersion"
        WHERE s.id=$1`,
      [swapId],
    )
  )[0].kind;
const transferKind = async (db, transferId) =>
  (
    await db.query(
      `SELECT v.kind FROM owned_transfers t JOIN owned_transfer_versions v
        ON v."transferId"=t.id AND v.version=t."currentVersion" WHERE t.id=$1`,
      [transferId],
    )
  )[0].kind;
async function held(s, owner, symbol, accountId) {
  const asset = (await s.portfolio.read(owner, { currency: 'USD' }, now)).assets.find(
    (item) => item.symbol === symbol,
  );
  const holdings = (asset?.holdings ?? []).filter(
    (holding) => accountId === undefined || holding.accountId === accountId,
  );
  return holdings.reduce((sum, holding) => sum + scaled(holding.quantity), 0n);
}
const coins = (value) => scaled(value);

// Leg ids. An Ethereum token leg is the hash and its log index (M14).
const legs = {
  usdtIn: `${hash(1)}-1`,
  ethIn: hash(2),
  usdtOut: `${hash(3)}-2`,
  gas: hash(3),
  btcIn: hash(4),
  ethOut: hash(5),
  coldIn: hash(6),
  btcOut: hash(7),
};

async function setup(db, s, owner) {
  stage = 'synthetic wallets: Trust Wallet with Ethereum and Bitcoin addresses, Cold storage';
  const trust = await account(s, owner, 'Trust Wallet');
  const cold = await account(s, owner, 'Cold storage');
  const eth = await wallet(db, owner, trust, 'ethereum', `0x${'ab'.repeat(20)}`);
  const btc = await wallet(db, owner, trust, 'bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  const vault = await wallet(db, owner, cold, 'bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  const at = (day, time) => `2026-${day}T${time}:00.000Z`;
  // 3000 USDT and 1 ETH arrive; 1000 USDT leave, the 0.001 ETH gas in a leg of its own; 0.0125
  // BTC arrive 40 minutes later and 0.005 BTC of them leave again; 0.5 ETH and its 0.001 ETH
  // fee leave; 0.02 BTC reach Cold.
  await raw(db, owner, eth, { txid: legs.usdtIn, asset: 'USDT', height: 1, at: at('08-01', '09:00'), received: '3000000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, eth, { txid: legs.ethIn, height: 2, at: at('08-01', '09:30'), received: '1000000000000000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, eth, { txid: legs.usdtOut, asset: 'USDT', height: 3, at: at('09-01', '10:00'), received: '0', sent: '1000000000', fee: '0', direction: 'out' });
  await raw(db, owner, eth, { txid: legs.gas, height: 3, at: at('09-01', '10:00'), received: '0', sent: '1000000000000000', fee: '1000000000000000', direction: 'out' });
  await raw(db, owner, btc, { txid: legs.btcIn, height: 800004, at: at('09-01', '10:40'), received: '1250000', sent: '0', fee: '1400', direction: 'in' });
  await raw(db, owner, btc, { txid: legs.btcOut, height: 800007, at: at('09-05', '08:00'), received: '0', sent: '500000', fee: '1000', direction: 'out' });
  await raw(db, owner, eth, { txid: legs.ethOut, height: 5, at: at('09-10', '12:00'), received: '0', sent: '501000000000000000', fee: '1000000000000000', direction: 'out' });
  await raw(db, owner, vault, { txid: legs.coldIn, height: 800006, at: at('09-10', '12:30'), received: '2000000', sent: '0', fee: '1500', direction: 'in' });
  stage = 'synthetic stored ETH prices: 3000 an hour before the cold swap, 3100 after it';
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ('ETH','USD','kraken','2026-09-10T11:00:00Z',3000,'hourly-close'),
      ('ETH','USD','kraken','2026-09-10T13:00:00Z',3100,'hourly-close')`);
  await classify(s, owner, eth, legs.usdtIn, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '3000' },
  });
  await classify(s, owner, eth, legs.ethIn, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '2500' },
  });
  assert.equal(await count(s, owner), 6);
  return { trust, cold, eth, btc, vault };
}

async function sameWallet(db, s, owner, f) {
  stage = 'CLS-SWAP-SAME the BTC receipt is paid with the 1000 USDT sent from the same wallet';
  const saved = await classify(s, owner, f.btc, legs.btcIn, {
    expectedVersion: 0,
    classification: swapWith(f.eth, legs.usdtOut),
  });
  assert.equal(saved.value.operation.kind, 'swap');
  assert.deepEqual(saved.value.paired, { addressId: f.eth, txid: legs.usdtOut });
  const bought = await answer(db, f.btc, legs.btcIn);
  const paid = await answer(db, f.eth, legs.usdtOut);
  assert.ok(bought.swapId);
  assert.deepEqual(
    [bought.status, bought.type, bought.swapAccountId, bought.transferId, bought.pairedAddressId, bought.pairedTxid],
    ['classified', 'swap', f.trust, null, f.eth, legs.usdtOut],
  );
  assert.deepEqual(
    [paid.version, paid.status, paid.type, paid.swapId, paid.pairedAddressId, paid.pairedTxid],
    [1, 'classified', 'swap', bought.swapId, f.btc, legs.btcIn],
  );
  assert.deepEqual(paid.details, { type: 'swap', with: { addressId: f.btc, txid: legs.btcIn }, valueUsd: null });
  assert.equal(await count(s, owner), 4, 'The gas, the BTC send, the ETH send and the cold receipt');

  stage = 'CLS-SWAP-SAME the books: USDT leaves at its cost, BTC costs 1000 USD, nothing realised';
  const books = await journal(s, owner, f.trust);
  same(books.summary.remainingCostUsd, '5500', '2000 USDT, 1 ETH and 0.0125 BTC at 1000 USD');
  same(books.swapSummary.realizedUsd, '0', 'USDT paid at its own cost');
  same(books.swapSummary.considerationUsd, '1000', 'USDT counts 1:1 with USD');
  assert.equal(await held(s, owner, 'USDT', f.trust), coins('2000'), 'Records match the chain');
  assert.equal(
    await held(s, owner, 'BTC', f.trust),
    coins('0.0075'),
    'The unanswered send of 0.005 BTC has already left (D1)',
  );

  stage = 'CLS-SWAP-SAME the list shows one swap USDT → BTC on the receiving row';
  const operations = await listed(s, owner);
  const rows = operations.filter((row) => [legs.usdtOut, legs.btcIn].includes(row.chain?.txid));
  assert.equal(rows.length, 1, 'The pair is listed once');
  const [row] = rows;
  assert.deepEqual(
    [row.id, row.type, row.status, row.asset.symbol, row.counterAsset.symbol, row.account.id, row.counterAccount],
    [`chain:${f.btc}:${legs.btcIn}`, 'swap', 'recorded', 'USDT', 'BTC', f.trust, null],
  );
  same(row.quantity, '1000');
  same(row.counterQuantity, '0.0125');
  same(row.valueUsd, '1000');
  assert.equal(row.counterWallet.id, f.eth);
  assert.equal(row.chain.pairedTxid, legs.usdtOut);
  assert.equal(
    operations.filter((operation) => operation.id === `swap:${bought.swapId}`).length,
    0,
    'The produced swap is shown on its chain row only',
  );
  assert.equal(operations.find((operation) => operation.chain?.txid === legs.gas).status, 'needs-classification');

  stage = 'CLS-SWAP-SAME the export lists the swap as produced by the receipt, and both legs name it';
  const exported = (await s.exports.operations(db.manager, owner)).find((entry) => entry.id === `swap:${bought.swapId}`);
  assert.deepEqual(
    [exported.source, exported.chainTxid, exported.asset, exported.counterAsset, exported.valueUsd],
    ['chain', legs.btcIn, 'USDT', 'BTC', '1000'],
  );
  const exportedLegs = (await s.exports.chain(db.manager, owner))
    .filter((leg) => [legs.usdtOut, legs.btcIn].includes(leg.txid));
  assert.deepEqual(exportedLegs.map((leg) => leg.operationId), [`swap:${bought.swapId}`, `swap:${bought.swapId}`]);
  console.log('PASS CLS-SWAP-SAME');
  return bought.swapId;
}

async function reclassify(db, s, owner, f, swapId) {
  stage = 'CLS-SWAP-UNDO hiding the BTC receipt voids the swap and frees the USDT send';
  await classify(s, owner, f.btc, legs.btcIn, {
    expectedVersion: 1,
    hidden: true,
    classification: swapWith(f.eth, legs.usdtOut),
  });
  assert.equal(await swapKind(db, swapId), 'void');
  const freed = await answer(db, f.eth, legs.usdtOut);
  assert.deepEqual([freed.version, freed.status, freed.swapId], [2, 'unclassified', null]);
  assert.equal(await count(s, owner), 5);
  same((await journal(s, owner, f.trust)).summary.remainingCostUsd, '5500', '3000 USDT and 1 ETH again');

  stage = 'CLS-SWAP-UNDO the old way round: BTC bought with the wallet\'s USDT, the send hidden';
  await classify(s, owner, f.btc, legs.btcIn, {
    expectedVersion: 2,
    classification: { type: 'buy', currency: 'USDT', amount: '1000' },
  });
  await classify(s, owner, f.eth, legs.usdtOut, { expectedVersion: 2, hidden: true, classification: null });
  assert.equal(await held(s, owner, 'USDT', f.trust), coins('2000'));
  // The BTC bought are partly sold later, so the buy cannot go before the swap replaces it.
  await classify(s, owner, f.btc, legs.btcOut, {
    expectedVersion: 0,
    classification: { type: 'sell', currency: 'USD', amount: '300' },
  });

  stage = 'CLS-SWAP-UNDO pairing from the USDT side replaces the buy and the hiding with one swap';
  await classify(s, owner, f.eth, legs.usdtOut, {
    expectedVersion: 3,
    classification: swapWith(f.btc, legs.btcIn, '1010'),
  });
  const bought = await answer(db, f.btc, legs.btcIn);
  assert.deepEqual([bought.version, bought.type, bought.pairedTxid], [4, 'swap', legs.usdtOut]);
  assert.deepEqual(bought.details.valueUsd, '1010');
  const books = await journal(s, owner, f.trust);
  same(
    books.summary.remainingCostUsd,
    '5406',
    '2000 USDT, 1 ETH, 300 USD kept from the sale and 0.0075 BTC of the 1010 USD entered',
  );
  same(books.swapSummary.realizedUsd, '10', 'The value entered realises 10 USD on the USDT');
  assert.equal(await held(s, owner, 'USDT', f.trust), coins('2000'), 'USDT is not spent twice');
  assert.equal(await held(s, owner, 'BTC', f.trust), coins('0.0075'));
  assert.equal(await count(s, owner), 3);
  assert.equal((await listed(s, owner)).filter((row) => row.type === 'buy' && row.chain?.txid === legs.btcIn).length, 0);
  console.log('PASS CLS-SWAP-UNDO');
}

async function crossWallet(db, s, owner, f) {
  stage = 'CLS-SWAP-CROSS 0.5 ETH from Trust Wallet pay for 0.02 BTC received in Cold storage';
  await classify(s, owner, f.eth, legs.ethOut, {
    expectedVersion: 0,
    classification: swapWith(f.vault, legs.coldIn),
  });
  const sent = await answer(db, f.eth, legs.ethOut);
  const arrived = await answer(db, f.vault, legs.coldIn);
  assert.ok(sent.transferId, 'An owned transfer carries the ETH to Cold storage first');
  assert.deepEqual(
    [sent.swapAccountId, arrived.swapAccountId, arrived.swapId, arrived.transferId],
    [f.cold, f.cold, sent.swapId, sent.transferId],
  );
  assert.equal(await transferKind(db, sent.transferId), 'create');
  const cold = await journal(s, owner, f.cold);
  same(cold.summary.remainingCostUsd, '1500', 'BTC at 0.5 ETH × the 3000 USD stored before the swap');
  same(cold.swapSummary.considerationUsd, '1500');
  same(cold.swapSummary.realizedUsd, '250', '1500 for ETH bought at 2500 per ETH');
  const trust = await journal(s, owner, f.trust);
  same(trust.transferSummary.feeConsumedBasisUsd, '2.5', 'The 0.001 ETH fee consumes its basis');
  same(trust.summary.remainingCostUsd, '4153.5', '2000 USDT, 0.499 ETH, 300 USD and 606 USD of BTC');
  assert.equal(await held(s, owner, 'ETH'), coins('0.498'), 'Chain ETH: 1 less two fees and 0.5');
  assert.equal(await held(s, owner, 'ETH', f.cold), 0n, 'Cold storage keeps no ETH');
  assert.equal(await held(s, owner, 'BTC', f.cold), coins('0.02'));

  stage = 'CLS-SWAP-CROSS the list shows one swap, paid from Trust Wallet, with the ETH fee';
  const rows = (await listed(s, owner)).filter((row) => [legs.ethOut, legs.coldIn].includes(row.chain?.txid));
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].type, rows[0].wallet.id, rows[0].account.id, rows[0].counterAccount.id, rows[0].counterWallet.id],
    ['swap', f.vault, f.cold, f.trust, f.eth],
  );
  same(rows[0].fee.quantity, '0.001');
  assert.equal(
    (await listed(s, owner)).filter((row) => row.id === `transfer:${sent.transferId}`).length,
    0,
    'The carrying transfer is part of the swap',
  );

  stage = 'CLS-SWAP-CROSS undoing the swap voids the swap and the carrying transfer';
  await classify(s, owner, f.vault, legs.coldIn, { expectedVersion: 1, classification: { type: 'other' } });
  assert.equal(await swapKind(db, sent.swapId), 'void');
  assert.equal(await transferKind(db, sent.transferId), 'void');
  assert.equal((await answer(db, f.eth, legs.ethOut)).status, 'unclassified');
  assert.equal(
    (await journal(s, owner, f.cold)).summary.remainingCostUsd,
    null,
    'Only the Other receipt is left in Cold storage, without a cost',
  );
  await classify(s, owner, f.vault, legs.coldIn, {
    expectedVersion: 2,
    classification: swapWith(f.eth, legs.ethOut),
  });
  same((await journal(s, owner, f.cold)).swapSummary.realizedUsd, '250');
  console.log('PASS CLS-SWAP-CROSS/CLS-SWAP-VALUE');
}

async function invalid(db, s, owner, f) {
  stage = 'CLS-SWAP-INVALID what does not fit is refused and nothing changes';
  const before = await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions');
  await rejected(
    () => classify(s, owner, f.eth, legs.gas, { expectedVersion: 0, classification: swapWith(f.eth, legs.ethOut) }),
    422,
    'Choose a transaction that moved coins the other way',
  );
  await rejected(
    () => classify(s, owner, f.eth, legs.usdtIn, { expectedVersion: 1, classification: swapWith(f.eth, legs.usdtOut) }),
    422,
    'A swap needs two different coins',
  );
  await rejected(
    () => classify(s, owner, f.btc, legs.btcIn, { expectedVersion: 4, classification: swapWith(f.btc, legs.btcIn) }),
    422,
    'Choose the other side of the swap',
  );
  await rejected(
    () => classify(s, owner, f.btc, legs.btcIn, { expectedVersion: 4, classification: swapWith(f.btc, hash(99)) }),
    404,
  );
  await rejected(
    () => classify(s, owner, f.btc, legs.btcIn, { expectedVersion: 4, classification: { type: 'swap', with: { addressId: f.eth } } }),
    400,
  );
  assert.deepEqual(
    await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions'),
    before,
  );
  console.log('PASS CLS-SWAP-INVALID');
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
  assert.match(migrated.stdout, /Migrations applied: 45/);
  const db = source();
  try {
    await db.initialize();
    const [owner] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('swap-owner@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = await setup(db, s, owner.id);
    const before = await rawFingerprint(db, owner.id);
    const swapId = await sameWallet(db, s, owner.id, f);
    await reclassify(db, s, owner.id, f, swapId);
    await crossWallet(db, s, owner.id, f);
    await invalid(db, s, owner.id, f);
    assert.equal(await rawFingerprint(db, owner.id), before, 'Raw chain rows are never edited');
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
