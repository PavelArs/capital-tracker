// Externally mounted acceptance fixture, never included in a release image.
const { Client } = require('pg');
const { execFileSync } = require('node:child_process');
const argon2 = require('argon2');

const expected = {
  DB_HOST: 'postgres',
  DB_PORT: '5432',
  DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e',
  DB_NAME: 'capital_tracker_e2e',
};

async function main() {
  for (const [key, value] of Object.entries(expected)) {
    if (process.env[key] !== value) throw new Error(`Refusing seed: unexpected ${key}`);
  }
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  try {
    const { rows: [identity] } = await client.query('SELECT current_database() AS database, current_user AS username');
    if (identity.database !== expected.DB_NAME || identity.username !== expected.DB_USERNAME) {
      throw new Error('Refusing seed: database identity mismatch');
    }
    const password = await argon2.hash('Synthetic-password-42!', { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    await client.query('BEGIN');
    for (const [id, email, firstName] of [
      ['11111111-1111-4111-8111-111111111111', 'owner@example.invalid', 'Synthetic Owner'],
      ['22222222-2222-4222-8222-222222222222', 'foreign@example.invalid', 'Synthetic Foreign'],
    ]) {
      await client.query(
        `INSERT INTO users (id, email, password, "firstName", "emailVerified")
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password,
         "emailVerified" = true`,
        [id, email, id === '11111111-1111-4111-8111-111111111111' ? 'synthetic-legacy-placeholder' : password, firstName],
      );
    }
    await client.query(
      `INSERT INTO crypto_wallets (id, "userId", type, address, balance, "lastUpdated")
       VALUES ($1, $2, 'bitcoin', $3, 3.5, '2026-09-21T00:00:00Z')
       ON CONFLICT (id) DO NOTHING`,
      ['33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'synthetic-foreign-bitcoin-address'],
    );
    await client.query('COMMIT');
    execFileSync(process.execPath, ['/app/backend/dist/owner-cli.js', 'bootstrap',
      '--email', 'owner@example.invalid', '--existing-user-id', '11111111-1111-4111-8111-111111111111', '--password-stdin'],
      { input: JSON.stringify({ password: 'Synthetic-password-42!', confirmation: 'Synthetic-password-42!' }), stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('Synthetic owner provisioned through production CLI; foreign wallet seeded');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
