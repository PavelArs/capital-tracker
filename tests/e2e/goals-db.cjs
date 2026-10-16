'use strict';
// savings-goals (GOAL-TERMS, GOAL-FORECAST, GOAL-PREVIEW, GOAL-CHART) against fresh synthetic PostgreSQL: a goal entered
// once is kept per owner, a retried request makes it once, and its progress and return cases
// are computed from the whole portfolio on every read. All data is synthetic.
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
const database = 'capital_tracker_goals_e2e';
const modulePath = '/app/backend/dist/goals/goals.service.js';
const MIGRATIONS = 68;
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
const inYears = (years) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
};
const inDays = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const reserve = () => ({
  requestId: randomUUID(),
  name: 'Reserve A',
  currency: 'USD',
  targetAmount: '10000',
  deadline: inYears(3),
  expectedReturnPercent: '8',
  monthlyContribution: '200',
});

async function terms(db, service, owner, other) {
  stage = 'synthetic goal entered once, read back, retried, changed and deleted';
  assert.deepEqual((await service.list(owner)).items, []);
  const body = reserve();
  const made = await service.create(owner, body);
  assert.equal(made.name, 'Reserve A');
  assert.equal(made.targetAmount, '10000.00');
  assert.equal(made.monthlyContribution, '200.00');
  assert.equal(made.expectedReturnPercent, '8');
  assert.equal(made.deadline, body.deadline);
  const retried = await service.create(owner, body);
  assert.equal(retried.id, made.id, 'A retried request makes the goal once');
  assert.equal((await service.list(owner)).items.length, 1);
  await rejected(() => service.create(owner, { ...body, name: 'Another' }), 409);
  await rejected(() => service.create(owner, { ...body, requestId: 'one' }), 400);
  await rejected(() => service.create(owner, { ...reserve(), targetAmount: '0' }), 400);
  await rejected(() => service.create(owner, { ...reserve(), currency: 'KZT' }), 400);
  await rejected(() => service.create(owner, { ...reserve(), deadline: '2020-01-01' }), 422);
  await rejected(() => service.create(owner, { ...reserve(), deadline: inYears(0) }), 422);
  await rejected(() => service.create(owner, { ...reserve(), deadline: '2999-01-01' }), 422);
  // A lost answer is retried after the deadline it named has arrived: the goal, not a refusal.
  const soon = { ...reserve(), deadline: inDays(3) };
  const soonMade = await service.create(owner, soon);
  await db.query('UPDATE savings_goals SET deadline = current_date - 1 WHERE id=$1', [soonMade.id]);
  assert.equal(
    (await service.create(owner, soon)).id,
    soonMade.id,
    'A replay needs no new deadline',
  );
  await service.remove(owner, soonMade.id);
  const open = await service.create(owner, {
    ...reserve(),
    deadline: null,
    monthlyContribution: null,
  });
  assert.equal(open.deadline, null);
  assert.equal(open.monthlyContribution, null);

  const { requestId, ...fields } = reserve();
  const changed = await service.update(owner, made.id, {
    ...fields,
    name: 'Reserve B',
    currency: 'EUR',
    targetAmount: '12000.50',
    expectedReturnPercent: '0',
  });
  assert.equal(changed.id, made.id);
  assert.equal(changed.name, 'Reserve B');
  assert.equal(changed.currency, 'EUR');
  assert.equal(changed.expectedReturnPercent, '0');
  await rejected(() => service.update(owner, made.id, { ...fields, extra: 1 }), 400);
  await rejected(() => service.update(owner, randomUUID(), fields), 404);

  assert.deepEqual((await service.list(other)).items, [], 'Another owner sees no goal');
  await rejected(() => service.get(other, made.id), 404);
  await rejected(() => service.update(other, made.id, fields), 404);
  await rejected(() => service.remove(other, made.id), 404);

  await service.remove(owner, made.id);
  await service.remove(owner, open.id);
  await rejected(() => service.get(owner, made.id), 404);
  await rejected(() => service.remove(owner, made.id), 404);
  assert.deepEqual((await service.list(owner)).items, []);
  console.log('PASS GOAL-TERMS');
}

async function limit(service, owner) {
  stage = 'synthetic owner at the most goals they can keep';
  const ids = [];
  for (let index = 0; index < 20; index += 1)
    ids.push((await service.create(owner, { ...reserve(), name: `Goal ${index}` })).id);
  await rejected(() => service.create(owner, reserve()), 422);
  for (const id of ids) await service.remove(owner, id);
  console.log('PASS GOAL-LIMIT');
}

async function forecast(db, service, owner) {
  stage = 'synthetic dollar deposit of 5,000 at 0% as the whole portfolio';
  const { DepositsService } = require('/app/backend/dist/deposits/deposits.service.js');
  await new DepositsService(db).create(owner, {
    requestId: randomUUID(),
    name: 'Cash A',
    bank: 'Synthetic Bank',
    currency: 'USD',
    startDate: '2026-07-01',
    endDate: null,
    payout: 'monthly',
    capitalized: false,
    dayBasis: 'actual-365',
    earlyClose: 'keeps-interest',
    ratePercent: '0',
    amount: '5000',
  });
  const goal = await service.create(owner, reserve());
  assert.deepEqual(goal.progress, {
    current: '5000.00',
    complete: true,
    percent: '50.00',
    remaining: '5000.00',
    stalePrices: 0,
  });
  assert.equal(goal.status, 'on-track', '5,000 and 200 a month for three years pass 10,000');
  assert.deepEqual(
    goal.scenarios.map((scenario) => [scenario.key, scenario.returnPercent]),
    [
      ['pessimistic', '4'],
      ['base', '8'],
      ['optimistic', '12'],
    ],
  );
  const [low, base, high] = goal.scenarios;
  assert.ok(Number(low.projectedAtDeadline) < Number(base.projectedAtDeadline));
  assert.ok(Number(base.projectedAtDeadline) < Number(high.projectedAtDeadline));
  assert.ok(Number(low.requiredMonthly) > Number(base.requiredMonthly));
  assert.ok(Number(low.monthsToTarget) > Number(base.monthsToTarget));
  assert.ok(Number(base.gap) <= 0, 'A surplus is a negative gap');
  console.log('PASS GOAL-FORECAST');

  stage = 'synthetic goal previewed from its terms before saving';
  const { requestId: unused, name, ...terms } = reserve();
  assert.ok(unused && name);
  const preview = await service.preview(owner, { ...terms, deadline: goal.deadline });
  assert.equal(preview.id, undefined);
  assert.deepEqual(preview.progress, goal.progress);
  assert.equal(preview.status, goal.status);
  assert.deepEqual(preview.scenarios, goal.scenarios, 'The same terms give the same plan');
  assert.equal(
    (await service.preview(owner, { ...terms, deadline: '', monthlyContribution: '' })).status,
    'open',
  );
  await rejected(() => service.preview(owner, { ...terms, deadline: '2020-01-01' }), 422);
  await rejected(() => service.preview(owner, { ...terms, name: 'Reserve A' }), 400);
  assert.equal((await service.list(owner)).items.length, 1, 'A preview stores nothing');
  const [{ refreshed }] = await db.query(
    'SELECT count(*)::int AS refreshed FROM portfolio_snapshot_state WHERE "ownerId"=$1',
    [owner],
  );
  assert.equal(refreshed, 0, 'Goals read the portfolio now without rebuilding its history');
  console.log('PASS GOAL-PREVIEW');

  stage = 'synthetic goal charted month by month';
  const chart = await service.forecast(owner, goal.id);
  assert.equal(chart.currency, 'USD');
  assert.equal(chart.complete, true);
  assert.deepEqual(
    chart.points[0],
    { on: chart.asOf, pessimistic: '5000.00', base: '5000.00', optimistic: '5000.00' },
    'The chart starts at the portfolio now',
  );
  assert.deepEqual(
    goal.scenarios.map((scenario) => chart.points.at(-1)[scenario.key]),
    goal.scenarios.map((scenario) => scenario.projectedAtDeadline),
    'The chart ends on the forecast the goal shows for its deadline',
  );
  assert.equal(chart.points.at(-1).on, goal.deadline);
  await rejected(() => service.forecast(owner, randomUUID()), 404);
  await rejected(() => service.forecast(randomUUID(), goal.id), 404); // another owner
  console.log('PASS GOAL-CHART');

  stage = 'synthetic goal in a currency where the dollar deposit has no rate';
  const euro = await service.create(owner, { ...reserve(), currency: 'EUR' });
  assert.equal(
    euro.progress.complete,
    false,
    'The deposit is left out, so the value is incomplete',
  );
  assert.equal(euro.status, 'unknown', 'An incomplete value never says behind');
  const listed = await service.list(owner);
  assert.equal(listed.items.length, 2);
  assert.deepEqual(
    listed.items.map((item) => item.id),
    [goal.id, euro.id],
    'Goals are listed in the order they were made',
  );

  stage = 'synthetic goal already reached';
  const reached = await service.update(owner, goal.id, {
    ...(({ requestId, ...rest }) => rest)(reserve()),
    targetAmount: '4000',
  });
  assert.equal(reached.status, 'reached');
  assert.equal(reached.progress.percent, '125.00', 'goals-03: the real share, not capped at 100');
  assert.equal(reached.scenarios[1].monthsToTarget, 0);
  console.log('PASS GOAL-REACHED');

  stage = 'goals-28 synthetic goal on its deadline day, a Moscow day';
  const moscowToday = "(now() AT TIME ZONE 'Europe/Moscow')::date";
  const due = await service.create(owner, { ...reserve(), targetAmount: '20000' });
  await db.query(`UPDATE savings_goals SET deadline = ${moscowToday} WHERE id=$1`, [due.id]);
  const onTheDay = await service.get(owner, due.id);
  assert.equal(onTheDay.deadline, onTheDay.asOf, 'The deadline is the Moscow day of the read');
  assert.equal(onTheDay.status, 'behind', 'The deadline day itself is not overdue');
  assert.equal(onTheDay.scenarios[1].projectedAtDeadline, '5000.00');
  const { requestId: dueRequest, ...dueFields } = reserve();
  assert.ok(dueRequest);
  const renamed = await service.update(owner, due.id, {
    ...dueFields,
    targetAmount: '20000',
    name: 'Due today',
    deadline: onTheDay.deadline,
  });
  assert.equal(renamed.name, 'Due today', 'An edit that keeps the date is saved on its day');
  const { name: dueName, ...dueTerms } = dueFields;
  assert.ok(dueName);
  assert.equal(
    (await service.preview(owner, { ...dueTerms, deadline: onTheDay.deadline, goalId: due.id }))
      .status,
    'behind',
    'The edit dialog previews a kept date',
  );
  await rejected(() => service.preview(owner, { ...dueTerms, deadline: onTheDay.deadline }), 422);
  await db.query(`UPDATE savings_goals SET deadline = ${moscowToday} + 1 WHERE id=$1`, [due.id]);
  await rejected(
    () => service.update(owner, due.id, { ...dueFields, deadline: onTheDay.deadline }),
    422,
  );
  await db.query(`UPDATE savings_goals SET deadline = ${moscowToday} - 1 WHERE id=$1`, [due.id]);
  assert.equal((await service.get(owner, due.id)).status, 'overdue', 'Overdue from the next day');
  await service.remove(owner, due.id);
  console.log('PASS GOAL-DUE-DAY');
}

async function stale(db, service, owner) {
  stage = 'goals-35 synthetic bitcoin held at a stored price older than 2 hours';
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  const accounting = make('accounting.service', 'AccountingService');
  const trades = make('trade.service', 'TradeService');
  const btc = (
    await accounting.createInstrument(owner, {
      requestId: randomUUID(),
      name: 'Bitcoin',
      symbol: 'BTC',
      assetType: 'crypto',
    })
  ).value.id;
  const account = (await accounting.createAccount(owner, { requestId: randomUUID(), name: 'Cold' }))
    .value.id;
  const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
  await trades.initialize(owner, account, {
    requestId: randomUUID(),
    coverageFrom: hoursAgo(48),
    assertEmpty: true,
  });
  await trades.create(owner, account, {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    instrumentId: btc,
    side: 'buy',
    occurredAt: hoursAgo(24),
    orderWithinTimestamp: 0,
    quantity: '1',
    grossUsd: '50000',
    feeUsd: '0',
  });
  await db.query(
    `INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
      VALUES ('BTC','USD','kraken',$1,60000,'hourly-close')`,
    [hoursAgo(3)],
  );
  const goal = await service.create(owner, { ...reserve(), targetAmount: '100000' });
  assert.deepEqual(goal.progress, {
    current: '60000.00',
    complete: true,
    percent: '60.00',
    remaining: '40000.00',
    stalePrices: 1,
  });
  await db.query(
    `INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
      VALUES ('BTC','USD','kraken',$1,61000,'hourly-close')`,
    [hoursAgo(0.25)],
  );
  const fresh = await service.get(owner, goal.id);
  assert.equal(fresh.progress.current, '61000.00');
  assert.equal(fresh.progress.stalePrices, 0, 'A price from the last 2 hours is not old');
  console.log('PASS GOAL-STALE-PRICES');
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
    const [owner, other, third, fourth, fifth] = await db.query(`INSERT INTO users(email,password) VALUES
      ('goal-owner@example.invalid','synthetic-not-a-hash'),
      ('goal-other@example.invalid','synthetic-not-a-hash'),
      ('goal-third@example.invalid','synthetic-not-a-hash'),
      ('goal-fourth@example.invalid','synthetic-not-a-hash'),
      ('goal-fifth@example.invalid','synthetic-not-a-hash') RETURNING id`);
    const { GoalsService } = require(modulePath);
    const {
      PortfolioSnapshotsService,
    } = require('/app/backend/dist/portfolio-snapshots/portfolio-snapshots.service.js');
    const service = new GoalsService(db, new PortfolioSnapshotsService(db, new ConfigService({})));
    await terms(db, service, owner.id, other.id);
    await limit(service, third.id);
    await forecast(db, service, fourth.id);
    await stale(db, service, fifth.id);
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
