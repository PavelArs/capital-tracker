'use strict';
// export-owner-data (M19) against fresh synthetic PostgreSQL: production compiled services
// write every journal kind and a classified chain history, and the actual export service
// reads them into the CSV archive (EXP-CSV) and the JSON backup (EXP-JSON). All data is
// synthetic.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
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
const database = 'capital_tracker_owner_export_e2e';
const coverageFrom = '2025-01-01T00:00:00.000Z';
const modulePath = '/app/backend/dist/owner-export/owner-export.service.js';
const now = new Date('2026-10-08T10:15:30.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const txid = (n) => sha256(`ct-owner-export:${n}`);
const walletAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const secret = (name) => sha256(`ct-owner-export-secret:${name}`);
const csvUpload = 'instrument,side,time,order,quantity,gross,fee\nBTC,buy,2025-06-14T10:30:00Z,0,0.01,1050.5,1.25\n';
let stage = 'synthetic configuration';

function source() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: database }),
  ).createTypeOrmOptions();
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource({ ...options, extra: { ...options.extra, max: 1 } });
}
function services(db) {
  const make = (file, name, ...rest) =>
    new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db, ...rest);
  const trades = make('trade.service', 'TradeService');
  const rewards = make('asset-reward.service', 'AssetRewardService');
  const transfers = make('owned-transfer.service', 'OwnedTransferService');
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trades,
    rewards,
    transfers,
    csv: make('csv-import.service', 'CsvImportService'),
    swaps: make('asset-swap.service', 'AssetSwapService'),
    carry: make('carry-in.service', 'CarryInService'),
    flows: make('portfolio-flow.service', 'PortfolioFlowService'),
    classifications: make(
      'chain-classification.service',
      'ChainClassificationService',
      trades,
      rewards,
      transfers,
    ),
    exports: new (require(modulePath).OwnerExportService)(db),
  };
}
async function fingerprint(db) {
  const tables = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const rows = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    rows.push([
      tablename,
      await db.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY row`),
    ]);
  }
  return sha256(JSON.stringify(rows));
}
const rejected = (action, status) =>
  assert.rejects(
    async () => action(),
    (error) => error.getStatus?.() === status,
  );

/** Every file of a ZIP archive by name, read through its central directory. */
function unzip(archive) {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50, 'End of central directory');
  const files = new Map();
  let at = archive.readUInt32LE(end + 16);
  for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
    assert.equal(archive.readUInt32LE(at), 0x02014b50);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    files.set(name, inflateRawSync(archive.subarray(start, start + size)).toString('utf8'));
    at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
  }
  return files;
}
/** RFC 4180 records as objects keyed by the header. */
function parseCsv(text) {
  assert.ok(text.startsWith('﻿'), 'UTF-8 byte order mark');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i++;
    } else field += c;
  }
  assert.equal(record.length + field.length, 0, 'Every record ends with CRLF');
  const [header, ...rows] = records;
  for (const row of rows) assert.equal(row.length, header.length);
  return rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i]])));
}

async function instrument(s, owner, body) {
  return (await s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body })).value
    .id;
}
async function account(s, owner, name) {
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name })).value.id;
  await s.trades.initialize(owner, id, {
    requestId: randomUUID(),
    coverageFrom,
    assertEmpty: true,
  });
  return id;
}
const revision = async (s, owner, id) =>
  (await s.trades.getJournal(owner, id)).journal.journalRevision;
async function trade(s, owner, accountId, instrumentId, side, occurredAt, quantity, amounts) {
  const saved = await s.trades.create(owner, accountId, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, accountId),
    instrumentId,
    side,
    occurredAt,
    orderWithinTimestamp: 0,
    quantity,
    ...amounts,
  });
  return saved.value.trade.tradeId;
}
async function csvBuy(s, owner, accountId, instrumentId) {
  const batch = (
    await s.csv.upload(owner, accountId, {
      filename: 'synthetic-buys.csv',
      bytes: Buffer.from(csvUpload),
    })
  ).value;
  const settingsInput = {
    format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: {
      columns: {
        instrument: 0,
        side: 1,
        occurredAt: 2,
        order: 3,
        quantity: 4,
        grossUsd: 5,
        feeUsd: 6,
      },
      instruments: [{ source: 'BTC', instrumentId }],
      sides: [{ source: 'buy', side: 'buy' }],
    },
    assertUsd: true,
  };
  const preview = await s.csv.preview(owner, accountId, batch.batchId, settingsInput);
  assert.equal(preview.canConfirm, true);
  await s.csv.confirm(owner, accountId, batch.batchId, {
    requestId: randomUUID(),
    expectedJournalRevision: preview.journalRevision,
    parserVersion: 'usd-csv-v1',
    ...settingsInput,
    previewHash: preview.previewHash,
  });
}
async function chainHistory(db, owner, accountId) {
  const [{ id }] = await db.query(
    `INSERT INTO wallet_addresses(id,"ownerId",network,address,"accountId",label)
      VALUES ($1,$2,'bitcoin',$3,$4,'Savings') RETURNING id`,
    [randomUUID(), owner, walletAddress, accountId],
  );
  const raw = (n, direction, received, sent, fee, blockTime) =>
    db.query(
      `INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockHash",
        "blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        owner,
        id,
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
  await raw(1, 'in', '918359', '0', '500', '2025-06-20T08:00:00.000Z');
  await raw(2, 'in', '546', '0', '200', '2025-06-21T08:00:00.000Z');
  await raw(3, 'out', '1000', '51000', '300', '2025-06-22T08:00:00.000Z');
  return id;
}
// Sign-in secrets of the owner, each a distinct marker the backup must never contain.
async function secrets(db, owner) {
  await db.query(`UPDATE users SET password=$2 WHERE id=$1`, [owner, secret('password')]);
  await db.query(
    `INSERT INTO owner_auth(id,"userId","credentialVersion") VALUES (1,$1,$2)`,
    [owner, randomUUID()],
  );
  await db.query(
    `INSERT INTO owner_mfa(id,"userId","activeVersion","activeEnvelope","lastCounter")
      VALUES (1,$1,$2,$3,1)`,
    [owner, randomUUID(), JSON.stringify({ ciphertext: secret('totp') })],
  );
  await db.query(
    `INSERT INTO owner_mfa_recovery("codeHash","userId","enrollmentVersion") VALUES ($1,$2,$3)`,
    [secret('recovery'), owner, randomUUID()],
  );
  await db.query(
    `INSERT INTO auth_sessions("tokenHash","csrfToken",state,"userId","credentialVersion",
      "createdAt","lastSeenAt","expiresAt","mfaVerifiedAt")
      VALUES ($1,$2,'authenticated',$3,$4,now(),now(),now()+interval '1 day',now())`,
    [secret('session'), secret('csrf').slice(0, 43), owner, randomUUID()],
  );
  await db.query(
    `INSERT INTO password_reset_tokens("userId","tokenHash","createdAt","expiresAt")
      VALUES ($1,$2,now(),now()+interval '30 minutes')`,
    [owner, secret('reset')],
  );
  return ['password', 'totp', 'recovery', 'session', 'reset']
    .map(secret)
    .concat(secret('csrf').slice(0, 43));
}

/** Rows of the screens retired in M20, written as their legacy modules stored them. */
async function legacyRows(db, owner, other) {
  const currency = async (code) =>
    (await db.query('SELECT id FROM currencies WHERE code=$1', [code]))[0].id;
  const [usd, eur, rub, btc] = [
    await currency('USD'),
    await currency('EUR'),
    await currency('RUB'),
    await currency('BTC'),
  ];
  const [capital] = await db.query(
    `INSERT INTO capitals("userId",name,description) VALUES ($1,'Family','Synthetic') RETURNING id`,
    [owner],
  );
  await db.query(
    `INSERT INTO assets("userId",name,"assetType",category,amount,date,"currencyId")
      VALUES ($1,'Flat','stock','real_estate',1234.56789012,'2025-03-01',$2),
        ($3,'Foreign flat','stock','real_estate',5,'2025-03-01',$4)`,
    [owner, usd, other, btc],
  );
  await db.query(
    `INSERT INTO liabilities("userId",name,category,amount,date,frequency,"currencyId")
      VALUES ($1,'Loan','loans',100.5,'2025-04-01','monthly',$2)`,
    [owner, eur],
  );
  await db.query(
    `INSERT INTO crypto_wallets("userId",type,address,balance,tokens)
      VALUES ($1,'bitcoin',$2,0.5,'[{"symbol":"BTC"}]')`,
    [owner, walletAddress],
  );
  await db.query(
    `INSERT INTO reports("userId","capitalId",type,name,format,parameters)
      VALUES ($1,$2,'custom','Yearly','json','{"year":2025}')`,
    [owner, capital.id],
  );
  await db.query(`INSERT INTO subscriptions("userId",type,status) VALUES ($1,'free','active')`, [
    owner,
  ]);
  await db.query(
    `INSERT INTO user_currency_preferences("userId","currencyId","isHidden") VALUES ($1,$2,true)`,
    [owner, rub],
  );
}

async function seed(db, s, f) {
  stage = 'synthetic journals of every kind, a classified chain history and sign-in secrets';
  const { owner, other } = f;
  const btc = await instrument(s, owner, { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const usdt = await instrument(s, owner, { name: 'Tether', symbol: 'USDT', assetType: 'crypto' });
  const bybit = await account(s, owner, 'Bybit');
  const cold = await account(s, owner, 'Холодный, кошелёк');
  const paid = await trade(s, owner, bybit, btc, 'buy', '2025-06-13T00:00:00.000Z', '0.00918359', {
    paid: { currency: 'RUB', gross: '84040', fee: '100', perUsd: '80' },
    comment: '=1+1 "note"',
  });
  await csvBuy(s, owner, bybit, btc);
  const voided = await trade(s, owner, bybit, btc, 'buy', '2025-06-15T00:00:00.000Z', '0.5', {
    grossUsd: '40000',
    feeUsd: '0',
  });
  await s.trades.void(owner, bybit, voided, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, bybit),
  });
  await trade(s, owner, bybit, usdt, 'buy', '2025-06-16T00:00:00.000Z', '1000', {
    grossUsd: '1000',
    feeUsd: '0',
  });
  await s.swaps.create(owner, bybit, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, bybit),
    assertExecuted: true,
    outgoingInstrumentId: usdt,
    incomingInstrumentId: btc,
    occurredAt: '2025-06-17T00:00:00.000Z',
    orderWithinTimestamp: 0,
    outgoingQuantity: '500',
    incomingQuantity: '0.005',
    considerationUsd: '500',
    feeSource: null,
    feeInstrumentId: null,
    feeQuantity: '0',
  });
  await s.transfers.create(owner, {
    requestId: randomUUID(),
    fromAccountId: bybit,
    toAccountId: cold,
    expectedFromJournalRevision: await revision(s, owner, bybit),
    expectedToJournalRevision: await revision(s, owner, cold),
    assertInternal: true,
    instrumentId: btc,
    occurredAt: '2025-06-18T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '0.005',
    feeInstrumentId: btc,
    feeQuantity: '0.0001',
  });
  await s.rewards.create(owner, cold, {
    requestId: randomUUID(),
    expectedJournalRevision: await revision(s, owner, cold),
    assertReward: true,
    instrumentId: btc,
    category: 'staking',
    occurredAt: '2025-06-19T00:00:00.000Z',
    orderWithinTimestamp: 0,
    quantity: '0.0002',
    acquisitionBasisUsd: null,
    incomeValueUsd: '20',
  });
  const trust = (
    await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Trust Wallet' })
  ).value.id;
  await s.accounting.saveOpening(owner, trust, {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: coverageFrom,
    positions: [{ instrumentId: btc, quantity: '0.3', costStatus: 'known', totalCostUsd: '15000' }],
  });
  await s.carry.initialize(owner, trust, {
    requestId: randomUUID(),
    expectedOpeningRevision: 1,
    assertReviewed: true,
    lots: [
      {
        instrumentId: btc,
        acquiredAt: '2024-12-01T00:00:00.000Z',
        orderWithinTimestamp: 0,
        originalQuantity: '0.4',
        originalCostUsd: '20000',
        remainingQuantity: '0.3',
      },
    ],
  });
  await s.flows.initialize(owner, { requestId: randomUUID(), coverageFrom, assertReviewed: true });
  const flow = {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    direction: 'contribution',
    occurredAt: '2025-06-12T00:00:00.000Z',
    amountUsd: '2000',
    assertExternal: true,
  };
  await s.flows.create(owner, flow);
  const withdrawal = await s.flows.create(owner, {
    ...flow,
    requestId: randomUUID(),
    expectedJournalRevision: 1,
    direction: 'withdrawal',
    occurredAt: '2025-06-12T12:00:00.000Z',
    amountUsd: '5',
  });
  await s.flows.void(owner, withdrawal.value.flow.flowId, {
    requestId: randomUUID(),
    expectedJournalRevision: 2,
  });
  // The ledger account a Bitcoin address belongs to: a buy classified, a receipt hidden.
  const ledger = await account(s, owner, 'Ledger');
  const wallet = await chainHistory(db, owner, ledger);
  const bought = await s.classifications.classify(owner, wallet, txid(1), {
    requestId: randomUUID(),
    expectedVersion: 0,
    hidden: false,
    classification: { type: 'buy', currency: 'USDT', amount: '1000' },
    comment: 'From the exchange',
  });
  await s.classifications.classify(owner, wallet, txid(2), {
    requestId: randomUUID(),
    expectedVersion: 0,
    hidden: true,
    classification: null,
  });
  await db.query(`INSERT INTO owner_settings("ownerId","mainCurrency") VALUES ($1,'EUR')`, [
    owner,
  ]);
  // Another owner's records never mix in.
  const foreignBtc = await instrument(s, other, {
    name: 'Foreign bitcoin',
    symbol: 'BTC',
    assetType: 'crypto',
  });
  const foreign = await account(s, other, 'Foreign');
  await trade(s, other, foreign, foreignBtc, 'buy', '2025-06-13T00:00:00.000Z', '5', {
    grossUsd: '1',
    feeUsd: '0',
  });
  await legacyRows(db, owner, other);
  return {
    btc,
    usdt,
    bybit,
    cold,
    trust,
    ledger,
    wallet,
    paid,
    voided,
    chainTrade: bought.value.operation.id,
    secrets: await secrets(db, owner),
  };
}

async function csvArchive(db, s, f, made) {
  stage = 'EXP-CSV one archive with one CSV per entity, every active and voided operation';
  const before = await fingerprint(db);
  const download = await s.exports.archive(f.owner, now);
  assert.equal(download.filename, 'capital-tracker-export-2026-10-08.zip');
  assert.equal(download.contentType, 'application/zip');
  const files = unzip(download.data);
  assert.deepEqual(
    [...files.keys()],
    ['assets.csv', 'accounts.csv', 'wallets.csv', 'operations.csv', 'chain-transactions.csv'],
  );
  const table = (name) => parseCsv(files.get(name));

  const assets = table('assets.csv');
  assert.deepEqual(
    assets.map((row) => [row.id, row.name, row.symbol, row.type]),
    [
      [made.btc, 'Bitcoin', 'BTC', 'crypto'],
      [made.usdt, 'Tether', 'USDT', 'crypto'],
    ],
  );
  assert.deepEqual(
    table('accounts.csv').map((row) => row.name),
    ['Bybit', 'Холодный, кошелёк', 'Trust Wallet', 'Ledger'],
  );
  assert.deepEqual(table('wallets.csv'), [
    {
      id: made.wallet,
      network: 'bitcoin',
      address: walletAddress,
      label: 'Savings',
      account_id: made.ledger,
      account: 'Ledger',
      created_at: table('wallets.csv')[0].created_at,
    },
  ]);

  const operations = table('operations.csv');
  assert.deepEqual(
    operations.map((row) => [
      row.type,
      row.status,
      row.source,
      row.account,
      row.asset,
      row.quantity,
      row.value_usd,
    ]),
    [
      ['opening-balance', 'active', 'manual', 'Trust Wallet', 'BTC', '0.3', ''],
      ['deposit', 'active', 'manual', '', 'USD', '2000', '2000'],
      ['withdrawal', 'voided', 'manual', '', 'USD', '5', '5'],
      ['buy', 'active', 'manual', 'Bybit', 'BTC', '0.00918359', '1050.5'],
      ['buy', 'active', 'csv', 'Bybit', 'BTC', '0.01', '1050.5'],
      ['buy', 'voided', 'manual', 'Bybit', 'BTC', '0.5', '40000'],
      ['buy', 'active', 'manual', 'Bybit', 'USDT', '1000', '1000'],
      ['swap', 'active', 'manual', 'Bybit', 'USDT', '500', '500'],
      ['transfer', 'active', 'manual', 'Bybit', 'BTC', '0.005', ''],
      ['staking-reward', 'active', 'manual', 'Холодный, кошелёк', 'BTC', '0.0002', '20'],
      ['buy', 'active', 'chain', 'Ledger', 'BTC', '0.00918359', '1000'],
    ],
  );
  const byId = new Map(operations.map((row) => [row.id, row]));
  const paid = byId.get(`trade:${made.paid}`);
  assert.deepEqual(
    [paid.paid_currency, paid.paid_amount, paid.paid_fee, paid.paid_per_usd, paid.fee_usd],
    ['RUB', '84040', '100', '80', '1.25'],
  );
  assert.equal(paid.comment, `'=1+1 "note"`, 'A formula-like comment stays plain text');
  assert.equal(byId.get(`trade:${made.voided}`).version, '1', 'Voided: its last content');
  assert.equal(operations[0].cost_basis_usd, '15000');
  const swap = operations.find((row) => row.kind === 'swap');
  assert.deepEqual([swap.counter_asset, swap.counter_quantity], ['BTC', '0.005']);
  const transfer = operations.find((row) => row.kind === 'transfer');
  assert.deepEqual(
    [transfer.to_account_id, transfer.to_account, transfer.fee_asset, transfer.fee_quantity],
    [made.cold, 'Холодный, кошелёк', 'BTC', '0.0001'],
  );
  const fromChain = byId.get(`trade:${made.chainTrade}`);
  assert.equal(fromChain.chain_txid, txid(1));
  // The Ledger account held no USDT, so none of its own cash settled the buy.
  assert.deepEqual([fromChain.settlement_asset, fromChain.settlement_quantity], ['USDT', '0']);
  assert.ok(operations.every((row) => !row.account.startsWith('Foreign')), 'No foreign rows');

  assert.deepEqual(
    table('chain-transactions.csv').map((row) => [
      row.txid,
      row.direction,
      row.received,
      row.sent,
      row.fee,
      row.classification_status,
      row.classification_type,
      row.comment,
      row.operation_id,
    ]),
    [
      [
        txid(1),
        'in',
        '0.00918359',
        '0.00000000',
        '0.00000500',
        'classified',
        'buy',
        'From the exchange',
        `trade:${made.chainTrade}`,
      ],
      [txid(2), 'in', '0.00000546', '0.00000000', '0.00000200', 'hidden', '', '', ''],
      [txid(3), 'out', '0.00001000', '0.00051000', '0.00000300', 'unclassified', '', '', ''],
    ],
  );
  assert.equal(await fingerprint(db), before, 'Export changes no row');

  const foreign = unzip((await s.exports.archive(f.other, now)).data);
  assert.deepEqual(
    parseCsv(foreign.get('operations.csv')).map((row) => [row.type, row.asset, row.account]),
    [['buy', 'BTC', 'Foreign']],
  );
  assert.deepEqual(parseCsv(foreign.get('wallets.csv')), []);
  const empty = unzip((await s.exports.archive(f.third, now)).data);
  for (const [name, text] of empty) assert.deepEqual(parseCsv(text), [], `${name} is empty`);
  await rejected(() => s.exports.archive('not-a-uuid', now), 400);
  console.log('PASS EXP-CSV');
}

async function jsonBackup(db, s, f, made) {
  stage = 'EXP-JSON the backup holds every owner table with a format version and no secret';
  const { backupTables, legacyTables, notBackedUp } = require(
    '/app/backend/dist/owner-export/backup-tables.js',
  );
  const schema = (
    await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
  ).map((row) => row.tablename);
  assert.deepEqual(
    [...backupTables, ...legacyTables, ...Object.keys(notBackedUp)].sort(),
    schema,
    'Every table is backed up or left out on purpose, exactly once',
  );

  const before = await fingerprint(db);
  const download = await s.exports.backup(f.owner, now);
  assert.equal(download.filename, 'capital-tracker-backup-2026-10-08.json');
  assert.equal(download.contentType, 'application/json');
  const text = download.data.toString('utf8');
  const backup = JSON.parse(text);
  assert.deepEqual(Object.keys(backup), ['format', 'formatVersion', 'exportedAt', 'tables']);
  assert.deepEqual(
    [backup.format, backup.formatVersion, backup.exportedAt],
    ['capital-tracker-backup', 1, now.toISOString()],
  );
  assert.deepEqual(Object.keys(backup.tables), [...backupTables, ...legacyTables]);
  for (const name of backupTables) {
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM "${name}" WHERE "ownerId"=$1`, [
      f.owner,
    ]);
    assert.equal(backup.tables[name].length, n, `${name}: every row of the owner`);
    for (const row of backup.tables[name]) assert.equal('ownerId' in row, false);
  }
  assert.ok(backup.tables.wallet_address_transactions.length === 3);
  // LEGACY-EXPORT: the retired screens' rows leave with the owner's backup (M20).
  for (const name of legacyTables.filter((name) => name !== 'currencies')) {
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM "${name}" WHERE "userId"=$1`, [
      f.owner,
    ]);
    assert.ok(n > 0, `${name}: a synthetic legacy row`);
    assert.equal(backup.tables[name].length, n, `${name}: every legacy row of the owner`);
    for (const row of backup.tables[name]) assert.equal('userId' in row, false);
  }
  assert.deepEqual(
    backup.tables.currencies.map((row) => row.code).sort(),
    ['EUR', 'RUB', 'USD'],
    'Only the currencies the legacy rows name',
  );
  const usd = backup.tables.currencies.find((row) => row.code === 'USD');
  assert.deepEqual(
    backup.tables.assets.map((row) => [row.name, row.amount, row.currencyId, row.date]),
    [['Flat', '1234.56789012', usd.id, '2025-03-01']],
    'Exact legacy amounts and their currency',
  );
  assert.deepEqual(backup.tables.crypto_wallets[0].tokens, [{ symbol: 'BTC' }]);
  assert.deepEqual(backup.tables.reports[0].parameters, { year: 2025 });
  for (const marker of [...made.secrets, f.other])
    assert.equal(text.includes(marker), false, 'No secret, session or foreign id');
  for (const name of Object.keys(notBackedUp)) assert.equal(name in backup.tables, false);

  const versions = backup.tables.account_trade_versions;
  const paid = versions.find((row) => row.tradeId === made.paid);
  assert.deepEqual(
    [paid.quantity, paid.grossUsd, paid.occurredAt],
    ['0.00918359', '1050.5', '2025-06-13T00:00:00+00:00'],
    'Exact decimals as strings, times in UTC',
  );
  assert.deepEqual(
    versions.filter((row) => row.tradeId === made.voided).map((row) => row.kind),
    ['create', 'void'],
    'The audit history of every entry',
  );
  assert.equal(
    Buffer.from(backup.tables.account_csv_imports[0].originalBytes, 'base64').toString('utf8'),
    csvUpload,
    'The uploaded CSV file itself',
  );
  assert.deepEqual(backup.tables.owner_settings, [
    { mainCurrency: 'EUR', updatedAt: backup.tables.owner_settings[0].updatedAt, dustThresholdUsd: null },
  ]);
  assert.equal(await fingerprint(db), before, 'Backup changes no row');

  const foreign = JSON.parse((await s.exports.backup(f.other, now)).data.toString('utf8'));
  assert.deepEqual(
    foreign.tables.account_trade_versions.map((row) => row.quantity),
    ['5'],
  );
  assert.equal(JSON.stringify(foreign).includes(made.btc), false);
  assert.deepEqual(
    [foreign.tables.assets.map((row) => row.name), foreign.tables.currencies.map((row) => row.code)],
    [['Foreign flat'], ['BTC']],
  );
  assert.deepEqual(foreign.tables.liabilities, []);
  await rejected(() => s.exports.backup('not-a-uuid', now), 400);
  console.log('PASS EXP-JSON');
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
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 57);
    const [owner, other, third] =
      await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('export-owner@example.invalid','synthetic-not-a-hash',true),
      ('export-other@example.invalid','synthetic-not-a-hash',true),
      ('export-third@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    const f = { owner: owner.id, other: other.id, third: third.id };
    const made = await seed(db, s, f);
    await csvArchive(db, s, f, made);
    await jsonBackup(db, s, f, made);
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
