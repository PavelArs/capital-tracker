'use strict';

// Real PostgreSQL acceptance for track-solana-wallets (M15). Only Solana JSON-RPC is synthetic:
// requests leave through HTTPS_PROXY to the providers.cjs stub, which answers from the raw
// transactions this probe posts. Every key, signature and amount is synthetic.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');

const dist = '/app/backend/dist';
const { TypeOrmConfigService } = require(`${dist}/config/typeorm.config.js`);
const { WalletAddressService } = require(`${dist}/wallet-addresses/wallet-address.service.js`);
const { WalletSyncService } = require(`${dist}/wallet-addresses/wallet-sync.service.js`);
const { EsploraClient } = require(`${dist}/wallet-addresses/esplora-client.js`);
const { BitcoinSyncAdapter } = require(`${dist}/wallet-addresses/bitcoin-sync.adapter.js`);
const { SolanaRpcClient } = require(`${dist}/wallet-addresses/solana-rpc-client.js`);
const { SolanaSyncAdapter } = require(`${dist}/wallet-addresses/solana-sync.adapter.js`);
const { TrackSolanaWallets1792100000000 } = require(`${dist}/migrations/1792100000000-TrackSolanaWallets.js`);
const { TrackSolanaStake1792600000000 } = require(`${dist}/migrations/1792600000000-TrackSolanaStake.js`);
const { readChainMoves } = require(`${dist}/accounting/portfolio-valuation.service.js`);

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_solana_wallets_e2e';
const control = 'http://providers:8080/__control';
const solanaHost = 'api.mainnet-beta.solana.com';
const now = new Date('2026-10-06T12:00:00.000Z');
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// Base58 restated from the format so the probe does not trust the code it checks.
function base58(bytes) {
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}
const digest = (label) => createHash('sha256').update(label).digest();
// Synthetic keys and signatures: hashes of fixed labels, never a real wallet or transaction.
const key = (label) => base58(digest(`ct-e2e-sol:${label}`));
const sig = (n) => base58(Buffer.concat([digest(`ct-e2e-sol-tx:${n}`), digest(`ct-e2e-sol-tx2:${n}`)]));
// The public mints of USDT and USDC and the public SPL Token and System program ids.
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM = '11111111111111111111111111111111';
const wallets = { main: key('main'), cold: key('cold'), busy: key('busy'), staker: key('staker') };
// track-solana-stake: the public stake program id; a synthetic stake account and vote account.
const STAKE = 'Stake11111111111111111111111111111111111111';
const stakeAccount = key('stake-1');
const vote = key('vote-1');
const outside = key('outside');
const accounts = { mainUsdc: key('main-usdc'), mainUsdt: key('main-usdt'), mainOther: key('main-other'),
  outsideUsdc: key('outside-usdc'), outsideUsdt: key('outside-usdt'), outsideOther: key('outside-other') };
const otherMint = key('other-mint');
const SOL = 1_000_000_000;
const FEE = 5000;
const time = (slot) => 1760000000 + (slot - 300000000);
// The Bitcoin wallet that shares the scheduler: a synthetic base58check address.
const bitcoinAddress = '1H1dv7Mxs3yqdEGkx3HuMx6jLStmJi8e1d';

const balance = (accountIndex, mint, owner, amount) => ({ accountIndex, mint, owner, programId: TOKEN,
  uiTokenAmount: { amount: String(amount), decimals: 6, uiAmount: amount / 1e6, uiAmountString: String(amount / 1e6) } });
// A getTransaction result ("json" encoding) as mainnet returns it.
function tx(n, slot, { keys, pre, post, fee = FEE, err = null, preTokens = [], postTokens = [], loaded, instructions = [] }) {
  return { signature: sig(n), result: { slot, blockTime: time(slot), version: loaded ? 0 : 'legacy',
    meta: { err, status: err ? { Err: err } : { Ok: null }, fee, preBalances: pre, postBalances: post,
      preTokenBalances: preTokens, postTokenBalances: postTokens, innerInstructions: [], logMessages: [], rewards: [],
      ...(loaded ? { loadedAddresses: loaded } : {}) },
    transaction: { signatures: [sig(n)], message: { accountKeys: keys,
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      instructions, recentBlockhash: key(`blockhash:${slot}`) } } } };
}
// A stake program instruction ("json" encoding): its accounts by index and its u32 tag.
function stakeInstruction(program, accounts, tag) {
  const data = Buffer.alloc(12, 3);
  data.writeUInt32LE(tag, 0);
  return { programIdIndex: program, accounts, data: base58(data), stackHeight: null };
}
// getMultipleAccounts "jsonParsed" for a delegated stake account, as mainnet answers it.
const delegated = (lamports, activationEpoch) => ({ lamports, owner: STAKE, executable: false, rentEpoch: 0, space: 200,
  data: { program: 'stake', space: 200, parsed: { type: 'delegated', info: {
    meta: { authorized: { staker: wallets.staker, withdrawer: wallets.staker }, rentExemptReserve: '2282880',
      lockup: { custodian: SYSTEM, epoch: 0, unixTimestamp: 0 } },
    stake: { creditsObserved: 1, delegation: { voter: vote, stake: String(lamports - 2282880), activationEpoch: String(activationEpoch),
      deactivationEpoch: '18446744073709551615', warmupCooldownRate: 0.25 } } } } } });

// The provider history; the stub derives signatures and token accounts from it.
const history = [
  // 2 SOL from outside.
  tx(1, 300000001, { keys: [outside, wallets.main, SYSTEM], pre: [10 * SOL, 0, 1], post: [8 * SOL - FEE, 2 * SOL, 1] }),
  // 100 USDC into the main wallet's new token account; outside pays its rent.
  tx(2, 300000003, { keys: [outside, accounts.mainUsdc, accounts.outsideUsdc, wallets.main, USDC, TOKEN],
    pre: [8 * SOL, 0, 2039280, 0, 1, 1], post: [8 * SOL - 2039280 - FEE, 2039280, 2039280, 0, 1, 1],
    preTokens: [balance(2, USDC, outside, 500000000)],
    postTokens: [balance(1, USDC, wallets.main, 100000000), balance(2, USDC, outside, 400000000)] }),
  // 300 USDT to the main wallet's token account; the wallet itself is not in the transaction.
  tx(3, 300000004, { keys: [outside, accounts.outsideUsdt, accounts.mainUsdt, TOKEN],
    pre: [8 * SOL, 2039280, 2039280, 1], post: [8 * SOL - FEE, 2039280, 2039280, 1],
    preTokens: [balance(1, USDT, outside, 900000000), balance(2, USDT, wallets.main, 0)],
    postTokens: [balance(1, USDT, outside, 600000000), balance(2, USDT, wallets.main, 300000000)] }),
  // SOL-IDENTITY: the main wallet pays the fee and sends 25 USDC.
  tx(4, 300000010, { keys: [wallets.main, accounts.mainUsdc, accounts.outsideUsdc, TOKEN],
    pre: [2 * SOL, 2039280, 2039280, 1], post: [2 * SOL - FEE, 2039280, 2039280, 1],
    preTokens: [balance(1, USDC, wallets.main, 100000000), balance(2, USDC, outside, 400000000)],
    postTokens: [balance(1, USDC, wallets.main, 75000000), balance(2, USDC, outside, 425000000)] }),
  // 0.5 SOL from the main wallet to the cold wallet (another of the owner's accounts).
  tx(5, 300000020, { keys: [wallets.main, wallets.cold, SYSTEM],
    pre: [2 * SOL - FEE, 0, 1], post: [1.5 * SOL - 2 * FEE, 0.5 * SOL, 1] }),
  // A failed transaction the main wallet still pays the fee for.
  tx(6, 300000022, { keys: [wallets.main, outside, SYSTEM], err: { InstructionError: [0, { Custom: 1 }] },
    pre: [1.5 * SOL - 2 * FEE, 8 * SOL, 1], post: [1.5 * SOL - 3 * FEE, 8 * SOL, 1] }),
  // Another token is out of scope (Q7): the main wallet appears but nothing tracked moves.
  tx(7, 300000025, { keys: [outside, accounts.outsideOther, accounts.mainOther, wallets.main, TOKEN],
    pre: [8 * SOL, 1, 1, 1.5 * SOL - 3 * FEE, 1], post: [8 * SOL - FEE, 1, 1, 1.5 * SOL - 3 * FEE, 1],
    preTokens: [balance(1, otherMint, outside, 5000), balance(2, otherMint, wallets.main, 0)],
    postTokens: [balance(1, otherMint, outside, 0), balance(2, otherMint, wallets.main, 5000)] }),
  // A versioned transaction loads the main wallet from a lookup table: 0.25 SOL arrives.
  tx(8, 300000030, { keys: [outside, SYSTEM], loaded: { writable: [wallets.main], readonly: [] },
    pre: [8 * SOL, 1, 1.5 * SOL - 3 * FEE], post: [7.75 * SOL - FEE, 1, 1.75 * SOL - 3 * FEE] }),
  // Not final yet: above the finalized slot.
  tx(9, 300000150, { keys: [outside, wallets.main, SYSTEM], pre: [7 * SOL, 1.75 * SOL, 1], post: [6 * SOL - FEE, 2.75 * SOL, 1] }),
];
// Independent oracle of the stored legs of the main wallet, newest slot first.
const mainLegs = [
  { txid: sig(8), asset: null, received: 0.25 * SOL, sent: 0, fee: 0, direction: 'in', slot: 300000030 },
  { txid: sig(6), asset: null, received: 0, sent: FEE, fee: FEE, direction: 'out', slot: 300000022 },
  { txid: sig(5), asset: null, received: 0, sent: 0.5 * SOL + FEE, fee: FEE, direction: 'out', slot: 300000020 },
  { txid: sig(4), asset: null, received: 0, sent: FEE, fee: FEE, direction: 'out', slot: 300000010 },
  { txid: `${sig(4)}-2`, asset: 'USDC', received: 0, sent: 25000000, fee: 0, direction: 'out', slot: 300000010 },
  { txid: `${sig(3)}-1`, asset: 'USDT', received: 300000000, sent: 0, fee: 0, direction: 'in', slot: 300000004 },
  { txid: `${sig(2)}-2`, asset: 'USDC', received: 100000000, sent: 0, fee: 0, direction: 'in', slot: 300000003 },
  { txid: sig(1), asset: null, received: 2 * SOL, sent: 0, fee: 0, direction: 'in', slot: 300000001 },
];

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
// Few transactions per call keep each control body small.
async function postHistory(items, extra = {}) {
  for (let index = 0; index < items.length; index += 3) await post('solana', { transactions: items.slice(index, index + 3) });
  return post('solana', extra);
}
async function solanaCalls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).filter(({ url }) => new URL(url).hostname === solanaHost);
}
async function newRequests(action) {
  const before = (await solanaCalls()).length;
  const result = await action();
  return { result, calls: (await solanaCalls()).slice(before) };
}
// What one JSON-RPC call asked: its method and the address or signature it names.
const call = ({ method, rpc }) => {
  assert.equal(method, 'POST');
  const [first, second] = rpc.params;
  if (rpc.method === 'getSlot' || rpc.method === 'getEpochInfo') return [rpc.method];
  if (rpc.method === 'getTokenAccountsByOwner') return [rpc.method, first, second.mint];
  return [rpc.method, first];
};
function sourceFor(name) {
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: name })).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource(options);
}
async function createDatabase(name) {
  const client = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME, password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    assert.equal((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0, 'Never overwrite/reuse an existing database');
    assert.match(name, /^capital_tracker_solana_wallets_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, [`${dist}/migrate.js`], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function refusal(action, status) {
  await assert.rejects(async () => action(), (error) => error?.getStatus?.() === status);
}
async function stored(db, addressId) {
  return (await db.query(`SELECT txid, asset, "blockHeight", "blockHash", "blockTime", "receivedUnits"::text AS received,
    "sentUnits"::text AS sent, "feeUnits"::text AS fee, direction, raw FROM wallet_address_transactions
    WHERE "addressId"=$1 ORDER BY "blockHeight" DESC, txid`, [addressId]));
}
function assertLegs(rows, legs) {
  assert.deepEqual(rows.map((row) => ({ txid: row.txid, asset: row.asset, received: row.received, sent: row.sent,
    fee: row.fee, direction: row.direction, slot: row.blockHeight })),
  legs.map(({ txid, asset, received, sent, fee, direction, slot }) => ({ txid, asset, received: String(received),
    sent: String(sent), fee: String(fee), direction, slot })));
  rows.forEach((row, index) => {
    assert.equal(row.blockHash, null);
    assert.equal(row.blockTime.toISOString(), new Date(time(legs[index].slot) * 1000).toISOString());
    assert.equal(row.raw.txid, row.txid, 'Raw provider observation is retained');
    assert.equal(row.raw.signature, row.txid.split('-')[0]);
  });
}
function services(db) {
  const make = (file, name, ...rest) => new (require(`${dist}/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const classifications = make('chain-classification.service', 'ChainClassificationService', trades,
    make('asset-reward.service', 'AssetRewardService'), make('owned-transfer.service', 'OwnedTransferService'));
  const bitcoin = new BitcoinSyncAdapter(db, new EsploraClient());
  const solana = new SolanaSyncAdapter(db, new SolanaRpcClient({ pauseMs: 0 }));
  const scheduler = (enabled) => new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: String(enabled) }),
    [bitcoin, solana], classifications);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    operations: make('operation-list.service', 'OperationListService'),
    classifications,
    scheduler,
    addresses: new WalletAddressService(db, scheduler(false)),
  };
}

async function main() {
  for (const [name, value] of Object.entries(settings)) assert.equal(process.env[name], value, 'Exact synthetic environment required');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 43/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('sol-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('sol-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const s = services(db);
    const account = async (name) => (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
    const mainAccount = await account('Main');
    const coldAccount = await account('Cold');

    // WAL-ADD, WAL-INVALID, WAL-DUP: no provider call while an address is added.
    const added = await newRequests(async () => {
      const first = await s.addresses.register(owner, { network: 'solana', address: wallets.main, accountId: mainAccount, label: 'Main SOL' });
      const again = await s.addresses.register(owner, { network: 'solana', address: wallets.main, accountId: coldAccount });
      for (const input of [
        { network: 'solana', address: bitcoinAddress },
        { network: 'solana', address: `0x${'ab'.repeat(20)}` },
        { network: 'solana', address: wallets.main.slice(0, 31) },
        // A mistyped character outside base58.
        { network: 'solana', address: `${wallets.main.slice(0, -1)}0` },
        // A 64-byte secret key in base58.
        { network: 'solana', address: sig('secret') },
        { network: 'bitcoin', address: wallets.main },
        { network: 'ethereum', address: wallets.main },
      ]) await refusal(() => s.addresses.register(owner, input), 400);
      return { first, again };
    });
    assert.deepEqual(added.calls, []);
    const { first, again } = added.result;
    assert.deepEqual([first.created, again.created, again.value.id], [true, false, first.value.id]);
    assert.deepEqual([first.value.network, first.value.address, first.value.accountId, first.value.label, first.value.balances, first.value.sync.state],
      ['solana', wallets.main, mainAccount, 'Main SOL', null, 'never']);
    const main = first.value.id;
    assert.equal((await db.query('SELECT count(*)::int AS n FROM wallet_addresses WHERE "ownerId"=$1', [owner]))[0].n, 1);
    console.log('PASS WAL-ADD Solana address stored exactly as given; WAL-DUP returns the same wallet; WAL-INVALID 400 for a Bitcoin, Ethereum, short or mistyped address and a secret key; no provider call');

    // SOL-IDENTITY: the first sync lists the wallet's and its token accounts' signatures up to
    // the finalized slot, then reads each transaction once, oldest first.
    await postHistory(history, { slot: 300000100 });
    const sync1 = await newRequests(() => s.addresses.sync(owner, main));
    assert.deepEqual([sync1.result.outcome, sync1.result.reason, sync1.result.imported], ['complete', null, 8]);
    assert.deepEqual(sync1.calls.map(call), [
      ['getSlot'],
      ['getTokenAccountsByOwner', wallets.main, USDT],
      ['getTokenAccountsByOwner', wallets.main, USDC],
      ['getSignaturesForAddress', wallets.main],
      ['getSignaturesForAddress', accounts.mainUsdt],
      ['getSignaturesForAddress', accounts.mainUsdc],
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ['getTransaction', sig(n)]),
    ]);
    assert.ok(sync1.calls.every(({ url }) => url === `https://${solanaHost}/`));
    assertLegs(await stored(db, main), mainLegs);
    const both = (await stored(db, main)).filter((row) => row.txid.startsWith(sig(4)));
    assert.deepEqual(both.map((row) => [row.txid, row.asset, row.fee]), [[sig(4), null, String(FEE)], [`${sig(4)}-2`, 'USDC', '0']]);
    assert.equal(both[1].raw.mint, USDC);
    assert.equal(both[0].raw.transaction.meta.fee, FEE);
    // SYNC-RECONCILE: per asset, received minus sent of the whole stored history.
    const summary = sync1.result.address;
    assert.deepEqual(summary.balances, [
      { symbol: 'SOL', quantity: '1.749985000' },
      { symbol: 'USDT', quantity: '300.000000' },
      { symbol: 'USDC', quantity: '75.000000' },
    ]);
    assert.deepEqual([summary.chainBalance, summary.transactionCount, summary.sync.state], ['1.749985000', 8, 'complete']);
    assert.equal((await db.query('SELECT "scannedBlock" FROM wallet_addresses WHERE id=$1', [main]))[0].scannedBlock, 300000100);
    console.log('PASS SOL-IDENTITY one signature with a SOL fee and an SPL USDC transfer stores two legs (signature, signature-2); USDT sent to a token account is found through it; a failed transaction keeps its fee; other tokens skipped');
    console.log('PASS SYNC-RECONCILE complete history gives SOL 1.749985, USDT 300, USDC 75');

    // Resync: nothing twice; only a slot finalized since is read.
    const sync2 = await newRequests(() => s.addresses.sync(owner, main));
    assert.deepEqual([sync2.result.outcome, sync2.result.imported], ['complete', 0]);
    assert.deepEqual(sync2.calls.map(call), [['getSlot']]);
    await post('solana', { slot: 300000200 });
    const sync3 = await newRequests(() => s.addresses.sync(owner, main));
    assert.deepEqual([sync3.result.outcome, sync3.result.imported], ['complete', 1]);
    assert.deepEqual(sync3.calls.map(call).slice(3), [
      ['getSignaturesForAddress', wallets.main],
      ['getSignaturesForAddress', accounts.mainUsdt],
      ['getSignaturesForAddress', accounts.mainUsdc],
      ['getTransaction', sig(9)],
    ]);
    const finalLegs = [{ txid: sig(9), asset: null, received: SOL, sent: 0, fee: 0, direction: 'in', slot: 300000150 }, ...mainLegs];
    assertLegs(await stored(db, main), finalLegs);
    // Reading the same final slots again stores nothing twice.
    await db.query('UPDATE wallet_addresses SET "scannedBlock"=NULL, "completedAt"=NULL WHERE id=$1', [main]);
    const replay = await s.addresses.sync(owner, main);
    assert.deepEqual([replay.outcome, replay.imported, replay.address.transactionCount], ['complete', 0, 9]);
    assertLegs(await stored(db, main), finalLegs);
    console.log('PASS SOL-IDENTITY resync stores each leg once: 0 new on the same slot, 1 once its slot is final, 0 after a full replay');

    // Constraints: base58 Solana addresses and signatures only.
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'solana',$2)`,
      [owner, `0${wallets.busy.slice(1)}`]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'tron',$2)`,
      [owner, wallets.busy]), /wallet_addresses_(network|address)_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockTime",
      "receivedUnits","sentUnits","feeUnits",direction,raw) VALUES ($1,$2,$3,1,now(),0,0,0,'in',jsonb_build_object('txid',$3::text))`,
    [owner, main, `${sig(1)}-x`]), /wallet_address_transactions_txid_check/);
    console.log('PASS SOL-DB network, address and leg id checks refuse anything else');

    // SOL-LINK: once the main wallet's SOL has a cost, its send to the cold wallet becomes one transfer.
    const cold = (await s.addresses.register(owner, { network: 'solana', address: wallets.cold, accountId: coldAccount })).value.id;
    assert.equal((await s.addresses.sync(owner, cold)).imported, 1);
    await s.classifications.classify(owner, main, sig(1), { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '300' } });
    await s.classifications.classify(owner, main, `${sig(2)}-2`, { requestId: randomUUID(), hidden: false, expectedVersion: 0,
      classification: { type: 'buy', currency: 'USD', amount: '100' } });
    const links = await db.query(`SELECT "addressId", type, automatic, "transferId" FROM chain_transaction_classification_versions
      WHERE txid=$1 ORDER BY "addressId"`, [sig(5)]);
    assert.equal(links.length, 2, 'Both legs of the own transfer are answered');
    assert.ok(links.every((row) => row.type === 'transfer' && row.automatic === true && row.transferId === links[0].transferId));
    const list = (await s.operations.read(owner, {}, now)).operations;
    const byTx = (txid) => list.filter((operation) => operation.chain?.txid === txid);
    assert.deepEqual(byTx(sig(1)).map((operation) => [operation.asset.symbol, operation.quantity, operation.status]),
      [['SOL', '2', 'recorded']]);
    assert.deepEqual(byTx(`${sig(2)}-2`).map((operation) => [operation.asset.symbol, operation.quantity, operation.status]),
      [['USDC', '100', 'recorded']]);
    const transfer = byTx(sig(5));
    assert.equal(transfer.length, 1, 'A linked pair is listed once');
    assert.deepEqual([transfer[0].type, transfer[0].asset.symbol, transfer[0].quantity, transfer[0].fee?.asset.symbol, transfer[0].fee?.quantity],
      ['transfer', 'SOL', '0.5', 'SOL', '0.000005']);
    const usdcSend = byTx(`${sig(4)}-2`)[0];
    assert.deepEqual([usdcSend.asset.symbol, usdcSend.quantity, usdcSend.fee, usdcSend.status], ['USDC', '25', null, 'needs-classification']);
    const fee = byTx(sig(4))[0];
    assert.deepEqual([fee.asset.symbol, fee.quantity, fee.direction], ['SOL', '0.000005', 'out']);
    console.log('PASS SOL-LINK a 0.5 SOL send between own accounts auto-links into one transfer with its SOL fee; token legs list as USDC and USDT');

    // SYNC-ISOLATION and SYNC-BG: the hourly job runs Bitcoin and Solana; a busy Solana RPC
    // delays only its wallet, which recovers on its next due run.
    await db.query(`INSERT INTO sync_sources (key, state, "lastAttemptAt", "nextRunAt")
      SELECT 'wallet:' || id, 'synced', now(), now() + interval '1 day' FROM wallet_addresses
      ON CONFLICT (key) DO UPDATE SET "nextRunAt" = EXCLUDED."nextRunAt"`);
    const btc = (await s.addresses.register(owner, { network: 'bitcoin', address: bitcoinAddress })).value.id;
    const busy = (await s.addresses.register(owner, { network: 'solana', address: wallets.busy })).value.id;
    await post('bitcoin-history', { address: bitcoinAddress, count: 2 });
    await postHistory([tx(10, 300000060, { keys: [outside, wallets.busy, SYSTEM], pre: [5 * SOL, 0, 1], post: [2 * SOL - FEE, 3 * SOL, 1] })],
      { fault: { onRequest: 1, rateLimited: true } });
    const t0 = new Date();
    const tick = await s.scheduler(true).tick(t0);
    assert.deepEqual(tick, { outcome: 'ran', wallets: [{ id: btc, state: 'synced' }, { id: busy, state: 'delayed' }] });
    let listed = new Map((await s.addresses.list(owner)).map((item) => [item.id, item]));
    assert.deepEqual([listed.get(busy).sync.status, listed.get(busy).sync.errorMessage],
      ['delayed', 'The Solana data source is busy. The app tries again in a few minutes.']);
    assert.equal(listed.get(btc).transactionCount, 2);
    const t1 = new Date(t0.getTime() + 15 * 60000);
    assert.deepEqual(await s.scheduler(true).tick(t1), { outcome: 'ran', wallets: [{ id: busy, state: 'synced' }] });
    listed = new Map((await s.addresses.list(owner)).map((item) => [item.id, item]));
    assert.deepEqual([listed.get(busy).sync.status, listed.get(busy).sync.errorMessage, listed.get(busy).balances],
      ['synced', null, [{ symbol: 'SOL', quantity: '3.000000000' }, { symbol: 'USDT', quantity: '0.000000' }, { symbol: 'USDC', quantity: '0.000000' }]]);
    assertLegs(await stored(db, main), finalLegs);
    console.log('PASS SYNC-ISOLATION a rate-limited Solana RPC delays only its wallet with a readable reason; Bitcoin syncs');
    console.log('PASS SYNC-BG the hourly job syncs Solana wallets beside Bitcoin ones and recovers on the next due run');

    // Reads stay owner-scoped and per asset.
    const page = await s.addresses.transactions(owner, main, {});
    assert.equal(page.total, 9);
    assert.deepEqual(page.items.find((item) => item.txid === `${sig(2)}-2`), {
      txid: `${sig(2)}-2`, blockHeight: 300000003, blockTime: new Date(time(300000003) * 1000).toISOString(), direction: 'in',
      symbol: 'USDC', received: '100.000000', sent: '0.000000', net: '100.000000', fee: '0.000000000',
      receivedBtc: '100.000000', sentBtc: '0.000000', netBtc: '100.000000', feeBtc: '0.000000000',
      usdValue: null, usdValueStatus: 'missing',
    });
    await refusal(() => s.addresses.sync(stranger, main), 404);
    await refusal(() => s.addresses.transactions(stranger, main, {}), 404);
    assert.deepEqual(await s.addresses.list(stranger), []);
    console.log('PASS SOL-PRIVATE another owner gets 404 for the wallet and sees none; legs read per asset');

    // SOL-STAKE-FIND, SOL-STAKE-MOVE, SOL-STAKE-REWARD: 12 SOL arrive, 10 SOL go into a stake account
    // the wallet creates and delegates; the chain later shows that account with 10.04 SOL.
    const stakerAccount = await account('Staker');
    const staker = (await s.addresses.register(owner, { network: 'solana', address: wallets.staker, accountId: stakerAccount })).value.id;
    const toClassify = async () => (await s.classifications.needsClassificationCount(owner)).count;
    const waiting = await toClassify();
    await postHistory([
      tx(20, 300000210, { keys: [outside, wallets.staker, SYSTEM], pre: [20 * SOL, 0, 1], post: [8 * SOL - FEE, 12 * SOL, 1] }),
      tx(21, 300000220, { keys: [wallets.staker, stakeAccount, SYSTEM, STAKE, vote], pre: [12 * SOL, 0, 1, 1, 1],
        post: [2 * SOL - FEE, 10 * SOL, 1, 1, 1], instructions: [
          { programIdIndex: 2, accounts: [0, 1], data: base58(Buffer.alloc(4)), stackHeight: null },
          stakeInstruction(3, [1, 2], 0), stakeInstruction(3, [1, 4, 2, 2, 2, 0], 2)] }),
    ], { slot: 300000300, epoch: 800, stakes: { [stakeAccount]: delegated(10.04 * SOL, 790) } });
    const staked = await newRequests(() => s.addresses.sync(owner, staker));
    assert.deepEqual([staked.result.outcome, staked.result.imported], ['complete', 2]);
    assert.deepEqual(staked.calls.map(call), [
      ['getSlot'],
      ['getTokenAccountsByOwner', wallets.staker, USDT],
      ['getTokenAccountsByOwner', wallets.staker, USDC],
      ['getSignaturesForAddress', wallets.staker],
      ['getTransaction', sig(20)],
      ['getTransaction', sig(21)],
      ['getEpochInfo'],
      ['getMultipleAccounts', [stakeAccount]],
      // Growth is a reward only when no transaction newer than the synced slot touched the account.
      ['getSignaturesForAddress', stakeAccount],
    ]);
    const stakeRows = async () => ({
      moves: (await db.query(`SELECT signature, account, slot, units::text AS units FROM wallet_stake_moves
        WHERE "addressId"=$1 ORDER BY slot, signature`, [staker])).map((row) => [row.signature, row.account, row.slot, row.units]),
      rewards: (await db.query(`SELECT account, slot, units::text AS units FROM wallet_stake_rewards
        WHERE "addressId"=$1 ORDER BY slot`, [staker])).map((row) => [row.account, row.slot, row.units]),
      accounts: (await db.query(`SELECT account, lamports::text AS lamports, validator, state FROM wallet_stake_accounts
        WHERE "addressId"=$1`, [staker])).map((row) => [row.account, row.lamports, row.validator, row.state]),
    });
    assert.deepEqual(await stakeRows(), {
      moves: [[sig(21), stakeAccount, 300000220, String(10 * SOL)]],
      rewards: [[stakeAccount, 300000300, String(0.04 * SOL)]],
      accounts: [[stakeAccount, String(10.04 * SOL), vote, 'active']],
    });
    // The wallet's SOL counts what sits in its stake account: 12 - 10 - fee + 10 + 0.04.
    const stakedSummary = staked.result.address;
    assert.deepEqual(stakedSummary.balances[0], { symbol: 'SOL', quantity: '12.039995000' });
    assert.deepEqual(stakedSummary.staking, { symbol: 'SOL', quantity: '10.040000000', rewards: '0.040000000', accounts: [
      { account: stakeAccount, validator: vote, pool: null, state: 'active', quantity: '10.040000000', rewards: '0.040000000' }] });
    // Only the fee left: the staked SOL keeps its lots; the reward arrives without a purchase price.
    // In time order; the synthetic chain is dated 2025, rewards when this probe saw them.
    const movesOf = async () => ((await readChainMoves(db.manager, owner)).get(stakerAccount) ?? [])
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .map((move) => [move.inbound, Number(move.quantity)]);
    assert.deepEqual(await movesOf(), [[true, 12], [false, 0.000005], [true, 0.04]]);
    const stakeOps = async () => (await s.operations.read(owner, {}, now)).operations
      .filter((operation) => operation.wallet?.id === staker)
      .map((operation) => [operation.chain.txid, operation.type, operation.direction, operation.quantity, operation.fee?.quantity ?? null, operation.status]);
    assert.deepEqual(await stakeOps(), [
      [sig(21), 'stake', 'internal', '10', '0.000005', 'recorded'],
      [sig(20), null, 'in', '12', null, 'needs-classification'],
    ]);
    assert.equal(await toClassify(), waiting + 1, 'Only the receipt waits for an answer');
    console.log('PASS SOL-STAKE-FIND the stake account the wallet created is found in its own transaction and read from the chain (active, its validator)');
    console.log('PASS SOL-STAKE-MOVE 10 SOL moved into the stake account stay in the wallet balance; only the fee leaves; listed as Stake, nothing to classify');
    console.log('PASS SOL-STAKE-REWARD 0.04 SOL of unexplained growth is a staking reward counted without a purchase price');

    // Same slot again: the balance is read, nothing is counted twice.
    const again2 = await newRequests(() => s.addresses.sync(owner, staker));
    assert.deepEqual(again2.calls.map(call), [['getSlot'], ['getEpochInfo'], ['getMultipleAccounts', [stakeAccount]]]);
    // The next epoch adds 0.01 SOL.
    await post('solana', { slot: 300000400, epoch: 802, stakes: { [stakeAccount]: delegated(10.05 * SOL, 790) } });
    await s.addresses.sync(owner, staker);
    assert.deepEqual((await stakeRows()).rewards, [[stakeAccount, 300000300, String(0.04 * SOL)], [stakeAccount, 300000400, String(0.01 * SOL)]]);

    // Withdrawing everything back closes the stake account: an Unstake, again only the fee.
    await postHistory([tx(22, 300000450, { keys: [wallets.staker, stakeAccount, SYSTEM, STAKE],
      pre: [2 * SOL - FEE, 10.05 * SOL, 1, 1], post: [12.05 * SOL - 2 * FEE, 0, 1, 1],
      instructions: [stakeInstruction(3, [1, 2, 0], 5), stakeInstruction(3, [1, 0, 2, 2, 0], 4)] })],
    { slot: 300000500, stakes: { [stakeAccount]: null } });
    const unstaked = await newRequests(() => s.addresses.sync(owner, staker));
    assert.deepEqual(unstaked.calls.map(call).slice(-2), [['getEpochInfo'], ['getMultipleAccounts', [stakeAccount]]]);
    const closed = await stakeRows();
    assert.deepEqual(closed.moves, [[sig(21), stakeAccount, 300000220, String(10 * SOL)], [sig(22), stakeAccount, 300000450, String(-10.05 * SOL)]]);
    assert.deepEqual(closed.accounts, [[stakeAccount, '0', null, 'closed']]);
    assert.equal(closed.rewards.length, 2, 'A closed account explained by its history adds no reward');
    assert.deepEqual([unstaked.result.address.balances[0], unstaked.result.address.staking], [{ symbol: 'SOL', quantity: '12.049990000' }, null]);
    assert.deepEqual(await movesOf(), [[true, 12], [false, 0.000005], [false, 0.000005], [true, 0.04], [true, 0.01]]);
    assert.deepEqual((await stakeOps())[0], [sig(22), 'unstake', 'internal', '10.05', '0.000005', 'recorded']);
    console.log('PASS SOL-STAKE-MOVE withdrawing 10.05 SOL back is an Unstake: balance 12.04999 SOL, rewards kept, the closed account no longer listed');

    // An address synced before stake accounts were followed reads its stored history once.
    await db.query('DELETE FROM wallet_stake_moves WHERE "addressId"=$1', [staker]);
    await db.query('DELETE FROM wallet_stake_scans WHERE "addressId"=$1', [staker]);
    const backfilled = await newRequests(() => s.addresses.sync(owner, staker));
    assert.deepEqual(backfilled.calls.map(call), [['getSlot'], ['getEpochInfo'], ['getMultipleAccounts', [stakeAccount]]]);
    assert.deepEqual(await stakeRows(), closed);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM wallet_stake_scans WHERE "addressId"=$1', [staker]))[0].n, 1);
    // Wallets without stake accounts never ask for them.
    const plain = await newRequests(() => s.addresses.sync(owner, main));
    assert.ok(plain.calls.every(({ rpc }) => !['getEpochInfo', 'getMultipleAccounts'].includes(rpc.method)));
    await assert.rejects(() => db.query(`INSERT INTO wallet_stake_moves("ownerId","addressId",signature,account,slot,"blockTime",units)
      VALUES ($1,$2,$3,$4,1,now(),0)`, [owner, staker, sig(30), stakeAccount]), /wallet_stake_moves_units_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_stake_rewards("ownerId","addressId",account,slot,"observedAt",units)
      VALUES ($1,$2,$3,1,now(),-1)`, [owner, staker, stakeAccount]), /wallet_stake_rewards_units_check/);
    console.log('PASS SOL-STAKE-FIND history stored before stake tracking is read once from the stored transactions, no provider call; wallets without stake accounts make no extra call; zero moves and negative rewards refused');

    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new TrackSolanaWallets1792100000000().down(), /recovery plan/);
    await assert.rejects(() => new TrackSolanaStake1792600000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS SOL-MIGRATION fresh 43 applies once; both Solana migrations refuse down');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
