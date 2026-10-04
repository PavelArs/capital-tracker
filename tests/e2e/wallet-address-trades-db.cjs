'use strict';

// Real PostgreSQL acceptance for wallet-address-trade-completion (ADDRT-*): imported
// incoming transactions become ordinary journal buy trades, linked in one transaction.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
const { WalletAddressService } = require('/app/backend/dist/wallet-addresses/wallet-address.service.js');
const { WalletAddressTradeService } = require('/app/backend/dist/wallet-addresses/wallet-address-trade.service.js');
const { EsploraClient } = require('/app/backend/dist/wallet-addresses/esplora-client.js');
const { AddWalletAddressTradeLinks1790600000000 } = require('/app/backend/dist/migrations/1790600000000-AddWalletAddressTradeLinks.js');

const settings = { DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e', DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e' };
const database = 'capital_tracker_wallet_address_trades_e2e';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const ownAddress = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const foreignAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const tx = (name) => sha256(`ct-e2e-addrt:${name}`);
const purchase = '2025-06-13T00:00:00.000Z';

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
    assert.match(name, /^capital_tracker_wallet_address_trades_e2e$/);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally { await client.end(); }
}
function migrate(name) {
  const result = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], { cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: name }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function refusal(action, status) {
  await assert.rejects(async () => action(), (error) => {
    assert.equal(error?.getStatus?.(), status, `Expected HTTP ${status}, got ${error?.getStatus?.() ?? error}`);
    return true;
  });
}
async function seedAddress(db, owner, address, transactions) {
  const [{ id }] = await db.query(
    `INSERT INTO wallet_addresses(id, "ownerId", network, address, "completedTopTxid", "completedAt")
     VALUES ($1, $2, 'bitcoin', $3, $4, now()) RETURNING id`, [randomUUID(), owner, address, transactions[0].txid]);
  for (const [index, row] of transactions.entries()) {
    await db.query(
      `INSERT INTO wallet_address_transactions("ownerId", "addressId", txid, "blockHeight", "blockHash", "blockTime",
        "receivedUnits", "sentUnits", "feeUnits", direction, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [owner, id, row.txid, 900000 - index, sha256(`ct-e2e-addrt-block:${index}`), row.blockTime,
        row.received, row.sent, row.fee, row.direction, JSON.stringify({ txid: row.txid })]);
  }
  return id;
}
async function counts(db) {
  const [row] = await db.query(`SELECT
    (SELECT count(*)::int FROM account_trades) AS trades,
    (SELECT count(*)::int FROM account_trade_versions) AS versions,
    (SELECT count(*)::int FROM wallet_address_trade_links) AS links`);
  return row;
}
const buy = (overrides = {}) => ({
  requestId: randomUUID(), expectedJournalRevision: 0, instrumentId: undefined, side: 'buy',
  occurredAt: purchase, orderWithinTimestamp: 0, quantity: '0.00918359', grossUsd: '1000', feeUsd: '0',
  ...overrides,
});

async function main() {
  for (const [key, value] of Object.entries(settings)) assert.equal(process.env[key], value, 'Exact synthetic environment required');
  await createDatabase(database);
  assert.match(migrate(database), /Migrations applied: 24/);
  assert.match(migrate(database), /Migrations applied: 0/);
  const db = sourceFor(database);
  await db.initialize();
  try {
    const [owner, stranger] = (await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('addrt-owner@example.invalid','synthetic-not-a-login-hash',true),
      ('addrt-stranger@example.invalid','synthetic-not-a-login-hash',true) RETURNING id`)).map(({ id }) => id);
    const accounting = new AccountingService(db);
    const trades = new TradeService(db);
    const wallet = new WalletAddressService(db, new EsploraClient());
    const completion = new WalletAddressTradeService(db, trades);

    const account = async (who, name, coverageFrom) => {
      const { value } = await accounting.createAccount(who, { requestId: randomUUID(), name });
      if (coverageFrom) await trades.initialize(who, value.id, { requestId: randomUUID(), coverageFrom, assertEmpty: true });
      return value.id;
    };
    const instrument = async (who) =>
      (await accounting.createInstrument(who, { requestId: randomUUID(), name: 'Bitcoin', symbol: 'BTC' })).value.id;
    const primary = await account(owner, 'Trust Wallet', '2025-01-01T00:00:00.000Z');
    const second = await account(owner, 'Trezor', '2025-01-01T00:00:00.000Z');
    const uninitialized = await account(owner, 'Без журнала');
    const late = await account(owner, 'Поздний журнал', '2026-01-01T00:00:00.000Z');
    const foreignAccount = await account(stranger, 'Чужой счёт', '2025-01-01T00:00:00.000Z');
    const btc = await instrument(owner);
    const foreignBtc = await instrument(stranger);

    const inFirst = tx('in-first');
    const out = tx('out');
    const inSecond = tx('in-second');
    const addressId = await seedAddress(db, owner, ownAddress, [
      { txid: inSecond, blockTime: '2025-06-20T10:00:00.000Z', received: '1250000', sent: '0', fee: '0', direction: 'in' },
      { txid: out, blockTime: '2025-06-15T10:00:00.000Z', received: '5700', sent: '57000', fee: '300', direction: 'out' },
      { txid: inFirst, blockTime: '2025-06-14T10:00:00.000Z', received: '918359', sent: '0', fee: '0', direction: 'in' },
    ]);
    const foreignTx = tx('foreign');
    const foreignAddressId = await seedAddress(db, stranger, foreignAddress, [
      { txid: foreignTx, blockTime: '2025-06-14T10:00:00.000Z', received: '918359', sent: '0', fee: '0', direction: 'in' },
    ]);
    const empty = await counts(db);
    assert.deepEqual(empty, { trades: 0, versions: 0, links: 0 });

    // ADDRT-INVALID
    await refusal(() => completion.complete(owner, addressId, out, { accountId: primary, trade: buy({ instrumentId: btc, quantity: '0.000513' }) }), 422);
    await refusal(() => completion.complete(owner, addressId, inSecond, { accountId: primary, trade: buy({ instrumentId: btc, side: 'sell', quantity: '0.0125' }) }), 422);
    await refusal(() => completion.complete(owner, addressId, inSecond, { accountId: primary, trade: buy({ instrumentId: btc, quantity: '0.0124' }) }), 422);
    await refusal(() => completion.complete(owner, addressId, inSecond, { accountId: primary, trade: buy({ instrumentId: btc, quantity: '0.0125' }), extra: true }), 400);
    assert.deepEqual(await counts(db), empty, 'Invalid completions write nothing');
    console.log('PASS ADDRT-INVALID outgoing, sell and wrong quantity are refused before any write');

    // ADDRT-ATOMIC
    await refusal(() => completion.complete(owner, addressId, inFirst, { accountId: uninitialized, trade: buy({ instrumentId: btc }) }), 409);
    await refusal(() => completion.complete(owner, addressId, inFirst, { accountId: late, trade: buy({ instrumentId: btc }) }), 409);
    assert.deepEqual(await counts(db), empty, 'A refused trade leaves no trade, version or link');
    console.log('PASS ADDRT-ATOMIC journal refusals leave no trade and no link');

    // ADDRT-PRIVATE (HTTP 401/403 are covered by the Playwright journey)
    await refusal(() => completion.complete(owner, foreignAddressId, foreignTx, { accountId: primary, trade: buy({ instrumentId: btc }) }), 404);
    await refusal(() => completion.complete(owner, addressId, inFirst, { accountId: foreignAccount, trade: buy({ instrumentId: btc }) }), 404);
    await refusal(() => completion.complete(owner, addressId, inFirst, { accountId: primary, trade: buy({ instrumentId: foreignBtc }) }), 404);
    await refusal(() => completion.complete(owner, addressId, tx('missing'), { accountId: primary, trade: buy({ instrumentId: btc }) }), 404);
    await refusal(() => completion.complete(stranger, addressId, inFirst, { accountId: foreignAccount, trade: buy({ instrumentId: foreignBtc }) }), 404);
    assert.deepEqual(await counts(db), empty, 'Foreign access writes nothing');
    console.log('PASS ADDRT-PRIVATE foreign address, transaction, account and instrument are indistinguishable from missing');

    // ADDRT-COMPLETE
    const request = { accountId: primary, trade: buy({ instrumentId: btc }) };
    const first = await completion.complete(owner, addressId, inFirst, request);
    assert.equal(first.created, true);
    assert.equal(first.value.accountId, primary);
    assert.equal(first.value.journalRevision, 1);
    assert.equal(first.value.trade.side, 'buy');
    assert.equal(first.value.trade.quantity, '0.00918359');
    assert.equal(Number(first.value.trade.grossUsd), 1000);
    assert.equal(first.value.trade.occurredAt, purchase);
    const tradeId = first.value.trade.tradeId;
    assert.deepEqual(await db.query(`SELECT "ownerId", "addressId", txid, "accountId", "tradeId", "createVersion"
      FROM wallet_address_trade_links`), [{ ownerId: owner, addressId, txid: inFirst, accountId: primary, tradeId, createVersion: 1 }]);
    const journal = await trades.getJournal(owner, primary);
    assert.equal(journal.journal.journalRevision, 1);
    assert.equal(journal.journal.activeTradeCount, 1);
    assert.equal(Number(journal.journal.summary.remainingCostUsd), 1000);
    console.log('PASS ADDRT-COMPLETE received transaction becomes one linked journal buy trade');

    // ADDRT-REPLAY
    const replay = await completion.complete(owner, addressId, inFirst, request);
    assert.equal(replay.created, false);
    assert.equal(replay.value.trade.tradeId, tradeId);
    await refusal(() => completion.complete(owner, addressId, inFirst, { accountId: primary, trade: buy({ instrumentId: btc, expectedJournalRevision: 1, grossUsd: '900' }) }), 409);
    await refusal(() => completion.complete(owner, addressId, inFirst, { accountId: second, trade: buy({ instrumentId: btc }) }), 409);
    assert.deepEqual(await counts(db), { trades: 1, versions: 1, links: 1 });
    assert.equal((await trades.getJournal(owner, primary)).journal.journalRevision, 1);
    console.log('PASS ADDRT-REPLAY replay returns the same trade; a second completion is refused');

    // ADDRT-STATE
    const read = async () => wallet.transactions(owner, addressId, {});
    const item = (page, id) => page.items.find((row) => row.txid === id);
    let page = await read();
    assert.equal(page.total, 3);
    assert.equal(page.missingUsdValueCount, 2);
    assert.deepEqual(item(page, inFirst).trade, { accountId: primary, tradeId, status: 'active', grossUsd: first.value.trade.grossUsd, feeUsd: first.value.trade.feeUsd });
    assert.equal(item(page, inFirst).usdValue, first.value.trade.grossUsd);
    assert.equal(item(page, inFirst).usdValueStatus, 'known');
    for (const id of [out, inSecond]) {
      assert.equal(item(page, id).trade, null);
      assert.equal(item(page, id).usdValue, null);
      assert.equal(item(page, id).usdValueStatus, 'missing');
    }
    const corrected = await trades.correct(owner, primary, tradeId, {
      ...buy({ instrumentId: btc, expectedJournalRevision: 1, grossUsd: '1010' }),
    });
    page = await read();
    assert.equal(Number(item(page, inFirst).usdValue), 1010);
    assert.equal(item(page, inFirst).usdValue, corrected.value.trade.grossUsd);
    assert.equal(page.missingUsdValueCount, 2);
    await trades.void(owner, primary, tradeId, { requestId: randomUUID(), expectedJournalRevision: 2 });
    page = await read();
    assert.equal(item(page, inFirst).trade.status, 'voided');
    assert.equal(item(page, inFirst).usdValue, null);
    assert.equal(item(page, inFirst).usdValueStatus, 'missing');
    assert.equal(page.missingUsdValueCount, 3);
    // After the void the owner may record the purchase again, e.g. in the right account.
    const redo = await completion.complete(owner, addressId, inFirst, { accountId: second, trade: buy({ instrumentId: btc, grossUsd: '990' }) });
    assert.equal(redo.created, true);
    await refusal(() => completion.complete(owner, addressId, inFirst, { accountId: primary, trade: buy({ instrumentId: btc, expectedJournalRevision: 3 }) }), 409);
    page = await read();
    assert.deepEqual(item(page, inFirst).trade, { accountId: second, tradeId: redo.value.trade.tradeId, status: 'active', grossUsd: '990', feeUsd: '0' });
    assert.equal(item(page, inFirst).usdValue, '990');
    assert.equal(page.missingUsdValueCount, 2);
    assert.deepEqual(await counts(db), { trades: 2, versions: 4, links: 2 });
    console.log('PASS ADDRT-STATE completion, journal correction and void show on the address transactions; a voided completion can be redone once');

    // ADDRT-MIGRATION
    const constraints = await db.query(`SELECT contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = 'wallet_address_trade_links'::regclass ORDER BY contype, conname`);
    const definitions = constraints.map(({ contype, definition }) => `${contype} ${definition}`);
    assert.ok(definitions.includes('p PRIMARY KEY ("ownerId", "accountId", "tradeId")'), definitions.join('\n'));
    assert.ok(definitions.some((value) => /^f FOREIGN KEY \("addressId", txid\) REFERENCES wallet_address_transactions\("addressId", txid\) ON DELETE RESTRICT/.test(value)), definitions.join('\n'));
    assert.ok(definitions.some((value) => /^f FOREIGN KEY \("ownerId", "accountId", "tradeId", "createVersion"\) REFERENCES account_trade_versions\("ownerId", "accountId", "tradeId", version\) ON DELETE RESTRICT/.test(value)), definitions.join('\n'));
    await assert.rejects(() => new AddWalletAddressTradeLinks1790600000000().down(), /recovery plan/);
    console.log('PASS ADDRT-MIGRATION additive link table with restricting keys; downgrade refuses');
    console.log('PASS isolated wallet address trade completion PostgreSQL acceptance');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  console.error('FAIL wallet address trade completion acceptance');
  process.exit(1);
});
