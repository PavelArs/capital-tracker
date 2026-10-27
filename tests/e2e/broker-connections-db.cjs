'use strict';
// broker-connections (BROKER-CONNECT) against fresh synthetic PostgreSQL: a read-only T-Bank
// token is kept encrypted per broker account, never returned, replaced by a new one and removed
// with the connection. BROKER-SYNC: the account's T-Bank history is previewed and written into
// its empty records in one command, once. T-Bank itself is a stub; all data is synthetic.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
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
const database = 'capital_tracker_broker_connections_e2e';
const servicePath = '/app/backend/dist/brokers/broker-connections.service.js';
const MIGRATIONS = 74;
const token = 't.SyntheticToken000000000000000001';
const replacement = 't.SyntheticToken000000000000000002';
const brokerAccount = { id: '2000000001', name: 'Synthetic', open: true, access: 'read_only' };
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
const rejected = (action, status) =>
  assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status,
  );
async function account(db, owner, assetClass) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO manual_accounts(id, "ownerId", "requestId", "canonicalPayload", name, "assetClass")
      VALUES ($1, $2, $3, 'synthetic', 'Synthetic broker', $4)`,
    [id, owner, randomUUID(), assetClass],
  );
  return id;
}
// One T-Bank account reads into one broker account, so each probe takes it over from the last.
async function takeOver(db, service, owner, broker) {
  const holders = await db.query(
    `SELECT "accountId" FROM broker_connections WHERE "ownerId" = $1 AND "brokerAccountId" = $2`,
    [owner, brokerAccount.id],
  );
  for (const { accountId } of holders) await service.disconnect(owner, accountId);
  return service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
}

async function operationsCsv(db, owner) {
  const { OwnerExportService } = require('/app/backend/dist/owner-export/owner-export.service.js');
  const { inflateRawSync } = require('node:zlib');
  const archive = (await new OwnerExportService(db).archive(owner)).data;
  const end = archive.length - 22;
  let at = archive.readUInt32LE(end + 16);
  for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
    const nameLength = archive.readUInt16LE(at + 28);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (name === 'operations.csv') {
      const local = archive.readUInt32LE(at + 42);
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      return inflateRawSync(archive.subarray(start, start + archive.readUInt32LE(at + 20))).toString('utf8');
    }
    at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
  }
  assert.fail('Missing operations.csv');
}

async function connection(db, service, owner, other) {
  stage = 'synthetic broker account connected, read back, replaced and disconnected';
  const broker = await account(db, owner, 'broker');
  const wallet = await account(db, owner, null);
  assert.deepEqual(await service.read(owner, broker), { connected: false });

  const accounts = await service.check(owner, broker, { token });
  assert.deepEqual(accounts, { accounts: [{ id: brokerAccount.id, name: 'Synthetic' }] });
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM broker_connections'))[0].n,
    0,
    'Checking a token stores nothing',
  );

  const shown = await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
  assert.equal(shown.connected, true);
  assert.equal(shown.provider, 'tbank');
  assert.equal(shown.tokenHint, '0001');
  assert.equal(shown.brokerAccountId, brokerAccount.id);
  assert.ok(!JSON.stringify(shown).includes(token), 'The token is never returned');
  const [stored] = await db.query(
    'SELECT credentials::text AS credentials FROM broker_connections WHERE "accountId" = $1',
    [broker],
  );
  assert.ok(!stored.credentials.includes(token), 'The token is stored encrypted');
  assert.deepEqual(await service.read(owner, broker), shown);

  const again = await service.connect(owner, broker, {
    token: replacement,
    brokerAccountId: brokerAccount.id,
  });
  assert.equal(again.tokenHint, '0002');
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM broker_connections'))[0].n,
    1,
    'A new token replaces the old one',
  );

  await rejected(() => service.read(other, broker), 404);
  await rejected(() => service.check(other, broker, { token }), 404);
  await rejected(() => service.connect(other, broker, { token, brokerAccountId: brokerAccount.id }), 404);
  await rejected(() => service.disconnect(other, broker), 404);
  await rejected(() => service.read(owner, wallet), 404);
  await rejected(
    () => service.connect(owner, wallet, { token, brokerAccountId: brokerAccount.id }),
    404,
  );
  await rejected(() => service.connect(owner, broker, { token, brokerAccountId: '9999999999' }), 422);

  await assert.rejects(
    db.query('DELETE FROM manual_accounts WHERE id = $1', [broker]),
    // PostgreSQL 18 reports RESTRICT as 23001, earlier versions as 23503.
    (error) => ['23001', '23503'].includes(error.code),
    'An account with a connection cannot be deleted',
  );
  await assert.rejects(
    db.query(`UPDATE broker_connections SET provider = 'other' WHERE "accountId" = $1`, [broker]),
    { code: '23514' },
  );
  await assert.rejects(
    db.query(`UPDATE broker_connections SET "tokenHint" = 'toolong' WHERE "accountId" = $1`, [broker]),
    { code: '23514' },
  );

  await service.disconnect(owner, broker);
  assert.deepEqual(await service.read(owner, broker), { connected: false });
  await service.disconnect(owner, broker);
  console.log('PASS BROKER-CONNECT');
}

async function removal(db, service, owner) {
  stage = 'removing an empty broker account scrubs its token';
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const broker = await account(db, owner, 'broker');
  await takeOver(db, service, owner, broker);
  assert.equal((await service.read(owner, broker)).connected, true);
  // BROKER-LIST-CONNECTION: the account list says which broker accounts read with a token.
  const bare = await account(db, owner, 'broker');
  const listed = (await new AccountingService(db).listAccounts(owner, { limit: 100 })).items;
  assert.deepEqual(listed.find((item) => item.id === broker).connection, {
    provider: 'tbank',
    imported: false,
  });
  assert.equal(listed.find((item) => item.id === bare).connection, null);
  await new AccountingService(db).removeAccount(owner, bare);
  await new AccountingService(db).removeAccount(owner, broker);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM broker_connections WHERE "accountId" = $1', [broker]))[0].n,
    0,
    'The token goes with the account',
  );
  await rejected(() => service.read(owner, broker), 404);
  console.log('PASS BROKER-CONNECT-REMOVE');
}

async function setup(db, service, setupService, tbank, owner, other) {
  stage = 'BROKER-SETUP: one token makes and connects a broker account for each pick, once';
  const regular = { id: '2000000101', name: 'Synthetic regular', open: true, access: 'read_only' };
  const iis = { id: '2000000102', name: 'Synthetic IIS', open: true, access: 'read_only' };
  const closed = { id: '2000000103', name: 'Synthetic closed', open: false, closed: true, access: 'read_only' };
  tbank.listed = [regular, iis, closed];
  try {
    const count = async (table, where = '') =>
      (await db.query(`SELECT count(*)::int AS n FROM ${table} ${where}`))[0].n;
    const listing = await setupService.accounts(owner, { token });
    assert.deepEqual(
      listing.accounts.map(({ id, connected }) => [id, connected]),
      [
        [regular.id, false],
        [iis.id, false],
      ],
      'A closed T-Bank account is not offered',
    );
    assert.equal(await count('broker_connections', `WHERE "brokerAccountId" = '${regular.id}'`), 0);

    const picks = [
      { brokerAccountId: regular.id, requestId: randomUUID(), name: 'T-Bank Synthetic regular' },
      { brokerAccountId: iis.id, requestId: randomUUID(), name: 'T-Bank Synthetic IIS' },
    ];
    const accountsBefore = await count('manual_accounts');
    const made = await setupService.connect(owner, { token, accounts: picks });
    assert.equal(made.connections.length, 2);
    assert.ok(made.connections.every((item) => item.created));
    assert.ok(!JSON.stringify(made).includes(token), 'The token is never returned');
    assert.equal(await count('manual_accounts'), accountsBefore + 2);
    for (const [index, item] of made.connections.entries()) {
      const [row] = await db.query(
        'SELECT name, "assetClass", "ownerId" FROM manual_accounts WHERE id = $1',
        [item.accountId],
      );
      assert.deepEqual(
        [row.name, row.assetClass, row.ownerId],
        [picks[index].name, 'broker', owner],
      );
      const shown = await service.read(owner, item.accountId);
      assert.equal(shown.connected, true);
      assert.equal(shown.brokerAccountId, picks[index].brokerAccountId);
      const [stored] = await db.query(
        'SELECT credentials::text AS credentials FROM broker_connections WHERE "accountId" = $1',
        [item.accountId],
      );
      assert.ok(!stored.credentials.includes(token), 'The token is stored encrypted');
    }

    const again = await setupService.connect(owner, { token: replacement, accounts: picks });
    assert.deepEqual(
      again.connections.map(({ accountId, created }) => [accountId, created]),
      made.connections.map(({ accountId }) => [accountId, false]),
      'The same request finds the accounts it made',
    );
    // A finished command is answered from what is saved, even while T-Bank cannot be reached.
    tbank.down = true;
    try {
      const offline = await setupService.connect(owner, { token, accounts: picks });
      assert.deepEqual(offline, again);
    } finally {
      tbank.down = false;
    }
    assert.equal(await count('manual_accounts'), accountsBefore + 2);
    assert.equal(
      (await service.read(owner, made.connections[0].accountId)).tokenHint,
      token.slice(-4),
      'A repeated request writes nothing, so it does not replace the stored token',
    );

    assert.deepEqual(
      (await setupService.accounts(owner, { token })).accounts.map(({ id, connected }) => [id, connected]),
      [
        [regular.id, true],
        [iis.id, true],
      ],
    );
    assert.deepEqual(
      (await setupService.accounts(other, { token })).accounts.map(({ connected }) => connected),
      [false, false],
      'Another owner sees nothing connected',
    );
    await rejected(
      () =>
        setupService.connect(owner, {
          token,
          accounts: [{ ...picks[0], requestId: randomUUID() }],
        }),
      409,
    );
    assert.equal(await count('manual_accounts'), accountsBefore + 2, 'A refused request makes nothing');
    // The direct connect keeps the same rule: a T-Bank account read by one broker account is
    // refused for another.
    const spare = await account(db, owner, 'broker');
    await rejected(() => service.connect(owner, spare, { token, brokerAccountId: regular.id }), 409);
    assert.equal(await count('broker_connections', `WHERE "accountId" = '${spare}'`), 0);
    assert.equal(await count('broker_connections', `WHERE "brokerAccountId" = '${regular.id}'`), 1);
    await rejected(
      () =>
        setupService.connect(owner, {
          token,
          accounts: [{ brokerAccountId: '9999999999', requestId: randomUUID(), name: 'Other' }],
        }),
      422,
    );
    await rejected(
      () => setupService.connect(owner, { token, accounts: [{ ...picks[0], name: 'Changed' }] }),
      409,
    );
    // A repeated request never re-points a connection, restores a disconnected one or stores a
    // token on an account removed since.
    await rejected(
      () =>
        setupService.connect(owner, {
          token,
          accounts: [{ ...picks[0], brokerAccountId: iis.id }],
        }),
      409,
    );
    assert.equal(
      (await service.read(owner, made.connections[0].accountId)).brokerAccountId,
      regular.id,
      'A repeated request for another T-Bank account re-points nothing',
    );
    await service.disconnect(owner, made.connections[1].accountId);
    await rejected(() => setupService.connect(owner, { token, accounts: [picks[1]] }), 409);
    assert.equal(
      await count('broker_connections', `WHERE "accountId" = '${made.connections[1].accountId}'`),
      0,
      'A repeated request does not restore a connection the owner removed',
    );
    const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
    await new AccountingService(db).removeAccount(owner, made.connections[0].accountId);
    await rejected(() => setupService.connect(owner, { token, accounts: [picks[0]] }), 409);
    assert.equal(
      await count('broker_connections', `WHERE "accountId" = '${made.connections[0].accountId}'`),
      0,
      'A repeated request stores no token on a removed account',
    );
    console.log('PASS BROKER-SETUP');
  } finally {
    tbank.listed = [brokerAccount];
  }
}

async function heldPreview(db, service, imports, owner) {
  stage = 'the import preview counts an opening snapshot as held entries';
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const accounting = new AccountingService(db);
  const broker = await account(db, owner, 'broker');
  await takeOver(db, service, owner, broker);
  assert.equal((await imports.preview(owner, broker)).accountHasEntries, false);
  const instrument = (
    await accounting.createInstrument(owner, { requestId: randomUUID(), name: 'Synthetic share' })
  ).value.id;
  const opening = await accounting.saveOpening(owner, broker, {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: '2025-01-01T00:00:00.000Z',
    positions: [{ instrumentId: instrument, quantity: '2', costStatus: 'known', totalCostUsd: '300' }],
  });
  assert.equal(opening.created, true);
  assert.equal(
    (await imports.preview(owner, broker)).accountHasEntries,
    true,
    'An opening snapshot is history the import would add to',
  );
  console.log('PASS BROKER-SYNC-PREVIEW-HELD');
  return instrument;
}

async function voidedTransferPreview(db, service, imports, owner, instrument) {
  stage = 'the import preview no longer counts a voided transfer';
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const { OwnedTransferService } = require('/app/backend/dist/accounting/owned-transfer.service.js');
  const sender = await account(db, owner, null);
  const broker = await account(db, owner, 'broker');
  await takeOver(db, service, owner, broker);
  await new TradeService(db).create(owner, sender, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    instrumentId: instrument,
    side: 'buy',
    occurredAt: '2025-01-02T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '1',
    grossUsd: '100',
    feeUsd: '0',
  });
  const transfers = new OwnedTransferService(db);
  const moved = await transfers.create(owner, {
    requestId: randomUUID(),
    fromAccountId: sender,
    toAccountId: broker,
    expectedFromJournalRevision: 1,
    expectedToJournalRevision: 0,
    assertInternal: true,
    instrumentId: instrument,
    occurredAt: '2025-01-03T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '0.5',
    feeInstrumentId: null,
    feeQuantity: '0',
  });
  assert.equal((await imports.preview(owner, broker)).accountHasEntries, true);
  await transfers.void(owner, moved.value.transfer.transferId, {
    requestId: randomUUID(),
    expectedVersion: 1,
    expectedFromJournalRevision: 2,
    expectedToJournalRevision: 1,
  });
  assert.equal(
    (await imports.preview(owner, broker)).accountHasEntries,
    false,
    'A voided transfer leaves nothing the import would add to',
  );
  console.log('PASS BROKER-SYNC-PREVIEW-VOIDED');
}

async function rewardRoomPreview(db, service, imports, owner, instrument) {
  stage = "the import preview counts the owner's rewards in other accounts";
  const { AssetRewardService } = require('/app/backend/dist/accounting/asset-reward.service.js');
  const broker = await account(db, owner, 'broker');
  const elsewhere = await account(db, owner, null);
  await takeOver(db, service, owner, broker);
  // 1000 synthetic dividends: exactly what one account's reward journal keeps.
  for (let index = 0; index < 1000; index += 1)
    history.push({
      id: String(700000000 + index),
      parentId: '',
      type: 'OPERATION_TYPE_DIVIDEND',
      state: 'executed',
      occurredAt: '2025-02-01T10:00:00Z',
      instrumentUid: '00000000-0000-4000-8000-000000000001',
      instrumentType: 'share',
      ticker: 'SYNTH',
      quantity: '0',
      payment: '1',
      paymentCurrency: 'rub',
      price: '',
      priceCurrency: '',
      commission: '',
      commissionCurrency: '',
      fills: [],
    });
  try {
    const before = await imports.preview(owner, broker);
    assert.deepEqual([before.rewards, before.fitsRewardLimit], [1000, true]);
    await new AssetRewardService(db).create(owner, elsewhere, {
      requestId: randomUUID(),
      expectedJournalRevision: 0,
      assertReward: true,
      instrumentId: instrument,
      category: 'staking',
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '2',
      acquisitionBasisUsd: '0',
      incomeValueUsd: '0',
    });
    assert.equal(
      (await imports.preview(owner, broker)).fitsRewardLimit,
      false,
      'One reward elsewhere leaves room for 999, not 1000',
    );
  } finally {
    history.length = 0;
  }
  console.log('PASS BROKER-SYNC-PREVIEW-REWARD-ROOM');
}

const shareUid = '10000000-0000-4000-8000-0000000000a1';
const otherUid = '10000000-0000-4000-8000-0000000000b2';
let history = [];
function operation(id, type, payment, over = {}) {
  return {
    id,
    parentId: '',
    type: `OPERATION_TYPE_${type}`,
    state: 'executed',
    occurredAt: '2024-03-01T07:00:00Z',
    instrumentUid: '',
    instrumentType: '',
    ticker: '',
    quantity: '0',
    payment,
    paymentCurrency: 'rub',
    price: '',
    priceCurrency: '',
    commission: '',
    commissionCurrency: '',
    fills: [],
    ...over,
  };
}
const share = (over) => ({ instrumentUid: shareUid, instrumentType: 'share', ticker: 'SYNTHA', ...over });
const heldPosition = (instrumentUid, quantity, instrumentType = 'share') => ({ instrumentUid, instrumentType, quantity, averagePrice: '100', averagePriceCurrency: 'rub', currentPrice: '120', currentPriceCurrency: 'rub', virtual: false, expiresAt: '' });

async function importing(db, service, imports, tbank, owner, other) {
  const { OperationListService } = require('/app/backend/dist/accounting/operation-list.service.js');
  stage = 'BROKER-SYNC: a synthetic T-Bank history previewed and written into an empty account';
  const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
  const trades = new TradeService(db);
  await db.query(`INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit")
    SELECT c.currency,'cbr',d::date,c.rate FROM (VALUES ('USD',90),('EUR',100)) c(currency,rate)
    CROSS JOIN generate_series(date '2024-02-20', date '2024-03-31', interval '1 day') d`);
  const count = async (table, where = '') =>
    (await db.query(`SELECT count(*)::int AS n FROM ${table} ${where}`))[0].n;
  const broker = await account(db, owner, 'broker');
  await takeOver(db, service, owner, broker);
  history = [
    operation('100000001', 'INPUT', '10000'),
    operation('100000002', 'BUY', '-5000', share({
      occurredAt: '2024-03-01T08:00:00.123456789Z',
      quantity: '10',
      fills: [{ filledAt: '2024-03-01T08:00:01.5Z', quantity: '10', price: '500', priceCurrency: 'rub' }],
    })),
    operation('100000003', 'BROKER_FEE', '-15', { parentId: '100000002', occurredAt: '2024-03-01T08:00:00Z' }),
    operation('100000004', 'DIVIDEND', '90', share({ occurredAt: '2024-03-05T09:00:00Z', quantity: '0' })),
    operation('100000005', 'DIVIDEND_TAX', '-12', { occurredAt: '2024-03-05T09:00:00Z' }),
    operation('100000006', 'SELL', '2400', share({ occurredAt: '2024-03-10T10:00:00Z', quantity: '4' })),
    operation('100000007', 'BROKER_FEE', '-7', { parentId: '100000006', occurredAt: '2024-03-10T10:00:00Z' }),
    operation('100000008', 'OUTPUT', '-1000', { occurredAt: '2024-03-11T10:00:00Z' }),
    operation('100000009', 'BROKER_FEE', '0', { occurredAt: '2024-03-12T10:00:00Z' }),
    operation('100000010', 'BUY', '-1', share({ state: 'canceled', quantity: '1' })),
  ];
  tbank.positions = [heldPosition(shareUid, '6')];
  tbank.cash = [['RUB', '6456']];
  const instrumentsBefore = await count('accounting_instruments');
  const preview = await imports.preview(owner, broker);
  assert.deepEqual(preview.problems, []);
  assert.equal(preview.accountHasEntries, false);
  assert.equal(preview.canImport, true);
  assert.match(preview.previewHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    preview.entries.map((entry) => [entry.record, entry.action, entry.amount, entry.fee]),
    [
      ['trade', 'deposit', '10000', '0'],
      ['trade', 'buy', '5000', '15'],
      ['reward', 'income', '90', '0'],
      ['trade', 'tax', '12', '0'],
      ['trade', 'sell', '2400', '7'],
      ['trade', 'withdrawal', '1000', '0'],
    ],
  );
  assert.deepEqual(preview.skipped.map((item) => [item.operationId, item.reason]), [['100000009', 'no-amount']]);
  assert.equal(await count('accounting_instruments'), instrumentsBefore, 'A preview creates nothing');
  assert.equal(await count('broker_imports'), 0);
  assert.equal(await count('account_trade_journals', `WHERE "accountId" = '${broker}'`), 0);

  const requestId = randomUUID();
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const listedConnection = async () =>
    (await new AccountingService(db).listAccounts(owner, { limit: 100 })).items.find(
      (item) => item.id === broker,
    ).connection;
  assert.deepEqual(await listedConnection(), { provider: 'tbank', imported: false });
  const first = await imports.import(owner, broker, { requestId, previewHash: preview.previewHash });
  assert.equal(first.created, true);
  // BROKER-LIST-CONNECTION: once its history is written, the account no longer waits for it.
  assert.deepEqual(await listedConnection(), { provider: 'tbank', imported: true });
  // The import is the history of the T-Bank account it was read from: reconnected to another,
  // the account waits for that one's history, and back again it is imported.
  const otherTBank = { ...brokerAccount, id: '2000000199', name: 'Synthetic other' };
  tbank.listed = [brokerAccount, otherTBank];
  try {
    await service.connect(owner, broker, { token, brokerAccountId: otherTBank.id });
    assert.deepEqual(await listedConnection(), { provider: 'tbank', imported: false });
    await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
    assert.deepEqual(await listedConnection(), { provider: 'tbank', imported: true });
  } finally {
    tbank.listed = [brokerAccount];
  }
  assert.deepEqual(
    [first.value.trades, first.value.rewards, first.value.firstJournalRevision, first.value.lastJournalRevision],
    [5, 1, 1, 6],
  );
  const again = await imports.import(owner, broker, { requestId, previewHash: preview.previewHash });
  assert.deepEqual(again, { created: false, value: first.value }, 'A repeated request returns its receipt');
  await rejected(() => imports.import(owner, broker, { requestId, previewHash: 'f'.repeat(64) }), 409);
  await rejected(
    () => imports.import(owner, broker, { requestId: randomUUID(), previewHash: preview.previewHash }),
    409,
  );
  const after = await imports.preview(owner, broker);
  assert.deepEqual([after.accountHasEntries, after.canImport], [true, false]);

  const journal = await trades.getJournal(owner, broker);
  assert.deepEqual([journal.journal.journalRevision, journal.journal.activeTradeCount], [6, 5]);
  const [rub] = await db.query(
    `SELECT id FROM accounting_instruments WHERE "ownerId" = $1 AND "assetType" = 'fiat' AND symbol = 'RUB'`,
    [owner],
  );
  const [linked] = await db.query(
    `SELECT i.id, i.name, i.symbol, i."assetType", i."valuationCurrency", i."priceSource"
      FROM broker_instrument_links l JOIN accounting_instruments i ON i.id = l."instrumentId"
      WHERE l."ownerId" = $1 AND l."providerInstrumentId" = $2`,
    [owner, shareUid],
  );
  assert.deepEqual(
    [linked.name, linked.symbol, linked.assetType, linked.valuationCurrency, linked.priceSource],
    ['SYNTHA', 'SYNTHA', 'manual', 'RUB', 'manual'],
  );
  // BPR-IMPORT: the import keeps the price T-Bank reports for the share it holds, and values it.
  const plainNumber = (value) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);
  const observed = await db.query(
    `SELECT price::text AS price, "quoteCurrency", provider FROM broker_price_observations
      WHERE "ownerId" = $1 AND "instrumentId" = $2`,
    [owner, linked.id],
  );
  assert.deepEqual(observed.map((row) => [plainNumber(row.price), row.quoteCurrency, row.provider]), [['120', 'RUB', 'tbank']]);
  const { PortfolioValuationService } = require('/app/backend/dist/accounting/portfolio-valuation.service.js');
  const valuedShare = (await new PortfolioValuationService(db).read(owner, { currency: 'RUB' })).assets.find(
    (asset) => asset.instrumentId === linked.id,
  );
  assert.deepEqual(
    [valuedShare.quantity, valuedShare.value, valuedShare.price.value, valuedShare.price.source, valuedShare.price.status],
    ['6', '720', '120', 'tbank', 'fresh'],
  );
  // BPR-HISTORY: the asset chart values the share at the same T-Bank price as the portfolio.
  const { PortfolioSnapshotsService } = require('/app/backend/dist/portfolio-snapshots/portfolio-snapshots.service.js');
  const chart = await new PortfolioSnapshotsService(db, new ConfigService({})).assetHistory(
    owner,
    linked.id,
    { period: '24H', currency: 'RUB' },
    new Date(Date.now() + 1000),
  );
  assert.deepEqual([chart.points.at(-1).quantity, chart.points.at(-1).value], ['6', '720']);
  console.log('PASS BPR-IMPORT');
  const at = '2024-04-01T00:00:00.000Z';
  // 10000 in, 5015 on the buy, 90 dividend, 12 tax, 2393 kept from the sale, 1000 out.
  assert.equal((await trades.available(owner, broker, { instrumentId: rub.id, at })).quantity, '6456');
  assert.equal((await trades.available(owner, broker, { instrumentId: linked.id, at })).quantity, '6');
  const importedRows = (await new OperationListService(db).read(owner, {})).operations.filter(
    (item) => item.account?.id === broker,
  );
  assert.ok(importedRows.some((item) => item.kind === 'trade'));
  assert.ok(importedRows.some((item) => item.kind === 'reward'));
  assert.ok(importedRows.every((item) => item.source === 'broker'), 'Trades and rewards retain broker provenance');
  const exported = await operationsCsv(db, owner);
  for (const item of importedRows) assert.ok(exported.includes(`${item.id},${item.kind},${item.type},${item.direction},active,broker,`));
  const { AuditHistoryService } = require('/app/backend/dist/accounting/audit-history.service.js');
  const importedHistory = (await new AuditHistoryService(db).read(owner, { actor: 'broker', limit: '100' })).events;
  assert.ok(importedHistory.some((item) => item.entity === 'trade' && item.version === 1));
  assert.ok(importedHistory.some((item) => item.entity === 'reward' && item.version === 1));
  const [buy] = await db.query(
    `SELECT v."occurredAt", p.gross, p.fee, p."rateSource", s.quantity AS settled
      FROM account_trade_versions v
      JOIN account_trade_version_payments p USING ("ownerId", "accountId", "tradeId", version)
      JOIN account_trade_version_settlements s USING ("ownerId", "accountId", "tradeId", version)
      WHERE v."accountId" = $1 AND v."instrumentId" = $2 AND v.side = 'buy'`,
    [broker, linked.id],
  );
  assert.equal(buy.occurredAt.toISOString(), '2024-03-01T08:00:01.500Z', 'Dated by its last fill');
  const plain = (value) => value.replace(/\.?0+$/, '');
  assert.deepEqual(
    [plain(buy.gross), plain(buy.fee), buy.rateSource, plain(buy.settled)],
    ['5000', '15', 'bank-of-russia', '5015'],
  );
  assert.equal(
    await count('account_trade_version_purposes', `WHERE "accountId" = '${broker}' AND purpose = 'fee'`),
    1,
    'The dividend tax lowers the return only',
  );
  const [dividend] = await db.query(
    `SELECT quantity, category, "incomeValueUsd" FROM account_reward_versions WHERE "accountId" = $1`,
    [broker],
  );
  assert.deepEqual(
    [plain(dividend.quantity), dividend.category, plain(dividend.incomeValueUsd)],
    ['90', 'other', '1'],
  );
  const firstHistory = history;
  const recorded = await db.query(
    `SELECT "operationId", "tradeId" IS NOT NULL AS trade FROM broker_imported_operations
      WHERE "accountId" = $1 ORDER BY "operationId"`,
    [broker],
  );
  assert.deepEqual(
    recorded.map((row) => [row.operationId, row.trade]),
    [
      ['100000001', true],
      ['100000002', true],
      ['100000003', true],
      ['100000004', false],
      ['100000005', true],
      ['100000006', true],
      ['100000007', true],
      ['100000008', true],
    ],
  );
  await rejected(() => imports.preview(other, broker), 404);
  console.log('PASS BROKER-SYNC-IMPORT');

  stage = 'BROKER-SYNC: a second account reuses the linked instrument';
  const second = await account(db, owner, 'broker');
  await takeOver(db, service, owner, second);
  history = [
    operation('200000001', 'INPUT', '1000'),
    operation('200000002', 'BUY', '-500', share({ occurredAt: '2024-03-02T08:00:00Z', quantity: '1' })),
  ];
  tbank.positions = [heldPosition(shareUid, '1')];
  tbank.cash = [['RUB', '500']];
  const reused = await imports.preview(owner, second);
  await imports.import(owner, second, { requestId: randomUUID(), previewHash: reused.previewHash });
  assert.equal(await count('broker_instrument_links'), 1);
  assert.equal(await count('accounting_instruments', `WHERE symbol = 'SYNTHA'`), 1);
  console.log('PASS BROKER-SYNC-REUSE');

  stage = 'BROKER-SYNC: a history that cannot be written is refused whole';
  const third = await account(db, owner, 'broker');
  await takeOver(db, service, owner, third);
  history = [
    operation('300000001', 'INPUT', '100', { occurredAt: '2020-01-01T10:00:00Z' }),
    operation('300000002', 'SELL', '100', {
      occurredAt: '2024-03-03T10:00:00Z',
      instrumentUid: otherUid,
      instrumentType: 'share',
      ticker: 'SYNTHB',
      quantity: '1',
    }),
    operation('300000003', 'SOMETHING_NEW', '-1', { occurredAt: '2024-03-04T10:00:00Z' }),
  ];
  tbank.positions = [];
  tbank.cash = [];
  const refused = await imports.preview(owner, third);
  assert.equal(refused.canImport, false);
  assert.deepEqual(
    refused.problems.map((problem) => [problem.reason, problem.ticker, problem.operationIds]),
    [
      // The sale of SYNTHB units the history never shows held is left out by the plan itself.
      ['not-recordable', '', ['300000003', '300000002']],
      ['no-rate', '', ['300000001']],
    ],
  );
  const instruments = await count('accounting_instruments');
  await rejected(
    () => imports.import(owner, third, { requestId: randomUUID(), previewHash: refused.previewHash }),
    409,
  );
  assert.equal(await count('accounting_instruments'), instruments, 'A refused import writes nothing');
  assert.equal(await count('broker_imports', `WHERE "accountId" = '${third}'`), 0);
  console.log('PASS BROKER-SYNC-REFUSED');

  stage = 'BROKER-SYNC: one T-Bank account is never written twice, into any account';
  const fourth = await account(db, owner, 'broker');
  await takeOver(db, service, owner, fourth);
  history = firstHistory;
  tbank.positions = [heldPosition(shareUid, '6')];
  tbank.cash = [['RUB', '6456']];
  const twice = await imports.preview(owner, fourth);
  assert.equal(twice.accountHasEntries, false);
  assert.equal(twice.canImport, false);
  assert.deepEqual(
    twice.problems.map((problem) => [problem.reason, problem.operationIds.length]),
    [['already-imported', 8]],
  );
  await rejected(
    () => imports.import(owner, fourth, { requestId: randomUUID(), previewHash: twice.previewHash }),
    409,
  );
  assert.equal(await count('broker_imports', `WHERE "accountId" = '${fourth}'`), 0);
  console.log('PASS BROKER-SYNC-ONCE');

  await assert.rejects(
    db.query('DELETE FROM manual_accounts WHERE id = $1', [broker]),
    (error) => ['23001', '23503'].includes(error.code),
    'An account with an import cannot be deleted',
  );
  await assert.rejects(
    db.query(`UPDATE broker_imported_operations SET "tradeId" = NULL WHERE "accountId" = $1`, [broker]),
    { code: '23514' },
  );

  stage = 'BROKER-SYNC-FX: dollars bought on the exchange are cash, gold an asset, a split order two entries';
  const fifth = await account(db, owner, 'broker');
  await takeOver(db, service, owner, fifth);
  const dollarsUid = '10000000-0000-4000-8000-0000000000d1';
  const goldUid = '10000000-0000-4000-8000-0000000000f1';
  const fx = (ticker, uid, over) => ({ instrumentUid: uid, instrumentType: 'currency', ticker, ...over });
  history = [
    operation('500000001', 'INPUT', '100000'),
    operation('500000002', 'BUY', '-90000', fx('USD000UTSTOM', dollarsUid, {
      occurredAt: '2024-03-02T08:00:00Z',
      quantity: '1000',
    })),
    operation('500000003', 'BROKER_FEE', '-45', { parentId: '500000002', occurredAt: '2024-03-02T08:00:00Z' }),
    operation('500000004', 'BUY', '-600', share({
      occurredAt: '2024-03-03T08:00:00Z',
      quantity: '2',
      paymentCurrency: 'usd',
      fills: [
        { filledAt: '2024-03-03T08:00:01Z', quantity: '1', price: '300', priceCurrency: 'usd' },
        { filledAt: '2024-03-04T08:00:01Z', quantity: '1', price: '300', priceCurrency: 'usd' },
      ],
    })),
    operation('500000005', 'SELL', '27000', fx('USD000UTSTOM', dollarsUid, {
      occurredAt: '2024-03-05T08:00:00Z',
      quantity: '300',
    })),
    operation('500000006', 'BUY', '-7000', fx('GLDRUB_TOM', goldUid, {
      occurredAt: '2024-03-06T08:00:00Z',
      quantity: '1',
    })),
  ];
  tbank.currencyCodes[goldUid] = 'XAU';
  tbank.positions = [heldPosition(shareUid, '2'), heldPosition(goldUid, '1', 'currency')];
  tbank.cash = [['RUB', '29955'], ['USD', '100']];
  const exchanged = await imports.preview(owner, fifth);
  assert.deepEqual([exchanged.problems, exchanged.skipped], [[], []]);
  assert.deepEqual(
    exchanged.entries.map((entry) => [entry.action, entry.cash ?? '', entry.quantity, entry.operationIds]),
    [
      ['deposit', '', '100000', ['500000001']],
      ['buy', 'usd', '1000', ['500000002', '500000003']],
      ['buy', '', '1', ['500000004']],
      ['buy', '', '1', ['500000004#2']],
      ['sell', 'usd', '300', ['500000005']],
      ['buy', '', '1', ['500000006']],
    ],
  );
  await imports.import(owner, fifth, { requestId: randomUUID(), previewHash: exchanged.previewHash });
  const [usd] = await db.query(
    `SELECT id FROM accounting_instruments WHERE "ownerId" = $1 AND "assetType" = 'fiat' AND symbol = 'USD'`,
    [owner],
  );
  // 100000 in, 90045 for the dollars, 27000 back for 300 of them, 7000 on gold.
  assert.equal((await trades.available(owner, fifth, { instrumentId: rub.id, at })).quantity, '29955');
  // 1000 bought, 600 spent on the share in two parts, 300 sold.
  assert.equal((await trades.available(owner, fifth, { instrumentId: usd.id, at })).quantity, '100');
  const [goldAsset] = await db.query(
    `SELECT i.symbol, i."assetType", i."valuationCurrency" FROM broker_instrument_links l
      JOIN accounting_instruments i ON i.id = l."instrumentId"
      WHERE l."ownerId" = $1 AND l."providerInstrumentId" = $2`,
    [owner, goldUid],
  );
  assert.deepEqual(
    [goldAsset.symbol, goldAsset.assetType, goldAsset.valuationCurrency],
    ['GLDRUB_TOM', 'manual', 'RUB'],
  );
  assert.equal(await count('broker_instrument_links', `WHERE "providerInstrumentId" = '${dollarsUid}'`), 0);
  assert.deepEqual(
    (
      await db.query(
        `SELECT "operationId" FROM broker_imported_operations WHERE "accountId" = $1 ORDER BY "operationId"`,
        [fifth],
      )
    ).map((row) => row.operationId),
    ['500000001', '500000002', '500000003', '500000004', '500000004#2', '500000005', '500000006'],
  );
  console.log('PASS BROKER-SYNC-FX');

  stage = 'BROKER-SYNC-HASH: a rate stored after the preview does not let its hash write the history';
  const sixth = await account(db, owner, 'broker');
  await takeOver(db, service, owner, sixth);
  history = [operation('600000001', 'INPUT', '100', { occurredAt: '2019-12-20T10:00:00Z' })];
  tbank.positions = [];
  tbank.cash = [['RUB', '100']];
  const unrated = await imports.preview(owner, sixth);
  assert.deepEqual(unrated.problems.map((problem) => problem.reason), ['no-rate']);
  await db.query(`INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit")
    VALUES ('USD','cbr','2019-12-20',62),('EUR','cbr','2019-12-20',69)`);
  await rejected(
    () => imports.import(owner, sixth, { requestId: randomUUID(), previewHash: unrated.previewHash }),
    409,
  );
  assert.equal(await count('broker_imports', `WHERE "accountId" = '${sixth}'`), 0);
  const rated = await imports.preview(owner, sixth);
  assert.equal(rated.canImport, true);
  assert.notEqual(rated.previewHash, unrated.previewHash);
  console.log('PASS BROKER-SYNC-HASH');

  stage = 'BROKER-SYNC-REWARD-CAP: a history with more rewards than the journal keeps is previewed, not failed';
  const seventh = await account(db, owner, 'broker');
  await takeOver(db, service, owner, seventh);
  history = Array.from({ length: 1001 }, (_, index) =>
    operation(`7${String(index).padStart(8, '0')}`, 'DIVIDEND', '1', share({
      occurredAt: `2024-03-${String(1 + (index % 28)).padStart(2, '0')}T09:00:00Z`,
      quantity: '0',
    })),
  );
  tbank.cash = [['RUB', '1001']];
  const crowded = await imports.preview(owner, seventh);
  assert.equal(crowded.fitsRewardLimit, false);
  assert.equal(crowded.canImport, false);
  assert.deepEqual(crowded.problems.map((problem) => problem.reason), ['too-many-rewards']);
  console.log('PASS BROKER-SYNC-REWARD-CAP');

  stage = 'BROKER-SYNC-FUNDING: a sale in the same instant pays for the buy it funds, though the buy comes first in the plan';
  const eighth = await account(db, owner, 'broker');
  await takeOver(db, service, owner, eighth);
  history = [
    operation('800000001', 'INPUT', '100', { occurredAt: '2024-03-01T10:00:00Z' }),
    operation('800000002', 'BUY', '-100', share({ occurredAt: '2024-03-02T10:00:00Z', quantity: '1', price: '100' })),
    operation('800000003', 'SELL', '150', share({ occurredAt: '2024-03-05T10:00:00Z', quantity: '1', price: '150' })),
    operation('800000004', 'BUY', '-150', share({ occurredAt: '2024-03-05T10:00:00Z', quantity: '1', price: '150' })),
  ];
  tbank.positions = [heldPosition(shareUid, '1')];
  tbank.cash = [];
  const funded = await imports.preview(owner, eighth);
  assert.deepEqual(funded.problems, []);
  assert.equal(funded.canImport, true);
  await imports.import(owner, eighth, { requestId: randomUUID(), previewHash: funded.previewHash });
  assert.equal(await count('broker_imports', `WHERE "accountId" = '${eighth}'`), 1);
  // The same order with a security no earlier import linked: the import creates it on its first
  // pass and still matches the preview that named it as new.
  const fundedNew = await account(db, owner, 'broker');
  await takeOver(db, service, owner, fundedNew);
  const fundedUid = '10000000-0000-4000-8000-00000000f101';
  history = history.map((row, index) => ({ ...row, id: String(810000001 + index),
    ...(row.instrumentUid ? { instrumentUid: fundedUid, ticker: 'SYNTHFUNDED' } : {}) }));
  tbank.positions = [heldPosition(fundedUid, '1')];
  const fundedNewPreview = await imports.preview(owner, fundedNew);
  assert.equal(fundedNewPreview.canImport, true);
  await imports.import(owner, fundedNew, { requestId: randomUUID(), previewHash: fundedNewPreview.previewHash });
  assert.equal(await count('broker_instrument_links', `WHERE "providerInstrumentId" = '${fundedUid}'`), 1);
  console.log('PASS BROKER-SYNC-FUNDING');

  stage = 'BROKER-CAPRET: a bond paid back in part lowers its cost and brings cash in, once';
  const bondUid = '10000000-0000-4000-8000-0000000000c3';
  const bond = (over) => ({
    instrumentUid: bondUid,
    instrumentType: 'bond',
    ticker: 'SYNTHBOND',
    ...over,
  });
  const ninth = await account(db, owner, 'broker');
  await takeOver(db, service, owner, ninth);
  history = [
    operation('900000001', 'INPUT', '10000', { occurredAt: '2024-03-01T07:00:00Z' }),
    operation('900000002', 'BUY', '-9000', bond({ occurredAt: '2024-03-01T08:00:00Z', quantity: '10' })),
    operation('900000003', 'BOND_REPAYMENT', '2000', bond({ occurredAt: '2024-03-15T07:00:00Z' })),
    operation('900000004', 'BOND_REPAYMENT_FULL', '7500', bond({ occurredAt: '2024-03-20T07:00:00Z' })),
  ];
  tbank.positions = [];
  tbank.cash = [['RUB', '10500']];
  const returns = await imports.preview(owner, ninth);
  assert.deepEqual(returns.problems, []);
  assert.deepEqual(
    returns.entries.map((entry) => [entry.record, entry.action, entry.amount]),
    [
      ['trade', 'deposit', '10000'],
      ['trade', 'buy', '9000'],
      ['capital-return', 'return', '2000'],
      ['trade', 'sell', '7500'],
    ],
  );
  assert.deepEqual([returns.trades, returns.rewards, returns.capitalReturns], [3, 0, 1]);
  assert.equal(returns.canImport, true);
  const returnRequest = randomUUID();
  const returned = await imports.import(owner, ninth, { requestId: returnRequest, previewHash: returns.previewHash });
  assert.deepEqual(
    [returned.value.trades, returned.value.rewards, returned.value.capitalReturns, returned.value.lastJournalRevision],
    [3, 0, 1, 4],
  );
  assert.deepEqual(
    await imports.import(owner, ninth, { requestId: returnRequest, previewHash: returns.previewHash }),
    { created: false, value: returned.value },
    'A repeated request returns its receipt and writes no second return',
  );
  assert.equal(await count('account_capital_returns', `WHERE "accountId" = '${ninth}'`), 1);
  const [heldReturn] = await db.query(
    `SELECT v.kind, v.version, v."journalRevision", v.amount, v."amountUsd", v."paidCurrency",
        v."rateDate"::text AS "rateDate", v."perUsd", v."rateSource", v."occurredAt"
      FROM account_capital_return_versions v WHERE v."accountId" = $1`,
    [ninth],
  );
  const trim = (value) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);
  assert.deepEqual(
    [heldReturn.kind, heldReturn.version, heldReturn.journalRevision, trim(heldReturn.amount), heldReturn.paidCurrency],
    ['create', 1, 3, '2000', 'RUB'],
  );
  assert.deepEqual(
    [heldReturn.rateDate, trim(heldReturn.perUsd), heldReturn.rateSource, heldReturn.occurredAt.toISOString()],
    ['2024-03-15', '90', 'bank-of-russia', '2024-03-15T07:00:00.000Z'],
  );
  assert.equal(trim(heldReturn.amountUsd), '22.222222222222222222222222222222'.replace(/0+$/, ''));
  const [byReturn] = await db.query(
    `SELECT o."operationId", i."capitalReturns" FROM broker_imported_operations o
      JOIN broker_imports i ON i.id = o."importId"
      WHERE o."accountId" = $1 AND o."capitalReturnId" IS NOT NULL`,
    [ninth],
  );
  assert.deepEqual([byReturn.operationId, byReturn.capitalReturns], ['900000003', 1]);
  const [rubCash] = await db.query(
    `SELECT id FROM accounting_instruments WHERE "ownerId" = $1 AND "assetType" = 'fiat' AND symbol = 'RUB'`,
    [owner],
  );
  const bonds = await db.query(
    `SELECT i.id FROM broker_instrument_links l JOIN accounting_instruments i ON i.id = l."instrumentId"
      WHERE l."ownerId" = $1 AND l."providerInstrumentId" = $2`,
    [owner, bondUid],
  );
  const atEnd = '2024-04-01T00:00:00.000Z';
  // 10000 in, 9000 on the bond, 2000 came back, 7500 on its full repayment.
  assert.equal((await trades.available(owner, ninth, { instrumentId: rubCash.id, at: atEnd })).quantity, '10500');
  assert.equal((await trades.available(owner, ninth, { instrumentId: bonds[0].id, at: atEnd })).quantity, '0');
  const listed = (await new OperationListService(db).read(owner, {})).operations.filter(
    (item) => item.kind === 'capital-return',
  );
  assert.deepEqual(
    listed.map((item) => [item.type, item.direction, trim(item.quantity), item.counterAsset.symbol, item.account.id]),
    [['capital-return', 'in', '2000', 'SYNTHBOND', ninth]],
  );
  assert.equal(listed[0].paid.currency, 'RUB');
  assert.equal(listed[0].source, 'broker', 'The capital return came from a broker import');
  assert.ok((await operationsCsv(db, owner)).includes(`${listed[0].id},capital-return,capital-return,in,active,broker,`));
  const returnHistory = (await new AuditHistoryService(db).read(owner, { entity: 'capital-return' })).events;
  assert.equal(returnHistory.find((item) => item.entityId === listed[0].id.slice('capital-return:'.length)).actor, 'broker');
  await rejected(() => new AccountingService(db).removeAccount(owner, ninth), 409);
  assert.equal(await count('account_capital_returns', `WHERE "accountId" = '${ninth}'`), 1);
  console.log('PASS BROKER-CAPRET');

  stage = 'BROKER-CARD: a card buy spends the money T-Bank lists as paid in; a card sale never credits broker cash';
  const cardAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, cardAccount);
  history = [operation('1100000004', 'INPUT', '500', { occurredAt: '2024-03-01T06:59:59Z' }), operation('1100000001', 'BUY_CARD', '-500', share({ quantity: '2' })), operation('1100000002', 'SELL_CARD', '300', share({ occurredAt: '2024-03-02T08:00:00Z', quantity: '1' }))];
  tbank.positions = [heldPosition(shareUid, '1')];
  tbank.cash = [];
  const paidIn = history.shift();
  const unfunded = await imports.preview(owner, cardAccount);
  assert.equal(unfunded.canImport, false, 'A card buy without the money T-Bank lists as paid in never invents cash');
  assert.deepEqual(
    unfunded.problems.filter((problem) => problem.reason === 'not-held').map((problem) => [problem.ticker, problem.missingQuantity]),
    [['RUB', '500']],
  );
  history.unshift(paidIn);
  history.push(operation('1100000003', 'DIV_EXT', '15', share({ occurredAt: '2024-03-03T08:00:00Z', quantity: '0' })));
  const outsideDividend = await imports.preview(owner, cardAccount);
  assert.equal(outsideDividend.canImport, false, 'External dividends require reconciliation, never disappear from a successful import');
  await rejected(() => imports.import(owner, cardAccount, { requestId: randomUUID(), previewHash: outsideDividend.previewHash }), 409);
  assert.equal(await count('broker_imported_operations', `WHERE "accountId" = '${cardAccount}'`), 0);
  history.pop();
  const cardPreview = await imports.preview(owner, cardAccount);
  assert.equal(cardPreview.canImport, true);
  await imports.import(owner, cardAccount, { requestId: randomUUID(), previewHash: cardPreview.previewHash });
  assert.equal((await trades.available(owner, cardAccount, { instrumentId: rubCash.id, at: atEnd })).quantity, '0');
  assert.equal(await count('broker_imported_operations', `WHERE "accountId" = '${cardAccount}'`), 3);
  console.log('PASS BROKER-CARD PostgreSQL card buy paid from the money paid in, card sale off broker cash');

  stage = 'SPLIT-IMPORT: a declared share split lets the new units be sold, and holds for every account';
  const splitUid = '10000000-0000-4000-8000-00000000c101';
  const splitAsset = '10000000-0000-4000-8000-00000000c1a5';
  const splitShare = (over) => ({ instrumentUid: splitUid, assetUid: splitAsset, instrumentType: 'share', ticker: 'SYNTHSPLIT', ...over });
  const splitAt = '2024-03-09T21:00:00.000Z';
  const splitAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, splitAccount);
  history = [
    operation('1350000001', 'INPUT', '300'),
    operation('1350000002', 'BUY', '-300', splitShare({ quantity: '3' })),
    operation('1350000003', 'SELL', '250', splitShare({ occurredAt: '2024-03-15T08:00:00Z', quantity: '25' })),
  ];
  tbank.positions = [heldPosition(splitUid, '5')];
  tbank.cash = [['RUB', '250']];
  const unsplit = await imports.preview(owner, splitAccount);
  assert.equal(unsplit.canImport, false, 'Without the split, 25 shares were never held');
  // Bonds and currencies never split: a split of a held bond is refused.
  const splitBond = '10000000-0000-4000-8000-00000000c1b0';
  tbank.positions = [heldPosition(splitUid, '5'), heldPosition(splitBond, '1', 'bond')];
  await imports.preview(owner, splitAccount); // the held bond alone previews
  // The preview answers a refused split as a conflict, as it does a re-declared one.
  await rejected(() => imports.preview(owner, splitAccount, { splits: [{ asset: splitBond, effectiveAt: splitAt, ratio: 10 }] }), 409);
  tbank.positions = [heldPosition(splitUid, '5')];
  const splits = [{ asset: splitUid, effectiveAt: splitAt, ratio: 10 }];
  const declared = await imports.preview(owner, splitAccount, { splits });
  assert.deepEqual(declared.problems, []);
  assert.equal(declared.canImport, true);
  await rejected(() => imports.import(owner, splitAccount, { requestId: randomUUID(), previewHash: declared.previewHash }), 409);
  assert.equal(await count('instrument_splits'), 0, 'A preview with the split does not match an import without it');
  await imports.import(owner, splitAccount, { requestId: randomUUID(), previewHash: declared.previewHash, splits });
  const [splitLink] = await db.query(
    `SELECT "instrumentId" FROM broker_instrument_links WHERE "ownerId" = $1 AND "providerInstrumentId" = $2`,
    [owner, splitUid],
  );
  const [saved] = await db.query(`SELECT "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId" = $1`, [owner]);
  assert.deepEqual([saved.instrumentId, saved.effectiveAt.toISOString(), saved.ratio], [splitLink.instrumentId, splitAt, 10]);
  assert.equal((await trades.available(owner, splitAccount, { instrumentId: splitLink.instrumentId, at: atEnd })).quantity, '5');
  // A second account of the same security sells new units too, with no split declared again.
  const splitSecond = await account(db, owner, 'broker');
  await takeOver(db, service, owner, splitSecond);
  history = history.map((row, index) => ({ ...row, id: String(1350000101 + index) }));
  const inherited = await imports.preview(owner, splitSecond);
  assert.deepEqual(inherited.problems, []);
  assert.equal(inherited.canImport, true);
  // Declaring a split already saved conflicts with the saved state.
  await rejected(() => imports.preview(owner, splitSecond, { splits }), 409);
  // Nor does an account that holds it on another venue: another UID, the same asset.
  const splitVenueUid = '10000000-0000-4000-8000-00000000c102';
  const splitVenue = await account(db, owner, 'broker');
  await takeOver(db, service, owner, splitVenue);
  history = history.map((row, index) => ({
    ...row,
    id: String(1350000201 + index),
    ...(row.instrumentUid ? { instrumentUid: splitVenueUid, ticker: 'SYNTHSPLIT@' } : {}),
  }));
  tbank.positions = [heldPosition(splitVenueUid, '5')];
  const splitVenuePreview = await imports.preview(owner, splitVenue);
  assert.deepEqual(splitVenuePreview.problems, [], 'A saved split reaches the same asset on another venue');
  console.log('PASS SPLIT-IMPORT PostgreSQL declared split saved with the import, replayed for every account');

  stage = 'BROKER-OPENING: explicit owner quantities and exact costs cover pre-history holdings';
  const openingAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, openingAccount);
  history = [operation('1200000001', 'SELL', '9000', { instrumentUid: dollarsUid, instrumentType: 'currency', ticker: 'USD000UTSTOM', quantity: '100' }), operation('1200000002', 'SELL', '500', share({ occurredAt: '2024-03-02T08:00:00Z', quantity: '1' }))];
  tbank.positions = [];
  const opening = { asOf: '2024-02-25T00:00:00Z', lots: [{ asset: 'cash:USD', acquiredAt: '2024-02-01T00:00:00Z', quantity: '100', costUsd: '100' }, { asset: shareUid, acquiredAt: '2024-02-01T00:00:00Z', quantity: '1', costUsd: '10' }] };
  tbank.cash = [['RUB', '9500']];
  const openingPreview = await imports.preview(owner, openingAccount, { opening });
  assert.equal(openingPreview.canImport, true, 'Declared opening holdings must participate in planner and FIFO checks');
  await rejected(() => imports.import(owner, openingAccount, { requestId: randomUUID(), previewHash: openingPreview.previewHash, opening: { ...opening, lots: opening.lots.map((lot) => ({ ...lot, costUsd: '999' })) } }), 409);
  assert.equal(await count('account_opening_snapshots', `WHERE "accountId" = '${openingAccount}'`), 0, 'A stale preview rolls back opening creation');
  assert.equal(await count('account_carry_in_lots', `WHERE "accountId" = '${openingAccount}'`), 0);
  const openingRequest = { requestId: randomUUID(), previewHash: openingPreview.previewHash, opening };
  const importedOpening = await imports.import(owner, openingAccount, openingRequest);
  assert.equal((await imports.import(owner, openingAccount, openingRequest)).value.id, importedOpening.value.id, 'Replay preserves one atomic opening and import');
  assert.equal((await trades.available(owner, openingAccount, { instrumentId: rubCash.id, at: atEnd })).quantity, '9500');
  assert.equal(await count('account_opening_snapshots', `WHERE "accountId" = '${openingAccount}'`), 1);
  assert.equal(await count('account_carry_in_lots', `WHERE "accountId" = '${openingAccount}'`), 2);
  console.log('PASS BROKER-OPENING PostgreSQL known-cost carry-in, atomic import and idempotent retry');

  stage = 'BROKER-OPENING-POSITIONS: untouched earlier holdings cannot silently disappear';
  const untouchedAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, untouchedAccount);
  history = [operation('1300000001', 'INPUT', '1000')];
  const untouched = { instrumentUid: otherUid, instrumentType: 'share', quantity: '2', averagePrice: '100', averagePriceCurrency: 'rub', currentPrice: '120', currentPriceCurrency: 'rub', virtual: false, expiresAt: '' };
  tbank.positions = [untouched];
  tbank.cash = [['RUB', '1000']];
  assert.equal((await imports.preview(owner, untouchedAccount)).canImport, false, 'A held security absent from operations needs opening lots');
  const earlierGold = heldPosition('10000000-0000-4000-8000-0000000000f2', '1', 'currency');
  tbank.currencyCodes[earlierGold.instrumentUid] = 'XAU';
  tbank.positions = [earlierGold];
  assert.equal((await imports.preview(owner, untouchedAccount)).canImport, false, 'An earlier commodity cannot be silently classified as cash');
  const goldOpening = { asOf: '2024-02-25T00:00:00Z', lots: [{ asset: earlierGold.instrumentUid, acquiredAt: '2024-02-01T00:00:00Z', quantity: '1', costUsd: '25' }] };
  assert.equal((await imports.preview(owner, untouchedAccount, { opening: goldOpening })).canImport, true, 'Verified commodity metadata allows explicit opening lots');
  const withEarlierDollars = { ...goldOpening, lots: [...goldOpening.lots, { asset: 'cash:USD', acquiredAt: '2024-02-01T00:00:00Z', quantity: '1', costUsd: '1' }] };
  assert.equal((await imports.preview(owner, untouchedAccount, { opening: withEarlierDollars })).canImport, false, 'Opening cash cannot invent dollars absent from the current portfolio');
  tbank.cash = [['RUB', '999']];
  assert.equal((await imports.preview(owner, untouchedAccount, { opening: goldOpening })).canImport, false, 'Replayed ruble cash must match the provider too');
  tbank.cash = [['RUB', '1000'], ['USD', '1']];
  assert.equal((await imports.preview(owner, untouchedAccount, { opening: goldOpening })).canImport, false, 'Earlier cash absent from operations must be declared');
  assert.equal((await imports.preview(owner, untouchedAccount, { opening: withEarlierDollars })).canImport, true, 'Matching explicit earlier cash restores the exact balance');
  tbank.cash = [['RUB', '1000']];
  tbank.positions = [untouched];

  history.push(operation('1300000002', 'BUY', '0', { ...share({ quantity: '0' }), instrumentUid: otherUid }));
  assert.equal((await imports.preview(owner, untouchedAccount)).canImport, false, 'A zero operation cannot conceal a current holding');
  history.pop();
  tbank.cash = [['RUB', '500']];
  history.push(operation('1300000003', 'BUY', '-500', { ...share({ quantity: '1' }), instrumentUid: otherUid }));
  assert.equal((await imports.preview(owner, untouchedAccount)).canImport, false, 'One recorded share cannot conceal another earlier share');
  tbank.positions = [{ ...untouched, quantity: '0' }];
  assert.equal((await imports.preview(owner, untouchedAccount)).canImport, false, 'A recorded holding cannot contradict an explicitly zero current position');
  tbank.positions = [untouched];
  assert.equal((await imports.preview(owner, untouchedAccount, { opening: { asOf: '2024-02-25T00:00:00Z', lots: [{ asset: otherUid, acquiredAt: '2024-02-01T00:00:00Z', quantity: '1', costUsd: '10' }] } })).canImport, true, 'Opening and recorded shares reconcile together');
  history.pop();
  tbank.cash = [['RUB', '1000']];
  const untouchedOpening = { asOf: '2024-02-25T00:00:00Z', lots: [{ asset: otherUid, acquiredAt: '2024-02-01T00:00:00Z', quantity: '2', costUsd: '20' }] };
  const untouchedHistory = history;
  history = [operation('1400000001', 'INPUT', '1000'), operation('1400000002', 'BUY', '-500', { ...share({ quantity: '1' }), instrumentUid: otherUid }), operation('1400000003', 'SELL', '500', { ...share({ quantity: '1', occurredAt: '2024-03-02T10:00:00Z' }), instrumentUid: otherUid })];
  tbank.positions = [];
  assert.equal((await imports.preview(owner, untouchedAccount, { opening: { ...untouchedOpening, lots: [{ ...untouchedOpening.lots[0], quantity: '1', costUsd: '10' }] } })).canImport, false, 'Opening lots cannot invent a holding absent from the current portfolio');
  history = untouchedHistory;
  tbank.positions = [untouched];
  const untouchedPreview = await imports.preview(owner, untouchedAccount, { opening: untouchedOpening });
  assert.equal(untouchedPreview.openingAssets.some((asset) => asset.asset === otherUid), true);
  assert.equal(untouchedPreview.canImport, true);
  assert.equal((await imports.preview(owner, untouchedAccount, { opening: { ...untouchedOpening, lots: [{ ...untouchedOpening.lots[0], quantity: '3' }] } })).canImport, false, 'Opening quantity must match an untouched current holding');
  for (const ignored of [{ ...untouched, virtual: true }, { ...untouched, quantity: '0' }]) {
    tbank.positions = [ignored];
    assert.equal((await imports.preview(owner, untouchedAccount)).canImport, true, 'Virtual or zero positions are not required opening holdings');
  }
  tbank.positions = [{ ...untouched, currentPriceCurrency: '', averagePriceCurrency: '' }];
  assert.equal((await imports.preview(owner, untouchedAccount)).canImport, false, 'Missing position metadata never becomes an empty holding');
  tbank.positions = [{ ...untouched, instrumentType: 'futures' }];
  assert.equal((await imports.preview(owner, untouchedAccount)).canImport, false, 'Unsupported positions require reconciliation');
  tbank.positions = [{ ...untouched, currentPriceCurrency: 'usd' }];
  const changedMetadata = await imports.preview(owner, untouchedAccount, { opening: untouchedOpening });
  assert.equal(changedMetadata.canImport, true);
  assert.notEqual(changedMetadata.previewHash, untouchedPreview.previewHash, 'The preview pins position metadata even with unchanged quantities');
  await rejected(() => imports.import(owner, untouchedAccount, { requestId: randomUUID(), previewHash: untouchedPreview.previewHash, opening: untouchedOpening }), 409);
  tbank.positions = [{ ...untouched, quantity: '3' }];
  await rejected(() => imports.import(owner, untouchedAccount, { requestId: randomUUID(), previewHash: untouchedPreview.previewHash, opening: untouchedOpening }), 409);
  assert.equal(await count('account_opening_snapshots', `WHERE "accountId" = '${untouchedAccount}'`), 0);
  tbank.positions = [untouched];
  await imports.import(owner, untouchedAccount, { requestId: randomUUID(), previewHash: untouchedPreview.previewHash, opening: untouchedOpening });
  const [untouchedLink] = await db.query('SELECT "instrumentId" FROM broker_instrument_links WHERE "ownerId"=$1 AND "providerInstrumentId"=$2', [owner, otherUid]);
  assert.equal((await trades.available(owner, untouchedAccount, { instrumentId: untouchedLink.instrumentId, at: atEnd })).quantity, '2');
  tbank.positions = [];
  console.log('PASS BROKER-OPENING-POSITIONS explicit current holdings, quantity reconciliation and stale-portfolio rollback');

  stage = 'BROKER-POSITION-ID: trading modes share one verified security position';
  const modeAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, modeAccount);
  const oldMode = '10000000-0000-4000-8000-00000000f001';
  const currentMode = '10000000-0000-4000-8000-00000000f002';
  const positionUid = '10000000-0000-4000-8000-00000000f003';
  history = [operation('1500000001', 'INPUT', '200'),
    operation('1500000002', 'BUY', '-100', share({ instrumentUid: oldMode, positionUid, ticker: 'SYNTHMODE', quantity: '2' })),
    operation('1500000003', 'SELL', '60', share({ instrumentUid: currentMode, positionUid, ticker: 'SYNTHMODE', quantity: '1', occurredAt: '2024-03-02T07:00:00Z' }))];
  tbank.positions = [{ ...heldPosition(currentMode, '1'), positionUid }];
  tbank.cash = [['RUB', '160']];
  const modePreview = await imports.preview(owner, modeAccount);
  assert.equal(modePreview.canImport, true);
  assert.equal(modePreview.skipped.length, 0);
  // Another raw trading mode under the same position leaves economics unchanged but changes what was reviewed.
  history[1] = { ...history[1], instrumentUid: '10000000-0000-4000-8000-00000000f004' };
  await rejected(() => imports.import(owner, modeAccount, { requestId: randomUUID(), previewHash: modePreview.previewHash }), 409);
  assert.equal(await count('broker_imported_operations', `WHERE "accountId" = '${modeAccount}'`), 0);
  history[1] = { ...history[1], instrumentUid: oldMode };
  const modeRequest = { requestId: randomUUID(), previewHash: modePreview.previewHash };
  const modeReceipt = await imports.import(owner, modeAccount, modeRequest);
  assert.equal((await imports.import(owner, modeAccount, modeRequest)).value.id, modeReceipt.value.id);
  const [modeLink] = await db.query('SELECT "instrumentId" FROM broker_instrument_links WHERE "ownerId"=$1 AND "providerInstrumentId"=$2', [owner, currentMode]);
  assert.equal((await trades.available(owner, modeAccount, { instrumentId: modeLink.instrumentId, at: atEnd })).quantity, '1');
  assert.equal((await trades.available(owner, modeAccount, { instrumentId: rubCash.id, at: atEnd })).quantity, '160');
  assert.equal(await count('broker_instrument_links', `WHERE "providerInstrumentId" = '${oldMode}'`), 0);
  assert.equal(await count('broker_imported_operations', `WHERE "accountId" = '${modeAccount}'`), 3);
  console.log('PASS BROKER-POSITION-ID PostgreSQL trading-mode identity, exact cash, stale alias refusal and atomic replay');

  stage = 'BROKER-POSITION-ID: later imports reuse a linked trading mode';
  const laterModeAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, laterModeAccount);
  history = [operation('1600000001', 'INPUT', '200'),
    operation('1600000002', 'BUY', '-100', share({ instrumentUid: currentMode, positionUid, ticker: 'SYNTHMODE', quantity: '2' })),
    operation('1600000003', 'SELL', '60', share({ instrumentUid: oldMode, positionUid, ticker: 'SYNTHMODE', quantity: '1', occurredAt: '2024-03-02T07:00:00Z' }))];
  tbank.positions = [{ ...heldPosition(oldMode, '1'), positionUid }];
  const laterModePreview = await imports.preview(owner, laterModeAccount);
  assert.equal(laterModePreview.canImport, true);
  const modeInstrumentsBefore = await count('accounting_instruments');
  await imports.import(owner, laterModeAccount, { requestId: randomUUID(), previewHash: laterModePreview.previewHash });
  assert.equal((await trades.available(owner, laterModeAccount, { instrumentId: modeLink.instrumentId, at: atEnd })).quantity, '1',
    'A changed current trading mode must reuse the instrument linked by the earlier import');
  assert.equal(await count('accounting_instruments'), modeInstrumentsBefore, 'No duplicate instrument after a trading-mode change');

  const closedModeAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, closedModeAccount);
  history = history.map((row, index) => ({ ...row, id: String(1700000001 + index),
    ...(index === 2 ? { quantity: '2', payment: '120' } : {}) }));
  tbank.positions = [];
  tbank.cash = [['RUB', '220']];
  const closedModePreview = await imports.preview(owner, closedModeAccount);
  assert.equal(closedModePreview.canImport, true);
  await imports.import(owner, closedModeAccount, { requestId: randomUUID(), previewHash: closedModePreview.previewHash });
  assert.equal(await count('accounting_instruments'), modeInstrumentsBefore, 'A closed position also resolves all its original trading modes');
  assert.equal((await trades.available(owner, closedModeAccount, { instrumentId: modeLink.instrumentId, at: atEnd })).quantity, '0');
  const conflictingModeAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, conflictingModeAccount);
  history = history.map((row, index) => ({ ...row, id: String(1800000001 + index) }));
  const beforeConflict = await imports.preview(owner, conflictingModeAccount);
  assert.equal(beforeConflict.canImport, true);
  const conflictingInstrument = (await new (require('/app/backend/dist/accounting/accounting.service.js').AccountingService)(db)
    .createInstrument(owner, { requestId: randomUUID(), name: 'Synthetic conflicting mode' })).value;
  await db.query(`INSERT INTO broker_instrument_links ("ownerId", provider, "providerInstrumentId", "instrumentId")
    VALUES ($1, 'tbank', $2, $3)`, [owner, oldMode, conflictingInstrument.id]);
  const linksBeforeConflict = await count('broker_instrument_links');
  await rejected(() => imports.preview(owner, conflictingModeAccount), 409);
  await rejected(() => imports.import(owner, conflictingModeAccount, { requestId: randomUUID(), previewHash: beforeConflict.previewHash }), 409);
  assert.equal(await count('broker_instrument_links'), linksBeforeConflict, 'Conflicting saved instruments are never silently merged');
  assert.equal(await count('broker_imported_operations', `WHERE "accountId" = '${conflictingModeAccount}'`), 0);
  console.log('PASS BROKER-POSITION-ID stable linked instrument across current-mode changes, closed positions and conflict refusal');

  stage = 'BROKER-ASSET-ID: one fund on two venues in separate accounts is one instrument';
  const exchangeUid = '10000000-0000-4000-8000-00000000e001';
  const venueUid = '10000000-0000-4000-8000-00000000e002';
  const fundAsset = '10000000-0000-4000-8000-00000000e003';
  const exchangePosition = '10000000-0000-4000-8000-00000000e004';
  const venuePosition = '10000000-0000-4000-8000-00000000e005';
  const onExchange = (over) => ({ instrumentUid: exchangeUid, positionUid: exchangePosition, assetUid: fundAsset, instrumentType: 'etf', ticker: 'SYNTHFUND', ...over });
  const onVenue = (over) => ({ instrumentUid: venueUid, positionUid: venuePosition, assetUid: fundAsset, instrumentType: 'etf', ticker: 'SYNTHFUND@', ...over });
  const importAll = async (broker) => {
    const preview = await imports.preview(owner, broker);
    assert.equal(preview.canImport, true);
    await imports.import(owner, broker, { requestId: randomUUID(), previewHash: preview.previewHash });
  };
  const exchangeAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, exchangeAccount);
  history = [operation('1900000001', 'INPUT', '200'),
    operation('1900000002', 'BUY', '-100', onExchange({ quantity: '2' }))];
  tbank.positions = [{ ...heldPosition(exchangeUid, '2', 'etf'), positionUid: exchangePosition }];
  tbank.cash = [['RUB', '100']];
  await importAll(exchangeAccount);
  const [fundLink] = await db.query('SELECT "instrumentId" FROM broker_instrument_links WHERE "ownerId"=$1 AND "providerInstrumentId"=$2', [owner, exchangeUid]);
  const fundInstruments = await count('accounting_instruments');

  // Bought on the exchange, sold on T-Bank's venue: the exchange link resolves the venue UID.
  const bothVenuesAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, bothVenuesAccount);
  history = [operation('1900000011', 'INPUT', '200'),
    operation('1900000012', 'BUY', '-100', onExchange({ quantity: '2' })),
    operation('1900000013', 'SELL', '60', onVenue({ quantity: '1', occurredAt: '2024-03-02T07:00:00Z' }))];
  tbank.positions = [{ ...heldPosition(venueUid, '1', 'etf'), positionUid: venuePosition }];
  tbank.cash = [['RUB', '160']];
  const migrated = await db.query(`SELECT 1 FROM information_schema.columns
    WHERE table_name = 'broker_instrument_links' AND column_name = 'assetUid'`);
  // A link saved before asset UIDs were kept learns its asset from the next import that names it.
  if (migrated.length)
    await db.query(`UPDATE broker_instrument_links SET "assetUid" = NULL, "instrumentType" = NULL
      WHERE "ownerId" = $1 AND "providerInstrumentId" = $2`, [owner, exchangeUid]);
  await importAll(bothVenuesAccount);
  assert.equal(await count('accounting_instruments'), fundInstruments, 'The venue UID joins the exchange listing within one account');
  assert.equal((await trades.available(owner, bothVenuesAccount, { instrumentId: fundLink.instrumentId, at: atEnd })).quantity, '1');

  // Only the venue UID, in another account: the asset UID alone finds the instrument.
  const venueAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, venueAccount);
  history = [operation('1900000021', 'INPUT', '200'),
    operation('1900000022', 'BUY', '-100', onVenue({ quantity: '2' })),
    operation('1900000023', 'SELL', '60', onVenue({ quantity: '1', occurredAt: '2024-03-02T07:00:00Z' }))];
  const venuePreview = await imports.preview(owner, venueAccount);
  assert.equal(venuePreview.canImport, true);
  // The reviewed asset UID decides the instrument, so another one is a different preview.
  const otherAsset = '10000000-0000-4000-8000-00000000e006';
  history = history.map((row) => (row.assetUid ? { ...row, assetUid: otherAsset } : row));
  await rejected(() => imports.import(owner, venueAccount, { requestId: randomUUID(), previewHash: venuePreview.previewHash }), 409);
  history = history.map((row) => (row.assetUid ? { ...row, assetUid: fundAsset } : row));
  await imports.import(owner, venueAccount, { requestId: randomUUID(), previewHash: venuePreview.previewHash });
  assert.equal(await count('accounting_instruments'), fundInstruments,
    'A fund held on T-Bank\'s venue in one account and on the exchange in another is one instrument');
  assert.equal((await trades.available(owner, venueAccount, { instrumentId: fundLink.instrumentId, at: atEnd })).quantity, '1');
  assert.equal(await count('broker_instrument_links', `WHERE "providerInstrumentId" = '${venueUid}'`), 0);
  assert.deepEqual(
    await db.query(`SELECT "providerInstrumentId", "assetUid", "instrumentType" FROM broker_instrument_links
      WHERE "ownerId" = $1 AND "assetUid" = $2`, [owner, fundAsset]),
    [{ providerInstrumentId: exchangeUid, assetUid: fundAsset, instrumentType: 'etf' }],
  );

  // T-Bank naming the same asset as another security type is refused, not guessed.
  const otherTypeAccount = await account(db, owner, 'broker');
  await takeOver(db, service, owner, otherTypeAccount);
  history = history.map((row, index) => ({ ...row, id: String(1900000031 + index),
    ...(row.assetUid ? { instrumentType: 'share' } : {}) }));
  tbank.positions = [{ ...heldPosition(venueUid, '1', 'share'), positionUid: venuePosition }];
  await rejected(() => imports.preview(owner, otherTypeAccount), 409);
  assert.equal(await count('accounting_instruments'), fundInstruments);
  assert.equal(await count('broker_imported_operations', `WHERE "accountId" = '${otherTypeAccount}'`), 0);
  const unlinked = (await new (require('/app/backend/dist/accounting/accounting.service.js').AccountingService)(db)
    .createInstrument(owner, { requestId: randomUUID(), name: 'Synthetic second fund link' })).value;
  await assert.rejects(
    db.query(`INSERT INTO broker_instrument_links ("ownerId", provider, "providerInstrumentId", "instrumentId", "assetUid", "instrumentType")
      VALUES ($1, 'tbank', 'synthetic-second-link', $2, $3, 'etf')`, [owner, unlinked.id, fundAsset]),
    { code: '23505' },
    'One asset UID links one instrument',
  );
  tbank.positions = [];
  console.log('PASS BROKER-ASSET-ID one asset across venue UIDs and accounts, legacy link backfill, pinned asset and type refusal');

  stage = 'BROKER-CAPRET-VOID: one owner command removes a return without erasing its history';
  const { CapitalReturnService } = require('/app/backend/dist/accounting/capital-return.service.js');
  const capitalReturns = new CapitalReturnService(db);
  const returnId = listed[0].id.slice('capital-return:'.length);
  const command = { requestId: randomUUID(), expectedJournalRevision: 4 };
  await rejected(() => capitalReturns.void(other, ninth, returnId, command), 404);
  await rejected(() => capitalReturns.void(owner, fifth, returnId, command), 404);
  await rejected(() => capitalReturns.void(owner, ninth, returnId, { ...command, expectedJournalRevision: 3 }), 409);
  await rejected(() => capitalReturns.void(owner, ninth, returnId, { ...command, unexpected: true }), 400);
  const spent = await trades.create(owner, ninth, {
    requestId: randomUUID(), expectedJournalRevision: 4,
    instrumentId: rubCash.id, side: 'sell', purpose: 'expense',
    occurredAt: '2024-03-25T00:00:00.000Z', quantity: '10000', grossUsd: '100', feeUsd: '0',
  });
  await rejected(() => capitalReturns.void(owner, ninth, returnId, { ...command, expectedJournalRevision: 5 }), 409);
  assert.equal(await count('account_capital_return_versions', `WHERE "accountId" = '${ninth}'`), 1,
    'A dependent cash expense refuses the void and rolls back its version');
  await trades.void(owner, ninth, spent.value.trade.tradeId, {
    requestId: randomUUID(), expectedJournalRevision: 5,
  });
  const finalCommand = { ...command, expectedJournalRevision: 6 };
  const removed = await capitalReturns.void(owner, ninth, returnId, finalCommand);
  assert.equal(removed.created, true);
  assert.deepEqual([removed.value.capitalReturn.kind, removed.value.capitalReturn.version, removed.value.journalRevision], ['void', 2, 7]);
  assert.deepEqual(await capitalReturns.void(owner, ninth, returnId, finalCommand), { created: false, value: removed.value });
  await rejected(() => capitalReturns.void(owner, ninth, returnId, { ...finalCommand, expectedJournalRevision: 7 }), 409);
  await rejected(() => capitalReturns.void(owner, ninth, returnId, { requestId: randomUUID(), expectedJournalRevision: 7 }), 409);
  assert.equal(await count('account_capital_return_versions', `WHERE "accountId" = '${ninth}'`), 2);
  assert.equal((await trades.available(owner, ninth, { instrumentId: rubCash.id, at: atEnd })).quantity, '8500');
  assert.equal((await new OperationListService(db).read(owner, {})).operations.some((item) => item.id === listed[0].id), false);
  const returnVersions = (await new AuditHistoryService(db).read(owner, { entity: 'capital-return' })).events
    .filter((item) => item.entityId === returnId).sort((a, b) => a.version - b.version);
  assert.deepEqual(returnVersions.map((item) => [item.version, item.actor]), [[1, 'broker'], [2, 'owner']],
    'The broker created the return, but the owner deleted it');
  assert.ok((await operationsCsv(db, owner)).includes(`${listed[0].id},capital-return,capital-return,in,voided,broker,`));
  console.log('PASS BROKER-CAPRET-VOID');
}

const fundUid = '10000000-0000-4000-8000-0000000000c7';
const bondUid = '10000000-0000-4000-8000-0000000000c9';
// BPH: T-Bank's market data stubbed at the HTTP boundary, in the recorded GetCandles and BondBy
// shapes with synthetic prices. Day candles are stamped midnight UTC; today's is not complete.
// The fund's candles are in today's units: it split 1:2 on 2026-01-15.
function candleServer() {
  const day = (date, units, nano, isComplete = true) => ({
    open: { units, nano }, high: { units, nano }, low: { units, nano }, close: { units, nano },
    volume: '10', time: `${date}T00:00:00Z`, ...(isComplete ? { isComplete } : {}),
    candleSource: 'CANDLE_SOURCE_EXCHANGE', volumeBuy: '5', volumeSell: '5',
  });
  const candles = {
    [fundUid]: {
      priceCurrency: 'rub',
      2025: [day('2025-03-03', '700', 250000000)],
      2026: [day('2026-10-23', '1490', 0), day('2026-10-24', '1495', 0, false)],
    },
    [bondUid]: { priceCurrency: 'pt.', 2025: [day('2025-03-03', '98', 765000000)], 2026: [] },
  };
  const requests = [];
  const state = { failing: false };
  const server = require('node:http').createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const asked = JSON.parse(body);
      requests.push({ method: request.url.split('.').pop(), body: asked, authorized: request.headers.authorization === `Bearer ${token}` });
      let answer;
      if (state.failing) answer = undefined;
      else if (request.url.endsWith('MarketDataService/GetCandles')) {
        const series = candles[asked.instrumentId] ?? { priceCurrency: 'rub' };
        answer = { candles: series[asked.from.slice(0, 4)] ?? [], priceCurrency: series.priceCurrency };
      } else if (request.url.endsWith('InstrumentsService/BondBy')) {
        const nominal = { currency: 'rub', units: '1000', nano: 0 };
        answer = { instrument: { uid: asked.id, nominal, initialNominal: nominal } };
      }
      response.writeHead(answer ? 200 : 404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(answer ?? {}));
    });
  });
  return { server, requests, state };
}

async function refreshing(db, service, tbank, owner) {
  stage = 'BPR-REFRESH: the hourly refresh keeps T-Bank prices current and names a fallback asset';
  const { BrokerPriceSyncService } = require('/app/backend/dist/brokers/broker-price-sync.service.js');
  const { TBankClient } = require('/app/backend/dist/brokers/tbank-client.js');
  const { server, requests, state } = candleServer();
  server.listen(0, '127.0.0.1');
  await require('node:events').once(server, 'listening');
  const market = new TBankClient({ baseUrl: `http://127.0.0.1:${server.address().port}/rest` });
  try {
  const broker = await account(db, owner, 'broker');
  await takeOver(db, service, owner, broker);
  // Only this connection is read: every other one is closed first.
  for (const { accountId } of await db.query(
    `SELECT "accountId" FROM broker_connections WHERE "ownerId" = $1 AND "accountId" <> $2`,
    [owner, broker],
  ))
    await service.disconnect(owner, accountId);
  // An asset made before its ticker could be read (#347): named by its UID, no ticker.
  const [fund] = await db.query(
    `INSERT INTO accounting_instruments (id, "ownerId", "requestId", "canonicalPayload", name, symbol,
        "assetType", "valuationCurrency", "priceSource")
      VALUES ($1, $2, $3, 'synthetic', $4, NULL, 'manual', 'RUB', 'manual') RETURNING id`,
    [randomUUID(), owner, randomUUID(), `T-Bank ${fundUid}`],
  );
  await db.query(
    `INSERT INTO broker_instrument_links ("ownerId", provider, "providerInstrumentId", "instrumentId", "instrumentType")
      VALUES ($1, 'tbank', $2, $3, 'etf')`,
    [owner, fundUid, fund.id],
  );
  const [bond] = await db.query(
    `INSERT INTO accounting_instruments (id, "ownerId", "requestId", "canonicalPayload", name, symbol,
        "assetType", "valuationCurrency", "priceSource")
      VALUES ($1, $2, $3, 'synthetic', 'SYNTHB', 'SYNTHB', 'manual', 'RUB', 'manual') RETURNING id`,
    [randomUUID(), owner, randomUUID()],
  );
  await db.query(
    `INSERT INTO broker_instrument_links ("ownerId", provider, "providerInstrumentId", "instrumentId", "instrumentType")
      VALUES ($1, 'tbank', $2, $3, 'bond')`,
    [owner, bondUid, bond.id],
  );
  await db.query(
    `INSERT INTO instrument_splits (id, "ownerId", "instrumentId", "effectiveAt", ratio, "requestId", "canonicalPayload")
      VALUES ($1, $2, $3, '2026-01-15T00:00:00+03:00', 2, $4, 'synthetic')`,
    [randomUUID(), owner, fund.id, randomUUID()],
  );
  history = [
    operation('400000001', 'INPUT', '5000'),
    operation('400000002', 'BUY', '-3000', {
      instrumentUid: fundUid, instrumentType: 'etf', ticker: 'SYNTHF', quantity: '2',
      fills: [{ filledAt: '2024-03-01T08:00:00Z', quantity: '2', price: '1500', priceCurrency: 'rub' }],
    }),
  ];
  tbank.positions = [{ ...heldPosition(fundUid, '2', 'etf'), currentPrice: '1500.25' }, { ...heldPosition('10000000-0000-4000-8000-0000000000c8', '1'), currentPrice: '99' }];
  tbank.cash = [['RUB', '2000']];
  const config = (enabled) => new (require('@nestjs/config').ConfigService)({ PRICE_COLLECTION_ENABLED: enabled });
  const prices = async (instrument = fund.id) =>
    (await db.query(
      `SELECT "instrumentId", price::text AS price, "quoteCurrency", "observedAt" FROM broker_price_observations
        WHERE "ownerId" = $1 AND "instrumentId" = $2 ORDER BY "observedAt"`,
      [owner, instrument],
    )).map((row) => [row.price.replace(/\.?0+$/, ''), row.quoteCurrency, row.observedAt.toISOString()]);
  const source = async () =>
    (await db.query(`SELECT state, "errorCode", "errorMessage" FROM sync_sources WHERE key = 'prices:tbank'`))[0];
  const off = new BrokerPriceSyncService(db, config('false'), service, market);
  assert.deepEqual(await off.tick(new Date('2026-10-24T10:10:00Z')), { outcome: 'disabled' });
  assert.deepEqual(await prices(), [], 'Switched off, nothing is read or saved');
  const sync = new BrokerPriceSyncService(db, config('true'), service, market);
  assert.deepEqual(await sync.tick(new Date('2026-10-24T10:02:00Z')), { outcome: 'not_due' }, 'Not before five past the hour');
  const first = new Date('2026-10-24T10:10:00Z');
  assert.deepEqual(await sync.tick(first), { outcome: 'ran', accounts: 1, failed: 0, saved: 1, closes: 3 });
  // BPH-BACKFILL: the first run of a Moscow day also stores each complete day's close since
  // 2025, at the end of its Moscow day; today's unfinished candle is left out. A close is stored
  // as T-Bank gives it, in the units of the day it was read (BPH-SPLIT, valued below).
  assert.deepEqual(await prices(), [
    ['700.25', 'RUB', '2025-03-03T20:59:59.999Z'],
    ['1490', 'RUB', '2026-10-23T20:59:59.999Z'],
    ['1500.25', 'RUB', first.toISOString()],
  ]);
  // BPH-BOND: a bond's close in percent is money at its unchanging nominal.
  assert.deepEqual(await prices(bond.id), [['987.65', 'RUB', '2025-03-03T20:59:59.999Z']]);
  const candleAsks = requests.filter((item) => item.method === 'MarketDataService/GetCandles' && item.body.instrumentId === fundUid);
  assert.deepEqual(candleAsks.map((item) => [item.body.from, item.body.to, item.body.interval, item.authorized]), [
    ['2025-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z', 'CANDLE_INTERVAL_DAY', true],
    ['2026-01-01T00:00:00Z', first.toISOString(), 'CANDLE_INTERVAL_DAY', true],
  ]);
  assert.deepEqual(await source(), { state: 'synced', errorCode: null, errorMessage: null });
  // BPR-RENAME: the asset made without a ticker takes the one its operations name.
  const [renamed] = await db.query('SELECT name, symbol FROM accounting_instruments WHERE id = $1', [fund.id]);
  assert.deepEqual([renamed.name, renamed.symbol], ['SYNTHF', 'SYNTHF']);
  assert.deepEqual(await sync.tick(new Date('2026-10-24T10:40:00Z')), { outcome: 'not_due' }, 'Once an hour');
  const asked = requests.length;
  // A price T-Bank reports no more stays; a failed read records why, without the token.
  tbank.down = true;
  const failedAt = new Date('2026-10-24T11:10:00Z');
  try {
    assert.deepEqual(await sync.tick(failedAt), { outcome: 'ran', accounts: 1, failed: 1, saved: 0, closes: 0 });
  } finally {
    tbank.down = false;
  }
  const failure = await source();
  assert.equal(failure.state, 'failed');
  assert.equal(failure.errorCode, 'unavailable');
  assert.ok(!failure.errorMessage.includes(token.slice(2)), 'No secret in the status');
  // The owner sees this refresh apart from the crypto prices, with why it failed.
  const { SyncStatusService } = require('/app/backend/dist/sync-status/sync-status.service.js');
  const shownSources = async (at) => (await new SyncStatusService(db).read(owner, at)).sources;
  const shownFailure = (await shownSources(failedAt)).find((item) => item.key === 'prices:tbank');
  assert.deepEqual(
    [shownFailure.kind, shownFailure.name, shownFailure.state, shownFailure.errorMessage],
    ['prices', 'T-Bank prices', 'failed', failure.errorMessage],
  );
  assert.equal((await shownSources(failedAt)).some((item) => item.key === 'prices'), false, 'No crypto price source was read');
  assert.deepEqual((await prices()).map((row) => row[0]), ['700.25', '1490', '1500.25'], 'A failed read keeps every stored price');
  tbank.positions = [{ ...heldPosition(fundUid, '2', 'etf'), currentPrice: '1510' }];
  const next = new Date('2026-10-24T12:10:00Z');
  assert.deepEqual(await sync.tick(next), { outcome: 'ran', accounts: 1, failed: 0, saved: 1, closes: 0 });
  assert.deepEqual((await prices()).map((row) => row[0]), ['700.25', '1490', '1500.25', '1510']);
  assert.equal(requests.length, asked, 'Past prices are read once a Moscow day');
  assert.equal((await shownSources(next)).find((item) => item.key === 'prices:tbank').state, 'synced');
  await assert.rejects(
    db.query('UPDATE broker_price_observations SET price = 1 WHERE "instrumentId" = $1', [fund.id]),
    /append-only/,
  );
  // BPR-STALE: three hours later the price still values the fund, marked stale.
  const { PortfolioValuationService } = require('/app/backend/dist/accounting/portfolio-valuation.service.js');
  const later = new Date('2026-10-24T15:10:00Z');
  const fundValue = (await new PortfolioValuationService(db).read(owner, { currency: 'RUB' }, later)).assets.find(
    (asset) => asset.instrumentId === fund.id,
  );
  assert.deepEqual(
    [fundValue.name, fundValue.price.value, fundValue.price.source, fundValue.price.status, fundValue.price.observedAt],
    ['SYNTHF', '1510', 'tbank', 'stale', next.toISOString()],
  );
  // BPH-HISTORY, BPH-SPLIT: a past day is valued at the close before it, in that day's units
  // (the split since is undone, then applied again after it); a day before the first close has
  // no price, never zero.
  const valued = async (at) =>
    (await new PortfolioValuationService(db).read(owner, { currency: 'RUB' }, new Date(at))).assets.find(
      (asset) => asset.instrumentId === fund.id,
    ).price;
  assert.deepEqual([(await valued('2025-03-04T10:00:00Z')).value, (await valued('2025-03-04T10:00:00Z')).observedAt],
    ['1400.5', '2025-03-03T20:59:59.999Z']);
  assert.equal((await valued('2026-02-01T10:00:00Z')).value, '700.25');
  assert.equal(await valued('2025-03-03T12:00:00Z'), null);
  // BPH-SPLIT: a split the owner withdraws is in neither the close nor the valuation.
  await db.query(`UPDATE instrument_splits SET "removedAt" = clock_timestamp() WHERE "instrumentId" = $1`, [fund.id]);
  assert.deepEqual([(await valued('2025-03-04T10:00:00Z')).value, (await valued('2026-02-01T10:00:00Z')).value], ['700.25', '700.25']);
  // BPH-RETRY: a failed read of past prices is shown apart from the T-Bank prices and read again
  // the next Moscow day, not every hour; closes already stored stay.
  state.failing = true;
  const nextDay = new Date('2026-10-24T21:10:00Z');
  assert.deepEqual(await sync.tick(nextDay), { outcome: 'ran', accounts: 1, failed: 0, saved: 1, closes: 0 });
  const past = async () =>
    (await db.query(`SELECT state, "errorCode", "errorMessage" FROM sync_sources WHERE key = 'prices:tbank-history'`))[0];
  const pastFailure = await past();
  assert.equal(pastFailure.state, 'failed');
  assert.equal(pastFailure.errorCode, 'unavailable');
  // Every linked security is still tried after one fails.
  assert.match(pastFailure.errorMessage, /^\d+ reads of past T-Bank prices failed: T-Bank could not be reached/);
  assert.ok(Number(pastFailure.errorMessage.split(' ')[0]) > 1, 'Every linked security was tried');
  assert.ok(!pastFailure.errorMessage.includes(token.slice(2)), 'No secret in the status');
  assert.equal((await source()).state, 'synced', 'The current prices were read');
  const shownPast = (await shownSources(nextDay)).find((item) => item.key === 'prices:tbank-history');
  assert.deepEqual([shownPast.name, shownPast.state, shownPast.errorMessage], ['T-Bank past prices', 'failed', pastFailure.errorMessage]);
  state.failing = false;
  const retried = requests.length;
  assert.deepEqual(await sync.tick(new Date('2026-10-24T22:10:00Z')), { outcome: 'ran', accounts: 1, failed: 0, saved: 1, closes: 0 });
  assert.equal(requests.length, retried, 'Not again the same Moscow day');
  assert.equal((await past()).state, 'failed');
  assert.deepEqual(await sync.tick(new Date('2026-10-25T21:10:00Z')), { outcome: 'ran', accounts: 1, failed: 0, saved: 1, closes: 0 });
  assert.ok(requests.length > retried, 'Read again the next Moscow day');
  assert.equal((await past()).state, 'synced');
  assert.deepEqual((await prices()).filter((row) => row[2].endsWith('20:59:59.999Z')).map((row) => row[0]), ['700.25', '1490']);
  console.log('PASS BPR-REFRESH');
  console.log('PASS BPR-RENAME');
  console.log('PASS BPR-STALE');
  console.log('PASS BPH-BACKFILL');
  console.log('PASS BPH-SPLIT');
  console.log('PASS BPH-BOND');
  console.log('PASS BPH-HISTORY');
  console.log('PASS BPH-RETRY');
  } finally {
    server.close();
  }
}
async function main() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact isolated settings required');
  assert.ok(
    require('node:fs').existsSync(servicePath),
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
  assert.match(migrated.stdout, new RegExp(`Migrations applied: ${MIGRATIONS}`));
  const directory = mkdtempSync(join(tmpdir(), 'capital-broker-connections-'));
  const db = source();
  try {
    writeFileSync(join(directory, 'key'), randomBytes(32), { mode: 0o600 });
    await db.initialize();
    const [owner, other] = await db.query(`INSERT INTO users(email,password) VALUES
      ('broker-owner@example.invalid','synthetic-not-a-hash'),
      ('broker-other@example.invalid','synthetic-not-a-hash') RETURNING id`);
    const { BrokerConnectionsService } = require(servicePath);
    const { TBankTokenBox } = require('/app/backend/dist/brokers/tbank-token-box.js');
    const box = new TBankTokenBox(
      new ConfigService({ MFA_KEY_FILE: join(directory, 'key'), MFA_KEY_ID: 'probe-key' }),
    );
    const tbank = {
      listed: [brokerAccount],
      down: false,
      accounts: async () =>
        tbank.down ? { ok: false, reason: 'unavailable' } : { ok: true, value: tbank.listed },
      operations: async () => ({ ok: true, value: history }),
      positions: [],
      cash: [],
      currencyCodes: {},
      currencyCode: async (_token, uid) => { const code = uid.startsWith('cash-') ? uid.slice(5) : tbank.currencyCodes[uid]; return code ? { ok: true, value: code } : { ok: false, reason: 'unavailable' }; },
      portfolio: async () => ({ ok: true, value: [...tbank.positions, ...tbank.cash.map(([code, quantity]) => heldPosition(`cash-${code}`, quantity, 'currency'))] }),
    };
    const service = new BrokerConnectionsService(db, tbank, box);
    await connection(db, service, owner.id, other.id);
    await removal(db, service, owner.id);
    const { BrokerSetupService } = require('/app/backend/dist/brokers/broker-setup.service.js');
    await setup(db, service, new BrokerSetupService(db, service, box), tbank, owner.id, other.id);
    const { BrokerImportService } = require('/app/backend/dist/brokers/broker-import.service.js');
    const imports = new BrokerImportService(db, service, new (require('/app/backend/dist/accounting/accounting.service.js').AccountingService)(db), new (require('/app/backend/dist/accounting/carry-in.service.js').CarryInService)(db));
    const instrument = await heldPreview(db, service, imports, owner.id);
    await voidedTransferPreview(db, service, imports, owner.id, instrument);
    await rewardRoomPreview(db, service, imports, owner.id, instrument);
    await importing(db, service, imports, tbank, owner.id, other.id);
    await refreshing(db, service, tbank, owner.id);
  } finally {
    if (db.isInitialized) await db.destroy();
    rmSync(directory, { recursive: true, force: true });
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
