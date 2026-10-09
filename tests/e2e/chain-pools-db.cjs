'use strict';
// liquidity-pool-chain-legs (POOL-*) against fresh synthetic PostgreSQL: the compiled
// classification service records coins put into a liquidity pool as still owned, returns them
// on withdrawal with the difference as pool income or impermanent loss, records pool rewards
// as income, and the books, the holdings, the address card and the operation list follow.
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
const database = 'capital_tracker_chain_pools_e2e';
const modulePath = '/app/backend/dist/accounting/chain-pool.js';
const now = new Date('2026-10-04T12:30:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hash = (n) => sha256(`ct-chain-pools:${n}`);
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
  const { WalletAddressService } = require('/app/backend/dist/wallet-addresses/wallet-address.service.js');
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
    // Listing reads only; no sync runs in this probe.
    addresses: new WalletAddressService(db, null),
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
// A wallet whose whole history is stored, so its address card shows balances.
async function wallet(db, owner, accountId, network, address) {
  const [{ id }] = await db.query(
    `INSERT INTO wallet_addresses(id,"ownerId",network,address,"accountId","completedAt")
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [randomUUID(), owner, network, address, accountId, now],
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
      leg.height === 0 ? null : sha256(`block:${leg.height}`),
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
const deposit = { type: 'pool-deposit' };
const withdrawalOf = (addressId, txid, valueUsd = null) => ({
  type: 'pool-withdrawal',
  deposit: { addressId, txid },
  valueUsd,
});
const count = async (s, owner) => (await s.classifications.needsClassificationCount(owner)).count;
const listed = async (s, owner) => (await s.operations.read(owner, {}, now)).operations;
const row = async (s, owner, txid) => (await listed(s, owner)).find((item) => item.chain?.txid === txid);
const journal = async (s, owner, accountId) =>
  (await s.trades.getJournal(owner, accountId)).journal;
const answer = async (db, addressId, txid) =>
  (
    await db.query(
      `SELECT v.version, v.status, v.type, v.details, v."accountId", v."rewardId",
          v."pairedAddressId", v."pairedTxid"
        FROM chain_transaction_classifications h
        JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
          AND v.txid=h.txid AND v.version=h."currentVersion"
        WHERE h."addressId"=$1 AND h.txid=$2`,
      [addressId, txid],
    )
  )[0];
const rewardKind = async (db, rewardId) =>
  (
    await db.query(
      `SELECT v.kind FROM account_rewards r JOIN account_reward_versions v ON v."ownerId"=r."ownerId"
        AND v."accountId"=r."accountId" AND v."rewardId"=r.id AND v.version=r."currentVersion"
        WHERE r.id=$1`,
      [rewardId],
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
async function card(s, owner, addressId) {
  return (await s.addresses.list(owner)).find((item) => item.id === addressId);
}
const balance = (summary, symbol) =>
  scaled(summary.balances.find((item) => item.symbol === symbol).quantity);

// Leg ids. An Ethereum token leg is the hash and its log index (M14).
const legs = {
  usdcIn: `${hash(1)}-1`,
  ethIn: hash(2),
  ethDeposit: hash(3),
  usdcDeposit: `${hash(3)}-4`,
  usdcReward: `${hash(4)}-2`,
  ethWithdrawal: hash(5),
  usdcWithdrawal: `${hash(5)}-3`,
  coldIn: hash(6),
  coldDeposit: hash(7),
  coldWithdrawal: hash(8),
  lateDeposit: `${hash(9)}-1`,
  usdcExtra: `${hash(10)}-1`,
  bybitOut: 'bybit-withdrawal-pool-probe-1',
};

async function setup(db, s, owner) {
  stage = 'synthetic wallets: Trust Wallet and Cold storage on Ethereum, a Bybit account';
  const trust = await account(s, owner, 'Trust Wallet');
  const cold = await account(s, owner, 'Cold storage');
  const exchange = await account(s, owner, 'Bybit');
  const eth = await wallet(db, owner, trust, 'ethereum', `0x${'cd'.repeat(20)}`);
  const vault = await wallet(db, owner, cold, 'ethereum', `0x${'ef'.repeat(20)}`);
  const bybit = await wallet(db, owner, exchange, 'bybit', '100000001');
  const at = (day, time) => `2026-${day}T${time}:00.000Z`;
  // 5000 USDC and 2 ETH arrive; 1 ETH (fee 0.001 ETH) and 3000 USDC go into a pool in one
  // transaction; 25 USDC of pool fees arrive; the pool returns 0.9 ETH (the withdrawal's fee
  // 0.0005 ETH) and 3400 USDC; Cold storage puts 0.5 ETH in and takes 0.6 ETH out; 10 more
  // USDC arrive; 100 USDC go into a pool after that; Bybit withdraws 50 USDC.
  await raw(db, owner, eth, { txid: legs.usdcIn, asset: 'USDC', height: 1, at: at('08-01', '09:00'), received: '5000000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, eth, { txid: legs.ethIn, height: 2, at: at('08-01', '09:30'), received: '2000000000000000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, eth, { txid: legs.ethDeposit, height: 3, at: at('08-10', '10:00'), received: '0', sent: '1001000000000000000', fee: '1000000000000000', direction: 'out' });
  await raw(db, owner, eth, { txid: legs.usdcDeposit, asset: 'USDC', height: 3, at: at('08-10', '10:00'), received: '0', sent: '3000000000', fee: '0', direction: 'out' });
  await raw(db, owner, eth, { txid: legs.usdcReward, asset: 'USDC', height: 4, at: at('08-20', '10:00'), received: '25000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, eth, { txid: legs.ethWithdrawal, height: 5, at: at('09-01', '10:00'), received: '900000000000000000', sent: '500000000000000', fee: '500000000000000', direction: 'in' });
  await raw(db, owner, eth, { txid: legs.usdcWithdrawal, asset: 'USDC', height: 5, at: at('09-01', '10:00'), received: '3400000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, vault, { txid: legs.coldIn, height: 6, at: at('08-02', '09:00'), received: '1000000000000000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, vault, { txid: legs.coldDeposit, height: 7, at: at('08-12', '09:00'), received: '0', sent: '500000000000000000', fee: '0', direction: 'out' });
  await raw(db, owner, vault, { txid: legs.coldWithdrawal, height: 8, at: at('09-10', '12:00'), received: '600000000000000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, eth, { txid: legs.lateDeposit, asset: 'USDC', height: 9, at: at('09-25', '10:00'), received: '0', sent: '100000000', fee: '0', direction: 'out' });
  await raw(db, owner, eth, { txid: legs.usdcExtra, asset: 'USDC', height: 10, at: at('09-20', '10:00'), received: '10000000', sent: '0', fee: '0', direction: 'in' });
  await raw(db, owner, bybit, { txid: legs.bybitOut, asset: 'USDC', height: 0, at: at('09-21', '10:00'), received: '0', sent: '50000000', fee: '0', direction: 'out' });
  stage = 'synthetic stored ETH prices: 3000 an hour before the cold withdrawal, 3100 after it';
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ('ETH','USD','kraken','2026-09-10T11:00:00Z',3000,'hourly-close'),
      ('ETH','USD','kraken','2026-09-10T13:00:00Z',3100,'hourly-close')`);
  await classify(s, owner, eth, legs.usdcIn, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '5000' },
  });
  await classify(s, owner, eth, legs.ethIn, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '5000' },
  });
  await classify(s, owner, vault, legs.coldIn, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '2500' },
  });
  assert.equal(await count(s, owner), 10);
  return { trust, cold, exchange, eth, vault, bybit };
}

async function deposits(db, s, owner, f) {
  stage = 'POOL-DEPOSIT 1 ETH and 3000 USDC go into the pool and stay the owner\'s coins';
  // Before an answer the deposit counts as coins that left (D1), as every unanswered leg does.
  const ethBefore = await held(s, owner, 'ETH', f.trust);
  const usdcBefore = await held(s, owner, 'USDC', f.trust);
  const saved = await classify(s, owner, f.eth, legs.ethDeposit, { expectedVersion: 0, classification: deposit });
  assert.equal(saved.value.type, 'pool-deposit');
  assert.equal(saved.value.operation, null, 'A pool deposit records no journal entry');
  await classify(s, owner, f.eth, legs.usdcDeposit, { expectedVersion: 0, classification: deposit });
  assert.equal(await count(s, owner), 8, 'Both legs of the deposit stop asking');
  const eth = await held(s, owner, 'ETH', f.trust);
  const usdc = await held(s, owner, 'USDC', f.trust);
  assert.equal(eth, ethBefore + coins('1'), 'The 1 ETH stays held; only the 0.001 ETH fee left');
  assert.equal(usdc, usdcBefore + coins('3000'));
  const books = await journal(s, owner, f.trust);
  same(books.summary.remainingCostUsd, '10000', 'The coins in the pool keep their purchase price');
  same(books.summary.realizedUsd, '0', 'Nothing is realised');

  stage = 'POOL-DEPOSIT the address card lists the coins in pools as part of its balance';
  const summary = await card(s, owner, f.eth);
  assert.deepEqual(
    summary.pools.map((item) => [item.symbol, scaled(item.quantity)]),
    [['ETH', coins('1')], ['USDC', coins('3000')]],
  );
  assert.equal(balance(summary, 'ETH'), eth, 'The chain balance and 1 ETH in the pool match the books');
  assert.equal(balance(summary, 'USDC'), usdc, 'The chain balance and 3000 USDC in the pool');
  assert.equal((await card(s, owner, f.vault)).pools, null, 'Cold storage has nothing in a pool yet');

  stage = 'POOL-DEPOSIT the list shows both legs as pool deposits between own places';
  const ethRow = await row(s, owner, legs.ethDeposit);
  assert.deepEqual([ethRow.type, ethRow.status, ethRow.direction, ethRow.chain.direction], ['pool-deposit', 'recorded', 'internal', 'out']);
  same(ethRow.quantity, '1', 'The principal, the fee apart');
  same(ethRow.fee.quantity, '0.001');
  const usdcRow = await row(s, owner, legs.usdcDeposit);
  assert.deepEqual([usdcRow.type, usdcRow.status], ['pool-deposit', 'recorded']);
  same(usdcRow.quantity, '3000');
  console.log('PASS POOL-DEPOSIT');
}

async function reward(db, s, owner, f) {
  stage = 'POOL-REWARD 25 USDC of pool fees are income at the value entered';
  const before = await held(s, owner, 'USDC', f.trust);
  const saved = await classify(s, owner, f.eth, legs.usdcReward, {
    expectedVersion: 0,
    classification: { type: 'pool-reward', valueUsd: '25' },
  });
  assert.equal(saved.value.operation.kind, 'reward');
  const books = await journal(s, owner, f.trust);
  same(books.summary.remainingCostUsd, '10025');
  same(books.rewardSummary.knownIncomeSubtotalUsd, '25');
  assert.equal(await held(s, owner, 'USDC', f.trust), before, 'Counted before, now with its value');
  const listedReward = await row(s, owner, legs.usdcReward);
  assert.deepEqual([listedReward.type, listedReward.status], ['pool-reward', 'recorded']);
  same(listedReward.valueUsd, '25');
  assert.equal(await count(s, owner), 7);
  console.log('PASS POOL-REWARD');
}

async function withdrawals(db, s, owner, f) {
  stage = 'POOL-WITHDRAW 3400 USDC return 3000 USDC of principal and 400 USDC of pool income';
  const usdc = await classify(s, owner, f.eth, legs.usdcWithdrawal, {
    expectedVersion: 0,
    classification: withdrawalOf(f.eth, legs.usdcDeposit),
  });
  assert.equal(usdc.value.operation.kind, 'reward', 'The gain is recorded as income');
  assert.deepEqual(usdc.value.paired, { addressId: f.eth, txid: legs.usdcDeposit });
  const stored = await answer(db, f.eth, legs.usdcWithdrawal);
  assert.deepEqual([stored.type, stored.pairedAddressId, stored.pairedTxid], ['pool-withdrawal', f.eth, legs.usdcDeposit]);
  let books = await journal(s, owner, f.trust);
  same(books.rewardSummary.knownIncomeSubtotalUsd, '425', 'USDC counts 1:1 with USD');
  same(books.summary.remainingCostUsd, '10425');
  assert.equal(
    await held(s, owner, 'USDC', f.trust),
    coins('5335'),
    'Chain: 5000 − 3000 + 25 + 3400, and the unanswered −100 and +10 (D1)',
  );

  stage = 'POOL-WITHDRAW 0.9 ETH return 1 ETH less 0.1 ETH of impermanent loss and the 0.0005 ETH fee';
  const eth = await classify(s, owner, f.eth, legs.ethWithdrawal, {
    expectedVersion: 0,
    classification: withdrawalOf(f.eth, legs.ethDeposit),
  });
  assert.equal(eth.value.operation, null, 'A loss records no income');
  books = await journal(s, owner, f.trust);
  same(books.rewardSummary.knownIncomeSubtotalUsd, '425', 'A loss is not negative income');
  assert.equal(await held(s, owner, 'ETH', f.trust), coins('1.8985'), 'Chain: 2 − 1.001 + 0.9 − 0.0005');
  assert.equal(await count(s, owner), 5);

  stage = 'POOL-WITHDRAW the address card shows no pool any more and matches the books';
  const summary = await card(s, owner, f.eth);
  assert.equal(summary.pools, null);
  assert.equal(balance(summary, 'ETH'), coins('1.8985'));
  assert.equal(balance(summary, 'USDC'), coins('5335'));

  stage = 'POOL-WITHDRAW the list shows both receipts with what was deposited and the difference';
  const operations = await listed(s, owner);
  const usdcRow = operations.find((item) => item.chain?.txid === legs.usdcWithdrawal);
  assert.deepEqual([usdcRow.type, usdcRow.status, usdcRow.direction, usdcRow.chain.pairedTxid], ['pool-withdrawal', 'recorded', 'internal', legs.usdcDeposit]);
  same(usdcRow.quantity, '3400');
  same(usdcRow.pool.deposited, '3000');
  same(usdcRow.pool.difference, '400');
  same(usdcRow.valueUsd, '400');
  const ethRow = operations.find((item) => item.chain?.txid === legs.ethWithdrawal);
  same(ethRow.quantity, '0.9');
  same(ethRow.pool.deposited, '1');
  same(ethRow.pool.difference, '-0.1');
  assert.equal(ethRow.valueUsd, null);
  same(ethRow.fee.quantity, '0.0005');
  assert.equal(
    operations.filter((item) => item.id === `reward:${stored.rewardId}`).length,
    0,
    'The produced income is shown on its chain row only',
  );

  stage = 'POOL-WITHDRAW Cold storage: 0.1 ETH more than deposited, at the stored price of 3000';
  await classify(s, owner, f.vault, legs.coldDeposit, { expectedVersion: 0, classification: deposit });
  await classify(s, owner, f.vault, legs.coldWithdrawal, {
    expectedVersion: 0,
    classification: withdrawalOf(f.vault, legs.coldDeposit),
  });
  const cold = await journal(s, owner, f.cold);
  same(cold.rewardSummary.knownIncomeSubtotalUsd, '300', '0.1 ETH × 3000 USD');
  assert.equal(await held(s, owner, 'ETH', f.cold), coins('1.1'));

  stage = 'POOL-WITHDRAW the export names the income produced by the withdrawal';
  const exported = (await s.exports.chain(db.manager, owner))
    .find((leg) => leg.txid === legs.usdcWithdrawal);
  assert.deepEqual([exported.classificationType, exported.operationId], ['pool-withdrawal', `reward:${stored.rewardId}`]);
  console.log('PASS POOL-WITHDRAW');
  return stored.rewardId;
}

async function undo(db, s, owner, f, rewardId) {
  stage = 'POOL-UNDO a deposit that a withdrawal names cannot be hidden or changed';
  const message = 'A pool withdrawal names this deposit; change the withdrawal first';
  await rejected(
    () => classify(s, owner, f.eth, legs.usdcDeposit, { expectedVersion: 1, hidden: true, classification: deposit }),
    422,
    message,
  );
  await rejected(
    () => classify(s, owner, f.eth, legs.usdcDeposit, { expectedVersion: 1, classification: { type: 'other' } }),
    422,
    message,
  );
  // A comment on the deposit changes nothing else.
  await classify(s, owner, f.eth, legs.usdcDeposit, { expectedVersion: 1, classification: deposit, comment: 'Uniswap' });

  stage = 'POOL-UNDO hiding the withdrawal voids its income and puts the deposit back in the pool';
  await classify(s, owner, f.eth, legs.usdcWithdrawal, {
    expectedVersion: 1,
    hidden: true,
    classification: withdrawalOf(f.eth, legs.usdcDeposit),
  });
  assert.equal(await rewardKind(db, rewardId), 'void');
  const summary = await card(s, owner, f.eth);
  assert.deepEqual(summary.pools.map((item) => [item.symbol, scaled(item.quantity)]), [['USDC', coins('3000')]]);
  assert.equal(
    await held(s, owner, 'USDC', f.trust),
    coins('4935'),
    'The hidden receipt is out; the 3000 USDC in the pool are held again',
  );

  stage = 'POOL-UNDO classifying it again with a value entered records that value';
  await classify(s, owner, f.eth, legs.usdcWithdrawal, {
    expectedVersion: 2,
    classification: withdrawalOf(f.eth, legs.usdcDeposit, '410'),
  });
  same((await journal(s, owner, f.trust)).rewardSummary.knownIncomeSubtotalUsd, '435');
  assert.equal(await held(s, owner, 'USDC', f.trust), coins('5335'));
  console.log('PASS POOL-UNDO');
}

async function invalid(db, s, owner, f) {
  stage = 'POOL-INVALID what does not fit is refused and nothing changes';
  const before = await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions');
  await classify(s, owner, f.eth, legs.lateDeposit, { expectedVersion: 0, classification: deposit });
  const after = await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions');
  await rejected(
    () => classify(s, owner, f.eth, legs.usdcExtra, { expectedVersion: 0, classification: withdrawalOf(f.eth, legs.usdcIn) }),
    422,
    'Choose a pool deposit',
  );
  await rejected(
    () => classify(s, owner, f.eth, legs.usdcExtra, { expectedVersion: 0, classification: withdrawalOf(f.eth, legs.ethDeposit) }),
    422,
    'A pool withdrawal returns the coin of its deposit',
  );
  await rejected(
    () => classify(s, owner, f.eth, legs.usdcExtra, { expectedVersion: 0, classification: withdrawalOf(f.eth, legs.usdcDeposit) }),
    422,
    'That pool deposit was already withdrawn',
  );
  await rejected(
    () => classify(s, owner, f.vault, legs.coldWithdrawal, { expectedVersion: 1, classification: withdrawalOf(f.eth, legs.ethDeposit) }),
    422,
    'Choose a pool deposit of this wallet',
  );
  await rejected(
    () => classify(s, owner, f.eth, legs.usdcExtra, { expectedVersion: 0, classification: withdrawalOf(f.eth, legs.lateDeposit) }),
    422,
    'Choose a pool deposit made before this withdrawal',
  );
  await rejected(
    () => classify(s, owner, f.eth, legs.usdcExtra, { expectedVersion: 0, classification: deposit }),
    422,
    'This type does not fit the direction of the transaction',
  );
  await rejected(
    () => classify(s, owner, f.bybit, legs.bybitOut, { expectedVersion: 0, classification: deposit }),
    422,
    'This type does not fit the direction of the transaction',
  );
  await rejected(
    () => classify(s, owner, f.eth, legs.usdcExtra, { expectedVersion: 0, classification: { type: 'pool-withdrawal', deposit: { addressId: f.eth } } }),
    400,
  );
  assert.ok(before[0].n < after[0].n);
  assert.deepEqual(
    await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions'),
    after,
  );
  console.log('PASS POOL-INVALID');
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
  assert.match(migrated.stdout, /Migrations applied: 48/);
  const db = source();
  try {
    await db.initialize();
    const [owner] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('pool-owner@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = await setup(db, s, owner.id);
    const before = await rawFingerprint(db, owner.id);
    await deposits(db, s, owner.id, f);
    await reward(db, s, owner.id, f);
    const rewardId = await withdrawals(db, s, owner.id, f);
    await undo(db, s, owner.id, f, rewardId);
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
