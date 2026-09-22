'use strict';

// External fixture only: run inside the release image with /tests mounted read-only.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const { Client } = require('pg');
const argon2 = require('argon2');
const settings = {
  DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e',
};
const fresh = 'capital_tracker_owner_cli_e2e';
const existing = 'capital_tracker_owner_existing_e2e';
const databases = [fresh, existing];
const cli = '/app/backend/dist/owner-cli.js';
const password = '  Exact Unicode Пароль 🔐 42!  ';
const replacement = 'Replacement Unicode пароль 84!';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function config(database) {
  assert.ok([settings.DB_NAME, ...databases].includes(database));
  return { host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database, connectionTimeoutMillis: 5000 };
}

function credentials(value = password) {
  return JSON.stringify({ password: value, confirmation: value });
}

function safeResult(code, stdout, stderr) {
  const output = stdout + stderr;
  for (const secret of [password, replacement, '$argon2id$', 'CLI_SECRET_NOT_FOR_OUTPUT']) {
    assert.ok(!output.includes(secret), 'CLI must not disclose credential material');
  }
  assert.notEqual(code, null, 'CLI must terminate normally');
  return { status: code, output };
}

function invoke(database, args, input = credentials(), overrides = {}) {
  assert.ok(databases.includes(database));
  const env = { ...process.env, ...settings, DB_NAME: database, ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: '/app/backend', env, input, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.error, undefined, 'CLI must not hang');
  assert.equal(result.signal, null);
  return safeResult(result.status, result.stdout, result.stderr);
}

function concurrentBootstrap(email) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'bootstrap', '--email', email, '--password-stdin'], {
      cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: fresh },
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      try { assert.equal(signal, null); resolve(safeResult(code, stdout, stderr)); }
      catch (error) { reject(error); }
    });
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(credentials());
  });
}

async function snapshot(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows;
  const rows = {};
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    rows[tablename] = (await client.query(`SELECT to_jsonb(t)::text AS row FROM ${quoted} t ORDER BY row`)).rows;
  }
  return rows;
}

async function unchangedFailure(client, database, args, input = credentials()) {
  const before = await snapshot(client);
  const result = invoke(database, args, input);
  assert.notEqual(result.status, 0, 'Invalid CLI operation must fail');
  const digest = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  assert.equal(digest(await snapshot(client)), digest(before), 'Rejected CLI operation must not change any row');
}

async function checkHash(client, userId, exactPassword) {
  const { rows: [user] } = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
  const hashParts = user.password.split('$');
  assert.equal(hashParts.length, 6, 'Expected Argon2 PHC structure');
  assert.equal(hashParts[0], '');
  assert.equal(hashParts[1], 'argon2id');
  assert.equal(hashParts[2], 'v=19');
  const parameters = hashParts[3].split(',').map((item) => item.split('='));
  assert.equal(parameters.length, 3, 'Exactly three Argon2 cost parameters');
  assert.ok(parameters.every((pair) => pair.length === 2));
  assert.equal(new Set(parameters.map(([key]) => key)).size, 3, 'No duplicate cost parameters');
  assert.deepEqual(Object.fromEntries(parameters), { m: '65536', t: '3', p: '1' });
  assert.ok(Buffer.from(hashParts[4], 'base64').length >= 16, 'Random salt at least 16 bytes');
  assert.equal(Buffer.from(hashParts[5], 'base64').length, 32);
  assert.equal(await argon2.verify(user.password, exactPassword), true);
  assert.equal(await argon2.verify(user.password, exactPassword + 'x'), false);
  if (exactPassword.trim() !== exactPassword) {
    assert.equal(await argon2.verify(user.password, exactPassword.trim()), false, 'Preserve spaces');
  }
  assert.equal(user.emailVerified, true);
  assert.equal(user.emailVerificationToken, null);
  assert.equal(user.resetPasswordToken, null);
  assert.equal(user.resetPasswordExpires, null);
  return user.password;
}

async function verifyFresh() {
  const results = await Promise.all([
    concurrentBootstrap('fresh-one@example.invalid'),
    concurrentBootstrap('fresh-two@example.invalid'),
  ]);
  assert.equal(results.filter((result) => result.status === 0).length, 1, 'Exactly one concurrent bootstrap succeeds');
  const client = new Client(config(fresh));
  await client.connect();
  try {
    const users = (await client.query('SELECT * FROM users')).rows;
    const bindings = (await client.query('SELECT * FROM owner_auth')).rows;
    assert.equal(users.length, 1);
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].id, 1);
    assert.equal(bindings[0].userId, users[0].id);
    assert.match(bindings[0].credentialVersion, /^[a-f0-9-]{36}$/i);
    const hash = await checkHash(client, users[0].id, password);
    await unchangedFailure(client, fresh, ['bootstrap', '--email', 'repeat@example.invalid', '--password-stdin']);
    await unchangedFailure(client, fresh, ['recover', '--password-stdin']);
    await unchangedFailure(client, fresh, ['recover', '--user-id', otherId, '--password-stdin']);
    const recovery = invoke(fresh, ['recover', '--user-id', users[0].id, '--password-stdin'], credentials(replacement));
    assert.equal(recovery.status, 0, 'Established owner recovery succeeds');
    const changed = await checkHash(client, users[0].id, replacement);
    assert.ok(changed !== hash, 'Recovery must replace the password hash');
    assert.equal(await argon2.verify(changed, password), false);
    const revised = (await client.query('SELECT * FROM owner_auth')).rows;
    assert.equal(revised[0].userId, users[0].id);
    assert.notEqual(revised[0].credentialVersion, bindings[0].credentialVersion);
    // Rehashing the same password must still generate a distinct random salt.
    assert.equal(invoke(fresh, ['recover', '--user-id', users[0].id, '--password-stdin'], credentials(replacement)).status, 0);
    const salted = await checkHash(client, users[0].id, replacement);
    assert.notEqual(salted.split('$')[4], changed.split('$')[4]);
    await client.query('BEGIN');
    try {
      await assert.rejects(client.query('INSERT INTO owner_auth(id, "userId", "credentialVersion") VALUES (2, $1, $2)',
        [users[0].id, bindings[0].credentialVersion]), (error) => error.code === '23514');
    } finally { await client.query('ROLLBACK'); }
    console.log('PASS OWN-001-A/OWN-002-A/OWN-003-C concurrent bootstrap, Argon2id and bounded owner recovery');
  } finally { await client.end(); }
}

async function verifyExisting() {
  const client = new Client(config(existing));
  await client.connect();
  try {
    for (const [userId, email] of [[id, 'selected@example.invalid'], [otherId, 'other@example.invalid'],
      ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ambiguous@example.invalid'],
      ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'AMBIGUOUS@example.invalid']]) {
      await client.query(`INSERT INTO users(id,email,password,"emailVerified","emailVerificationToken","resetPasswordToken","resetPasswordExpires")
        VALUES ($1,$2,'synthetic-legacy-credential',false,'old-verification','old-reset','2030-01-01')`, [userId,email]);
      await client.query(`INSERT INTO crypto_wallets("userId",type,address,balance) VALUES ($1,'bitcoin',$2,'1.250000000000000001')`, [userId, 'synthetic-'+userId]);
    }
    for (const args of [
      ['bootstrap','--email','selected@example.invalid','--password-stdin'],
      ['bootstrap','--email','selected@example.invalid','--existing-user-id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','--password-stdin'],
      ['bootstrap','--email','wrong@example.invalid','--existing-user-id',id,'--password-stdin'],
      ['bootstrap','--email','ambiguous@example.invalid','--existing-user-id','cccccccc-cccc-4ccc-8ccc-cccccccccccc','--password-stdin'],
      ['recover','--user-id',id,'--password-stdin'],
    ]) await unchangedFailure(client, existing, args);
    const before = await snapshot(client);
    assert.equal(invoke(existing, ['bootstrap','--email','selected@example.invalid','--existing-user-id',id,'--password-stdin']).status, 0);
    const after = await snapshot(client);
    for (const table of Object.keys(before)) {
      if (!['users','owner_auth'].includes(table)) assert.deepEqual(after[table], before[table], `Preserve ${table}`);
    }
    const oldUsers = before.users.map(({ row }) => JSON.parse(row));
    const newUsers = after.users.map(({ row }) => JSON.parse(row));
    assert.equal(newUsers.length, oldUsers.length);
    for (const old of oldUsers) {
      const changed = newUsers.find((user) => user.id === old.id);
      assert.ok(changed);
      if (old.id !== id) assert.deepEqual(changed, old, 'Other users remain unchanged');
      else {
        for (const field of ['password','emailVerified','emailVerificationToken','resetPasswordToken','resetPasswordExpires','updatedAt']) {
          delete old[field]; delete changed[field];
        }
        assert.deepEqual(changed, old, 'Owner identity/profile/history preserved');
      }
    }
    await checkHash(client, id, password);
    await unchangedFailure(client, existing, ['recover','--user-id',otherId,'--password-stdin']);
    assert.equal((await client.query('SELECT "userId" FROM owner_auth WHERE id=1')).rows[0].userId,id);
    console.log('PASS OWN-001-B/C explicit existing selection preserves rows and rejects ambiguous identities');
  } finally { await client.end(); }
}

function verifyInvalidInput() {
  const args = ['bootstrap','--email','invalid-input@example.invalid','--password-stdin'];
  const badInputs = ['{', '{}', '[]', JSON.stringify({password,confirmation:password,extra:true}),
    JSON.stringify({password:42,confirmation:42}), credentials('short'), credentials('x'.repeat(129)), credentials('line\n'+'x'.repeat(20)),
    credentials('null\0'+'x'.repeat(20)), credentials('return\r'+'x'.repeat(20)),
    credentials('abcdefghijklmnop\ud800'), credentials('abcdefghijklmnop\udfff'),
    JSON.stringify({password, confirmation: replacement}), ' '.repeat(4097)];
  for (const input of badInputs) {
    const result = invoke(fresh,args,input,{DB_PASSWORD:'CLI_SECRET_NOT_FOR_OUTPUT'});
    assert.notEqual(result.status,0);
    assert.match(result.output,/password|input|json|confirm|length|character|byte|large/i);
    assert.doesNotMatch(result.output,/database|connection|authentication failed/i,'Reject input before connecting');
  }
  for (const invalid of [
    [...args,'--password','CLI_SECRET_NOT_FOR_OUTPUT'], [...args,'--email','duplicate@example.invalid'], [...args,'--unknown'],
  ]) {
    const result = invoke(fresh,invalid,credentials(),{DB_PASSWORD:'CLI_SECRET_NOT_FOR_OUTPUT'});
    assert.notEqual(result.status,0);
    assert.match(result.output,/option|argument|usage|duplicate|unknown|unsupported/i);
  }
  for (const key of Object.keys(settings)) {
    const result = invoke(fresh,args,credentials(),{[key]:undefined});
    assert.notEqual(result.status,0);
    assert.match(result.output,/missing|required|config/i);
  }
  assert.notEqual(invoke(fresh,args,'',{OWNER_PASSWORD:password,PASSWORD:password}).status,0,
    'Environment passwords must not substitute for explicit credential input');
  const result = invoke(fresh,args,credentials(),{DB_PASSWORD:'CLI_SECRET_NOT_FOR_OUTPUT'});
  assert.notEqual(result.status,0);
  assert.doesNotMatch(result.output,/CLI_SECRET_NOT_FOR_OUTPUT/);
  console.log('PASS OWN-002-B invalid/oversized CLI input and safe configuration failures');
}

async function main() {
  for (const [key,value] of Object.entries(settings)) assert.equal(process.env[key],value,`Isolated harness required: ${key}`);
  assert.ok(existsSync(cli),'Build prerequisite: production owner CLI must exist');
  const admin = new Client(config(settings.DB_NAME));
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname = ANY($1)',[databases])).rowCount,0,'Refuse existing owner test databases');
    for (const database of databases) {
      await admin.query(`CREATE DATABASE "${database}"`);
      const migrated = spawnSync(process.execPath,['/app/backend/dist/migrate.js'],{
        cwd:'/app/backend',env:{...process.env,...settings,DB_NAME:database},encoding:'utf8',timeout:60000,
      });
      assert.equal(migrated.error,undefined);
      assert.equal(migrated.status,0,`Prepare synthetic schema: ${migrated.stderr}`);
    }
  } finally { await admin.end(); }
  verifyInvalidInput();
  await verifyFresh();
  await verifyExisting();
}

main().catch((error) => { console.error(error); process.exitCode=1; });
