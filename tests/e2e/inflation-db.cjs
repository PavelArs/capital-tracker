'use strict';
// inflation (INFL-OFFICIAL, INFL-MANUAL, INFL-PERSONAL, INFL-INDEX) against fresh synthetic
// PostgreSQL: the published monthly price changes are collected once and kept idempotent, one
// provider failing keeps the other's months, the owner's own months and annual rate lie over
// them for that owner only, and a factor between two days is read from what is stored. The
// providers are replaced by a stub: nothing leaves the machine. All data is synthetic.
const assert = require('node:assert/strict');
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
const database = 'capital_tracker_inflation_e2e';
const modulePath = '/app/backend/dist/inflation/inflation.service.js';
const MIGRATIONS = 76;
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
const refused = async (db, sql, params) => {
  const client = await db.createQueryRunner();
  try {
    await assert.rejects(() => client.query(sql, params), /violates (check|foreign key|not-null)/);
  } finally {
    await client.release();
  }
};

// A stub of the two providers: each answer is a list of [month, percent] or a failure.
function stubClient(answers) {
  return {
    calls: [],
    async fetch(provider) {
      this.calls.push(provider);
      const answer = answers[provider];
      if (answer.fail) return { ok: false, reason: answer.fail, detail: answer.detail };
      return {
        ok: true,
        changes: answer.map(([month, percent]) => ({ month, percent })),
      };
    },
  };
}
const flat = (start, count, percent) =>
  Array.from({ length: count }, (_, index) => {
    const month = start + index;
    return [`${2024 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`, percent];
  });

async function collecting(db, InflationService) {
  stage = 'synthetic collection: USD one percent a month from 2025-01, EUR half a percent, RUB 0.8';
  const clock = new Date('2026-03-20T10:00:00.000Z');
  const answers = {
    bls: flat(12, 14, '1.00000000'), // 2025-01 .. 2026-02
    eurostat: flat(12, 14, '0.50000000'),
    cbr: flat(12, 14, '0.80000000'),
  };
  const client = stubClient(answers);
  const service = new InflationService(db, new ConfigService({ PRICE_COLLECTION_ENABLED: 'true' }), client);
  assert.deepEqual(await service.tick(clock), { outcome: 'collected', stored: 42 });
  assert.deepEqual(client.calls, ['bls', 'eurostat', 'cbr']);
  assert.equal((await db.query('SELECT count(*)::int n FROM inflation_months'))[0].n, 42);
  const [state] = await db.query(`SELECT * FROM sync_sources WHERE key = 'fx:inflation'`);
  assert.equal(state.state, 'synced');
  assert.equal(state.nextRunAt.toISOString(), '2026-03-20T22:00:00.000Z', 'Twelve hours later');
  assert.deepEqual(await service.tick(new Date('2026-03-20T21:59:00.000Z')), { outcome: 'not_due' });
  assert.equal(client.calls.length, 3, 'Nothing asked before the next run');
  console.log('PASS INFL-COLLECT');

  stage = 'synthetic rerun: unchanged months store nothing, a revised month replaces its row';
  answers.bls = flat(12, 14, '1.00000000').map(([month, percent]) =>
    month === '2026-02' ? [month, '1.20000000'] : [month, percent],
  );
  assert.deepEqual(await service.tick(new Date('2026-03-21T00:00:00.000Z')), {
    outcome: 'collected',
    stored: 1,
  });
  const [revised] = await db.query(
    `SELECT "changePercent"::text c FROM inflation_months WHERE currency='USD' AND month='2026-02-01'`,
  );
  assert.equal(revised.c, '1.20000000');
  console.log('PASS INFL-IDEMPOTENT');

  stage = 'synthetic partial failure: Eurostat does not answer, the US months are kept';
  answers.eurostat = { fail: 'unavailable' };
  answers.bls = flat(12, 15, '1.00000000'); // adds 2026-03
  const late = new Date('2026-03-21T12:00:00.000Z');
  assert.deepEqual(await service.tick(late), { outcome: 'collected', stored: 2 });
  const [delayed] = await db.query(`SELECT * FROM sync_sources WHERE key = 'fx:inflation'`);
  assert.equal(delayed.state, 'delayed');
  assert.equal(delayed.errorCode, 'unavailable');
  assert.match(delayed.errorMessage, /did not answer for EUR/);
  assert.equal(delayed.nextRunAt.toISOString(), '2026-03-21T13:00:00.000Z', 'Asked again in an hour');
  assert.equal((await db.query(`SELECT count(*)::int n FROM inflation_months WHERE currency='EUR'`))[0].n, 14);

  stage = 'synthetic total failure: no readable answer from any provider';
  answers.bls = { fail: 'invalid_response', detail: 'no series header: "<html>"' };
  answers.eurostat = { fail: 'invalid_response', detail: 'not JSON' };
  answers.cbr = { fail: 'unavailable' };
  await service.tick(new Date('2026-03-21T14:00:00.000Z'));
  const [failed] = await db.query(`SELECT * FROM sync_sources WHERE key = 'fx:inflation'`);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.errorCode, 'invalid_response');
  assert.match(failed.errorMessage, /unreadable answer for USD, EUR, RUB \(no series header/);
  assert.equal(
    new Date(failed.lastSuccessAt).toISOString(),
    '2026-03-21T00:00:00.000Z',
    'The last run that read both providers is the last success',
  );
  console.log('PASS INFL-FAILURE');

  stage = 'synthetic switch off: collection stays disabled without the owner switch';
  const off = new InflationService(db, new ConfigService({}), client);
  assert.deepEqual(await off.tick(new Date('2026-04-30T00:00:00.000Z')), { outcome: 'disabled' });
  console.log('PASS INFL-SWITCH');
}

async function reading(db, InflationService, owner, other) {
  const service = new InflationService(db, new ConfigService({}), stubClient({}));
  stage = 'synthetic overview: USD to 2026-03, EUR to 2026-02, RUB from the Bank of Russia';
  const now = new Date('2026-03-22T00:00:00.000Z');
  const view = await service.overview(owner, now);
  const byCurrency = Object.fromEntries(view.currencies.map((item) => [item.currency, item]));
  assert.equal(byCurrency.USD.officialSource, 'OECD (US CPI-U)');
  assert.equal(byCurrency.USD.officialLastMonth, '2026-03');
  assert.equal(byCurrency.EUR.officialLastMonth, '2026-02');
  assert.equal(byCurrency.RUB.officialSource, 'Bank of Russia (annual inflation)');
  assert.equal(byCurrency.RUB.lastMonth, '2026-02');
  assert.match(byCurrency.USD.trailingYearPercent, /^12\.6825/, '1.01 ** 12 - 1');
  assert.equal(byCurrency.USD.trailingYearEstimated, false, 'Twelve published months');
  assert.equal(view.sync.state, 'failed');
  console.log('PASS INFL-OVERVIEW');

  stage = 'synthetic factor: a year of 1 percent a month';
  const official = await service.factor(owner, {
    currency: 'USD',
    from: '2025-02-15',
    to: '2026-02-15',
  });
  assert.equal(official.factor, '1.1268250301', '1.01 ** 12');
  assert.equal(official.estimated, false);
  const beyond = await service.factor(owner, { currency: 'USD', from: '2026-03-15', to: '2026-04-15' });
  assert.equal(beyond.estimated, true, 'April is not published yet');
  const unknown = await service.factor(owner, { currency: 'RUB', from: '2024-06-01', to: '2025-12-31' });
  assert.deepEqual([unknown.factor, unknown.estimated], [null, null], 'Before the first month, no factor');
  const before = await service.factor(owner, { currency: 'USD', from: '2024-06-01', to: '2025-06-01' });
  assert.equal(before.factor, null, 'Before the first published month');
  await rejected(
    () => service.factor(owner, { currency: 'USD', from: '2026-01-01', to: '2025-01-01' }),
    400,
  );
  console.log('PASS INFL-FACTOR');

  stage = 'synthetic manual months: RUB months typed over the published ones, USD month replaced, other owner unaffected';
  assert.deepEqual(await service.setMonth(owner, 'RUB', '2025-12', { changePercent: '0.5' }), {
    currency: 'RUB',
    month: '2025-12',
    changePercent: '0.5',
  });
  await service.setMonth(owner, 'RUB', '2026-01', { changePercent: '1.5' });
  await service.setMonth(owner, 'RUB', '2026-02', { changePercent: '0.25' });
  const rub = await service.factor(owner, { currency: 'RUB', from: '2025-12-15', to: '2026-02-15' });
  assert.equal(rub.factor, '1.0175375000', '1.015 * 1.0025');
  await service.setMonth(owner, 'USD', '2026-02', { changePercent: '2' });
  const usd = await service.factor(owner, { currency: 'USD', from: '2026-01-15', to: '2026-02-15' });
  assert.equal(usd.factor, '1.0200000000', 'The typed month replaces the published one');
  const typed = (await service.overview(owner, now)).currencies.find((item) => item.currency === 'USD');
  assert.match(typed.officialTrailingYearPercent, /^12\.6825/, 'The published months alone, as before');
  assert.notEqual(typed.trailingYearPercent, typed.officialTrailingYearPercent, 'The typed month is in the effective year');
  const others = await service.factor(other, { currency: 'USD', from: '2026-01-15', to: '2026-02-15' });
  assert.equal(others.factor, '1.0100000000', 'The other owner still reads the published month');
  assert.equal(
    (await service.factor(other, { currency: 'RUB', from: '2025-12-15', to: '2026-02-15' })).factor,
    '1.0160640000',
    'The other owner reads the published 0.8 percent twice',
  );
  const listed = (await service.overview(owner, now)).currencies.find((item) => item.currency === 'RUB');
  assert.deepEqual(listed.manualMonths.map((item) => item.month), ['2025-12', '2026-01', '2026-02']);
  await service.removeMonth(owner, 'USD', '2026-02');
  assert.equal(
    (await service.factor(owner, { currency: 'USD', from: '2026-01-15', to: '2026-02-15' })).factor,
    '1.0100000000',
    'Removing it brings the published month back',
  );
  await rejected(() => service.removeMonth(owner, 'USD', '2026-02'), 404);
  await rejected(() => service.setMonth(owner, 'USD', '2026-13', { changePercent: '1' }), 400);
  await rejected(() => service.setMonth(owner, 'GBP', '2026-01', { changePercent: '1' }), 400);
  await rejected(() => service.setMonth(owner, 'USD', '2026-01', { changePercent: '-100' }), 400);
  // A month after the current Moscow month (a typo in the year) is refused; nothing is stored.
  const stored = await db.query('SELECT * FROM inflation_manual_months ORDER BY currency, month');
  await rejected(() => service.setMonth(owner, 'USD', '2026-04', { changePercent: '1' }, now), 400);
  await rejected(() => service.setMonth(owner, 'USD', '2206-03', { changePercent: '1' }, now), 400);
  assert.deepEqual(await db.query('SELECT * FROM inflation_manual_months ORDER BY currency, month'), stored);
  console.log('PASS INFL-MANUAL');

  stage = 'synthetic personal rate: 10 percent a year, per owner, removable';
  assert.deepEqual(await service.setPersonalRate(owner, 'RUB', { annualPercent: '10' }), {
    currency: 'RUB',
    annualPercent: '10',
  });
  const personal = await service.factor(owner, {
    currency: 'RUB',
    basis: 'personal',
    from: '2025-01-01',
    to: '2026-01-01',
  });
  assert.equal(personal.factor, '1.1000000000');
  assert.equal(personal.estimated, true);
  const noRate = await service.factor(other, {
    currency: 'RUB',
    basis: 'personal',
    from: '2025-01-01',
    to: '2026-01-01',
  });
  assert.equal(noRate.factor, null, 'The rate belongs to the owner who typed it');
  await service.setPersonalRate(owner, 'RUB', { annualPercent: '12.5' });
  const shown = (await service.overview(owner, now)).currencies.find((item) => item.currency === 'RUB');
  assert.equal(shown.personalRatePercent, '12.5');
  await service.setPersonalRate(owner, 'RUB', { annualPercent: null });
  const gone = (await service.overview(owner, now)).currencies.find((item) => item.currency === 'RUB');
  assert.equal(gone.personalRatePercent, null);
  await rejected(() => service.setPersonalRate(owner, 'RUB', { annualPercent: '-50' }), 400);
  console.log('PASS INFL-PERSONAL');
}

async function constraints(db, owner) {
  stage = 'synthetic constraints: the tables refuse what the service would never write';
  await refused(db, `INSERT INTO inflation_months VALUES ('GBP','2026-01-01','bls',1)`);
  await refused(db, `INSERT INTO inflation_months VALUES ('USD','2026-01-02','bls',1)`);
  await refused(db, `INSERT INTO inflation_months VALUES ('USD','2026-05-01','fred',1)`);
  await refused(db, `INSERT INTO inflation_months VALUES ('USD','2026-05-01','bls',-100)`);
  await refused(
    db,
    `INSERT INTO inflation_manual_months("ownerId",currency,month,"changePercent") VALUES ($1,'USD','2026-05-03',1)`,
    [owner],
  );
  await refused(
    db,
    `INSERT INTO inflation_manual_months("ownerId",currency,month,"changePercent")
     VALUES ('00000000-0000-4000-8000-000000000000','USD','2026-05-01',1)`,
  );
  await refused(
    db,
    `INSERT INTO inflation_personal_rates("ownerId",currency,"annualPercent") VALUES ($1,'USD',1000)`,
    [owner],
  );
  console.log('PASS INFL-CONSTRAINTS');
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
    const [owner, other] = await db.query(`INSERT INTO users(email,password) VALUES
      ('inflation-owner@example.invalid','synthetic-not-a-hash'),
      ('inflation-other@example.invalid','synthetic-not-a-hash') RETURNING id`);
    const { InflationService } = require(modulePath);
    await collecting(db, InflationService);
    await reading(db, InflationService, owner.id, other.id);
    await constraints(db, owner.id);
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
