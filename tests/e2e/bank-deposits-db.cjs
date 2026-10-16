'use strict';
// bank-deposits (DEP-ACCRUAL, DEP-CHECK) against fresh synthetic PostgreSQL: a deposit entered
// once earns computed interest, is worth its balance in USD, EUR and RUB at the Bank of Russia
// rate of the day, refuses movements it could not have had, and compares a balance read in the
// bank's app with the computed one. All data is synthetic.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
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
const MIGRATIONS = 69;
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
  payout: 'monthly',
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
  // Quarterly is no longer offered, so a deposit made before that is a stored row: this one is
  // written as one and has to keep reading as it did.
  const created = await service.create(owner, dollars);
  await db.query(`UPDATE bank_deposits SET payout='quarterly' WHERE id=$1`, [created.id]);
  const usd = await service.get(owner, created.id, '2026-10-01');
  assert.equal(usd.payout, 'quarterly', 'A stored quarterly deposit stays readable');
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

async function daily(db, service, owner) {
  stage = 'DEP-DAILY interest posted every day, and quarterly kept only for stored deposits';
  const terms = {
    ...savings,
    name: 'Daily C',
    endDate: null,
    payout: 'daily',
    capitalized: true,
    amount: '100000.00',
  };
  const made = await service.create(owner, terms);
  const read = (await service.list(owner, '2026-07-04')).items.find((item) => item.id === made.id);
  // 12% over 365 days on 100000, 100032.88 and 100065.77: 32.88, 32.89 and 32.90, each posted.
  assert.equal(read.principal, '100098.67');
  assert.equal(read.accrued, '0.00', 'Nothing is waiting between daily postings');
  assert.equal(read.nextPayout.date, '2026-07-05');
  const detail = await service.get(owner, made.id, '2026-07-04');
  assert.deepEqual(
    detail.periods.map((period) => period.interest),
    ['32.88', '32.89', '32.90'],
  );
  const paying = await service.create(owner, { ...terms, name: 'Daily D', capitalized: false });
  const due = (await service.list(owner, '2026-07-04')).items.find((item) => item.id === paying.id);
  assert.equal(due.due, '98.64', 'Three days of 32.88 payable');
  assert.equal(due.principal, '100000.00');
  // New deposits cannot be quarterly; the row of an earlier one is still valid for the database.
  await rejected(() => service.create(owner, { ...terms, payout: 'quarterly' }), 400);
  // The retry of a quarterly deposit made before this release still finds it instead of failing.
  const requestId = randomUUID();
  const old = await service.create(owner, { ...terms, name: 'Daily Q', payout: 'monthly', requestId });
  await db.query(
    `UPDATE bank_deposits SET payout='quarterly',
       "canonicalPayload"=replace("canonicalPayload", '"payout":"monthly"', '"payout":"quarterly"') WHERE id=$1`,
    [old.id],
  );
  const retried = await service.create(owner, {
    ...terms,
    name: 'Daily Q',
    payout: 'quarterly',
    requestId,
  });
  assert.equal(retried.id, old.id, 'A quarterly retry returns the deposit it made');
  await assert.rejects(
    () => db.query(`UPDATE bank_deposits SET payout='hourly' WHERE id=$1`, [made.id]),
    /bank_deposits_payout_check/,
  );
  console.log('PASS DEP-DAILY');
}

async function account(db, service, owner) {
  stage = 'DEP-ACCOUNT a savings or current account: no term, and no rate entered is not a rate';
  const terms = {
    name: 'Current A',
    bank: 'Synthetic Bank',
    currency: 'RUB',
    startDate: '2026-07-01',
    endDate: null,
    payout: 'monthly',
    capitalized: true,
    dayBasis: 'actual-365',
    earlyClose: 'keeps-interest',
    kind: 'account',
    ratePercent: null,
    amount: '100000.00',
  };
  const made = await service.create(owner, terms);
  assert.equal(made.kind, 'account');
  assert.equal(made.ratePercent, null, 'An account entered without a rate shows none, not 0%');
  assert.equal(made.status, 'active', 'An account has no term to end');
  assert.equal(made.atMaturity, null);
  const read = (await service.list(owner, '2026-07-04')).items.find((item) => item.id === made.id);
  assert.equal(read.kind, 'account');
  assert.equal(read.principal, '100000.00');
  assert.equal(read.balance, '100000.00', 'What was put in, no interest is counted');
  // Missing is not zero: with no rate the interest figures are unknown, not 0.00.
  assert.equal(read.interestMissing, true);
  assert.deepEqual(
    [read.accrued, read.due, read.interestEarned, read.nextPayout, read.real.official],
    [null, null, null, null, null],
  );
  const listed = await service.list(owner, '2026-07-04');
  assert.equal(listed.interestMissingCount, 1, 'The list says its total leaves interest out');
  const shown = await service.get(owner, made.id, '2026-07-04');
  assert.deepEqual(shown.periods, [], 'No periods of interest are listed without a rate');
  // The rate the bank pays from a date is added later, and interest is earned from that date.
  await service.addRate(owner, made.id, { effectiveFrom: '2026-08-01', ratePercent: '6' });
  const rated = await service.get(owner, made.id, '2026-09-01');
  assert.equal(rated.ratePercent, '6');
  assert.notEqual(rated.balance, '100000.00', 'Interest from the rate date is added');
  // The days before the first rate stay without one: the interest of that time is still unknown.
  assert.equal(rated.interestMissing, true, 'A rate from a later date leaves the earlier days open');
  assert.notEqual(rated.interestEarned, null, 'The interest from the rate date is stated');
  assert.notEqual(rated.accrued, null);
  assert.equal((await service.list(owner, '2026-09-01')).interestMissingCount, 1);
  // The periods that contain a day before the first rate are not listed, and a check against the
  // bank states no calculated balance and no difference: both would be a guess.
  assert.deepEqual(
    rated.periods.filter((period) => period.from < '2026-08-01'),
    [],
    'No period lists interest for days that had no rate',
  );
  await service.addCheck(owner, made.id, { checkedOn: '2026-08-15', bankBalance: '100400.00' });
  const checked = await service.get(owner, made.id, '2026-09-01');
  assert.deepEqual(
    [checked.lastCheck.calculated, checked.lastCheck.difference, checked.checks[0].calculated],
    [null, null, null],
    'A check against an account with missing interest is not compared',
  );
  // A payout whose period starts before the first rate is not forecast, and no real gain is stated.
  const partial = await service.create(owner, { ...terms, name: 'Current P' });
  await service.addRate(owner, partial.id, { effectiveFrom: '2026-07-15', ratePercent: '6' });
  const midway = await service.get(owner, partial.id, '2026-07-20');
  assert.equal(midway.interestMissing, true);
  assert.equal(midway.nextPayout, null, 'The next payout would count the days without a rate as 0%');
  assert.ok(
    [midway.real.official, midway.real.personal].every((real) => real === null || real.gain === null),
    'No real gain while interest is missing',
  );
  // Before that date no rate is in force: the later rate is not shown as the rate of an earlier day.
  const unrated = await service.get(owner, made.id, '2026-07-15');
  assert.equal(unrated.ratePercent, null, 'No rate is in force before the first one begins');
  assert.equal(unrated.balance, '100000.00');
  assert.equal(rated.status, 'active');
  const withdrawn = await service.addMovement(owner, made.id, {
    date: '2026-09-02',
    kind: 'withdrawal',
    amount: '10000.00',
  });
  assert.equal(withdrawn.status, 'active', 'Taking money out does not close an account');
  // Emptying an account leaves it open: it takes the next top-up, and a term deposit does not.
  const empty = await service.create(owner, { ...terms, name: 'Current Z', amount: '100.00' });
  const zero = await service.addMovement(owner, empty.id, {
    date: '2026-07-10',
    kind: 'withdrawal',
    amount: '100.00',
  });
  assert.equal(zero.status, 'active', 'An emptied account is not closed');
  assert.equal(zero.balance, '0.00');
  const refilled = await service.addMovement(owner, empty.id, {
    date: '2026-07-20',
    kind: 'topup',
    amount: '50.00',
  });
  assert.equal(refilled.status, 'active');
  assert.equal(refilled.balance, '50.00');
  // The first rate of an account may begin on its opening day; a term deposit's opening rate may not
  // be changed that day.
  const opened = await service.create(owner, { ...terms, name: 'Current S' });
  await service.addRate(owner, opened.id, { effectiveFrom: '2026-07-01', ratePercent: '6' });
  assert.equal((await service.get(owner, opened.id, '2026-07-02')).ratePercent, '6');
  const covered = await service.get(owner, opened.id, '2026-07-02');
  assert.equal(covered.interestMissing, false, 'A rate from the opening day covers the whole time');
  assert.notEqual(covered.nextPayout, null, 'A fully covered period is forecast');
  assert.notEqual(covered.interestEarned, null);
  await rejected(
    () => service.addRate(owner, opened.id, { effectiveFrom: '2026-07-01', ratePercent: '7' }),
    422,
  );
  const fixed = await service.create(owner, { ...savings, name: 'Term D' });
  await rejected(
    () => service.addRate(owner, fixed.id, { effectiveFrom: '2026-07-01', ratePercent: '5' }),
    422,
  );
  // An account has no term: no end date, and no payout that waits for one.
  await rejected(() => service.create(owner, { ...terms, endDate: '2027-07-01' }), 400);
  await rejected(() => service.create(owner, { ...terms, payout: 'at-end' }), 400);
  await rejected(() => service.create(owner, { ...terms, payout: 'quarterly' }), 400);
  // A term deposit still needs its rate.
  await rejected(() => service.create(owner, { ...savings, name: 'No rate', ratePercent: null }), 400);
  // The database refuses an account that still has a term, whatever the application sends.
  const term = await service.create(owner, { ...savings, name: 'Term C' });
  await assert.rejects(
    () => db.query(`UPDATE bank_deposits SET kind='account' WHERE id=$1`, [term.id]),
    /bank_deposits_account_has_no_term/,
  );
  console.log('PASS DEP-ACCOUNT');
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

async function backfill() {
  stage = 'DEP-HISTORY deposits entered before the event log are listed from when they were entered';
  const name = 'capital_tracker_bank_deposits_backfill_e2e';
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
      (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount,
      0,
      'Never reuse or drop an existing database',
    );
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(
    new ConfigService({ ...settings, DB_NAME: name }),
  ).createTypeOrmOptions();
  const prior = new DataSource({
    ...options,
    extra: { ...options.extra, max: 1 },
    // Only building a newly created synthetic schema as it was before the event log.
    migrations: readdirSync('/app/backend/dist/migrations')
      .filter((file) => file.endsWith('.js') && file < '1797100000000')
      .map((file) => `/app/backend/dist/migrations/${file}`),
  });
  try {
    await prior.initialize();
    await prior.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await prior.runMigrations({ transaction: 'all' });
    const [{ id: owner }] = await prior.query(`INSERT INTO users(email,password)
      VALUES('deposit-backfill@example.invalid','synthetic-not-a-hash') RETURNING id`);
    const deposit = randomUUID();
    await prior.query(
      `INSERT INTO bank_deposits (id,"ownerId","requestId","canonicalPayload",name,bank,currency,
         "startDate","endDate",payout,capitalized,"dayBasis","earlyClose","createdAt")
       VALUES ($1,$2,$3,'{}','Old deposit','Synthetic Bank','RUB','2026-01-01','2027-01-01',
         'monthly',false,'actual-365','forfeits-interest','2026-01-02T08:00:00Z')`,
      [deposit, owner, randomUUID()],
    );
    await prior.query(
      `INSERT INTO bank_deposit_rates ("ownerId","depositId","effectiveFrom","ratePercent")
       VALUES ($1,$2,'2026-01-01',11.5), ($1,$2,'2026-04-01',9)`,
      [owner, deposit],
    );
    for (const [position, date, kind, amount, comment, created] of [
      [1, '2026-01-01', 'topup', '5000.00', null, '2026-01-02T08:00:00Z'],
      [2, '2026-03-01', 'topup', '700.10', 'Later top-up', '2026-03-02T09:00:00Z'],
      [3, '2026-02-01', 'withdrawal', '100.00', null, '2026-03-03T09:00:00Z'],
    ])
      await prior.query(
        `INSERT INTO bank_deposit_movements (id,"ownerId","depositId","requestId","canonicalPayload",
           "occurredOn",kind,amount,comment,"createdAt","position")
         VALUES ($1,$2,$3,$4,'{}',$5,$6,$7,$8,$9,$10)`,
        [randomUUID(), owner, deposit, randomUUID(), date, kind, amount, comment, created, position],
      );
    const migrated = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
      cwd: '/app/backend',
      env: { ...settings, ...process.env, DB_NAME: name },
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(migrated.status, 0, 'Actual guarded migration CLI');
    assert.match(migrated.stdout, /Migrations applied: 6/);
    const events = await prior.query(
      `SELECT version, kind, "depositKind", name, bank, currency, to_char("occurredOn",'YYYY-MM-DD') AS day,
          to_char("endDate",'YYYY-MM-DD') AS "endDate", payout, "movementKind", amount::text AS amount,
          "ratePercent"::text AS rate, comment, to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') AS at
        FROM bank_deposit_events WHERE "depositId"=$1 ORDER BY version`,
      [deposit],
    );
    assert.deepEqual(events, [
      {
        version: 1, kind: 'opened', depositKind: 'term-deposit', name: 'Old deposit', bank: 'Synthetic Bank', currency: 'RUB',
        day: '2026-01-01', endDate: '2027-01-01', payout: 'monthly', movementKind: null,
        amount: '5000.00', rate: '11.5000', comment: null, at: '2026-01-02T08:00',
      },
      {
        version: 2, kind: 'movement-added', depositKind: 'term-deposit', name: 'Old deposit', bank: 'Synthetic Bank', currency: 'RUB',
        day: '2026-03-01', endDate: null, payout: null, movementKind: 'topup',
        amount: '700.10', rate: null, comment: 'Later top-up', at: '2026-03-02T09:00',
      },
      {
        version: 3, kind: 'movement-added', depositKind: 'term-deposit', name: 'Old deposit', bank: 'Synthetic Bank', currency: 'RUB',
        day: '2026-02-01', endDate: null, payout: null, movementKind: 'withdrawal',
        amount: '100.00', rate: null, comment: null, at: '2026-03-03T09:00',
      },
    ]);
    assert.equal(
      (await prior.query('SELECT count(*)::int AS n FROM bank_deposit_events'))[0].n,
      3,
      'Nothing for the later rate change: it carries no entry time',
    );
    console.log('PASS DEP-HISTORY-BACKFILL');
  } finally {
    if (prior.isInitialized) await prior.destroy();
  }
}

async function history(db, service, owner, other) {
  stage = 'DEP-HISTORY every action on a deposit is a History event, a deletion included';
  const { AuditHistoryService } = require('/app/backend/dist/accounting/audit-history.service.js');
  const audit = new AuditHistoryService(db);
  const plain = Object.getPrototypeOf(service);
  const events = async (who) =>
    (await audit.read(who, { entity: 'deposit', limit: '200' })).events.reverse();
  const action = (event) => (event.fields[0].after ?? event.fields[0].before).value;
  assert.deepEqual(await events(owner), [], 'Nothing before the owner has a deposit');

  const made = await service.create(owner, { ...savings, name: 'History A', endDate: null });
  const topup = await service.addMovement(owner, made.id, {
    date: '2026-08-01',
    kind: 'topup',
    amount: '500.25',
    comment: 'Salary',
  });
  // Refused and replayed requests change nothing, so they leave no event.
  await rejected(
    () => service.addMovement(owner, made.id, { date: '2026-06-30', kind: 'topup', amount: '1' }),
    422,
  );
  const retry = { requestId: randomUUID(), date: '2026-08-02', kind: 'topup', amount: '1.00' };
  await plain.addMovement(owner, made.id, retry);
  await plain.addMovement(owner, made.id, retry);
  await service.addRate(owner, made.id, { effectiveFrom: '2026-09-01', ratePercent: '10' });
  await service.addCheck(owner, made.id, { checkedOn: '2026-09-02', bankBalance: '101234.56' });
  const gone = topup.movements.find((movement) => movement.amount === '500.25');
  await service.removeMovement(owner, made.id, gone.id);
  await service.remove(owner, made.id);

  const listed = await events(owner);
  assert.deepEqual(listed.map(action), [
    'Deposit opened',
    'Top-up added',
    'Top-up added',
    'Rate changed',
    'Bank balance checked',
    'Top-up removed',
    'Deposit deleted',
  ]);
  assert.deepEqual(
    listed.map((event) => [event.version, event.change]),
    [
      [1, 'created'],
      [2, 'changed'],
      [3, 'changed'],
      [4, 'changed'],
      [5, 'changed'],
      [6, 'changed'],
      [7, 'deleted'],
    ],
  );
  assert.ok(listed.every((event) => event.title === 'History A' && event.entityId === made.id));
  assert.ok(listed.every((event) => event.account === 'Synthetic Bank' && event.actor === 'owner'));
  const fact = (event, label) => (event.fields.find((field) => field.label === label) ?? {}).after;
  assert.deepEqual(fact(listed[0], 'Amount'), { kind: 'quantity', value: '100000', unit: 'RUB' });
  assert.deepEqual(fact(listed[0], 'Rate'), { kind: 'text', value: '12% a year', unit: null });
  assert.deepEqual(fact(listed[1], 'Amount'), { kind: 'quantity', value: '500.25', unit: 'RUB' });
  assert.equal(fact(listed[1], 'Date').value, '2026-08-01');
  assert.equal(fact(listed[1], 'Comment').value, 'Salary');
  assert.equal(fact(listed[3], 'Rate').value, '10% a year');
  assert.deepEqual(fact(listed[4], 'Bank balance'), { kind: 'quantity', value: '101234.56', unit: 'RUB' });
  assert.deepEqual(listed[6].fields.map((field) => field.after), [null], 'A deletion names only itself');
  assert.equal(await db.query('SELECT 1 FROM bank_deposits WHERE id=$1', [made.id]).then((r) => r.length), 0);
  const filtered = await audit.read(owner, { entity: 'deposit', change: 'deleted' });
  assert.equal(filtered.events.length, 1);
  const created = await audit.read(owner, { change: 'created' });
  assert.ok(created.events.some((event) => event.entity === 'deposit'), 'In the unfiltered list');
  assert.deepEqual(await events(other), [], 'An owner with no deposit sees none of it');

  // An account is still an account in History after it is deleted: the row that said so is gone.
  const account = await service.create(owner, {
    ...savings,
    kind: 'account',
    name: 'History B',
    endDate: null,
    ratePercent: null,
  });
  await service.remove(owner, account.id);
  const accountEvents = (await events(owner)).filter((event) => event.entityId === account.id);
  assert.deepEqual(accountEvents.map(action), ['Account opened', 'Account deleted']);
  assert.deepEqual(
    (
      await db.query(
        'SELECT "depositKind" FROM bank_deposit_events WHERE "depositId"=$1 ORDER BY version',
        [account.id],
      )
    ).map((row) => row.depositKind),
    ['account', 'account'],
  );
  assert.deepEqual(
    (
      await db.query('SELECT DISTINCT "depositKind" FROM bank_deposit_events WHERE "depositId"=$1', [
        made.id,
      ])
    ).map((row) => row.depositKind),
    ['term-deposit'],
  );
  console.log('PASS DEP-HISTORY');
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

async function afterInflation(db, service, owner) {
  stage = 'INFL-DEPOSIT a 12% ruble deposit after inflation: unknown without data, then flat and rising prices';
  const made = await service.create(owner, { ...savings, name: 'Inflated', endDate: null });
  const at = '2026-10-01';
  const read = () => service.get(owner, made.id, at);
  const none = await read();
  const unknown = { inflationPercent: null, ratePercent: null, gain: null, estimated: false };
  assert.deepEqual(none.real.official, unknown, 'No inflation data stored');
  assert.deepEqual(none.real.personal, { ...unknown, ownRate: false });
  // No price change at all: what the deposit earned is what it earned after inflation.
  await db.query(
    `INSERT INTO inflation_manual_months ("ownerId", currency, month, "changePercent")
     SELECT $1, 'RUB', month::date, 0 FROM generate_series('2025-01-01'::date, '2026-10-01'::date, '1 month') month`,
    [owner],
  );
  try {
    const flat = await read();
    assert.equal(flat.interestEarned, '3024.66', 'Posted on 1 August, 1 September and 1 October');
    assert.deepEqual(flat.real.official, {
      inflationPercent: '0.00',
      ratePercent: '12.00',
      gain: flat.interestEarned,
      estimated: false,
    });
    assert.deepEqual(flat.real.personal, { ...flat.real.official, ownRate: false });
    assert.equal(flat.periods[0].afterInflation.official, flat.periods[0].interest);
    // The owner's own rate of 10% a year makes the money put in worth more today.
    await db.query(
      `INSERT INTO inflation_personal_rates ("ownerId", currency, "annualPercent") VALUES ($1, 'RUB', 10)`,
      [owner],
    );
    const rising = await read();
    assert.deepEqual(rising.real.official, flat.real.official, 'The official reading does not move');
    assert.equal(rising.real.personal.ownRate, true);
    assert.equal(rising.real.personal.inflationPercent, '10.00');
    assert.equal(rising.real.personal.ratePercent, '1.82', '12% against 10% a year');
    assert.ok(
      Number(rising.real.personal.gain) < Number(flat.interestEarned),
      'Inflation takes part of what was earned',
    );
    assert.ok(
      Number(rising.periods[0].afterInflation.personal) < Number(rising.periods[0].interest),
    );
    assert.equal(rising.interestEarned, flat.interestEarned, 'The nominal figures do not change');
    assert.ok((await service.list(owner, at)).items[0].real.personal.gain !== null);
    // The chart runs monthly to the day asked, and on that day the figures are the balance itself.
    const last = rising.chart.at(-1);
    assert.equal(last.date, at);
    assert.equal(last.balance, rising.balance);
    assert.equal(last.real.personal.balance, rising.balance, 'Money of the day asked: no carrying');
    assert.equal(last.real.official.balance, rising.balance);
    const first = rising.chart[0];
    assert.ok(
      Number(first.real.personal.invested) > Number(first.invested),
      'Money put in a year ago is worth more today at 10% inflation',
    );
    assert.equal(first.real.official.invested, first.invested, 'Zero official inflation');
  } finally {
    await db.query('DELETE FROM inflation_manual_months WHERE "ownerId" = $1', [owner]);
    await db.query('DELETE FROM inflation_personal_rates WHERE "ownerId" = $1', [owner]);
  }
  console.log('PASS INFL-DEPOSIT a deposit after inflation: flat prices equal nominal, a 10% rate lowers it');
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
  await db.query(`UPDATE bank_deposits SET payout='quarterly' WHERE id=$1`, [dollarsDeposit.id]);
  const now = new Date('2026-10-04T12:00:00.000Z');
  const valuation = new PortfolioValuationService(db);
  const rub = await valuation.read(owner, { currency: 'RUB' }, now);
  assert.equal(rub.completeness, 'complete');
  assert.equal(rub.unratedDepositCount, 0);
  assert.equal(rub.interestMissingDepositCount, 0, 'Both deposits have a rate');
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

  stage = 'synthetic deposit without a fresh rate leaves the profit unknown';
  // The rates stop on 2026-10-02, so by 2026-10-25 the dollar deposit has none at most 15 days old.
  const stale = await snapshots.history(
    owner,
    { period: 'ALL', currency: 'RUB' },
    new Date('2026-10-25T12:00:00.000Z'),
  );
  assert.equal(stale.complete, false);
  assert.equal(stale.profit, null, 'A deposit that is left out must not read as a loss');
  console.log('PASS DEP-VALUE-UNRATED-PROFIT');

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
  // A configured asset that is not held makes no difference.
  await db.query(
    `INSERT INTO accounting_instruments(id,"ownerId",name,symbol,"requestId","canonicalPayload")
    VALUES($1,$2,'Unheld asset','UNH',$3,$4)`,
    [randomUUID(), owner, randomUUID(), JSON.stringify({ name: 'Unheld asset', symbol: 'UNH' })],
  );
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
    const [owner, other, third, fourth, fifth, sixth, seventh] = await db.query(`INSERT INTO users(email,password) VALUES
      ('deposit-owner@example.invalid','synthetic-not-a-hash'),
      ('deposit-other@example.invalid','synthetic-not-a-hash'),
      ('deposit-third@example.invalid','synthetic-not-a-hash'),
      ('deposit-fourth@example.invalid','synthetic-not-a-hash'),
      ('deposit-fifth@example.invalid','synthetic-not-a-hash'),
      ('deposit-sixth@example.invalid','synthetic-not-a-hash'),
      ('deposit-seventh@example.invalid','synthetic-not-a-hash') RETURNING id`);
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
    await daily(db, service, fourth.id);
    await account(db, service, fourth.id);
    await movements(db, service, owner.id, other.id, ids);
    await checks(db, service, owner.id, ids);
    await owners(db, service, owner.id, other.id, ids);
    await wholePortfolio(db, third.id);
    await history(db, service, fifth.id, sixth.id);
    await afterInflation(db, service, seventh.id);
    await backfill();
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
