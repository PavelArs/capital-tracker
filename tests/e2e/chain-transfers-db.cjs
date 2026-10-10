'use strict';
// link-own-transfers (M13) against fresh synthetic PostgreSQL: the compiled classification
// service links a send and a receipt between two of the owner's accounts as one owned
// transfer, and the actual snapshots count only its network fee. All data is synthetic.
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
const database = 'capital_tracker_chain_transfers_e2e';
const modulePath = '/app/backend/dist/accounting/chain-transfer.js';
const now = new Date('2026-10-04T12:30:00.000Z');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const txid = (n) => sha256(`ct-chain-transfers:${n}`);
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
  const classifications = make(
    'chain-classification.service',
    'ChainClassificationService',
    trades,
    make('asset-reward.service', 'AssetRewardService'),
    make('owned-transfer.service', 'OwnedTransferService'),
  );
  const {
    WalletSyncService,
  } = require('/app/backend/dist/wallet-addresses/wallet-sync.service.js');
  const {
    WalletAddressService,
  } = require('/app/backend/dist/wallet-addresses/wallet-address.service.js');
  const {
    PortfolioSnapshotsService,
  } = require('/app/backend/dist/portfolio-snapshots/portfolio-snapshots.service.js');
  // No adapters: the probe stores raw rows itself, as a sync would.
  const sync = new WalletSyncService(db, new ConfigService({}), [], classifications);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trades,
    operations: make('operation-list.service', 'OperationListService'),
    classifications,
    addresses: new WalletAddressService(db, sync),
    snapshots: new PortfolioSnapshotsService(db, new ConfigService({})),
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
async function wallet(db, owner, accountId, address) {
  const [{ id }] = await db.query(
    `INSERT INTO wallet_addresses(id,"ownerId",network,address,"accountId")
      VALUES ($1,$2,'bitcoin',$3,$4) RETURNING id`,
    [randomUUID(), owner, address, accountId],
  );
  return id;
}
// The raw rows a sync stores: received, sent and fee in satoshis, never edited afterwards.
async function raw(db, owner, addressId, n, direction, received, sent, fee, blockTime) {
  await db.query(
    `INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockHash",
      "blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      owner,
      addressId,
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
}
const classify = (s, owner, addressId, n, body) =>
  s.classifications.classify(owner, addressId, txid(n), {
    requestId: randomUUID(),
    hidden: false,
    ...body,
  });
const count = async (s, owner) => (await s.classifications.needsClassificationCount(owner)).count;
const rows = async (s, owner, n) =>
  (await s.operations.read(owner, {}, now)).operations.filter(
    (operation) => operation.chain?.txid === txid(n),
  );
const journal = async (s, owner, accountId) =>
  (await s.trades.getJournal(owner, accountId)).journal;
const answers = (db, n) =>
  db.query(
    `SELECT "addressId", version, status, type, "transferId", "linkedAddressId", automatic
      FROM chain_transaction_classification_versions WHERE txid=$1 ORDER BY "addressId", version`,
    [txid(n)],
  );
const transferKind = async (db, transferId) =>
  (
    await db.query(
      `SELECT v.kind FROM owned_transfers t JOIN owned_transfer_versions v
        ON v."transferId"=t.id AND v.version=t."currentVersion" WHERE t.id=$1`,
      [transferId],
    )
  )[0].kind;
const week = (s, owner) => s.snapshots.history(owner, { period: '7D', currency: 'USD' }, now);

async function storedHistory(db) {
  stage = 'synthetic stored daily prices (BTC at 60000) and Bank of Russia rates';
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    SELECT 'BTC','USD','kraken',d,60000,'daily-close'
    FROM generate_series(timestamptz '2025-01-02 00:00+00', timestamptz '2026-10-04 00:00+00', interval '1 day') d`);
  await db.query(`INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit")
    SELECT c.currency,'cbr',d::date,c.rate FROM (VALUES ('USD',90),('EUR',100)) c(currency,rate)
    CROSS JOIN generate_series(date '2025-01-01', date '2026-10-04', interval '1 day') d
    WHERE extract(isodow FROM d) < 6`);
}

async function setup(db, s, owner) {
  stage = 'synthetic wallets: A in Trust Wallet, B not in a wallet yet, a manual Bybit';
  const trust = await account(s, owner, 'Trust Wallet');
  const cold = await account(s, owner, 'Cold storage');
  const bybit = await account(s, owner, 'Bybit');
  const a = await wallet(db, owner, trust, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  const b = await wallet(db, owner, null, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  // 1: A receives 0.6 BTC. 2: A sends 0.5 BTC to B, 0.0999 back as change, fee 0.0001.
  // 3: A sends 0.05 BTC to an address the owner never registered, fee 0.00002.
  await raw(db, owner, a, 1, 'in', '60000000', '0', '500', '2026-06-20T08:00:00.000Z');
  await raw(db, owner, a, 2, 'out', '9990000', '60000000', '10000', '2026-10-01T10:00:00.000Z');
  await raw(db, owner, b, 2, 'in', '50000000', '0', '10000', '2026-10-01T10:00:00.000Z');
  await raw(db, owner, a, 3, 'out', '4988000', '9990000', '2000', '2026-10-02T10:00:00.000Z');
  assert.equal(await count(s, owner), 4);
  return { trust, cold, bybit, a, b };
}

async function automatic(db, s, owner, f) {
  stage = 'XFER-AUTO waits for both addresses to be in accounts';
  await classify(s, owner, f.a, 1, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '30000' },
  });
  assert.equal(await count(s, owner), 3, 'B has no account yet: nothing is linked');
  assert.deepEqual(await answers(db, 2), []);

  stage = "XFER-AUTO choosing B's account links the pair without asking";
  await s.addresses.update(owner, f.b, { accountId: f.cold });
  assert.equal(await count(s, owner), 1, 'Neither leg of the transfer needs classification');
  const linked = await answers(db, 2);
  assert.equal(linked.length, 2);
  const transferId = linked[0].transferId;
  assert.ok(transferId);
  for (const answer of linked)
    assert.deepEqual(
      [answer.version, answer.status, answer.type, answer.transferId, answer.automatic],
      [1, 'classified', 'transfer', transferId, true],
    );
  const byAddress = new Map(linked.map((answer) => [answer.addressId, answer]));
  assert.equal(byAddress.get(f.a).linkedAddressId, f.b);
  assert.equal(byAddress.get(f.b).linkedAddressId, f.a);
  const [row] = await rows(s, owner, 2);
  assert.equal((await rows(s, owner, 2)).length, 1, 'The pair is listed once');
  assert.deepEqual(
    [row.type, row.direction, row.status, row.account.id, row.counterAccount.id],
    ['transfer', 'internal', 'recorded', f.trust, f.cold],
  );
  same(row.quantity, '0.5', 'B received 0.5 BTC');
  assert.equal(row.wallet.id, f.a);
  assert.equal(row.counterWallet.id, f.b);
  assert.equal(row.chain.direction, 'out');
  same(row.fee.quantity, '0.0001', 'A paid the network fee');
  assert.equal(row.classification.automatic, true);
  assert.equal(
    (await s.operations.read(owner, {}, now)).operations.filter(
      (operation) => operation.id === `transfer:${transferId}`,
    ).length,
    0,
    'The produced transfer is shown on its chain row only',
  );
  assert.deepEqual(await s.classifications.linkOwnTransfers(owner), { linked: 0 });

  stage = 'XFER-UNKNOWN a send to an unregistered address stays to classify';
  const [unknown] = await rows(s, owner, 3);
  assert.deepEqual([unknown.status, unknown.type], ['needs-classification', null]);
  assert.equal(unknown.counterWallet, null);
  console.log('PASS XFER-AUTO/XFER-UNKNOWN');
  return transferId;
}

async function capital(db, s, owner, f, transferId) {
  stage = "XFER-CAPITAL B keeps A's cost basis; only the fee leaves";
  const sender = await journal(s, owner, f.trust);
  const receiver = await journal(s, owner, f.cold);
  same(receiver.summary.remainingCostUsd, '25000', "B's 0.5 BTC keeps A's 50000 per BTC");
  same(sender.summary.remainingCostUsd, '4995', 'A keeps 0.0999 BTC at its cost');
  same(sender.transferSummary.feeConsumedBasisUsd, '5', 'The 0.0001 BTC fee consumes its basis');
  same(sender.summary.realizedUsd, '0', 'A transfer realises nothing');
  assert.equal(await transferKind(db, transferId), 'create');

  stage = 'XFER-CAPITAL / FLOW-SPLIT-TRANSFER at BTC 60000 the transfer changes the week by its fee';
  const history = await week(s, owner);
  assert.equal(history.points[0].at, '2026-09-28T00:00:00.000Z');
  same(history.points[0].value, '36000');
  assert.deepEqual([history.deposits, history.withdrawals, history.netFlow], ['0', '0', '0']);
  // D1: the unanswered send of 0.05002 BTC (3001.2 USD) has already left A, without a
  // withdrawal; the transfer itself costs only its 6 USD fee.
  same(history.change, '-3007.2', 'The 6 USD fee and the unanswered send leave the portfolio');
  same(history.marketEffect, '-3007.2', 'Neither is a withdrawal');
  console.log('PASS XFER-CAPITAL/FLOW-SPLIT-TRANSFER');
}

async function manual(db, s, owner, f) {
  stage = 'XFER-MANUAL the send to an unregistered address is linked to Bybit by hand';
  await rejected(
    () =>
      classify(s, owner, f.a, 3, {
        expectedVersion: 0,
        classification: { type: 'transfer', accountId: f.trust },
      }),
    422,
  );
  const saved = await classify(s, owner, f.a, 3, {
    expectedVersion: 0,
    classification: { type: 'transfer', accountId: f.bybit },
  });
  assert.equal(saved.value.operation.kind, 'transfer');
  assert.deepEqual([saved.value.linkedAddressId, saved.value.automatic], [null, false]);
  assert.equal(await count(s, owner), 0);
  same(
    (await journal(s, owner, f.bybit)).summary.remainingCostUsd,
    '2500',
    'Bybit holds 0.05 BTC more',
  );
  same((await journal(s, owner, f.trust)).summary.remainingCostUsd, '2494');
  const [row] = await rows(s, owner, 3);
  assert.deepEqual(
    [row.type, row.account.id, row.counterAccount.id],
    ['transfer', f.trust, f.bybit],
  );
  same(row.quantity, '0.05');
  same(row.fee.quantity, '0.00002');
  assert.equal(row.counterWallet, null);
  const history = await week(s, owner);
  assert.deepEqual([history.deposits, history.netFlow], ['0', '0'], 'No deposit is recorded');
  same(history.change, '-7.2', 'Only the two network fees left the portfolio');
  console.log('PASS XFER-MANUAL');
}

async function reclassify(db, s, owner, f, transferId) {
  stage = 'XFER-AUTO the owner reclassifies the send as a sale; B needs classification again';
  await classify(s, owner, f.a, 2, {
    expectedVersion: 1,
    classification: { type: 'sell', currency: 'USD', amount: '30000' },
  });
  assert.equal(await transferKind(db, transferId), 'void');
  assert.equal(await count(s, owner), 1);
  const afterSale = await answers(db, 2);
  const b = afterSale.filter((answer) => answer.addressId === f.b);
  assert.deepEqual(
    b.map((answer) => [answer.version, answer.status, answer.transferId]),
    [
      [1, 'classified', transferId],
      [2, 'unclassified', null],
    ],
  );
  same((await journal(s, owner, f.cold)).summary.remainingCostUsd, '0');
  assert.equal((await rows(s, owner, 2)).length, 2, 'Two legs, two rows again');

  stage = "XFER-MANUAL linking B's receipt from Trust Wallet makes the pair one transfer again";
  await rejected(
    () =>
      classify(s, owner, f.b, 2, {
        expectedVersion: 2,
        classification: { type: 'transfer', accountId: f.cold },
      }),
    422,
  );
  const relinked = await classify(s, owner, f.b, 2, {
    expectedVersion: 2,
    classification: { type: 'transfer', accountId: f.trust },
  });
  assert.equal(relinked.value.linkedAddressId, f.a);
  assert.equal(await count(s, owner), 0);
  const current = (await answers(db, 2)).filter(
    (answer) =>
      (answer.addressId === f.a && answer.version === 3) ||
      (answer.addressId === f.b && answer.version === 3),
  );
  assert.equal(current.length, 2);
  assert.equal(current[0].transferId, current[1].transferId);
  assert.deepEqual(
    current.map((answer) => [answer.status, answer.automatic]),
    [
      ['classified', false],
      ['classified', false],
    ],
  );
  same((await journal(s, owner, f.cold)).summary.remainingCostUsd, '25000');
  const listed = await rows(s, owner, 2);
  assert.equal(listed.length, 1);
  assert.deepEqual(
    [listed[0].type, listed[0].wallet.id, listed[0].classification.automatic],
    ['transfer', f.a, false],
  );

  stage = 'CLS-HIDE hiding the send voids the transfer and frees the receipt';
  await classify(s, owner, f.a, 2, {
    expectedVersion: 3,
    hidden: true,
    classification: { type: 'transfer', accountId: f.cold },
  });
  assert.equal(await transferKind(db, current[0].transferId), 'void');
  assert.equal(await count(s, owner), 1, 'The receipt needs classification; the send is hidden');
  assert.deepEqual(await s.classifications.linkOwnTransfers(owner), { linked: 0 });
  console.log('PASS XFER-RECLASSIFY/XFER-HIDE');
}

// XFER-REFUSED: a transfer the books cannot take says why, in a body the browser can read: the
// sender does not hold the coins (the shortfall is the transfer itself, not a later operation),
// or an account's records start after the transaction.
async function refused(db, s) {
  stage = 'XFER-REFUSED synthetic second owner with a sender, a receiver and one send';
  const [other] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
    ('refused-owner@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
  const owner = other.id;
  const sender = await account(s, owner, 'Sender');
  const receiver = await account(s, owner, 'Receiver');
  const a = await wallet(db, owner, sender, 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3');
  const b = await wallet(db, owner, receiver, 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
  await raw(db, owner, a, 21, 'in', '60000000', '0', '500', '2026-06-20T08:00:00.000Z');
  await raw(db, owner, a, 22, 'out', '9990000', '60000000', '10000', '2026-10-01T10:00:00.000Z');
  await raw(db, owner, b, 22, 'in', '50000000', '0', '10000', '2026-10-01T10:00:00.000Z');
  const send = () =>
    classify(s, owner, a, 22, {
      expectedVersion: 0,
      classification: { type: 'transfer', accountId: receiver },
    });
  const refusal = async () => {
    try {
      await send();
    } catch (error) {
      assert.equal(error.getStatus?.(), 409);
      return error.getResponse();
    }
    assert.fail('The transfer must be refused');
  };

  stage = 'XFER-REFUSED the sender holds nothing: the body names the transfer as the shortfall';
  const short = await refusal();
  assert.equal(short.message, 'An account does not hold enough for this transfer');
  assert.equal(short.dependent.accountId, sender);
  assert.match(short.dependent.operationId, /^transfer:/);
  assert.equal(short.dependent.occurredAt, '2026-10-01T10:00:00.000Z');

  stage = 'XFER-REFUSED the receiver starts its records after the send: the body names it';
  await s.trades.initialize(owner, receiver, {
    requestId: randomUUID(),
    coverageFrom: '2026-10-05T00:00:00.000Z',
    assertEmpty: true,
  });
  // The receipt that funds the sender; the pair is not linked on its own, as the receiver's
  // records start after it.
  await classify(s, owner, a, 21, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '30000' },
  });
  const late = await refusal();
  assert.equal(late.message, 'The records of an account start after this entry');
  assert.deepEqual(late.coverage, { accountId: receiver, coverageFrom: '2026-10-05T00:00:00.000Z' });
  assert.equal(late.dependent, undefined);
  assert.equal(await count(s, owner), 2, 'Neither leg of the refused send was answered');

  stage = 'XFER-REFUSED an account opened with balances has no records to move coins in or out of';
  const legacy = await account(s, owner, 'Opened with balances');
  const { value: ether } = await s.accounting.createInstrument(owner, {
    requestId: randomUUID(),
    name: 'Synthetic coin',
    symbol: 'SYN',
    assetType: 'crypto',
  });
  await s.accounting.saveOpening(owner, legacy, {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: '2026-01-01T00:00:00.000Z',
    positions: [{ instrumentId: ether.id, quantity: '5', costStatus: 'known', totalCostUsd: '9000' }],
  });
  const c = await wallet(db, owner, legacy, 'bc1q9h6yz4cl2y7p8v6kgsz3vurmk4vqq9a63k6ctw');
  await raw(db, owner, c, 23, 'out', '0', '1010000', '10000', '2026-10-02T10:00:00.000Z');
  try {
    await classify(s, owner, c, 23, {
      expectedVersion: 0,
      classification: { type: 'transfer', accountId: receiver },
    });
    assert.fail('The transfer must be refused');
  } catch (error) {
    assert.equal(error.getStatus?.(), 409);
    assert.equal(error.getResponse().message, 'The records of an account have not started');
    assert.deepEqual(error.getResponse().coverage, { accountId: legacy, coverageFrom: null });
  }

  stage = 'XFER-REFUSED any answer that adds coins before the records of the account begin says so';
  await raw(db, owner, b, 24, 'in', '1000000', '0', '0', '2026-10-02T10:00:00.000Z');
  for (const classification of [
    { type: 'airdrop', valueUsd: null },
    { type: 'buy', currency: 'USD', amount: '500' },
  ]) {
    try {
      await classify(s, owner, b, 24, { expectedVersion: 0, classification });
      assert.fail(`${classification.type} must be refused`);
    } catch (error) {
      assert.equal(error.getStatus?.(), 409, classification.type);
      assert.equal(error.getResponse().message, 'The records of an account start after this entry');
      assert.deepEqual(error.getResponse().coverage, {
        accountId: receiver,
        coverageFrom: '2026-10-05T00:00:00.000Z',
      });
    }
  }
  console.log('PASS XFER-REFUSED');
}


// XFER-PROPOSED: a withdrawal and a receipt that name different transactions are proposed, not
// linked; accepting answers the withdrawal as a transfer naming the receipt, and the fee is
// what went missing between them.
async function proposed(db, s) {
  stage = 'XFER-PROPOSED synthetic third owner: a sender, a receiver, a send and a receipt';
  const [third] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
    ('proposed-owner@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
  const owner = third.id;
  const sender = await account(s, owner, 'Exchange');
  const receiver = await account(s, owner, 'Hardware');
  const other = await account(s, owner, 'Savings');
  const a = await wallet(db, owner, sender, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  const b = await wallet(db, owner, receiver, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  const c = await wallet(db, owner, other, 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
  // 41: 0.6 BTC arrive in A. 42: A sends 0.5001 BTC at 10:00. 43: B gets 0.4999 BTC at 10:12
  // under another transaction, so 0.0002 BTC went missing between them.
  await raw(db, owner, a, 41, 'in', '60000000', '0', '500', '2026-06-20T08:00:00.000Z');
  await raw(db, owner, a, 42, 'out', '0', '50010000', '10000', '2026-10-01T10:00:00.000Z');
  await raw(db, owner, b, 43, 'in', '49990000', '0', '10000', '2026-10-01T10:12:00.000Z');
  await classify(s, owner, a, 41, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '30000' },
  });
  const before = await rawFingerprint(db, owner);
  assert.deepEqual(await s.classifications.linkOwnTransfers(owner), { linked: 0 });
  assert.equal(await count(s, owner), 2, 'The app does not link legs of two transactions itself');

  stage = 'XFER-PROPOSED the pair is proposed with the fee between them';
  const seen = await s.classifications.transferProposals(owner);
  assert.deepEqual([seen.windowHours, seen.feePercent], [24, 2]);
  assert.equal(seen.proposals.length, 1);
  const [proposal] = seen.proposals;
  assert.deepEqual([proposal.coin, proposal.sent, proposal.arrived, proposal.fee], [
    'BTC',
    '0.5001',
    '0.4999',
    '0.0002',
  ]);
  assert.deepEqual(
    [proposal.outgoing.addressId, proposal.outgoing.txid, proposal.outgoing.accountName],
    [a, txid(42), 'Exchange'],
  );
  assert.deepEqual(
    [proposal.incoming.addressId, proposal.incoming.txid, proposal.incoming.accountId],
    [b, txid(43), receiver],
  );

  stage = 'XFER-PROPOSED an unrelated or unfitting leg is refused as the other side';
  const accept = (partner, accountId = receiver, version = 0) =>
    classify(s, owner, a, 42, {
      expectedVersion: version,
      classification: { type: 'transfer', accountId, partner },
    });
  await rejected(() => accept({ addressId: c, txid: txid(43) }, other), 422);
  await rejected(() => accept({ addressId: b, txid: txid(99) }), 422);
  await rejected(() => accept({ addressId: a, txid: txid(41) }), 422);
  await raw(db, owner, c, 44, 'in', '49990000', '0', '10000', '2026-10-03T10:12:00.000Z');
  await rejected(() => accept({ addressId: c, txid: txid(44) }, other), 422);
  assert.equal(await count(s, owner), 3, 'Nothing was answered');

  stage = 'XFER-PROPOSED two equally good receipts leave the choice to the owner';
  await raw(db, owner, c, 45, 'in', '49990000', '0', '10000', '2026-10-01T10:12:00.000Z');
  assert.deepEqual((await s.classifications.transferProposals(owner)).proposals, []);
  await db.query(`DELETE FROM wallet_address_transactions WHERE txid IN ($1,$2)`, [txid(44), txid(45)]);
  assert.equal((await s.classifications.transferProposals(owner)).proposals.length, 1);

  stage = 'XFER-PROPOSED accepting joins the two legs as one transfer with the missing part as fee';
  const joined = await accept({ addressId: b, txid: txid(43) });
  assert.equal(joined.value.operation.kind, 'transfer');
  assert.equal(joined.value.linkedAddressId, null, 'The link column is for legs of one hash');
  assert.equal(joined.value.automatic, false);
  assert.equal(await count(s, owner), 0);
  const legs = (await db.query(
    `SELECT "addressId", txid, version, status, "transferId", "linkedAddressId"
      FROM chain_transaction_classification_versions
      WHERE txid IN ($1,$2) AND status='classified' ORDER BY "addressId"`,
    [txid(42), txid(43)],
  ));
  assert.equal(legs.length, 2);
  assert.equal(legs[0].transferId, legs[1].transferId);
  assert.deepEqual(legs.map((leg) => leg.linkedAddressId), [null, null]);
  assert.deepEqual(legs.map((leg) => leg.addressId).sort(), [a, b].sort());
  const mine = (await s.operations.read(owner, {}, now)).operations.filter(
    (operation) => operation.chain?.txid === txid(42) || operation.chain?.txid === txid(43),
  );
  assert.equal(mine.length, 1, 'The pair is listed once, on the sending leg');
  assert.deepEqual(
    [mine[0].type, mine[0].wallet.id, mine[0].counterWallet.id, mine[0].counterAccount.id],
    ['transfer', a, b, receiver],
  );
  same(mine[0].quantity, '0.4999', 'The receiver got 0.4999 BTC');
  same(
    (await journal(s, owner, receiver)).summary.remainingCostUsd,
    '24995',
    "B's 0.4999 BTC keeps A's 50000 per BTC",
  );
  same((await journal(s, owner, sender)).transferSummary.feeConsumedBasisUsd, '10');
  assert.deepEqual((await s.classifications.transferProposals(owner)).proposals, []);

  stage = 'XFER-PROPOSED answering the send differently frees the receipt and proposes again';
  await classify(s, owner, a, 42, {
    expectedVersion: 1,
    classification: { type: 'sell', currency: 'USD', amount: '30000' },
  });
  assert.equal(await count(s, owner), 1);
  assert.equal((await s.classifications.transferProposals(owner)).proposals.length, 0, 'sold');
  assert.equal(await rawFingerprint(db, owner), before, 'Raw chain rows are never edited');
  console.log('PASS XFER-PROPOSED');
}

// XFER-ADDRESS: two addresses of the receiving account took part in the one transaction; the
// owner names the address that received the transfer. The other address's payment of its own
// stays unanswered, and a leg that does not fit is refused.
async function addressChoice(db, s) {
  stage = 'XFER-ADDRESS synthetic fourth owner: a send received at two addresses of one account';
  const [fourth] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
    ('address-owner@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
  const owner = fourth.id;
  const sender = await account(s, owner, 'Spending');
  const receiver = await account(s, owner, 'Hardware');
  const a = await wallet(db, owner, sender, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  const b = await wallet(db, owner, receiver, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  const c = await wallet(db, owner, receiver, 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
  // 61: 0.6 BTC arrive in A. 62: A sends 0.3001 BTC (fee 0.0001); B gets 0.3 BTC and C a payment
  // of 0.05 BTC of its own in the same transaction.
  await raw(db, owner, a, 61, 'in', '60000000', '0', '500', '2026-06-20T08:00:00.000Z');
  await raw(db, owner, a, 62, 'out', '0', '30010000', '10000', '2026-10-01T10:00:00.000Z');
  await raw(db, owner, b, 62, 'in', '30000000', '0', '10000', '2026-10-01T10:00:00.000Z');
  await raw(db, owner, c, 62, 'in', '5000000', '0', '10000', '2026-10-01T10:00:00.000Z');
  await classify(s, owner, a, 61, {
    expectedVersion: 0,
    classification: { type: 'buy', currency: 'USD', amount: '30000' },
  });
  const before = await rawFingerprint(db, owner);
  const send = (partner) =>
    classify(s, owner, a, 62, {
      expectedVersion: 0,
      classification: { type: 'transfer', accountId: receiver, ...(partner ? { partner } : {}) },
    });

  stage = 'XFER-ADDRESS without a choice the two addresses leave the transfer unlinked';
  await rejected(() => send(), 422);
  assert.equal(await count(s, owner), 3, 'Nothing was answered');

  stage = 'XFER-ADDRESS the address whose amount does not fit is refused';
  await rejected(() => send({ addressId: c, txid: txid(62) }), 422);
  await rejected(() => send({ addressId: a, txid: txid(62) }), 422);
  assert.equal(await count(s, owner), 3, 'Nothing was answered');

  stage = 'XFER-ADDRESS the named address links as the other side with the sender fee';
  const saved = await send({ addressId: b, txid: txid(62) });
  assert.equal(saved.value.operation.kind, 'transfer');
  assert.deepEqual([saved.value.linkedAddressId, saved.value.automatic], [b, false]);
  assert.equal(await count(s, owner), 1, "C's payment still needs an answer");
  const legs = await db.query(
    `SELECT "addressId", "transferId", "linkedAddressId" FROM chain_transaction_classification_versions
      WHERE txid=$1 AND status='classified' ORDER BY "addressId"`,
    [txid(62)],
  );
  assert.equal(legs.length, 2);
  assert.equal(legs[0].transferId, legs[1].transferId);
  assert.deepEqual(legs.map((leg) => leg.addressId).sort(), [a, b].sort());
  const mine = (await rows(s, owner, 62)).filter((operation) => operation.type === 'transfer');
  assert.equal(mine.length, 1, 'The pair is listed once');
  same(mine[0].quantity, '0.3', 'B received 0.3 BTC');
  same(mine[0].fee.quantity, '0.0001', 'The fee is the sender\'s own');
  same(
    (await journal(s, owner, receiver)).summary.remainingCostUsd,
    '15000',
    "B's 0.3 BTC keeps A's 50000 per BTC",
  );
  assert.equal(await rawFingerprint(db, owner), before, 'Raw chain rows are never edited');

  stage = 'XFER-ADDRESS a leg of the same transaction short of the amount is not taken as fee';
  // 63: A sends 0.1001 BTC (fee 0.0001); B gets only 0.0995, so 0.0006 BTC are unexplained.
  await raw(db, owner, a, 63, 'out', '0', '10010000', '10000', '2026-10-02T10:00:00.000Z');
  await raw(db, owner, b, 63, 'in', '9950000', '0', '10000', '2026-10-02T10:00:00.000Z');
  await rejected(
    () =>
      classify(s, owner, a, 63, {
        expectedVersion: 0,
        classification: {
          type: 'transfer',
          accountId: receiver,
          partner: { addressId: b, txid: txid(63) },
        },
      }),
    422,
  );
  assert.equal((await rows(s, owner, 63)).filter((operation) => operation.type === 'transfer').length, 0);
  console.log('PASS XFER-ADDRESS');
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
      ('transfer-owner@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const s = services(db);
    await storedHistory(db);
    const f = await setup(db, s, owner.id);
    const before = await rawFingerprint(db, owner.id);
    const transferId = await automatic(db, s, owner.id, f);
    await capital(db, s, owner.id, f, transferId);
    await manual(db, s, owner.id, f);
    await reclassify(db, s, owner.id, f, transferId);
    assert.equal(await rawFingerprint(db, owner.id), before, 'Raw chain rows are never edited');
    await refused(db, s);
    await proposed(db, s);
    await addressChoice(db, s);
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
