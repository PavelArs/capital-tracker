'use strict';

// Real PostgreSQL acceptance for EVM-MULTICHAIN: the same 0x address read on Base, Arbitrum One,
// OP Mainnet, Polygon, BNB Smart Chain and Avalanche through the one Etherscan V2 key. Only Etherscan is synthetic: requests leave through
// HTTPS_PROXY to the providers.cjs stub, which answers the raw list items this probe posts per
// chain id. Every address, hash and amount is synthetic.
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
const { EtherscanClient } = require(`${dist}/wallet-addresses/etherscan-client.js`);
const { EvmSyncAdapter } = require(`${dist}/wallet-addresses/evm-sync.adapter.js`);
const { evmChains } = require(`${dist}/wallet-addresses/evm-chains.js`);
const { TrackEvmChains1796000000000 } = require(`${dist}/migrations/1796000000000-TrackEvmChains.js`);

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_evm_chains_e2e';
const control = 'http://providers:8080/__control';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
// Synthetic addresses and hashes: lowercase hex of a fixed label, never a real wallet.
const address = (label) => `0x${sha256(`ct-e2e-evm:${label}`).slice(0, 40)}`;
const hash = (n) => `0x${sha256(`ct-e2e-evm-tx:${n}`)}`;
const blockHash = (block) => `0x${sha256(`ct-e2e-evm-block:${block}`)}`;
const bare = (n) => hash(n).slice(2);
const wallet = address('wallet');
const outside = address('outside');
// The chain's own native USDC, Arbitrum's Tether, and a token no list names.
const baseUsdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const arbitrumUsdt = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
const mainnetUsdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const bnbUsdt = '0x55d398326f99059ff775485246999027b3197955';
const polygonUsdc = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const memeToken = address('meme-token');
const ether = (value) => BigInt(Math.round(value * 1e6)) * 10n ** 12n;
const time = (block) => 1720000000 + (block - 20000000) * 2;

const normal = (n, block, from, to, value, gasUsed, gasPrice) => ({
  blockNumber: String(block), timeStamp: String(time(block)), hash: hash(n), blockHash: blockHash(block),
  from, to, value: String(value), gas: '100000', gasPrice: String(gasPrice), gasUsed: String(gasUsed),
  isError: '0', txreceipt_status: '1', input: '0x',
});
const token = (n, block, contract, symbol, decimals, from, to, value, logIndex) => ({
  blockNumber: String(block), timeStamp: String(time(block)), hash: hash(n), blockHash: blockHash(block),
  from, to, value: String(value), contractAddress: contract, tokenName: `${symbol} token`, tokenSymbol: symbol,
  tokenDecimal: String(decimals), logIndex: String(logIndex), gas: '100000', gasPrice: '1', gasUsed: '1',
});

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
async function etherscanUrls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).map(({ url }) => new URL(url)).filter(({ hostname }) => hostname === 'api.etherscan.io');
}
async function newRequests(action) {
  const before = (await etherscanUrls()).length;
  const result = await action();
  return { result, urls: (await etherscanUrls()).slice(before) };
}
const call = (url) => [url.searchParams.get('chainid'), url.searchParams.get('action'), url.searchParams.get('address')];
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
    assert.match(name, /^capital_tracker_evm_chains_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, [`${dist}/migrate.js`], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const stored = (db, addressId) => db.query(`SELECT txid, asset, "blockHeight", "receivedUnits"::text AS received, "sentUnits"::text AS sent,
  "feeUnits"::text AS fee, direction FROM wallet_address_transactions WHERE "addressId"=$1 ORDER BY "blockHeight" DESC, txid`, [addressId]);
function services(db) {
  const make = (file, name, ...rest) => new (require(`${dist}/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const classifications = make('chain-classification.service', 'ChainClassificationService', trades,
    make('asset-reward.service', 'AssetRewardService'), make('owned-transfer.service', 'OwnedTransferService'));
  const etherscan = new EtherscanClient({ apiKey: 'acceptance-etherscan-key', pauseMs: 0 });
  const adapters = evmChains.map((chain) => new EvmSyncAdapter(db, etherscan, chain));
  const scheduler = new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: 'false' }), adapters, classifications);
  return { accounting: make('accounting.service', 'AccountingService'), addresses: new WalletAddressService(db, scheduler), adapters };
}

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 56/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('evm-owner@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const s = services(db);
    assert.deepEqual(s.adapters.map((adapter) => adapter.network), ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bnb', 'avalanche']);
    const account = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Main' })).value.id;

    // EVM-ADD: the same address is one wallet per chain, each with its own id and chain.
    const ids = {};
    for (const network of ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bnb', 'avalanche']) {
      const added = await s.addresses.register(owner, { network, address: wallet.toUpperCase().replace('0X', '0x'), accountId: account, label: `${network} wallet` });
      assert.deepEqual([added.created, added.value.network, added.value.address, added.value.sync.state], [true, network, wallet, 'never']);
      ids[network] = added.value.id;
    }
    assert.equal(new Set(Object.values(ids)).size, 7);
    const again = await s.addresses.register(owner, { network: 'base', address: wallet });
    assert.deepEqual([again.created, again.value.id], [false, ids.base]);
    for (const input of [{ network: 'base', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }, { network: 'base', address: wallet.slice(0, 41) }, { network: 'zksync', address: wallet }]) {
      await assert.rejects(async () => s.addresses.register(owner, input), (error) => error?.getStatus?.() === 400);
    }
    console.log('PASS EVM-ADD the same 0x address is one wallet per chain; adding it again returns the same one; a Bitcoin address, a short one and a chain not read are refused');

    // EVM-SYNC: each chain is asked with its own chain id, and the one key paces them all.
    await post('evm', { chainid: 8453, tip: 20000100,
      normal: [normal(1, 20000001, outside, wallet, ether(0.75), 21000, 10 ** 8)],
      tokens: [
        token(2, 20000002, baseUsdc, 'USDC', 6, outside, wallet, 125000000n, 4),
        // The Ethereum mainnet USDC contract is nothing special on Base.
        token(3, 20000003, mainnetUsdc, 'USDC', 6, outside, wallet, 9000000n, 1),
        token(4, 20000004, memeToken, 'MEME', 18, outside, wallet, 5n * 10n ** 18n, 2),
      ] });
    await post('evm', { chainid: 42161, tip: 20000100,
      normal: [normal(5, 20000010, wallet, outside, ether(0.1), 21000, 10 ** 8)],
      tokens: [token(6, 20000011, arbitrumUsdt, 'USDT', 6, outside, wallet, 300000000n, 3)] });
    await post('evm', { chainid: 10, tip: 20000100 });
    await post('evm', { chainid: 137, tip: 20000100,
      normal: [normal(7, 20000020, outside, wallet, ether(12), 21000, 10 ** 8)],
      tokens: [token(8, 20000021, polygonUsdc, 'USDC', 6, outside, wallet, 50000000n, 1)] });
    // BNB Smart Chain: Binance-Peg USDT has 18 decimals, so 7 USDT is 7 * 10^18 base units.
    await post('evm', { chainid: 56, tip: 20000100,
      normal: [normal(9, 20000030, outside, wallet, ether(1.5), 21000, 10 ** 8)],
      tokens: [token(10, 20000031, bnbUsdt, 'USDT', 18, outside, wallet, 7n * 10n ** 18n, 1)] });
    await post('evm', { chainid: 43114, tip: 20000100,
      normal: [normal(11, 20000035, outside, wallet, ether(2), 21000, 10 ** 8)] });
    const base = await newRequests(() => s.addresses.sync(owner, ids.base));
    assert.deepEqual([base.result.outcome, base.result.reason, base.result.imported], ['complete', null, 4]);
    assert.deepEqual(base.urls.map(call), [
      ['8453', 'eth_blockNumber', null], ['8453', 'txlist', wallet], ['8453', 'txlistinternal', wallet], ['8453', 'tokentx', wallet],
    ]);
    assert.deepEqual((await stored(db, ids.base)).map((row) => [row.txid, row.asset, row.received, row.sent, row.direction]), [
      [`${bare(4)}-2`, memeToken, String(5n * 10n ** 18n), '0', 'in'],
      [`${bare(3)}-1`, mainnetUsdc, '9000000', '0', 'in'],
      [`${bare(2)}-4`, 'USDC', '125000000', '0', 'in'],
      [bare(1), null, String(ether(0.75)), '0', 'in'],
    ]);
    const arbitrum = await newRequests(() => s.addresses.sync(owner, ids.arbitrum));
    assert.deepEqual([arbitrum.result.outcome, arbitrum.result.imported], ['complete', 2]);
    assert.ok(arbitrum.urls.every((url) => url.searchParams.get('chainid') === '42161'));
    const optimism = await newRequests(() => s.addresses.sync(owner, ids.optimism));
    assert.deepEqual([optimism.result.outcome, optimism.result.imported, optimism.result.address.balances.map((item) => item.symbol)], ['complete', 0, ['ETH', 'USDT', 'USDC']]);
    for (const [network, chainid, imported] of [['polygon', '137', 2], ['bnb', '56', 2], ['avalanche', '43114', 1]]) {
      const synced = await newRequests(() => s.addresses.sync(owner, ids[network]));
      assert.deepEqual([synced.result.outcome, synced.result.imported], ['complete', imported], network);
      assert.ok(synced.urls.every((url) => url.searchParams.get('chainid') === chainid), network);
    }
    const mainnet = await newRequests(() => s.addresses.sync(owner, ids.ethereum));
    assert.deepEqual([mainnet.result.outcome, mainnet.result.imported], ['complete', 0]);
    assert.ok(mainnet.urls.every((url) => url.searchParams.get('chainid') === '1'));
    console.log('PASS EVM-SYNC each chain is read with its own chain id and cursor; the chain’s native USDC and USDT keep their tickers, any other contract is an ordinary token; mainnet is untouched');

    // EVM-BALANCES: the balances are per wallet, so the same address shows each chain’s holdings.
    const balances = async (id) => (await s.addresses.list(owner)).find((item) => item.id === id).balances;
    const hidden = async (id) => (await s.addresses.list(owner)).find((item) => item.id === id).hiddenTokens;
    assert.deepEqual(await balances(ids.base), [{ symbol: 'ETH', quantity: '0.750000000000000000' }, { symbol: 'USDC', quantity: '125.000000' }]);
    // A token no price source lists is left out, and the Ethereum USDC contract, calling itself USDC on Base, is a lookalike.
    assert.deepEqual((await hidden(ids.base)).map((item) => [item.symbol, item.quantity, item.reason]), [
      ['MEME', '5.000000000000000000', 'dust'], ['USDCA0B8', '9.000000', 'lookalike'],
    ]);
    assert.deepEqual((await balances(ids.arbitrum)).slice(0, 2), [{ symbol: 'ETH', quantity: '-0.100002100000000000' }, { symbol: 'USDT', quantity: '300.000000' }]);
    // Each chain holds its own coin, and BNB Smart Chain’s 18-decimal USDT is counted as 7, not 7 million million.
    assert.deepEqual((await balances(ids.polygon)).map((item) => [item.symbol, item.quantity]), [['POL', '12.000000000000000000'], ['USDT', '0.000000'], ['USDC', '50.000000']]);
    assert.deepEqual((await balances(ids.bnb)).map((item) => [item.symbol, item.quantity]), [['BNB', '1.500000000000000000'], ['USDT', '7.000000000000000000'], ['USDC', '0.000000000000000000']]);
    assert.deepEqual((await balances(ids.avalanche)).slice(0, 1), [{ symbol: 'AVAX', quantity: '2.000000000000000000' }]);
    const tokens = await db.query('SELECT network, contract FROM chain_tokens ORDER BY network, contract');
    assert.deepEqual(tokens.map((row) => row.network), ['base', 'base']);
    console.log('PASS EVM-BALANCES the same address shows each chain’s own holdings; tokens are remembered per chain');

    // EVM-FALLBACK: when Etherscan's plan turns a chain away, that chain's Blockscout explorer is read without a key and the
    // history continues from the stored block; a chain with no Blockscout says why it cannot be read.
    const internalItem = (n, block, from, to, value) => ({ blockNumber: String(block), timeStamp: String(time(block)), hash: hash(n),
      from, to, value: String(value), type: 'call', isError: '0', errCode: '' });
    await post('evm', { chainid: 10, tip: 20000200, planRequired: true,
      normal: [normal(12, 20000050, outside, wallet, ether(0.5), 21000, 10 ** 8)],
      internal: [internalItem(13, 20000060, outside, wallet, ether(0.25))] });
    const everyUrl = async () => (await (await fetch(`${control}/requests`)).json()).map(({ url }) => new URL(url));
    const fallbackCalls = async (action) => {
      const before = (await everyUrl()).length;
      const result = await action();
      return { result, urls: (await everyUrl()).slice(before) };
    };
    const scout = await fallbackCalls(() => s.addresses.sync(owner, ids.optimism));
    assert.deepEqual([scout.result.outcome, scout.result.reason, scout.result.imported], ['complete', null, 2]);
    assert.deepEqual(scout.urls.map((url) => [url.hostname, url.searchParams.get('chainid'), url.searchParams.get('action'), url.searchParams.get('apikey')]), [
      ['api.etherscan.io', '10', 'eth_blockNumber', 'acceptance-etherscan-key'],
      ['optimism.blockscout.com', null, 'eth_block_number', null],
      ['optimism.blockscout.com', null, 'txlist', null],
      ['optimism.blockscout.com', null, 'txlistinternal', null],
      ['optimism.blockscout.com', null, 'tokentx', null],
    ]);
    assert.deepEqual((await stored(db, ids.optimism)).map((row) => [row.txid, row.asset, row.received, row.direction]), [
      [bare(13), null, String(ether(0.25)), 'in'], [bare(12), null, String(ether(0.5)), 'in'],
    ]);
    // The next pass goes straight to Blockscout instead of asking the refusing plan again.
    const again2 = await fallbackCalls(() => s.addresses.sync(owner, ids.optimism));
    assert.equal(again2.result.outcome, 'complete');
    assert.ok(again2.urls.every((url) => url.hostname === 'optimism.blockscout.com'));
    await post('evm', { chainid: 43114, planRequired: true });
    const refused = await s.addresses.sync(owner, ids.avalanche);
    assert.deepEqual([refused.outcome, refused.reason], ['provider_error', 'plan_required']);
    assert.match(require(`${dist}/wallet-addresses/chain-sync.js`).failureMessage('Avalanche C-Chain', 'plan_required'), /free Etherscan plan does not cover Avalanche C-Chain/);
    console.log('PASS EVM-FALLBACK a chain Etherscan\'s plan refuses is read from its Blockscout explorer without a key and continues from the stored block; a chain without one reports the plan');

    // EVM-DB: the checks name every chain the app reads and keep the 0x format.
    for (const network of ['zksync', 'linea', 'scroll', 'base']) {
      await db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,$2,$3)`, [owner, network, address(`check-${network}`)]);
    }
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'base',$2)`, [owner, wallet.toUpperCase()]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'fantom',$2)`, [owner, address('fantom')]), /wallet_addresses_(network|address)_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'arbitrum','bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')`, [owner]), /wallet_addresses_address_check/);
    console.log('PASS EVM-DB the checks accept the planned chains with lower-case 0x addresses only and refuse any other chain');

    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new TrackEvmChains1796000000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS EVM-MIGRATION fresh 56 applies once; down refuses');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
