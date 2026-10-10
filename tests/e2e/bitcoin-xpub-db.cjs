'use strict';

// Real PostgreSQL acceptance for scan-bitcoin-xpub (M21). Only Esplora is synthetic: requests
// leave through HTTPS_PROXY to the providers.cjs stub, which answers each address with the
// posted transactions naming it. The account key is the published BIP-84 test vector of the
// BIP-39 test mnemonic; every other address, hash and amount is synthetic.
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
const { AccountKey } = require(`${dist}/wallet-addresses/bitcoin-xpub.js`);
const { ScanBitcoinXpub1792900000000 } = require(`${dist}/migrations/1792900000000-ScanBitcoinXpub.js`);

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_bitcoin_xpub_e2e';
const control = 'http://providers:8080/__control';
const now = new Date('2026-10-09T12:00:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const zpub = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const key = new AccountKey(zpub);
const at = (chain, index) => key.address(chain, index);
// Anchors the derivation the probe relies on to the vector's published addresses.
assert.equal(at(0, 0), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
assert.equal(at(0, 1), 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
assert.equal(at(1, 0), 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
const outside = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
// The owner's other Bitcoin wallet: a synthetic base58check address outside the key.
const hot = '1H1dv7Mxs3yqdEGkx3HuMx6jLStmJi8e1d';
const txid = (n) => sha256(`ct-e2e-xpub-tx:${n}`);
const tx = (n, height, inputs, outputs, fee) => ({ txid: txid(n), height, inputs, outputs, fee });

// The account's history. T3 pays receiving address 5 after four unused ones, T4 address 24,
// past the first 20 derived: both are found because 20 unused addresses follow each used one.
// T6 pays address 50, more than 20 past the last used one, so a wallet never finds it either.
const history = [
  tx(1, 800010, [[outside, 1_500_000]], [[at(0, 0), 1_000_000], [outside, 499_500]], 500),
  // A payment with change to the account's first change address.
  tx(2, 800020, [[at(0, 0), 1_000_000]], [[outside, 400_000], [at(1, 0), 599_500]], 500),
  tx(3, 800030, [[outside, 260_000]], [[at(0, 5), 250_000], [outside, 9_500]], 500),
  tx(4, 800040, [[outside, 310_000]], [[at(0, 24), 300_000], [outside, 9_500]], 500),
  // Consolidation between the account's own addresses: only the fee leaves.
  tx(5, 800050, [[at(1, 0), 599_500], [at(0, 5), 250_000]], [[at(1, 1), 849_000]], 500),
  tx(6, 800060, [[outside, 10_000]], [[at(0, 50), 777], [outside, 8_723]], 500),
];
// Independent oracle of the wallet's legs, newest first: each transaction once, with its
// effect on every address of the key.
const legs = [
  { n: 5, received: 849_000, sent: 849_500, direction: 'self', block: 800050 },
  { n: 4, received: 300_000, sent: 0, direction: 'in', block: 800040 },
  { n: 3, received: 250_000, sent: 0, direction: 'in', block: 800030 },
  { n: 2, received: 599_500, sent: 1_000_000, direction: 'out', block: 800020 },
  { n: 1, received: 1_000_000, sent: 0, direction: 'in', block: 800010 },
];

async function post(path, body) {
  const response = await fetch(`${control}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `Provider fixture control ${path}`);
  return response.json();
}
async function esploraUrls() {
  const response = await fetch(`${control}/requests`);
  assert.equal(response.status, 200);
  return (await response.json()).map(({ url }) => new URL(url)).filter(({ hostname }) => hostname === 'blockstream.info');
}
async function newRequests(action) {
  const before = (await esploraUrls()).length;
  const result = await action();
  return { result, urls: (await esploraUrls()).slice(before) };
}
// ['count' | 'page', address, cursor]
const call = (url) => {
  const page = /^\/api\/address\/([^/]+)\/txs\/chain(?:\/([0-9a-f]{64}))?$/.exec(url.pathname);
  if (page) return ['page', decodeURIComponent(page[1]), page[2] ?? null];
  return ['count', decodeURIComponent(url.pathname.split('/').at(-1)), null];
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
    assert.match(name, /^capital_tracker_bitcoin_xpub_e2e$/);
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
async function stored(db, walletId) {
  return db.query(`SELECT txid, "blockHeight", "receivedUnits"::text AS received, "sentUnits"::text AS sent,
    "feeUnits"::text AS fee, direction, raw FROM wallet_address_transactions
    WHERE "addressId"=$1 ORDER BY "blockHeight" DESC, txid`, [walletId]);
}
function assertLegs(rows, expected) {
  assert.deepEqual(rows.map((row) => ({ txid: row.txid, received: row.received, sent: row.sent, fee: row.fee,
    direction: row.direction, block: row.blockHeight })),
  expected.map(({ n, received, sent, direction, block }) => ({ txid: txid(n), received: String(received),
    sent: String(sent), fee: '500', direction, block })));
  for (const row of rows) assert.equal(row.raw.txid, row.txid, 'Raw provider observation is retained');
}
function services(db) {
  const make = (file, name, ...rest) => new (require(`${dist}/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const classifications = make('chain-classification.service', 'ChainClassificationService', trades,
    make('asset-reward.service', 'AssetRewardService'), make('owned-transfer.service', 'OwnedTransferService'));
  const bitcoin = new BitcoinSyncAdapter(db, new EsploraClient({ pauseMs: 0 }));
  const scheduler = new WalletSyncService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: 'false' }), [bitcoin], classifications);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    operations: make('operation-list.service', 'OperationListService'),
    classifications,
    addresses: new WalletAddressService(db, scheduler),
  };
}
const derivedRows = (db, walletId) => db.query(`SELECT chain, "addressIndex", address, "txCount", "storedCount",
  "checkPending", "walkTopTxid" FROM wallet_xpub_addresses WHERE "walletId"=$1 ORDER BY chain, "addressIndex"`, [walletId]);

async function main() {
  for (const [name, value] of Object.entries(settings)) assert.equal(process.env[name], value, 'Exact synthetic environment required');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 57/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    await post('reset', {});
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('xpub-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('xpub-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const s = services(db);
    const account = async (name) => (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
    const trezor = await account('Trezor');
    const hotAccount = await account('Hot');

    // XPUB-ADD: the key is stored as pasted, with no provider call; a mistyped key, a private
    // key or a key for another network is refused.
    const added = await newRequests(async () => {
      const first = await s.addresses.register(owner, { network: 'bitcoin', address: zpub, accountId: trezor, label: 'Trezor BTC' });
      const again = await s.addresses.register(owner, { network: 'bitcoin', address: zpub, accountId: hotAccount });
      for (const input of [
        { network: 'bitcoin', address: `${zpub.slice(0, -1)}t` },
        { network: 'bitcoin', address: zpub.slice(0, -2) },
        { network: 'bitcoin', address: `zprv${zpub.slice(4)}` },
        { network: 'ethereum', address: zpub },
        { network: 'solana', address: zpub },
      ]) await refusal(() => s.addresses.register(owner, input), 400);
      return { first, again };
    });
    assert.deepEqual(added.urls, []);
    const { first, again } = added.result;
    assert.deepEqual([first.created, again.created, again.value.id], [true, false, first.value.id]);
    const wallet = first.value.id;
    assert.deepEqual([first.value.network, first.value.address, first.value.accountId, first.value.label,
      first.value.balances, first.value.chainBalance, first.value.sync.state],
    ['bitcoin', zpub, trezor, 'Trezor BTC', null, null, 'never']);
    assert.deepEqual(first.value.accountKey, { prefix: 'zpub', derivedAddresses: 0, usedAddresses: 0, alsoTracked: [] });
    console.log('PASS XPUB-ADD a zpub is stored as pasted in its account; WAL-DUP returns it; a mistyped, short or private key and other networks get 400; no provider call');

    // XPUB-SCAN: the first round counts every derived address before reading any history; the
    // request budget splits it over two passes, the first showing no balance yet.
    await post('bitcoin-chain', { transactions: history });
    const pass1 = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([pass1.result.outcome, pass1.result.imported], ['partial', 0]);
    assert.equal(pass1.urls.length, 40);
    assert.ok(pass1.urls.every((url) => call(url)[0] === 'count'), 'Counts come before any history page');
    assert.deepEqual([pass1.result.address.sync.state, pass1.result.address.balances, pass1.result.address.sync.status],
      ['partial', null, 'syncing']);
    const pass2 = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([pass2.result.outcome, pass2.result.reason, pass2.result.imported], ['complete', null, 5]);
    const calls = [...pass1.urls, ...pass2.urls].map(call);
    const counted = calls.filter(([kind]) => kind === 'count').map(([, address]) => address);
    // Receiving: 0..44 (20 past address 24); change: 0..21 (20 past address 1).
    const expectedCounted = [...Array.from({ length: 45 }, (_v, i) => at(0, i)), ...Array.from({ length: 22 }, (_v, i) => at(1, i))];
    assert.deepEqual(counted, expectedCounted);
    assert.ok(!counted.includes(at(0, 50)), 'An address beyond the gap is never asked');
    // Each used address's history is read once, in derivation order.
    assert.deepEqual(calls.filter(([kind]) => kind === 'page'),
      [[0, 0], [0, 5], [0, 24], [1, 0], [1, 1]].map(([chain, index]) => ['page', at(chain, index), null]));
    assertLegs(await stored(db, wallet), legs);
    const summary = pass2.result.address;
    assert.deepEqual([summary.sync.state, summary.chainBalance, summary.balances, summary.transactionCount],
      ['complete', '0.01149000', [{ symbol: 'BTC', quantity: '0.01149000' }], 5]);
    assert.deepEqual(summary.accountKey, { prefix: 'zpub', derivedAddresses: 67, usedAddresses: 5, alsoTracked: [] });
    const rows = await derivedRows(db, wallet);
    assert.deepEqual(rows.filter((row) => row.txCount > 0).map((row) => [row.chain, row.addressIndex, row.txCount, row.storedCount]),
      [[0, 0, 2, 2], [0, 5, 2, 2], [0, 24, 1, 1], [1, 0, 2, 2], [1, 1, 1, 1]]);
    assert.ok(rows.every((row) => row.address === at(row.chain, row.addressIndex) && !row.checkPending && row.walkTopTxid === null));
    console.log('PASS XPUB-SCAN 67 addresses counted (gap of 20 on each chain) before 5 histories are read; T6 beyond the gap is never found; two bounded passes');
    console.log('PASS XPUB-AMOUNTS each transaction stored once with its effect on all of the key\'s addresses: change and a consolidation stay inside; balance 0.01149000 BTC');

    // CLS-PROVISIONAL: the unclassified history already gives the account the chain balance.
    {
      const { readValuationInputs, accountsAt } = require(`${dist}/accounting/portfolio-valuation.service.js`);
      const { canonicalDecimalToAtoms, formatAtoms } = require(`${dist}/accounting/money.js`);
      const inputs = await readValuationInputs(db.manager, owner);
      const held = accountsAt(inputs, new Date().toISOString()).find((item) => item.accountId === trezor);
      const total = held.lots.reduce((sum, lot) => sum + canonicalDecimalToAtoms(lot.quantity), 0n);
      assert.equal(formatAtoms(total), '0.01149');
    }
    console.log('PASS CLS-PROVISIONAL the Trezor account holds the key\'s 0.01149 BTC before classification');

    // Resync: a new round counts again; nothing changed, so no history is read and nothing is stored twice.
    const resync1 = await newRequests(() => s.addresses.sync(owner, wallet));
    const resync2 = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([resync1.result.outcome, resync2.result.outcome, resync2.result.imported], ['partial', 'complete', 0]);
    assert.deepEqual([...resync1.urls, ...resync2.urls].map(call).map(([kind, address]) => [kind, address]),
      expectedCounted.map((address) => ['count', address]));
    // A completed key keeps showing its balance while a later round counts.
    assert.deepEqual([resync1.result.address.sync.state, resync1.result.address.chainBalance], ['complete', '0.01149000']);
    assertLegs(await stored(db, wallet), legs);
    console.log('PASS XPUB-RESYNC an unchanged account is only counted again: 0 pages, 0 new legs, balance kept meanwhile');

    // A new receipt on an address derived but unused so far: only its history is read, and the
    // receiving chain grows to keep 20 unused addresses after it.
    await post('bitcoin-chain', { append: true, transactions: [tx(7, 800070, [[outside, 15_500]], [[at(0, 25), 5_000], [outside, 10_000]], 500)] });
    const grow1 = await newRequests(() => s.addresses.sync(owner, wallet));
    const grow2 = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([grow2.result.outcome, grow2.result.imported], ['complete', 1]);
    const grown = [...grow1.urls, ...grow2.urls].map(call);
    assert.deepEqual(grown.filter(([kind]) => kind === 'page'), [['page', at(0, 25), null]]);
    assert.ok(grown.some(([kind, address]) => kind === 'count' && address === at(0, 45)));
    assert.deepEqual([grow2.result.address.chainBalance, grow2.result.address.accountKey.derivedAddresses,
      grow2.result.address.accountKey.usedAddresses], ['0.01154000', 68, 6]);
    console.log('PASS XPUB-GROW a receipt on address 25 is read alone and the receiving chain extends to 45');

    // XPUB-LAG: a lagging backend that answers [] where the count promised a transaction makes
    // the pass fail as unavailable; nothing is stored or marked done, and the next pass recovers.
    await post('bitcoin-chain', { append: true, transactions: [tx(8, 800080, [[outside, 12_500]], [[at(0, 0), 2_000], [outside, 10_000]], 500)],
      fault: { onRequest: 1, empty: true } });
    await s.addresses.sync(owner, wallet);
    const lagged = await s.addresses.sync(owner, wallet);
    assert.deepEqual([lagged.outcome, lagged.reason, lagged.imported], ['provider_error', 'unavailable', 0]);
    assert.deepEqual([lagged.address.sync.status, lagged.address.sync.errorMessage],
      ['failed', 'Bitcoin data is temporarily unavailable.']);
    const first0 = (await derivedRows(db, wallet)).find((row) => row.chain === 0 && row.addressIndex === 0);
    assert.deepEqual([first0.txCount, first0.storedCount], [3, 2]);
    const recovered = await newRequests(() => s.addresses.sync(owner, wallet));
    assert.deepEqual([recovered.result.outcome, recovered.result.imported], ['complete', 1]);
    assert.deepEqual(recovered.urls.map(call), [['page', at(0, 0), null]], 'The interrupted walk resumes without a new count');
    assert.equal(recovered.result.address.chainBalance, '0.01156000');
    console.log('PASS XPUB-LAG an empty page against a higher count fails the pass as unavailable; the next pass stores the transaction');

    // XPUB-LINK (D7): a send from the key to the owner's hot wallet in another account becomes
    // one transfer once the key's coins have a cost.
    await post('bitcoin-chain', { append: true, transactions: [tx(9, 800090, [[at(1, 1), 849_000]], [[hot, 300_000], [at(1, 2), 548_500]], 500)] });
    const hotWallet = (await s.addresses.register(owner, { network: 'bitcoin', address: hot, accountId: hotAccount, label: 'Hot BTC' })).value.id;
    for (let pass = 0; pass < 3 && (await s.addresses.sync(owner, wallet)).outcome !== 'complete'; pass++);
    assert.equal((await s.addresses.sync(owner, hotWallet)).imported, 1);
    for (const n of [1, 3, 4, 7, 8]) {
      await s.classifications.classify(owner, wallet, txid(n), { requestId: randomUUID(), hidden: false, expectedVersion: 0,
        classification: { type: 'buy', currency: 'USD', amount: '100' } });
    }
    const links = await db.query(`SELECT "addressId", type, automatic, "transferId" FROM chain_transaction_classification_versions
      WHERE txid=$1 ORDER BY "addressId"`, [txid(9)]);
    assert.equal(links.length, 2, 'Both legs of the own transfer are answered');
    assert.ok(links.every((row) => row.type === 'transfer' && row.automatic === true && row.transferId === links[0].transferId));
    const transfer = (await s.operations.read(owner, {}, now)).operations.filter((item) => item.chain?.txid === txid(9));
    assert.equal(transfer.length, 1, 'A linked pair is listed once');
    assert.deepEqual([transfer[0].type, transfer[0].asset.symbol, transfer[0].quantity, transfer[0].fee?.quantity],
      ['transfer', 'BTC', '0.003', '0.000005']);
    console.log('PASS XPUB-LINK 0.003 BTC from the key to the hot wallet auto-links into one transfer with a 500 sat fee; its change stays in the key');

    // XPUB-OVERLAP: a key address also tracked as its own wallet would count twice; the key names it.
    const single = (await s.addresses.register(owner, { network: 'bitcoin', address: at(0, 0), accountId: hotAccount })).value.id;
    const listed = new Map((await s.addresses.list(owner)).map((item) => [item.id, item]));
    assert.deepEqual(listed.get(wallet).accountKey.alsoTracked, [{ id: single, address: at(0, 0), label: null }]);
    assert.deepEqual([listed.get(single).accountKey, listed.get(hotWallet).accountKey], [null, null]);
    console.log('PASS XPUB-OVERLAP a derived address also added as a single wallet is named on the key');

    // Constraints and privacy.
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'bitcoin',$2)`,
      [owner, `zpub${'1'.repeat(80)}`]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_addresses(id,"ownerId",network,address) VALUES (gen_random_uuid(),$1,'ethereum',$2)`,
      [owner, zpub]), /wallet_addresses_address_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_xpub_addresses("ownerId","walletId",chain,"addressIndex",address) VALUES ($1,$2,2,0,$3)`,
      [owner, wallet, outside]), /wallet_xpub_addresses_chain_check/);
    await assert.rejects(() => db.query(`INSERT INTO wallet_xpub_addresses("ownerId","walletId",chain,"addressIndex",address) VALUES ($1,$2,0,999,$3)`,
      [stranger, wallet, outside]), /foreign key/);
    await refusal(() => s.addresses.sync(stranger, wallet), 404);
    assert.deepEqual(await s.addresses.list(stranger), []);
    console.log('PASS XPUB-DB address and chain checks refuse anything else; derived rows belong to the wallet\'s owner; another owner gets 404');

    const snapshot = JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"));
    await assert.rejects(() => new ScanBitcoinXpub1792900000000().down(), /recovery plan/);
    assert.equal(JSON.stringify(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")), snapshot);
    console.log('PASS XPUB-MIGRATION fresh 57 applies once; down refuses');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
