'use strict';
// Only fresh synthetic PostgreSQL; production compiled services and actual queries.
// HIST-PRICE-BOUND: a chart reads only the prices its period needs, and each asset's last price
// before the period still values every point of it as if every price had been read.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
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
const database = 'capital_tracker_history_price_bounds_e2e';
const modulePath = '/app/backend/dist/portfolio-snapshots/portfolio-snapshots.service.js';
const now = new Date('2026-10-27T12:30:00.000Z');
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
function services(db) {
  const make = (file, name) => new (require(`/app/backend/dist/accounting/${file}.js`)[name])(db);
  const { PortfolioSnapshotsService } = require(modulePath);
  return {
    accounting: make('accounting.service', 'AccountingService'),
    trades: make('trade.service', 'TradeService'),
    prices: make('manual-price.service', 'ManualPriceService'),
    snapshots: new PortfolioSnapshotsService(db, new ConfigService({})),
  };
}
async function instrument(s, owner, body) {
  return (await s.accounting.createInstrument(owner, { requestId: randomUUID(), ...body })).value
    .id;
}

async function bounds(db, s) {
  stage = 'HIST-PRICE-BOUND synthetic owner, prices only before the period';
  const [{ id: owner }] = await db.query(`INSERT INTO users(email,password)
    VALUES('price-bounds@example.invalid','synthetic-not-a-hash') RETURNING id`);
  const btc = await instrument(s, owner, { name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' });
  const bond = await instrument(s, owner, {
    name: 'Synthetic bond',
    assetType: 'manual',
    valuationCurrency: 'USD',
  });
  const unpriced = await instrument(s, owner, { name: 'Unpriced coin', assetType: 'manual' });
  // Every market price is older than the 1M period (from 2026-09-27T12:30Z). At its last
  // instant two kinds compete: the hourly close wins over the daily close, as live.
  await db.query(`INSERT INTO price_observations(asset,"quoteCurrency",source,"observedAt",price,kind)
    VALUES ('BTC','USD','kraken','2026-09-01T00:00:00Z',40000,'daily-close'),
      ('BTC','USD','kraken','2026-09-15T00:00:00Z',50000,'daily-close'),
      ('BTC','USD','kraken','2026-09-15T00:00:00Z',51000,'hourly-close')`);
  stage = 'HIST-PRICE-BOUND synthetic account and purchases';
  const id = (await s.accounting.createAccount(owner, { requestId: randomUUID(), name: 'Bounds' }))
    .value.id;
  await s.trades.initialize(owner, id, {
    requestId: randomUUID(),
    coverageFrom: '2026-08-01T00:00:00.000Z',
    assertEmpty: true,
  });
  let revision = 0;
  for (const [instrumentId, quantity] of [
    [btc, '1'],
    [bond, '2'],
    [unpriced, '1'],
  ]) {
    await s.trades.create(owner, id, {
      requestId: randomUUID(),
      expectedJournalRevision: revision++,
      instrumentId,
      side: 'buy',
      occurredAt: '2026-08-02T00:00:00.000Z',
      orderWithinTimestamp: revision - 1,
      quantity,
      grossUsd: '100',
      feeUsd: '0',
    });
  }

  stage = 'HIST-PRICE-BOUND hand and broker prices of the bond';
  // The bond's last broker price before the period shares its instant with a hand value: the
  // hand value wins. An older broker price is never the latest in the period.
  await s.prices.set(owner, bond, {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: '2026-09-10T00:00:00Z',
    priceUsd: '200',
    assertReviewed: true,
  });
  await db.query(
    `INSERT INTO broker_price_observations("ownerId","instrumentId",provider,"observedAt",price,"quoteCurrency")
      VALUES ($1,$2,'tbank','2026-09-05T00:00:00Z',180,'USD'),($1,$2,'tbank','2026-09-10T00:00:00Z',250,'USD')`,
    [owner, bond],
  );

  stage = 'HIST-PRICE-BOUND asset charts keep the last price before the period';
  for (const [asset, value] of [
    [btc, '51000'],
    [bond, '400'],
  ]) {
    for (const period of ['24H', '7D', '1M']) {
      const chart = await s.snapshots.assetHistory(owner, asset, { period, currency: 'USD' }, now);
      const stored = chart.points.slice(0, -1);
      assert.ok(stored.length > 0, `${period} has stored points`);
      for (const point of stored)
        assert.deepEqual([point.value, point.complete], [value, true], `${period} ${point.at}`);
    }
  }

  stage = 'HIST-PRICE-BOUND portfolio history without the unpriced coin';
  // The unpriced coin is left out of every point, so each stored point is valued again.
  const month = await s.snapshots.history(owner, { period: '1M', currency: 'USD' }, now);
  assert.equal(month.excludedAssetCount, 1);
  const points = month.points.slice(0, -1);
  assert.ok(points.length >= 30, 'Daily points of the month');
  for (const point of points) assert.equal(point.value, '51400', point.at);
  console.log(
    'PASS HIST-PRICE-BOUND charts read only their period and keep each last earlier price',
  );
}

async function main() {
  for (const [key, value] of Object.entries(settings))
    assert.equal(process.env[key], value, 'Exact isolated settings required');
  assert.ok(existsSync(modulePath), 'Missing implementation is prerequisite failure, not RED');
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
    await bounds(db, services(db));
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
