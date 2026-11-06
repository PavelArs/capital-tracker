'use strict';
// PROP-DETAILS against fresh synthetic PostgreSQL: the rent and the note an owner keeps with a
// hand-valued property are stored per owner as entered, repeating a command changes nothing,
// clearing both removes the row, and only the owner's own hand-priced assets accept them. All
// data is synthetic.
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
const database = 'capital_tracker_property_e2e';
const modulePath = '/app/backend/dist/accounting/property-details.service.js';
const MIGRATIONS = 78;
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

async function details(db, service, owner, other) {
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  const accounting = new AccountingService(db);
  const instrument = async (who, body) =>
    (await accounting.createInstrument(who, { requestId: randomUUID(), ...body })).value.id;

  stage = 'PROP-DETAILS-STORE a rent and a note entered once are read back as entered';
  const flat = await instrument(owner, {
    name: 'Synthetic flat',
    assetType: 'manual',
    valuationCurrency: 'RUB',
  });
  assert.deepEqual((await service.list(owner)).items, []);
  const first = await service.set(owner, flat, {
    monthlyRent: '45000.5',
    note: ' Mortgage to 2031 ',
  });
  assert.deepEqual(
    { ...first, updatedAt: typeof first.updatedAt },
    {
      instrumentId: flat,
      monthlyRent: '45000.50',
      currency: 'RUB',
      note: 'Mortgage to 2031',
      updatedAt: 'string',
    },
  );
  assert.deepEqual((await service.list(owner)).items, [first]);
  assert.deepEqual((await service.list(other)).items, [], 'Another owner sees nothing');

  stage = 'PROP-DETAILS-REPEAT sending the same record again changes nothing';
  await new Promise((resolve) => setTimeout(resolve, 20));
  const again = await service.set(owner, flat, {
    monthlyRent: '45000.50',
    note: 'Mortgage to 2031',
  });
  assert.deepEqual(again, first);

  stage = 'PROP-DETAILS-CHANGE a changed record replaces the whole record';
  const changed = await service.set(owner, flat, { monthlyRent: null, note: 'Mortgage to 2031' });
  assert.equal(changed.monthlyRent, null);
  assert.equal(changed.note, 'Mortgage to 2031');
  assert.notEqual(changed.updatedAt, first.updatedAt);
  assert.equal((await service.list(owner)).items.length, 1);

  stage = 'PROP-DETAILS-CLEAR no rent and no note leaves no row';
  const cleared = await service.set(owner, flat, { monthlyRent: null, note: null });
  assert.deepEqual(cleared, {
    instrumentId: flat,
    monthlyRent: null,
    currency: 'RUB',
    note: null,
    updatedAt: null,
  });
  assert.deepEqual((await service.list(owner)).items, []);
  const [{ n }] = await db.query(
    'SELECT count(*)::int AS n FROM property_details WHERE "ownerId"=$1',
    [owner],
  );
  assert.equal(n, 0);

  stage = "PROP-DETAILS-OWNER only the owner's own hand-priced assets accept details";
  const body = { monthlyRent: '10', note: null };
  await rejected(() => service.set(other, flat, body), 404);
  await rejected(() => service.set(owner, randomUUID(), body), 404);
  const coin = await instrument(owner, { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  await rejected(() => service.set(owner, coin, body), 404);
  await rejected(() => service.set(owner, flat, { monthlyRent: '0', note: null }), 400);
  await rejected(() => service.set(owner, flat, { monthlyRent: '10' }), 400);
  await rejected(() => service.set(owner, 'not-a-uuid', body), 400);
  assert.deepEqual((await service.list(owner)).items, []);

  stage = 'PROP-DETAILS-SCHEMA the table refuses what the service would not write';
  const insert = (who, rent, note) =>
    db.query(
      'INSERT INTO property_details ("ownerId","instrumentId","monthlyRent",note) VALUES ($1,$2,$3,$4)',
      [who, flat, rent, note],
    );
  await assert.rejects(() => insert(owner, null, null), /check constraint/);
  await assert.rejects(() => insert(owner, '0', null), /check constraint/);
  await assert.rejects(() => insert(owner, null, '   '), /check constraint/);
  await assert.rejects(() => insert(owner, null, 'x'.repeat(501)), /check constraint/);
  await assert.rejects(() => insert(other, null, 'foreign instrument'), /foreign key/);
  console.log('PASS PROP-DETAILS');
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
      ('property-owner@example.invalid','synthetic-not-a-hash'),
      ('property-other@example.invalid','synthetic-not-a-hash') RETURNING id`);
    const { PropertyDetailsService } = require(modulePath);
    await details(db, new PropertyDetailsService(db), owner.id, other.id);
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}
const watchdog = setTimeout(() => {
  console.error(`FAIL timeout at ${stage}`);
  process.exit(1);
}, 120000);
watchdog.unref();
main()
  .catch((error) => {
    console.error(`FAIL ${stage}: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
