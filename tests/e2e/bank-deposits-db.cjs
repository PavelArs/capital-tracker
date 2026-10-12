'use strict';
// bank-deposits (DEP-ACCRUAL, DEP-CHECK) against fresh synthetic PostgreSQL: a deposit entered
// once earns computed interest, is worth its balance in USD, EUR and RUB at the Bank of Russia
// rate of the day, refuses movements it could not have had, and compares a balance read in the
// bank's app with the computed one. All data is synthetic.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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
const database = 'capital_tracker_bank_deposits_e2e';
const modulePath = '/app/backend/dist/deposits/deposits.service.js';
const MIGRATIONS = 59;
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
const savings = {
  name: 'Savings A',
  bank: 'Synthetic Bank',
  currency: 'RUB',
  startDate: '2026-07-01',
  endDate: '2026-10-01',
  payout: 'monthly',
  capitalized: false,
  dayBasis: 'actual-365',
  earlyClose: 'forfeits-interest',
  ratePercent: '12',
  amount: '100000.00',
};
const dollars = {
  name: 'Dollar B',
  bank: 'Synthetic Bank',
  currency: 'USD',
  startDate: '2026-07-01',
  endDate: null,
  payout: 'quarterly',
  capitalized: true,
  dayBasis: 'actual-365',
  earlyClose: 'keeps-interest',
  ratePercent: '4',
  amount: '5000',
};

async function accrual(db, service, owner) {
  stage = 'synthetic deposits: 12% on 100000 RUB, monthly, and 4% on 5000 USD, quarterly capitalized';
  await db.query(`INSERT INTO fx_rates(currency,source,"rateDate","rubPerUnit")
    SELECT c.currency,'cbr',d::date,c.rate FROM (VALUES ('USD',90),('EUR',100)) c(currency,rate)
    CROSS JOIN generate_series(date '2026-06-01', date '2026-10-04', interval '1 day') d
    WHERE extract(isodow FROM d) < 6`);
  const rub = await service.create(owner, savings);
  const usd = await service.create(owner, dollars);
  assert.equal(rub.principal, '100000.00');
  assert.equal(rub.status, 'matured', 'Read today, its term is over');

  const listed = await service.list(owner, '2026-10-01');
  const matured = listed.items.find((item) => item.id === rub.id);
  assert.equal(matured.status, 'matured');
  assert.equal(matured.due, '3024.66', 'Three postings: 1019.18, 1019.18 and 986.30');
  assert.equal(matured.balance, '103024.66');
  assert.deepEqual(matured.values, { USD: '1144.72', EUR: '1030.25', RUB: '103024.66' });
  assert.equal(matured.atMaturity.interest, '3024.66');
  console.log('PASS DEP-ACCRUAL-RUB');

  const later = (await service.list(owner, '2026-10-02')).items.find((item) => item.id === usd.id);
  assert.equal(later.principal, '5050.41', 'The quarter ending 1 October was capitalized');
  assert.equal(later.accrued, '0.55', 'One day, 1 October, on the capitalized sum');
  const day4 = (await service.list(owner, '2026-10-04')).items.find((item) => item.id === usd.id);
  assert.equal(day4.balance, '5052.07');
  assert.equal(day4.values.RUB, '454686.30', 'At 90 rubles on a working day');
  assert.deepEqual(day4.nextPayout.date, '2027-01-01');
  console.log('PASS DEP-ACCRUAL-USD');

  const totals = (await service.list(owner, '2026-10-04')).totals;
  assert.deepEqual(totals, { USD: '6196.79', EUR: '5577.11', RUB: '557710.96' });
  console.log('PASS DEP-TOTALS');

  stage = 'synthetic rate freshness: the last rate is from 2 October';
  const recent = (await service.list(owner, '2026-10-12')).items.find((item) => item.id === usd.id);
  assert.notEqual(recent.values.RUB, null, 'Ten days after the last rate it is still used');
  const stale = await service.list(owner, '2026-10-25');
  const staleUsd = stale.items.find((item) => item.id === usd.id);
  assert.notEqual(staleUsd.values.USD, null, 'The deposit currency needs no rate');
  assert.equal(staleUsd.values.RUB, null, 'A rate 23 days old is not stated as the rate of the day');
  assert.equal(staleUsd.values.EUR, null);
  assert.equal(stale.totals.RUB, null);
  console.log('PASS DEP-FX-FRESH');

  stage = 'synthetic early closure: interest kept and not yet paid out still counts in the totals';
  const before = (await service.list(owner, '2026-10-02')).totals;
  const kept = await service.create(owner, {
    ...savings,
    name: 'Savings kept',
    endDate: '2027-07-01',
    earlyClose: 'keeps-interest',
  });
  const closed = await service.addMovement(owner, kept.id, {
    date: '2026-08-16',
    kind: 'withdrawal',
    amount: '100000.00',
  });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.accrued, '0.00');
  assert.equal(closed.due, '1512.33', 'The 1 August posting and the 15 days after it');
  const after = await service.list(owner, '2026-10-02');
  assert.equal(
    (Number(after.totals.RUB) - Number(before.RUB)).toFixed(2),
    '1512.33',
    'The unpaid interest of a closed deposit is part of the totals',
  );
  await service.addMovement(owner, kept.id, {
    date: '2026-08-20',
    kind: 'interest-payout',
    amount: '1512.33',
  });
  const settled = await service.list(owner, '2026-10-02');
  assert.deepEqual(settled.totals, before, 'Once paid out, the closed deposit counts for nothing');
  await service.remove(owner, kept.id);
  console.log('PASS DEP-CLOSED-DUE');

  stage = 'synthetic snapshot before the start, amount range and same-day order';
  const early = await service.list(owner, '2026-06-15');
  assert.deepEqual(early.items, [], 'Deposits that had not started are not in an earlier snapshot');
  assert.deepEqual(early.totals, { USD: '0.00', EUR: '0.00', RUB: '0.00' });
  await rejected(() => service.create(owner, { ...savings, amount: '1000000000000' }), 400);
  await rejected(() => service.create(owner, { ...savings, endDate: '2999-01-01' }), 400);
  await rejected(() => service.create(owner, { ...savings, endDate: '2056-07-02' }), 400);
  await service.remove(owner, (await service.create(owner, { ...savings, endDate: '2056-07-01' })).id);
  const same = await service.create(owner, { ...savings, name: 'Same day', amount: '100.00' });
  await service.addMovement(owner, same.id, { date: '2026-07-01', kind: 'topup', amount: '100.00' });
  const ordered = await service.addMovement(owner, same.id, {
    date: '2026-07-01',
    kind: 'withdrawal',
    amount: '150.00',
  });
  assert.deepEqual(
    ordered.movements.map((movement) => movement.kind),
    ['topup', 'topup', 'withdrawal'],
    'The same day is replayed in the order it was entered',
  );
  assert.equal(ordered.principal, '50.00');
  await rejected(() => service.get(owner, same.id, '2026-06-15'), 404);
  await rejected(() => service.get(owner, same.id, '2999-12-31'), 422);
  await rejected(() => service.list(owner, '2999-12-31'), 422);
  const requestId = randomUUID();
  const once = await service.create(owner, { ...savings, name: 'Replay', requestId });
  const again = await service.create(owner, { ...savings, name: 'Replay', requestId });
  assert.equal(again.id, once.id, 'The same request again returns the deposit it made');
  assert.equal(
    (await service.list(owner, undefined)).items.filter((item) => item.name === 'Replay').length,
    1,
    'A retried creation makes no second deposit',
  );
  await rejected(() => service.create(owner, { ...savings, name: 'Other', requestId }), 409);
  const topup = { date: '2026-07-02', kind: 'topup', amount: '10.00', requestId: randomUUID() };
  const first = await service.addMovement(owner, once.id, topup);
  const second = await service.addMovement(owner, once.id, topup);
  assert.equal(second.principal, first.principal, 'A retried movement is recorded once');
  assert.equal(second.movements.length, 2);
  await rejected(() => service.addMovement(owner, once.id, { ...topup, amount: '11.00' }), 409);
  await rejected(() => Object.getPrototypeOf(service).create(owner, savings), 400);
  const both = randomUUID();
  const racing = await Promise.all([
    service.create(owner, { ...savings, name: 'Race', requestId: both }),
    service.create(owner, { ...savings, name: 'Race', requestId: both }),
  ]);
  assert.equal(racing[0].id, racing[1].id, 'Two retries at once still make one deposit');
  await service.remove(owner, racing[0].id);
  await service.remove(owner, once.id);
  const withdrawnAll = await service.addMovement(owner, same.id, {
    date: '2026-08-10',
    kind: 'withdrawal',
    amount: '50.00',
  });
  assert.equal(withdrawnAll.closedOn, '2026-08-10');
  const hypothetical = await service.get(owner, same.id, '2026-07-15');
  assert.notEqual(hypothetical.nextPayout, null, 'A snapshot forecasts from what it knew then');
  await rejected(
    () => service.addRate(owner, same.id, { effectiveFrom: '2026-09-01', ratePercent: '5' }),
    422,
  );
  await service.addRate(owner, same.id, { effectiveFrom: '2026-08-01', ratePercent: '5' });
  await service.remove(owner, same.id);
  console.log('PASS DEP-ORDER');
  return { rub: rub.id, usd: usd.id };
}

async function movements(db, service, owner, other, ids) {
  stage = 'synthetic movements: payouts, withdrawals and what a deposit could not have had';
  await rejected(
    () => service.addMovement(owner, ids.rub, { date: '2026-06-30', kind: 'topup', amount: '10' }),
    422,
  );
  await rejected(
    () =>
      service.addMovement(owner, ids.rub, {
        date: '2026-08-01',
        kind: 'interest-payout',
        amount: '1019.19',
      }),
    422,
  );
  await rejected(
    () =>
      service.addMovement(owner, ids.rub, {
        date: '2026-08-15',
        kind: 'withdrawal',
        amount: '100000.01',
      }),
    422,
  );
  await rejected(() => service.addMovement(owner, ids.rub, { date: '2999-01-01', kind: 'topup', amount: '1' }), 422);
  await rejected(() => service.addMovement(other, ids.rub, { date: '2026-08-01', kind: 'topup', amount: '1' }), 404);
  await rejected(() => service.addMovement(owner, ids.rub, { date: '2026-08-01', kind: 'topup', amount: '1.005' }), 400);
  console.log('PASS DEP-MOVEMENT-REFUSED');

  const paid = await service.addMovement(owner, ids.rub, {
    date: '2026-08-01',
    kind: 'interest-payout',
    amount: '1019.18',
    comment: 'To the card',
  });
  assert.equal(paid.interestPaidOut, '1019.18');
  assert.equal(paid.due, '2005.48');
  const topped = await service.addMovement(owner, ids.rub, {
    date: '2026-08-16',
    kind: 'topup',
    amount: '50000',
  });
  assert.equal(topped.principal, '150000.00');
  const withdrawn = await service.addMovement(owner, ids.rub, {
    date: '2026-09-10',
    kind: 'withdrawal',
    amount: '150000',
  });
  assert.equal(withdrawn.status, 'closed');
  assert.equal(withdrawn.closedOn, '2026-09-10');
  assert.notEqual(withdrawn.interestForfeited, '0.00', 'Closing before the end forfeits the rest');
  console.log('PASS DEP-MOVEMENT-RECORDED');

  const topup = topped.movements.find((movement) => movement.kind === 'topup' && movement.amount === '50000.00');
  await rejected(() => service.removeMovement(owner, ids.rub, topup.id), 409);
  const first = topped.movements[0];
  await rejected(() => service.removeMovement(owner, ids.rub, first.id), 422);
  const removed = await service.removeMovement(
    owner,
    ids.rub,
    withdrawn.movements.find((movement) => movement.kind === 'withdrawal').id,
  );
  assert.equal(removed.status, 'matured');
  console.log('PASS DEP-MOVEMENT-DEPENDS');
}

async function checks(db, service, owner, ids) {
  stage = 'synthetic balance check against the balance read in the bank';
  const before = await service.get(owner, ids.usd, '2026-10-04');
  assert.equal(before.lastCheck, null);
  const checked = await service.addCheck(owner, ids.usd, {
    checkedOn: '2026-10-04',
    bankBalance: '5050.44',
  });
  assert.equal(checked.lastCheck.calculated, '5050.41');
  assert.equal(checked.lastCheck.difference, '0.03');
  assert.equal(checked.checks.length, 1);
  const corrected = await service.addCheck(owner, ids.usd, {
    checkedOn: '2026-10-04',
    bankBalance: '5050.43',
  });
  assert.deepEqual(
    corrected.checks.map((check) => check.bankBalance),
    ['5050.43', '5050.44'],
    'Checks of the same day are listed newest first, in the order they were entered',
  );
  assert.equal(corrected.lastCheck.bankBalance, '5050.43');
  const reading = { checkedOn: '2026-10-04', bankBalance: '5050.42', requestId: randomUUID() };
  await service.addCheck(owner, ids.usd, reading);
  const retried = await service.addCheck(owner, ids.usd, reading);
  assert.equal(retried.checks.length, 3, 'A retried check is recorded once');
  await rejected(
    () => service.addCheck(owner, ids.usd, { ...reading, bankBalance: '5050.41' }),
    409,
  );
  const past = await service.get(owner, ids.usd, '2026-10-02');
  assert.deepEqual(past.checks, [], 'A past view shows no later check');
  assert.ok(
    past.movements.every((movement) => movement.date <= '2026-10-02'),
    'A past view shows no later movement',
  );
  assert.equal(
    (await service.get(owner, ids.usd, '2026-10-02')).lastCheck,
    null,
    'A check made later says nothing about an earlier day',
  );
  await rejected(
    () => service.addCheck(owner, ids.usd, { checkedOn: '2026-06-30', bankBalance: '1' }),
    422,
  );
  await rejected(
    () => service.addCheck(owner, ids.usd, { checkedOn: '2026-10-04', bankBalance: '-1' }),
    400,
  );
  console.log('PASS DEP-CHECK');

  stage = 'synthetic rate change inside the term';
  await rejected(
    () => service.addRate(owner, ids.rub, { effectiveFrom: '2026-07-01', ratePercent: '5' }),
    422,
  );
  await rejected(
    () => service.addRate(owner, ids.rub, { effectiveFrom: '2026-10-01', ratePercent: '5' }),
    422,
  );
  await rejected(
    () => service.addRate(owner, ids.usd, { effectiveFrom: '2999-01-01', ratePercent: '5' }),
    422,
  );
  const lowered = await service.addRate(owner, ids.rub, { effectiveFrom: '2026-09-01', ratePercent: '6' });
  assert.equal(lowered.ratePercent, '6');
  assert.deepEqual(lowered.rates.map((rate) => rate.ratePercent), ['12', '6']);
  const twin = await service.create(owner, { ...savings, name: 'Twin' });
  const changed = await service.create(owner, { ...savings, name: 'Changed' });
  await service.addRate(owner, changed.id, { effectiveFrom: '2026-09-01', ratePercent: '6' });
  const thenTwin = await service.get(owner, twin.id, '2026-08-15');
  const thenChanged = await service.get(owner, changed.id, '2026-08-15');
  assert.deepEqual(
    thenChanged.atMaturity,
    thenTwin.atMaturity,
    'A past snapshot forecasts at the rates known then',
  );
  assert.notDeepEqual((await service.get(owner, changed.id, undefined)).atMaturity, thenTwin.atMaturity);
  await service.remove(owner, twin.id);
  await service.remove(owner, changed.id);
  console.log('PASS DEP-RATE');
}

async function owners(db, service, owner, other, ids) {
  stage = 'synthetic second owner';
  assert.deepEqual((await service.list(other, undefined)).items, []);
  await rejected(() => service.get(other, ids.rub, undefined), 404);
  await rejected(() => service.remove(other, ids.rub), 404);
  await service.remove(owner, ids.rub);
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM bank_deposit_rates WHERE "depositId"=$1) AS rates,
       (SELECT count(*)::int FROM bank_deposit_movements WHERE "depositId"=$1) AS movements`,
    [ids.rub],
  );
  assert.deepEqual(left[0], { rates: 0, movements: 0 }, 'Deleting a deposit deletes its rows');
  assert.equal((await service.list(owner, undefined)).items.length, 1);
  console.log('PASS DEP-OWNER');
}

async function wholePortfolio(db, owner) {
  stage = 'synthetic whole portfolio: the 12% ruble deposit and the 4% dollar one beside no coins';
  const { PortfolioValuationService } = require('/app/backend/dist/accounting/portfolio-valuation.service.js');
  const { PortfolioSnapshotsService } = require('/app/backend/dist/portfolio-snapshots/portfolio-snapshots.service.js');
  const { DepositsService } = require(modulePath);
  const deposits = new DepositsService(db);
  const rubles = await deposits.create(owner, { requestId: randomUUID(), ...savings });
  const dollarsDeposit = await deposits.create(owner, { requestId: randomUUID(), ...dollars });
  const now = new Date('2026-10-04T12:00:00.000Z');
  const valuation = new PortfolioValuationService(db);
  const rub = await valuation.read(owner, { currency: 'RUB' }, now);
  assert.equal(rub.completeness, 'complete');
  assert.equal(rub.unratedDepositCount, 0);
  assert.equal(rub.depositsValue, rub.totalValue, 'Nothing but deposits is held');
  assert.match(rub.totalValue, /^557710\.9[56]/, 'The same sum the deposits list states');
  assert.deepEqual(rub.allocation.byType.map((slice) => [slice.key, slice.percent]), [
    ['deposits', '100.00'],
  ]);
  assert.deepEqual(
    rub.allocation.byAsset.map((slice) => slice.label),
    ['Dollar B', 'Savings A'],
    'One slice per deposit, the larger first',
  );
  assert.deepEqual(rub.allocation.byAccount.map((slice) => slice.label), ['Synthetic Bank']);
  const usd = await valuation.read(owner, { currency: 'USD' }, now);
  assert.match(usd.totalValue, /^6196\.78/, "Full precision, the list rounds each deposit to cents");
  console.log('PASS DEP-VALUE-NOW');

  const snapshots = new PortfolioSnapshotsService(db, new ConfigService({}));
  const history = await snapshots.history(owner, { period: 'ALL', currency: 'RUB' }, now);
  const first = history.points.find((point) => point.value !== null && Number(point.value) > 0);
  assert.equal(first.at.slice(0, 10), '2026-07-01', 'The deposit appears the day it starts');
  assert.match(first.invested, /^550000(\.0+)?$/);
  assert.match(history.value, /^557710\.9[56]/);
  assert.match(history.invested, /^550000(\.0+)?$/, 'Only the money put in counts as invested');
  assert.ok(
    history.points.filter((point) => point.at >= '2026-07-01').every((point) => point.complete),
    'Every point since the deposit started is complete',
  );
  assert.match(history.profit, /^\+?7710\.9[56]/, 'Interest is the profit, not new money');
  console.log('PASS DEP-VALUE-HISTORY');

  stage = 'synthetic payout of posted interest leaves the portfolio';
  await deposits.addMovement(owner, rubles.id, {
    requestId: randomUUID(),
    date: '2026-10-02',
    kind: 'interest-payout',
    amount: '3000',
  });
  const paid = await snapshots.history(owner, { period: 'ALL', currency: 'RUB' }, now);
  assert.match(paid.invested, /^547000(\.0+)?$/, 'A payout is money taken out');
  assert.match(paid.value, /^554710\.9[56]/);
  assert.match(paid.profit, /^\+?7710\.9[56]/, 'Taking interest out does not change the profit');
  console.log('PASS DEP-VALUE-FLOWS');

  stage = 'synthetic hourly job refreshes an owner who has only deposits';
  const scheduled = new PortfolioSnapshotsService(
    db,
    new ConfigService({ PRICE_COLLECTION_ENABLED: 'true' }),
  );
  const later = new Date('2026-10-04T15:00:00.000Z');
  const tick = await scheduled.tick(later);
  assert.equal(tick.outcome, 'refreshed');
  const [{ count }] = await db.query(
    `SELECT count(*)::int AS count FROM portfolio_snapshots WHERE "ownerId"=$1 AND "takenAt"=$2`,
    [owner, later],
  );
  assert.ok(count > 0, 'The scheduled refresh reached the owner with deposits alone');
  console.log('PASS DEP-VALUE-SCHEDULED');

  stage = 'synthetic ruble deposit alone in rubles needs no dollar series';
  await deposits.remove(owner, dollarsDeposit.id);
  // The rates are append-only; this isolated database lets the trigger step aside once.
  await db.query('ALTER TABLE fx_rates DISABLE TRIGGER USER');
  await db.query(`DELETE FROM fx_rates WHERE currency = 'USD'`);
  await db.query('ALTER TABLE fx_rates ENABLE TRIGGER USER');
  const alone = await snapshots.history(owner, { period: 'ALL', currency: 'RUB' }, now);
  assert.notEqual(alone.value, null, 'Nothing but a ruble deposit in rubles is exact');
  assert.equal(alone.complete, true);
  const live = await valuation.read(owner, { currency: 'RUB' }, now);
  assert.ok(Math.abs(Number(alone.value) - Number(live.totalValue)) < 0.01, 'The same sum as now');
  console.log('PASS DEP-VALUE-SAME-CURRENCY');
  await deposits.remove(owner, rubles.id);
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
  assert.match(migrated.stdout, new RegExp(`Migrations applied: ${MIGRATIONS}`));
  const db = source();
  try {
    await db.initialize();
    const [owner, other, third] = await db.query(`INSERT INTO users(email,password,"emailVerified") VALUES
      ('deposit-owner@example.invalid','synthetic-not-a-hash',true),
      ('deposit-other@example.invalid','synthetic-not-a-hash',true),
      ('deposit-third@example.invalid','synthetic-not-a-hash',true) RETURNING id`);
    const { DepositsService } = require(modulePath);
    const plain = new DepositsService(db);
    // Every call carries a fresh request id unless a stage names one to test a replay.
    const service = Object.assign(Object.create(plain), {
      create: (owner, body) => plain.create(owner, { requestId: randomUUID(), ...body }),
      addMovement: (owner, id, body) =>
        plain.addMovement(owner, id, { requestId: randomUUID(), ...body }),
      addCheck: (owner, id, body) =>
        plain.addCheck(owner, id, { requestId: randomUUID(), ...body }),
    });
    const ids = await accrual(db, service, owner.id);
    await movements(db, service, owner.id, other.id, ids);
    await checks(db, service, owner.id, ids);
    await owners(db, service, owner.id, other.id, ids);
    await wholePortfolio(db, third.id);
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
