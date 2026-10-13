'use strict';
// broker-connections (BROKER-CONNECT) against fresh synthetic PostgreSQL: a read-only T-Bank
// token is kept encrypted per broker account, never returned, replaced by a new one and removed
// with the connection. T-Bank itself is a stub; all data is synthetic.
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
const MIGRATIONS = 66;
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
  await service.connect(owner, broker, { token, brokerAccountId: brokerAccount.id });
  assert.equal((await service.read(owner, broker)).connected, true);
  await new AccountingService(db).removeAccount(owner, broker);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM broker_connections WHERE "accountId" = $1', [broker]))[0].n,
    0,
    'The token goes with the account',
  );
  await rejected(() => service.read(owner, broker), 404);
  console.log('PASS BROKER-CONNECT-REMOVE');
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
    const tbank = { accounts: async () => ({ ok: true, value: [brokerAccount] }) };
    const service = new BrokerConnectionsService(db, tbank, box);
    await connection(db, service, owner.id, other.id);
    await removal(db, service, owner.id);
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
