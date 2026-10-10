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
  const rewards = make('asset-reward.service', 'AssetRewardService');
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trades,
    rewards,
    history: make('audit-history.service', 'AuditHistoryService'),
    operations: make('operation-list.service', 'OperationListService'),
    portfolio: make('portfolio-valuation.service', 'PortfolioValuationService'),
    classifications: make(
      'chain-classification.service',
      'ChainClassificationService',
      trades,
      rewards,
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
  // TOKEN-FEE: the gas leg is the fee of the USDT send, not a transaction to classify.
  assert.equal(await count(s, owner), 5);
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
  assert.equal(await count(s, owner), 3, 'The BTC send, the ETH send and the cold receipt');

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
  // TOKEN-FEE: the gas the USDT send paid is the swap's fee, not a row of its own.
  same(row.fee.quantity, '0.001');
  assert.equal(operations.find((operation) => operation.chain?.txid === legs.gas), undefined);

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
  assert.equal(await count(s, owner), 4);
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
  assert.equal(await count(s, owner), 2);
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

// SWAP-ONE-TX and TOKEN-CHAIN: a DEX swap of 0.01 ETH for 25 USDC in one Ethereum transaction
// the owner's address sent to a router contract. The raw rows are stored as a sync stores them.
async function oneTransaction(db, s, owner, f) {
  stage = 'SWAP-ONE-TX a contract call that returned another coin is suggested as one swap';
  const dex = { eth: hash(10), usdc: `${hash(10)}-5` };
  const at = '2026-09-20T10:00:00.000Z';
  const insert = (txid, asset, received, sent, fee, direction, data) =>
    db.query(
      `INSERT INTO wallet_address_transactions("ownerId","addressId",txid,asset,"blockHeight",
        "blockHash","blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
        VALUES ($1,$2,$3,$4,10,$5,$6,$7,$8,$9,$10,$11)`,
      [owner, f.eth, txid, asset, sha256('block:10'), at, received, sent, fee, direction, JSON.stringify(data)],
    );
  await insert(dex.eth, null, '0', '11000000000000000', '1000000000000000', 'out', {
    hash: `0x${dex.eth}`,
    transaction: {
      hash: `0x${dex.eth}`,
      from: `0x${'AB'.repeat(20)}`,
      to: `0x${'7a'.repeat(20)}`,
      value: '10000000000000000',
      input: '0x7ff36ab5000000000000000000000000000000000000000000000000000000000000002a',
      methodId: '0x7ff36ab5',
      functionName: 'swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
    },
    internal: [],
  });
  await insert(dex.usdc, 'USDC', '25000000', '0', '0', 'in', { hash: `0x${dex.eth}`, transfer: {} });
  const untouched = await rawFingerprint(db, owner);
  const call = { method: 'swapExactETHForTokens' };
  const row = async (txid) =>
    (await listed(s, owner)).find((item) => item.wallet?.id === f.eth && item.chain?.txid === txid);
  const usdc = await row(dex.usdc);
  assert.deepEqual(usdc.asset, { instrumentId: null, symbol: 'USDC', name: 'USD Coin', network: 'ethereum' });
  assert.deepEqual([usdc.chain.call, usdc.chain.swapWith], [call, { addressId: f.eth, txid: dex.eth }]);
  const ether = await row(dex.eth);
  assert.equal('network' in ether.asset, false, "The network's own coin names no blockchain");
  assert.deepEqual([ether.chain.call, ether.chain.swapWith], [call, { addressId: f.eth, txid: dex.usdc }]);
  // A plain token send of another hash names no call and suggests nothing.
  const plain = await row(legs.usdtIn);
  assert.deepEqual([plain.chain.call, plain.chain.swapWith], [undefined, undefined]);
  assert.equal(plain.asset.network, 'ethereum');

  const saved = await classify(s, owner, f.eth, dex.usdc, {
    expectedVersion: 0,
    classification: swapWith(f.eth, dex.eth),
  });
  assert.equal(saved.value.status, 'classified');
  const swap = await row(dex.usdc);
  assert.deepEqual(
    [swap.type, swap.asset.symbol, swap.asset.network, swap.quantity, swap.counterAsset.symbol, swap.counterAsset.network, swap.counterQuantity, swap.valueUsd],
    ['swap', 'ETH', undefined, '0.01', 'USDC', 'ethereum', '25', '25'],
  );
  assert.equal(swap.chain.swapWith, undefined, 'An answered swap suggests nothing');
  assert.deepEqual(swap.chain.call, call);
  assert.equal(await row(dex.eth), undefined, 'The swap is listed once, on the coins it bought');
  const answered = await answer(db, f.eth, dex.eth);
  assert.deepEqual([answered.type, answered.pairedTxid], ['swap', dex.usdc]);
  const exported = (await s.exports.operations(db.manager, owner)).find(
    (entry) => entry.id === `swap:${answered.swapId}`,
  );
  assert.deepEqual(
    [exported.asset, exported.assetNetwork, exported.counterAsset, exported.counterAssetNetwork],
    ['ETH', null, 'USDC', 'ethereum'],
  );
  assert.equal(await rawFingerprint(db, owner), untouched, 'Raw chain rows are never edited');
  console.log('PASS SWAP-ONE-TX/TOKEN-CHAIN');
}

// CLS-RECORDED: 500 USDT left Trust Wallet to pay for 0.2 ETH the owner had already added by
// hand as a Buy paid in USDT. Unanswered, the send and the buy both take the USDT away.
async function recordedByHand(db, s, owner, f) {
  stage = 'CLS-RECORDED a manual buy paid in USDT and the chain send that paid it count twice';
  const paid = `${hash(11)}-3`;
  await raw(db, owner, f.eth, { txid: paid, asset: 'USDT', height: 11, at: '2026-09-25T10:00:00.000Z', received: '0', sent: '500000000', fee: '0', direction: 'out' });
  const waiting = await count(s, owner);
  assert.equal(await held(s, owner, 'USDT', f.trust), coins('1500'), 'The send counts before an answer (D1)');
  const [eth] = await db.query(
    `SELECT id FROM accounting_instruments WHERE "ownerId"=$1 AND symbol='ETH'`,
    [owner],
  );
  const revision = async () => (await journal(s, owner, f.trust)).journalRevision;
  const bought = await s.trades.create(owner, f.trust, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(),
    instrumentId: eth.id,
    side: 'buy',
    occurredAt: '2026-09-25T09:00:00.000Z',
    quantity: '0.2',
    grossUsd: '500',
    feeUsd: '0',
    settlementCurrency: 'USDT',
  });
  const tradeId = bought.value.trade.tradeId;
  assert.equal(await held(s, owner, 'USDT', f.trust), coins('1000'), 'The same 500 USDT leave twice');

  stage = 'CLS-RECORDED-INVALID only a counting record of this wallet that moved this coin this way';
  const recorded = (kind, id) => ({ type: 'recorded', operation: { kind, id } });
  const before = await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions');
  const produced = (await db.query(
    `SELECT v."tradeId" FROM chain_transaction_classifications h
      JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
        AND v.txid=h.txid AND v.version=h."currentVersion"
      WHERE h."addressId"=$1 AND h.txid=$2`,
    [f.eth, legs.usdtIn],
  ))[0].tradeId;
  assert.ok(produced);
  await rejected(
    () => classify(s, owner, f.eth, paid, { expectedVersion: 0, classification: recorded('trade', produced) }),
    422,
    'Choose an operation you added or imported',
  );
  await rejected(
    () => classify(s, owner, f.eth, paid, { expectedVersion: 0, classification: recorded('swap', randomUUID()) }),
    422,
    'Choose an operation you added or imported',
  );
  await rejected(
    () => classify(s, owner, f.btc, legs.btcOut, { expectedVersion: 1, classification: recorded('trade', tradeId) }),
    422,
    'That operation did not move this coin this way',
  );
  await rejected(
    () => classify(s, owner, f.vault, legs.coldIn, { expectedVersion: 3, classification: recorded('trade', tradeId) }),
    422,
    'Choose an operation of this wallet',
  );
  await rejected(
    () => classify(s, owner, f.eth, paid, { expectedVersion: 0, classification: { type: 'recorded', operation: { kind: 'reward', id: tradeId } } }),
    400,
  );
  assert.deepEqual(
    await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions'),
    before,
  );

  stage = 'CLS-RECORDED the send is the manual buy: no new entry, the USDT leave once';
  const saved = await classify(s, owner, f.eth, paid, {
    expectedVersion: 0,
    classification: recorded('trade', tradeId),
  });
  assert.equal(saved.value.operation, null, 'Nothing new is recorded');
  const linked = await answer(db, f.eth, paid);
  assert.deepEqual(
    [linked.status, linked.type, linked.accountId, linked.swapId, linked.transferId],
    ['classified', 'recorded', f.trust, null, null],
  );
  assert.deepEqual(linked.details, recorded('trade', tradeId));
  assert.equal(await held(s, owner, 'USDT', f.trust), coins('1500'));
  assert.equal(await count(s, owner), waiting - 1);
  let operations = await listed(s, owner);
  const row = operations.find((item) => item.chain?.txid === paid);
  assert.deepEqual(
    [row.type, row.status, row.source, row.asset.symbol, row.direction],
    ['buy', 'recorded', 'chain', 'USDT', 'out'],
  );
  same(row.quantity, '500');
  const manual = operations.find((item) => item.id === `trade:${tradeId}`);
  assert.deepEqual([manual.source, manual.status], ['manual', 'recorded'], 'The record stays listed');

  stage = 'CLS-RECORDED deleting the manual buy makes the send count and ask again';
  await s.trades.void(owner, f.trust, tradeId, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(),
  });
  assert.equal(await held(s, owner, 'USDT', f.trust), coins('1500'), 'Only the send takes USDT now');
  assert.equal(await count(s, owner), waiting);
  operations = await listed(s, owner);
  assert.equal(operations.find((item) => item.chain?.txid === paid).status, 'needs-classification');
  console.log('PASS CLS-RECORDED');
}


// CLS-PAID: 300 USDT left Trust Wallet to pay for 10 ZEC the owner added by hand in an account
// of its own as a Buy paid in USDT. That account held no USDT, so the buy entered as money from
// outside while the send also took the USDT away. Answering the send with the purchase carries
// the USDT over and settles the purchase against them.
async function paidFromAnotherWallet(db, s, owner, f) {
  stage = 'CLS-PAID a purchase in another account and the send that paid for it count twice';
  const zec = (await s.accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Zcash', symbol: 'ZEC' })).value;
  const zcash = await account(s, owner, 'Zcash');
  const sentAt = '2026-09-27T10:00:00.000Z';
  const paid = `${hash(21)}-4`;
  await raw(db, owner, f.eth, { txid: paid, asset: 'USDT', height: 21, at: sentAt, received: '0', sent: '300000000', fee: '0', direction: 'out' });
  const revision = async () => (await journal(s, owner, zcash))?.journalRevision ?? 0;
  const buy = async (at, quantity = '10') =>
    (await s.trades.create(owner, zcash, {
      requestId: randomUUID(),
      expectedJournalRevision: await revision(),
      instrumentId: zec.id,
      side: 'buy',
      occurredAt: at,
      quantity,
      grossUsd: '300',
      feeUsd: '0',
      settlementCurrency: 'USDT',
    })).value.trade.tradeId;
  const tradeId = await buy('2026-09-27T09:00:00.000Z');
  const cash = async (id) => (await listed(s, owner)).find((row) => row.id === `trade:${id}`).settlement?.quantity;
  same(await cash(tradeId), '0', 'The account held no USDT: the whole buy is money from outside');
  stage = 'CLS-PAID-INVALID only a purchase an account\'s cash has not paid, with USDT or USDC';
  const recorded = (kind, id) => ({ type: 'recorded', operation: { kind, id } });
  const versions = async () => (await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions'))[0].n;
  const before = await versions();
  const sold = (await s.trades.create(owner, zcash, {
    requestId: randomUUID(), expectedJournalRevision: await revision(), instrumentId: zec.id, side: 'sell',
    occurredAt: '2026-09-27T09:30:00.000Z', quantity: '1', grossUsd: '40', feeUsd: '0',
  })).value.trade.tradeId;
  await rejected(
    () => classify(s, owner, f.eth, paid, { expectedVersion: 0, classification: recorded('trade', sold) }),
    422,
    'Choose an operation of this wallet',
  );
  const gas = `${hash(23)}`;
  await raw(db, owner, f.eth, { txid: gas, height: 23, at: '2026-09-27T08:00:00.000Z', received: '0', sent: '10000000000000000', fee: '1000000000000000', direction: 'out' });
  await rejected(
    () => classify(s, owner, f.eth, gas, { expectedVersion: 0, classification: recorded('trade', tradeId) }),
    422,
    'Only USDT or USDC can pay for a purchase in another wallet',
  );
  await rejected(
    () => classify(s, owner, f.vault, legs.coldIn, { expectedVersion: 3, classification: recorded('trade', tradeId) }),
    422,
    'Choose an operation of this wallet',
  );
  assert.equal(await versions(), before, 'Nothing was saved');
  const waiting = await count(s, owner);
  const trustUsdt = await held(s, owner, 'USDT', f.trust);
  assert.equal(await held(s, owner, 'USDT', zcash), 0n);

  stage = 'CLS-PAID the send is the payment: the USDT move to the account just before the purchase';
  const saved = await classify(s, owner, f.eth, paid, {
    expectedVersion: 0,
    classification: recorded('trade', tradeId),
  });
  assert.equal(saved.value.operation.kind, 'transfer', 'The answer produced the carrying transfer');
  const linked = await answer(db, f.eth, paid);
  assert.deepEqual(
    [linked.status, linked.type, linked.accountId, linked.swapId],
    ['classified', 'recorded', f.trust, null],
  );
  assert.ok(linked.transferId);
  assert.deepEqual(linked.details, recorded('trade', tradeId));
  const [carry] = await db.query(
    `SELECT v."occurredAt", v.quantity::text, t."fromAccountId", t."toAccountId"
      FROM owned_transfers t JOIN owned_transfer_versions v ON v."transferId"=t.id AND v.version=t."currentVersion"
      WHERE t.id=$1`,
    [linked.transferId],
  );
  assert.equal(carry.occurredAt.toISOString(), '2026-09-27T08:59:59.999Z', 'Just before the purchase');
  same(carry.quantity, '300');
  assert.deepEqual([carry.fromAccountId, carry.toAccountId], [f.trust, zcash]);
  same(await cash(tradeId), '300', 'The purchase spends the USDT that arrived');
  assert.equal(await held(s, owner, 'USDT', f.trust), trustUsdt, 'The USDT leave once');
  assert.equal(await held(s, owner, 'USDT', zcash), 0n, 'And are spent on the ZEC');
  assert.equal(await held(s, owner, 'ZEC', zcash), coins('9'), '10 ZEC bought, 1 sold');
  assert.equal(await count(s, owner), waiting - 1);
  let operations = await listed(s, owner);
  const row = operations.find((item) => item.chain?.txid === paid);
  assert.deepEqual(
    [row.type, row.status, row.direction, row.asset.symbol, row.account.id, row.counterAccount.id],
    ['transfer', 'recorded', 'internal', 'USDT', f.trust, zcash],
  );
  same(row.quantity, '300');
  assert.equal(operations.filter((item) => item.id === `transfer:${linked.transferId}`).length, 0, 'Listed once, on the send');
  assert.equal(operations.find((item) => item.id === `trade:${tradeId}`).source, 'manual', 'The purchase stays the owner\'s');
  const exportedLeg = (await s.exports.chain(db.manager, owner)).find((leg) => leg.txid === paid);
  assert.equal(exportedLeg.operationId, `transfer:${linked.transferId}`, 'The export links the send to its transfer');
  const exportedCarry = (await s.exports.operations(db.manager, owner)).find((entry) => entry.id === `transfer:${linked.transferId}`);
  assert.deepEqual([exportedCarry.source, exportedCarry.chainTxid], ['chain', paid]);

  stage = 'CLS-PAID a purchase the carried USDT paid is not owed any more';
  await rejected(
    () => classify(s, owner, f.eth, `${hash(22)}-5`, { expectedVersion: 0, classification: recorded('trade', tradeId) }),
    404,
  );
  const second = `${hash(22)}-5`;
  await raw(db, owner, f.eth, { txid: second, asset: 'USDT', height: 22, at: '2026-09-27T11:00:00.000Z', received: '0', sent: '300000000', fee: '0', direction: 'out' });
  await rejected(
    () => classify(s, owner, f.eth, second, { expectedVersion: 0, classification: recorded('trade', tradeId) }),
    422,
    'That purchase was already paid from the cash of its account',
  );

  stage = 'CLS-PAID answering again gives the USDT back and settles the purchase without them';
  await classify(s, owner, f.eth, paid, { expectedVersion: 1, hidden: true, classification: null });
  assert.equal(await transferKind(db, linked.transferId), 'void');
  same(await cash(tradeId), '0', 'Back to money from outside');
  assert.equal(await held(s, owner, 'USDT', zcash), 0n);
  assert.equal(await count(s, owner), waiting, 'The hidden send asks no more, the second one waits');
  await classify(s, owner, f.eth, paid, { expectedVersion: 2, classification: recorded('trade', tradeId) });
  same(await cash(tradeId), '300');

  stage = 'CLS-PAID a send before the purchase is carried at its own time, and the purchase can be edited';
  const third = `${hash(24)}-6`;
  await raw(db, owner, f.eth, { txid: third, asset: 'USDT', height: 24, at: '2026-09-28T10:00:00.000Z', received: '0', sent: '100000000', fee: '0', direction: 'out' });
  const later = await buy('2026-09-28T12:00:00.000Z', '3');
  await classify(s, owner, f.eth, third, { expectedVersion: 0, classification: recorded('trade', later) });
  const [early] = await db.query(
    `SELECT v."occurredAt" FROM chain_transaction_classifications h
      JOIN chain_transaction_classification_versions c ON c."addressId"=h."addressId" AND c.txid=h.txid AND c.version=h."currentVersion"
      JOIN owned_transfers t ON t.id=c."transferId" JOIN owned_transfer_versions v ON v."transferId"=t.id AND v.version=t."currentVersion"
      WHERE h."addressId"=$1 AND h.txid=$2`,
    [f.eth, third],
  );
  assert.equal(early.occurredAt.toISOString(), '2026-09-28T10:00:00.000Z', 'At the time of the send');
  same(await cash(later), '100', 'Only the 100 USDT that arrived; the rest of its 300 is money from outside');
  assert.equal(await held(s, owner, 'USDT', zcash), 0n, 'Both purchases spent what arrived');
  const edited = (await listed(s, owner)).find((row) => row.id === `trade:${later}`);
  await s.trades.correct(owner, zcash, later, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(),
    instrumentId: zec.id,
    side: 'buy',
    occurredAt: '2026-09-28T12:00:00.000Z',
    quantity: '3',
    grossUsd: '90',
    feeUsd: '0',
    settlementCurrency: 'USDT',
  });
  same(await cash(later), '90', 'Edited, it still spends the carried USDT');
  assert.equal(edited.source, 'manual');

  stage = 'CLS-PAID a purchase from before the wallet held the coins is refused with a reason';
  const early1 = await buy('2026-07-01T09:00:00.000Z', '1');
  const fourth = `${hash(25)}-7`;
  await raw(db, owner, f.eth, { txid: fourth, asset: 'USDT', height: 25, at: '2026-09-29T10:00:00.000Z', received: '0', sent: '10000000', fee: '0', direction: 'out' });
  const rows = await versions();
  await rejected(
    () => classify(s, owner, f.eth, fourth, { expectedVersion: 0, classification: recorded('trade', early1) }),
    422,
    'The wallet did not hold these coins yet when that purchase was made; check the purchase date',
  );
  assert.equal(await versions(), rows, 'Nothing was saved');

  stage = 'CLS-PAID deleting the purchase leaves the send a transfer, its USDT in the account';
  const again = await answer(db, f.eth, paid);
  await s.trades.void(owner, zcash, sold, { requestId: randomUUID(), expectedJournalRevision: await revision() });
  await s.trades.void(owner, zcash, tradeId, { requestId: randomUUID(), expectedJournalRevision: await revision() });
  assert.equal(await held(s, owner, 'USDT', f.trust), trustUsdt - coins('410'), 'Gone from the wallet once, and the other sends too');
  assert.equal(await held(s, owner, 'USDT', zcash), coins('310'), 'And in the other account, with the 10 the edited purchase left');
  operations = await listed(s, owner);
  assert.deepEqual(
    [operations.find((item) => item.chain?.txid === paid).type, operations.find((item) => item.chain?.txid === paid).status],
    ['transfer', 'recorded'],
  );
  assert.equal((await answer(db, f.eth, paid)).transferId, again.transferId);

  console.log('PASS CLS-PAID');
}

// CLS-DUPLICATE: records the owner added by hand and the transactions of a wallet that repeat
// them. Unanswered, both count; the proposal replaces the record with the wallet's transaction,
// which says what the record said, in one step.
async function duplicates(db, s, owner) {
  stage = 'CLS-DUPLICATE a hand-added buy and the receipt of the same coins count twice';
  const dup = await account(s, owner, 'Duplicates');
  const elsewhere = await account(s, owner, 'Elsewhere');
  const w = await wallet(db, owner, dup, 'ethereum', `0x${'cd'.repeat(20)}`);
  const instrument = async (symbol) =>
    (await db.query('SELECT id FROM accounting_instruments WHERE "ownerId"=$1 AND symbol=$2', [owner, symbol]))[0].id;
  const eth = await instrument('ETH');
  const revision = async (id) => (await journal(s, owner, id))?.journalRevision ?? 0;
  const manual = async (id, side, at, quantity, grossUsd, more = {}) =>
    (await s.trades.create(owner, id, {
      requestId: randomUUID(),
      expectedJournalRevision: await revision(id),
      instrumentId: more.instrumentId ?? eth,
      side,
      occurredAt: at,
      quantity,
      grossUsd,
      feeUsd: '0',
      ...more.fields,
    })).value.trade.tradeId;
  const receipt = async (n, at, wei, direction = 'in') =>
    raw(db, owner, w, {
      txid: hash(n),
      height: n,
      at,
      received: direction === 'in' ? wei : '0',
      sent: direction === 'in' ? '0' : wei,
      fee: '0',
      direction,
    });
  const proposals = async () => (await s.classifications.duplicateProposals(owner)).proposals;
  const replace = (txid, version, proposal, over = {}) =>
    classify(s, owner, w, txid, {
      expectedVersion: version,
      classification: proposal.classification,
      ...(proposal.comment === null ? {} : { comment: proposal.comment }),
      replaces: { kind: proposal.record.kind, id: proposal.record.id, version: proposal.record.version },
      ...over,
    });
  const headKind = async (tradeId) =>
    (await db.query(
      `SELECT v.kind FROM account_trades t JOIN account_trade_versions v ON v."ownerId"=t."ownerId"
        AND v."accountId"=t."accountId" AND v."tradeId"=t.id AND v.version=t."currentVersion" WHERE t.id=$1`,
      [tradeId],
    ))[0].kind;
  const versions = async () =>
    (await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions'))[0].n;

  const bought = await manual(dup, 'buy', '2026-09-20T10:00:00.000Z', '0.4', '1200');
  await receipt(31, '2026-09-20T10:20:00.000Z', '400000000000000000');
  assert.equal(await held(s, owner, 'ETH', dup), coins('0.8'), 'The same 0.4 ETH count twice');
  let found = await proposals();
  assert.equal(found.length, 1, 'One duplicate is proposed');
  const [one] = found;
  assert.deepEqual([one.coin, one.direction, one.record.kind, one.record.id, one.record.type], ['ETH', 'in', 'trade', bought, 'buy']);
  assert.equal(one.transaction.txid, hash(31));
  same(one.transaction.quantity, '0.4');
  assert.equal(one.classification.type, 'buy');
  same(one.classification.amount, '1200');
  assert.equal(one.classification.currency, 'USD');

  stage = 'CLS-DUPLICATE-INVALID a stale, altered or foreign record is refused and nothing is saved';
  const before = await versions();
  await rejected(() => replace(hash(31), 0, one, { replaces: { kind: 'trade', id: bought, version: 2 } }), 409);
  await rejected(
    () => replace(hash(31), 0, one, { classification: { type: 'buy', currency: 'USD', amount: '1199' } }),
    409,
  );
  await rejected(() => replace(hash(31), 0, one, { hidden: true }), 400);
  await rejected(() => replace(hash(31), 0, one, { classification: null }), 400);
  const abroad = await manual(elsewhere, 'buy', '2026-09-20T10:00:00.000Z', '0.4', '1200');
  await rejected(() => replace(hash(31), 0, one, { replaces: { kind: 'trade', id: abroad, version: 1 } }), 409);
  await receipt(32, '2026-09-25T10:00:00.000Z', '400000000000000000');
  await rejected(() => replace(hash(32), 0, one), 422, 'That record is not the same movement as this transaction');
  assert.equal(await versions(), before, 'Nothing was saved');
  assert.equal(await headKind(bought), 'create', 'The record still counts');
  assert.equal((await proposals()).length, 1, 'A record in another account and a far receipt are not matches');

  stage = 'CLS-DUPLICATE the receipt replaces the record: it says what the record said';
  const waiting = await count(s, owner);
  const base = await held(s, owner, 'ETH', dup);
  const saved = await replace(hash(31), 0, one);
  const now1 = await answer(db, w, hash(31));
  assert.deepEqual([now1.status, now1.type, now1.accountId], ['classified', 'buy', dup]);
  assert.equal(await headKind(bought), 'void', 'The record is voided');
  assert.equal(await held(s, owner, 'ETH', dup), base - coins('0.4'), 'The ETH count once');
  assert.equal(await count(s, owner), waiting - 1);
  assert.ok(saved.value.operation.kind === 'trade' && saved.value.operation.id !== bought, 'A new entry of the transaction');
  let operations = await listed(s, owner);
  assert.equal(operations.filter((row) => row.id === `trade:${bought}`).length, 0, 'The record leaves the lists');
  const row = operations.find((item) => item.chain?.txid === hash(31));
  assert.deepEqual([row.type, row.status, row.asset.symbol], ['buy', 'recorded', 'ETH']);
  same(row.valueUsd, '1200');
  assert.equal((await proposals()).length, 0, 'Nothing is left to propose');
  const events = (await s.history.read(owner, {}, now)).events;
  assert.ok(events.some((event) => event.entity === 'trade' && event.entityId === bought && event.change === 'deleted'), 'The audit history shows the record deleted');
  assert.ok(events.some((event) => event.entity === 'classification' && event.entityId === `${w}:${hash(31)}` && event.change === 'created'), 'And the transaction answered');
  const again = await replace(hash(31), 0, one).catch((error) => error);
  assert.equal(again.getStatus?.(), 409, 'Replaying the answer on an answered transaction is refused');

  stage = 'CLS-DUPLICATE a sale and the send of the same coins count once after the replacement';
  const sold = await manual(dup, 'sell', '2026-09-22T08:00:00.000Z', '0.1', '350');
  const level = await held(s, owner, 'ETH', dup);
  await receipt(33, '2026-09-22T08:05:00.000Z', '100000000000000000', 'out');
  assert.equal(await held(s, owner, 'ETH', dup), level - coins('0.1'), 'The same 0.1 ETH leave twice');
  [found] = await proposals();
  assert.deepEqual([found.direction, found.record.id, found.classification.type], ['out', sold, 'sell']);
  await replace(hash(33), 0, found);
  assert.equal(await headKind(sold), 'void');
  assert.equal(await held(s, owner, 'ETH', dup), level, 'The 0.1 ETH leave once');
  assert.equal((await answer(db, w, hash(33))).type, 'sell');

  stage = 'CLS-DUPLICATE a hand-added reward and the receipt of the coins count twice';
  const reward = (
    await s.rewards.create(owner, dup, {
      requestId: randomUUID(),
      expectedJournalRevision: await revision(dup),
      instrumentId: eth,
      occurredAt: '2026-09-23T12:00:00.000Z',
      quantity: '0.02',
      assertReward: true,
      category: 'staking',
      acquisitionBasisUsd: '60',
      incomeValueUsd: '60',
    })
  ).value.reward.rewardId;
  const rewarded = await held(s, owner, 'ETH', dup);
  await receipt(34, '2026-09-23T12:05:00.000Z', '20000000000000000');
  assert.equal(await held(s, owner, 'ETH', dup), rewarded + coins('0.02'), 'The same 0.02 ETH count twice');
  [found] = await proposals();
  assert.deepEqual([found.record.kind, found.record.id, found.classification.type], ['reward', reward, 'staking-reward']);
  await replace(hash(34), 0, found);
  assert.equal(await held(s, owner, 'ETH', dup), rewarded, 'The reward counts once');
  assert.equal((await answer(db, w, hash(34))).type, 'staking-reward');
  assert.equal((await listed(s, owner)).filter((item) => item.id === `reward:${reward}`).length, 0);

  stage = 'CLS-DUPLICATE a buy paid in the account\'s USDT cash is replaced by a buy paid in the same cash';
  const cashAccount = await account(s, owner, 'Cash');
  const cw = await wallet(db, owner, cashAccount, 'ethereum', `0x${'ef'.repeat(20)}`);
  const usdt = await instrument('USDT');
  await manual(cashAccount, 'buy', '2026-09-24T08:00:00.000Z', '600', '600', { instrumentId: usdt });
  const priced = await manual(cashAccount, 'buy', '2026-09-24T09:00:00.000Z', '0.3', '600', {
    fields: { settlementCurrency: 'USDT' },
  });
  await raw(db, owner, cw, { txid: hash(35), height: 35, at: '2026-09-24T09:05:00.000Z', received: '300000000000000000', sent: '0', fee: '0', direction: 'in' });
  assert.equal(await held(s, owner, 'USDT', cashAccount), 0n, 'The 600 USDT bought were spent on the ETH');
  [found] = await proposals();
  assert.deepEqual([found.record.id, found.classification.currency], [priced, 'USDT']);
  await classify(s, owner, cw, hash(35), {
    expectedVersion: 0,
    classification: found.classification,
    replaces: { kind: 'trade', id: priced, version: 1 },
  });
  assert.equal(await headKind(priced), 'void');
  assert.equal(await held(s, owner, 'USDT', cashAccount), 0n, 'The USDT are spent once, not entered as new money');
  assert.equal(await held(s, owner, 'ETH', cashAccount), coins('0.3'));
  const [spent] = await db.query(
    `SELECT s.quantity::text FROM chain_transaction_classifications h
      JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId" AND v.txid=h.txid AND v.version=h."currentVersion"
      JOIN account_trade_version_settlements s ON s."tradeId"=v."tradeId" AND s.version=1
      WHERE h."addressId"=$1 AND h.txid=$2`,
    [cw, hash(35)],
  );
  same(spent.quantity, '600', 'The new buy spent the 600 USDT of the cash');

  stage = 'CLS-DUPLICATE a record a transaction already stands for is never offered';
  const named = await manual(dup, 'buy', '2026-09-26T10:00:00.000Z', '0.15', '450');
  await receipt(36, '2026-09-26T10:10:00.000Z', '150000000000000000');
  assert.equal((await proposals()).length, 1);
  await classify(s, owner, w, hash(36), {
    expectedVersion: 0,
    classification: { type: 'recorded', operation: { kind: 'trade', id: named } },
  });
  await receipt(37, '2026-09-26T10:20:00.000Z', '150000000000000000');
  assert.equal((await proposals()).length, 0, 'The record is tied to the first receipt');
  assert.equal(await headKind(named), 'create');

  stage = 'CLS-DUPLICATE-INVALID a record a later entry depends on is not replaced, and nothing is saved';
  const lone = await account(s, owner, 'Dependent');
  const dw = await wallet(db, owner, lone, 'ethereum', `0x${'ab'.repeat(19)}cd`);
  await manual(lone, 'buy', '2026-09-27T10:00:00.000Z', '0.5', '1500');
  await manual(lone, 'sell', '2026-09-27T12:00:00.000Z', '0.5', '1600');
  await raw(db, owner, dw, { txid: hash(38), height: 38, at: '2026-09-27T10:30:00.000Z', received: '500000000000000000', sent: '0', fee: '0', direction: 'in' });
  const [depends] = (await s.classifications.duplicateProposals(owner)).proposals.filter((item) => item.transaction.addressId === dw);
  const unchanged = await versions();
  await rejected(
    () => classify(s, owner, dw, hash(38), {
      expectedVersion: 0,
      classification: depends.classification,
      replaces: { kind: 'trade', id: depends.record.id, version: 1 },
    }),
    422,
    'The books would not hold the coins without that record; change the entries that depend on it first',
  );
  assert.equal(await versions(), unchanged, 'Nothing was saved');
  assert.equal(await headKind(depends.record.id), 'create', 'The record still counts');
  assert.equal(await held(s, owner, 'ETH', lone), coins('0.5'), 'Bought 0.5 and sold 0.5; only the receipt remains');

  console.log('PASS CLS-DUPLICATE');
}

async function swapOfRecord(db, s, owner) {
  stage = 'CLS-SWAP-RECORD a coin bought by hand and the stablecoin sent to pay for it become one swap';
  const home = await account(s, owner, 'Swap record');
  const w = await wallet(db, owner, home, 'ethereum', `0x${'5e'.repeat(20)}`);
  const instrument = async (symbol) =>
    (await db.query('SELECT id FROM accounting_instruments WHERE "ownerId"=$1 AND symbol=$2', [owner, symbol]))[0].id;
  const btc = await instrument('BTC');
  const revision = async () => (await journal(s, owner, home))?.journalRevision ?? 0;
  const manual = async (side, at, quantity, grossUsd, more = {}) =>
    (await s.trades.create(owner, home, {
      requestId: randomUUID(),
      expectedJournalRevision: await revision(),
      instrumentId: more.instrumentId ?? btc,
      side,
      occurredAt: at,
      quantity,
      grossUsd,
      feeUsd: '0',
      ...more.fields,
    })).value.trade.tradeId;
  const headKind = async (tradeId) =>
    (await db.query(
      `SELECT v.kind FROM account_trades t JOIN account_trade_versions v ON v."ownerId"=t."ownerId"
        AND v."accountId"=t."accountId" AND v."tradeId"=t.id AND v.version=t."currentVersion" WHERE t.id=$1`,
      [tradeId],
    ))[0].kind;
  const versions = async () =>
    (await db.query('SELECT count(*)::int AS n FROM chain_transaction_classification_versions'))[0].n;
  const record = (id, version = 1) => ({ kind: 'trade', id, version });
  const swapOf = (id, version = 1, valueUsd = null) => ({ type: 'swap', record: record(id, version), valueUsd });

  // 5000 USDC arrive and are answered as income; later 450 USDC leave. The purchase of 0.01 BTC
  // for 450 USD was added by hand, dated before the USDC arrived (an import without a time).
  await raw(db, owner, w, { txid: `${hash(41)}-1`, asset: 'USDC', height: 41, at: '2026-09-30T14:49:00.000Z', received: '5000000000', sent: '0', fee: '0', direction: 'in' });
  await classify(s, owner, w, `${hash(41)}-1`, { expectedVersion: 0, classification: { type: 'income', valueUsd: '5000' } });
  const bought = await manual('buy', '2026-09-30T00:00:00.000Z', '0.01', '450');
  const out = `${hash(42)}-1`;
  await raw(db, owner, w, { txid: out, asset: 'USDC', height: 42, at: '2026-09-30T15:34:00.000Z', received: '0', sent: '450000000', fee: '0', direction: 'out' });
  assert.equal(await held(s, owner, 'BTC', home), coins('0.01'));
  assert.equal(await held(s, owner, 'USDC', home), coins('4550'), 'The 450 USDC left and the purchase did not spend them');

  stage = 'CLS-SWAP-RECORD-INVALID a stale, altered or unfit record is refused and nothing is saved';
  const before = await versions();
  await rejected(() => classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(bought, 2) }), 409, 'That record changed; reload and try again');
  await rejected(() => classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(randomUUID()) }), 409);
  const abroadAccount = await account(s, owner, 'Swap record elsewhere');
  const abroad = (await s.trades.create(owner, abroadAccount, {
    requestId: randomUUID(), expectedJournalRevision: 0, instrumentId: btc, side: 'buy',
    occurredAt: '2026-09-30T00:00:00.000Z', quantity: '0.01', grossUsd: '450', feeUsd: '0',
  })).value.trade.tradeId;
  await rejected(() => classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(abroad) }), 409);
  const sale = await manual('sell', '2026-09-30T12:00:00.000Z', '0.001', '45');
  await rejected(
    () => classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(sale) }),
    422,
    'Choose a record that moved coins the other way',
  );
  const far = await manual('buy', '2026-09-01T12:00:00.000Z', '0.01', '450');
  await rejected(
    () => classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(far) }),
    422,
    'That record is too far from this transaction',
  );
  const usdcBuy = await manual('buy', '2026-09-30T10:00:00.000Z', '10', '10', { instrumentId: await instrument('USDC') });
  await rejected(
    () => classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(usdcBuy) }),
    422,
    'A swap needs two different coins',
  );
  const feed = await manual('buy', '2026-09-30T09:00:00.000Z', '0.01', '450', { fields: { feeUsd: '2' } });
  await rejected(
    () => classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(feed) }),
    422,
    'That record cannot be replaced by a swap',
  );
  await rejected(
    () => classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(bought), replaces: record(bought) }),
    400,
  );
  assert.equal(await versions(), before, 'Nothing was saved');
  assert.equal(await headKind(bought), 'create', 'The record still counts');

  stage = 'CLS-SWAP-RECORD the send answered as a swap against the purchase replaces it with one swap';
  const waiting = await count(s, owner);
  const btcLevel = await held(s, owner, 'BTC', home);
  const usdcLevel = await held(s, owner, 'USDC', home);
  const saved = await classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(bought) });
  assert.equal(saved.value.operation.kind, 'swap');
  const now1 = await answer(db, w, out);
  assert.deepEqual([now1.status, now1.type, now1.accountId, now1.pairedAddressId, now1.pairedTxid], ['classified', 'swap', home, null, null]);
  assert.equal(await swapKind(db, now1.swapId), 'create');
  assert.equal(await headKind(bought), 'void', 'The purchase is voided');
  assert.equal(await held(s, owner, 'BTC', home), btcLevel, 'The BTC count once');
  assert.equal(await held(s, owner, 'USDC', home), usdcLevel, 'The USDC left once');
  assert.equal(await count(s, owner), waiting - 1);
  const [stored] = await db.query(
    `SELECT v."outgoingQuantity"::text AS out, v."incomingQuantity"::text AS inc, v."considerationUsd"::text AS value,
        v."occurredAt" FROM account_swap_versions v WHERE v."swapId"=$1 AND v.version=1`,
    [now1.swapId],
  );
  same(stored.out, '450');
  same(stored.inc, '0.01');
  same(stored.value, '450', 'The purchase value stays the swap value');
  assert.equal(new Date(stored.occurredAt).toISOString(), '2026-09-30T15:34:00.000Z', 'The swap takes the transaction time');
  const operations = await listed(s, owner);
  assert.equal(operations.filter((row) => row.id === `trade:${bought}`).length, 0, 'The purchase leaves the lists');
  const row = operations.find((item) => item.chain?.txid === out);
  assert.deepEqual([row.type, row.status, row.asset.symbol, row.counterAsset.symbol], ['swap', 'recorded', 'USDC', 'BTC']);
  const events = (await s.history.read(owner, {}, now)).events;
  assert.ok(events.some((event) => event.entity === 'trade' && event.entityId === bought && event.change === 'deleted'), 'The audit history shows the purchase deleted');
  const again = await classify(s, owner, w, out, { expectedVersion: 0, classification: swapOf(bought) }).catch((error) => error);
  assert.equal(again.getStatus?.(), 409, 'Answering the answered send again is refused');

  stage = 'CLS-SWAP-RECORD changing the answer voids the swap and the coins count again as the new answer says';
  await classify(s, owner, w, out, { expectedVersion: 1, classification: { type: 'sell', currency: 'USD', amount: '450' } });
  assert.equal(await swapKind(db, now1.swapId), 'void');
  assert.equal(await held(s, owner, 'BTC', home), btcLevel - coins('0.01'), 'The purchase is not restored; the BTC go with the swap');

  stage = 'CLS-SWAP-RECORD a sale added by hand and the coins that arrived for it become one swap';
  await manual('buy', '2026-10-01T00:00:00.000Z', '0.05', '2200');
  const sold = await manual('sell', '2026-10-02T00:00:00.000Z', '0.02', '900');
  const level = await held(s, owner, 'BTC', home);
  const inbound = `${hash(43)}-1`;
  await raw(db, owner, w, { txid: inbound, asset: 'USDC', height: 43, at: '2026-10-02T09:00:00.000Z', received: '900000000', sent: '0', fee: '0', direction: 'in' });
  const usdc = await held(s, owner, 'USDC', home);
  await classify(s, owner, w, inbound, { expectedVersion: 0, classification: swapOf(sold, 1, '905') });
  const [received] = await db.query(
    `SELECT v."outgoingQuantity"::text AS out, v."incomingQuantity"::text AS inc, v."considerationUsd"::text AS value
      FROM account_swap_versions v WHERE v."swapId"=$1 AND v.version=1`,
    [(await answer(db, w, inbound)).swapId],
  );
  same(received.out, '0.02');
  same(received.inc, '900');
  same(received.value, '905', 'The value the owner gave wins');
  assert.equal(await headKind(sold), 'void');
  assert.equal(await held(s, owner, 'BTC', home), level, 'The 0.02 BTC left once');
  assert.equal(await held(s, owner, 'USDC', home), usdc, 'The 900 USDC arrived once');

  stage = 'CLS-SWAP-RECORD-INVALID a purchase a later entry depends on is not replaced, and nothing is saved';
  const lone = await account(s, owner, 'Swap record dependent');
  const dw = await wallet(db, owner, lone, 'ethereum', `0x${'6e'.repeat(20)}`);
  const first = (await s.trades.create(owner, lone, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    instrumentId: btc, side: 'buy', occurredAt: '2026-10-03T00:00:00.000Z', quantity: '0.1', grossUsd: '4000', feeUsd: '0',
  })).value.trade.tradeId;
  await s.trades.create(owner, lone, {
    requestId: randomUUID(),
    expectedJournalRevision: 1,
    instrumentId: btc, side: 'sell', occurredAt: '2026-10-03T08:00:00.000Z', quantity: '0.1', grossUsd: '4100', feeUsd: '0',
  });
  await raw(db, owner, dw, { txid: `${hash(44)}-1`, asset: 'USDC', height: 44, at: '2026-10-03T10:00:00.000Z', received: '0', sent: '4000000000', fee: '0', direction: 'out' });
  const unchanged = await versions();
  await rejected(() => classify(s, owner, dw, `${hash(44)}-1`, { expectedVersion: 0, classification: swapOf(first) }), 422);
  assert.equal(await versions(), unchanged, 'Nothing was saved');
  assert.equal(await headKind(first), 'create', 'The purchase still counts');

  console.log('PASS CLS-SWAP-RECORD');
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
  assert.match(migrated.stdout, /Migrations applied: 56/);
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
    await oneTransaction(db, s, owner.id, f);
    await recordedByHand(db, s, owner.id, f);
    await paidFromAnotherWallet(db, s, owner.id, f);
    await duplicates(db, s, owner.id);
    await swapOfRecord(db, s, owner.id);
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
