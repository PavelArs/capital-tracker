'use strict';

// External synthetic PostgreSQL acceptance. No HTTP/authentication success is mocked.
// A missing production module/table is a build prerequisite, never behavioral RED.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');
const { DataSource } = require('typeorm');

const settings = {
  DB_HOST: 'postgres', DB_PORT: '5432', DB_USERNAME: 'capital_e2e',
  DB_PASSWORD: 'capital_e2e', DB_NAME: 'capital_tracker_e2e',
};
const database = 'capital_tracker_manual_opening_e2e';
const tables = ['manual_accounts', 'accounting_instruments',
  'account_opening_snapshots', 'account_opening_positions'];
const children = new Set();
let stage = 'isolated setup';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const known = (instrumentId, quantity = '1', totalCostUsd = '0') =>
  ({ instrumentId, quantity, costStatus: 'known', totalCostUsd });
const unknown = instrumentId =>
  ({ instrumentId, quantity: '0.000000000000000001', costStatus: 'unknown', totalCostUsd: null });
const opening = (positions, expectedRevision = 0) => ({ requestId: randomUUID(), expectedRevision,
  asOf: '2024-02-29T23:59:59.123+02:30', positions });

function sentinel(worker = false) {
  for (const [key, value] of Object.entries(settings)) {
    assert.equal(process.env[key], worker && key === 'DB_NAME' ? database : value,
      'Exact isolated database sentinel required');
  }
}

function productionSource() {
  const { TypeOrmConfigService } = require('/app/backend/dist/config/typeorm.config.js');
  const options = new TypeOrmConfigService(new ConfigService({ ...settings, DB_NAME: database }))
    .createTypeOrmOptions();
  assert.equal(options.database, database);
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  return new DataSource(options);
}

function accounting(source) {
  const { AccountingService } = require('/app/backend/dist/accounting/accounting.service.js');
  return new AccountingService(source);
}

async function rows(source, table) {
  assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
  return source.query(`SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY row`);
}

async function fingerprint(source, selected = 'all') {
  const names = await source.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const result = [];
  for (const { tablename } of names) {
    if (selected === 'legacy' && tables.includes(tablename)) continue;
    if (selected === 'accounting' && !tables.includes(tablename)) continue;
    result.push([tablename, await rows(source, tablename)]);
  }
  return hash(result);
}

async function status(action, expected) {
  let failed = false, code;
  try { await action(); }
  catch (error) { failed = true; code = error?.getStatus?.(); }
  assert.ok(failed, 'Expected deliberate service rejection');
  assert.equal(code, expected, 'Reject for the intended domain boundary, not incidental storage failure');
}

async function insert(source, table, row) {
  assert.ok(tables.includes(table));
  const fields = Object.keys(row);
  fields.forEach(field => assert.match(field, /^[A-Za-z][A-Za-z0-9]*$/));
  return source.query(`INSERT INTO ${table} (${fields.map(field => `"${field}"`).join(',')})
    VALUES (${fields.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(row));
}

async function rejectedSql(source, action, codes) {
  // Always roll back, including an unexpectedly accepted invalid row. A constraint
  // failure must have its expected SQLSTATE; unrelated setup/query failures fail.
  const runner = source.createQueryRunner();
  let failure;
  try {
    await runner.connect(); await runner.startTransaction();
    try { await action(runner); } catch (error) { failure = error; }
  } finally {
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
    finally { await runner.release(); }
  }
  assert.ok(codes.includes(failure?.code), 'Actual PostgreSQL must reject at the intended constraint');
}

async function seed(source) {
  const principals = [];
  for (const email of ['opening-owner@example.invalid', 'opening-other@example.invalid']) {
    const [user] = await source.query(`INSERT INTO users(email,password,"emailVerified")
      VALUES($1,'synthetic-pg-fixture-not-a-login-hash',true) RETURNING id`, [email]);
    principals.push(user.id);
    await source.query(`INSERT INTO crypto_wallets("userId",type,address,balance)
      VALUES($1,'bitcoin',$2,'1.250000000000000001')`, [user.id, `synthetic-${email}`]);
    await source.query(`INSERT INTO assets("userId",name,category,amount,"currencyId",date)
      SELECT $1,'Preserved legacy asset','savings','123.45',id,'2026-01-01'
      FROM currencies WHERE code='USD'`, [user.id]);
    await source.query(`INSERT INTO liabilities("userId",name,category,amount,"currencyId",date)
      SELECT $1,'Preserved legacy liability','loans','6.78',id,'2026-01-01'
      FROM currencies WHERE code='USD'`, [user.id]);
  }
  await source.query(`INSERT INTO owner_auth(id,"userId","credentialVersion") VALUES(1,$1,$2)`,
    [principals[0], randomUUID()]);
  await source.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
    INSERT INTO auth_request_limits(scope,"subjectHash",hits,"windowStartedAt","expiresAt")
    SELECT 'login-account',$1,3,now,now+interval '600 seconds' FROM moment`,
  [hash(['ct-auth-request-v1', 'login-account', 'opening-owner@example.invalid'])]);
  return principals;
}

async function exactStorage(source, service, owner, other) {
  stage = 'OPEN-002 exact independent strings and OPEN-003 retained replacements';
  const accountInput = { requestId: randomUUID(), name: 'Manual synthetic account' };
  const account = await service.createAccount(owner, accountInput);
  assert.equal(account.created, true);
  assert.equal(account.value.currentRevision, 0);
  assert.equal((await source.query('SELECT "currentRevision" FROM manual_accounts WHERE id=$1', [account.value.id]))[0].currentRevision, null);
  assert.equal((await service.getAccount(owner, account.value.id)).currentOpening, null);
  const instruments = [];
  for (let index = 0; index < 3; index++) {
    const result = await service.createInstrument(owner,
      { requestId: randomUUID(), name: `Synthetic instrument ${index}`, symbol: 'SAME' });
    assert.equal(result.created, true); assert.equal(result.value.namespace, 'manual');
    instruments.push(result.value.id);
  }
  const foreignAccount = (await service.createAccount(other,
    { requestId: accountInput.requestId, name: 'Foreign synthetic account' })).value;
  const foreignInstrument = (await service.createInstrument(other,
    { requestId: randomUUID(), name: 'Foreign synthetic instrument', symbol: 'SAME' })).value;
  const large = '9007199254740993.000000000000000001', cost = '123.450000000000000001';
  const firstInput = opening([known(instruments[0], large, cost), unknown(instruments[1]), known(instruments[2])]);
  const first = await service.saveOpening(owner, account.value.id, firstInput);
  assert.equal(first.created, true); assert.equal(first.value.revision, 1);
  assert.equal(first.value.asOf, '2024-02-29T21:29:59.123Z');
  const expected = new Map([[instruments[0], [large, 'known', cost]],
    [instruments[1], ['0.000000000000000001', 'unknown', null]], [instruments[2], ['1', 'known', '0']]]);
  for (const position of first.value.positions) {
    assert.deepEqual([position.quantity, position.costStatus, position.totalCostUsd], expected.get(position.instrumentId));
  }
  assert.equal(first.value.positions.length, 3);
  const stored = await source.query(`SELECT "instrumentId",quantity::text AS quantity,"totalCostUsd"::text AS cost
    FROM account_opening_positions WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=1`, [owner, account.value.id]);
  const fixed = value => value.includes('.') ? value.padEnd(value.indexOf('.') + 31, '0') : `${value}.${'0'.repeat(30)}`;
  for (const row of stored) {
    const [quantity, , total] = expected.get(row.instrumentId);
    assert.equal(row.quantity, fixed(quantity)); assert.equal(row.cost, total === null ? null : fixed(total));
  }
  const [payload] = await source.query(`SELECT "canonicalPayload" FROM account_opening_snapshots
    WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=1`, [owner, account.value.id]);
  assert.equal(typeof payload.canonicalPayload, 'string');
  assert.deepEqual(JSON.parse(payload.canonicalPayload), { expectedRevision: 0,
    asOf: '2024-02-29T21:29:59.123Z', positions: [...firstInput.positions].sort((a, b) =>
      a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0) });
  const originalRows = await rows(source, 'account_opening_positions');
  const originalSnapshot = (await source.query(`SELECT to_jsonb(s)::text AS row FROM account_opening_snapshots s
    WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=1`, [owner, account.value.id]))[0];
  const canonicalReplay = { ...firstInput, requestId: firstInput.requestId.toUpperCase(),
    asOf: '2024-02-29T21:29:59.123Z', positions: [...firstInput.positions].reverse().map(position => ({
      ...position, instrumentId: position.instrumentId.toUpperCase(), quantity: position.quantity.includes('.') ? `00${position.quantity}00` : `00${position.quantity}.00`,
      totalCostUsd: position.totalCostUsd === null ? null : position.totalCostUsd === '0' ? '000.000' : `00${position.totalCostUsd}00`,
    })) };
  const replay = await service.saveOpening(owner, account.value.id.toUpperCase(), canonicalReplay);
  assert.deepEqual(replay, { created: false, value: first.value });
  const replacement = await service.saveOpening(owner, account.value.id, opening([known(instruments[0], '2', '0')], 1));
  assert.equal(replacement.value.revision, 2);
  const afterReplacement = await fingerprint(source, 'accounting');
  assert.deepEqual(await service.saveOpening(owner, account.value.id, firstInput), { created: false, value: first.value });
  assert.equal(await fingerprint(source, 'accounting'), afterReplacement, 'Old replay changes no bytes or current pointer');
  const liveAccountReplay = await service.createAccount(owner, accountInput);
  assert.deepEqual(liveAccountReplay, { created: false, value: { ...account.value, currentRevision: 2 } });
  assert.equal((await service.getAccount(owner, account.value.id)).currentOpening.positions.length, 1);
  for (const old of originalRows) assert.ok((await rows(source, 'account_opening_positions')).some(row => row.row === old.row));
  assert.deepEqual((await source.query(`SELECT to_jsonb(s)::text AS row FROM account_opening_snapshots s
    WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=1`, [owner, account.value.id]))[0], originalSnapshot);
  await status(() => service.saveOpening(owner, account.value.id, { ...firstInput, expectedRevision: 1 }), 409);
  await status(() => service.createAccount(owner, { ...accountInput, name: 'Changed committed payload' }), 409);
  assert.equal(await fingerprint(source, 'accounting'), afterReplacement);
  const secondAccount = (await service.createAccount(owner, { requestId: randomUUID(), name: accountInput.name })).value;
  const reusedKey = await service.saveOpening(owner, secondAccount.id, firstInput);
  assert.equal(reusedKey.created, true); assert.equal(reusedKey.value.revision, 1);
  assert.equal((await service.getAccount(owner, account.value.id)).currentRevision, 2);
  console.log('PASS OPEN-002/003 exact numeric text/UTC, independent symbols, canonical replay, whole replacement and original immutable history');
  return { owner, other, account: account.value.id, secondAccount: secondAccount.id,
    instruments, foreignAccount: foreignAccount.id, foreignInstrument: foreignInstrument.id };
}

async function constraints(source, fixture) {
  stage = 'OPEN-004 PostgreSQL types and null/finite/composite-owner constraints';
  const { owner, other, account, instruments, foreignAccount, foreignInstrument } = fixture;
  const columns = await source.query(`SELECT table_name,column_name,is_nullable,numeric_precision,numeric_scale,datetime_precision
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1)`, [tables]);
  for (const column of ['quantity', 'totalCostUsd']) {
    const value = columns.find(row => row.table_name === 'account_opening_positions' && row.column_name === column);
    assert.equal(value.numeric_precision, 78); assert.equal(value.numeric_scale, 30);
  }
  for (const row of columns.filter(row => ['createdAt', 'asOf'].includes(row.column_name))) assert.equal(row.datetime_precision, 3);
  for (const row of columns.filter(row => ['ownerId', 'accountId', 'revision', 'instrumentId', 'requestId', 'quantity', 'costStatus'].includes(row.column_name))) {
    assert.equal(row.is_nullable, 'NO', 'Identity and cost-status NULL cannot bypass composite checks');
  }
  const foreignKeys = await source.query(`SELECT c.relname AS table_name, k.confrelid::regclass::text AS target,
    k.confdeltype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid WHERE k.contype='f' AND c.relname=ANY($1)`, [tables]);
  for (const table of tables) assert.ok(foreignKeys.some(row => row.table_name === table && row.target === 'users'));
  for (const row of foreignKeys) assert.equal(row.confdeltype, 'r', 'All owned references restrict deletion; none cascade');
  const before = await fingerprint(source);
  const createdAt = '2026-01-01T00:00:00.123Z';
  const bases = {
    manual_accounts: { id: randomUUID(), ownerId: owner, requestId: randomUUID(), canonicalPayload: '{}', name: 'Constraint account', createdAt },
    accounting_instruments: { id: randomUUID(), ownerId: owner, requestId: randomUUID(), canonicalPayload: '{}', name: 'Constraint instrument', namespace: 'manual', createdAt },
    account_opening_snapshots: { ownerId: owner, accountId: account, revision: 3, requestId: randomUUID(), canonicalPayload: '{}', asOf: createdAt, createdAt },
    account_opening_positions: { ownerId: owner, accountId: account, revision: 2, instrumentId: instruments[1], quantity: '1', costStatus: 'known', totalCostUsd: '0' },
  };
  for (const [table, base] of Object.entries(bases)) {
    for (const field of Object.keys(base).filter(field => field !== 'totalCostUsd')) {
      stage = `OPEN-004 SQL NOT NULL ${table}.${field}`;
      await rejectedSql(source, runner => insert(runner, table, { ...base, [field]: null }), ['23502']);
    }
    await rejectedSql(source, runner => insert(runner, table, { ...base, ownerId: randomUUID() }), ['23503']);
    if (base.createdAt) for (const value of ['infinity', '-infinity']) {
      await rejectedSql(source, runner => insert(runner, table, { ...base, createdAt: value }), ['23514']);
    }
  }
  const position = bases.account_opening_positions;
  for (const quantity of ['0', '-1', 'NaN', 'Infinity', '-Infinity']) {
    await rejectedSql(source, runner => insert(runner, 'account_opening_positions', { ...position, quantity }), ['23514', '22003']);
  }
  for (const totalCostUsd of [null, '-1', 'NaN', 'Infinity', '-Infinity']) {
    await rejectedSql(source, runner => insert(runner, 'account_opening_positions', { ...position, totalCostUsd }), ['23514', '22003']);
  }
  for (const change of [{ costStatus: 'unknown' }, { costStatus: 'invalid' }, { revision: 0 },
    { revision: 3 }, { accountId: foreignAccount }, { ownerId: other },
    { instrumentId: foreignInstrument }, { instrumentId: randomUUID() }]) {
    await rejectedSql(source, runner => insert(runner, 'account_opening_positions', { ...position, ...change }), ['23503', '23514']);
  }
  for (const change of [{ ownerId: other }, { accountId: foreignAccount }, { revision: 0 }, { revision: -1 },
    ...['infinity', '-infinity', '1969-12-31T23:59:59.999Z', '10000-01-01T00:00:00.000Z'].map(asOf => ({ asOf }))]) {
    await rejectedSql(source, runner => insert(runner, 'account_opening_snapshots', { ...bases.account_opening_snapshots, ...change }), ['23503', '23514']);
  }
  await rejectedSql(source, runner => insert(runner, 'accounting_instruments', { ...bases.accounting_instruments, namespace: 'fiat' }), ['23514']);
  for (const table of ['manual_accounts', 'accounting_instruments']) {
    for (const name of ['', ' untrimmed', 'line\nbreak', 'x'.repeat(121)]) {
      await rejectedSql(source, runner => insert(runner, table, { ...bases[table], name }), ['23514', '22001']);
    }
  }
  for (const symbol of ['', ' untrimmed', 'line\nbreak', 'x'.repeat(33)]) {
    await rejectedSql(source, runner => insert(runner, 'accounting_instruments', { ...bases.accounting_instruments, symbol }), ['23514', '22001']);
  }
  await rejectedSql(source, runner => insert(runner, 'account_opening_positions', {
    ...position, quantity: '1' + '0'.repeat(48) }), ['22003']);
  for (const revision of [0, -1, 3, 2147483648]) {
    await rejectedSql(source, runner => runner.query(`UPDATE manual_accounts SET "currentRevision"=$1 WHERE id=$2`, [revision, account]), ['23514', '23503', '22003']);
  }
  // The other account's revision1 must not make this previously empty pointer valid.
  await rejectedSql(source, runner => runner.query(`UPDATE manual_accounts SET "currentRevision"=1 WHERE id=$1`, [foreignAccount]), ['23503']);
  for (const table of ['manual_accounts', 'accounting_instruments']) {
    const [existing] = await source.query(`SELECT * FROM ${table} WHERE "ownerId"=$1 LIMIT 1`, [owner]);
    await rejectedSql(source, runner => insert(runner, table, { ...bases[table], requestId: existing.requestId }), ['23505']);
  }
  const [existingSnapshot] = await source.query(`SELECT "requestId" FROM account_opening_snapshots
    WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=1`, [owner, account]);
  await rejectedSql(source, runner => insert(runner, 'account_opening_snapshots', {
    ...bases.account_opening_snapshots, requestId: existingSnapshot.requestId }), ['23505']);
  await rejectedSql(source, runner => insert(runner, 'account_opening_positions', {
    ...position, instrumentId: instruments[0].toUpperCase() }), ['23505']);
  await rejectedSql(source, runner => runner.query('DELETE FROM users WHERE id=$1', [owner]), ['23503']);
  await rejectedSql(source, runner => runner.query('DELETE FROM accounting_instruments WHERE id=$1', [instruments[0]]), ['23503']);
  await rejectedSql(source, runner => runner.query('DELETE FROM manual_accounts WHERE id=$1', [account]), ['23503']);
  const temporary = source.createQueryRunner();
  try {
    await temporary.connect(); await temporary.startTransaction();
    await temporary.query('DELETE FROM owner_auth WHERE id=1');
    assert.equal(await fingerprint(temporary, 'accounting'), await fingerprint(source, 'accounting'),
      'Removing singleton binding does not remove owned accounting history');
    for (const [quantity, costStatus, totalCostUsd] of [
      ['9'.repeat(48) + '.' + '9'.repeat(30), 'known', '9'.repeat(48) + '.' + '9'.repeat(30)],
      ['0.' + '0'.repeat(29) + '1', 'unknown', null],
    ]) {
      await insert(temporary, 'account_opening_positions', { ...position, quantity, costStatus, totalCostUsd });
      const [saved] = await temporary.query(`SELECT quantity::text AS quantity,"totalCostUsd"::text AS cost
        FROM account_opening_positions WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=2 AND "instrumentId"=$3`,
      [owner, account, instruments[1]]);
      assert.deepEqual(saved, { quantity, cost: totalCostUsd });
      await temporary.query(`DELETE FROM account_opening_positions WHERE "ownerId"=$1 AND "accountId"=$2 AND revision=2 AND "instrumentId"=$3`,
        [owner, account, instruments[1]]);
    }
  } finally {
    try { if (temporary.isTransactionActive) await temporary.rollbackTransaction(); }
    finally { await temporary.release(); }
  }
  assert.equal(await fingerprint(source), before, 'SQL probes leave every original row unchanged');
  console.log('PASS OPEN-002/004 actual numeric78,30 extremes, finite/null pairings, composite owner/current pointer, uniqueness and RESTRICT preservation');
}

async function rejectedBatches(source, service, fixture) {
  stage = 'OPEN-002/004 defensive service validation and rejected-key reuse';
  const { owner, account, instruments, foreignAccount, foreignInstrument } = fixture;
  const badKey = randomUUID();
  const valid = { ...opening([known(instruments[0])], 2), requestId: badKey };
  const before = await fingerprint(source);
  for (const change of [
    { expectedRevision: '2' }, { expectedRevision: true }, { expectedRevision: 2.5 },
    { asOf: '2024-02-30T00:00:00Z' }, { asOf: { toString: 1 } },
    { positions: [known(instruments[0], 1)] },
    { positions: [known(instruments[0], '1.' + '0'.repeat(31))] },
    { positions: [known(instruments[0], '1', null)] },
    { positions: [{ instrumentId: instruments[0], quantity: '1', costStatus: 'unknown' }] },
    { positions: [known(instruments[0]), known(instruments[0].toUpperCase())] },
  ]) {
    await status(() => service.saveOpening(owner, account, { ...valid, ...change }), 400);
    assert.equal(await fingerprint(source), before, 'Rejected input reserves no request identity or partial rows');
  }
  await status(() => service.saveOpening(owner, account, { ...valid,
    positions: [known(instruments[0]), known(foreignInstrument)] }), 404);
  await status(() => service.saveOpening(owner, foreignAccount, valid), 404);
  await status(() => service.saveOpening(owner, randomUUID(), valid), 404);
  assert.equal(await fingerprint(source), before);
  const result = await service.saveOpening(owner, account, valid);
  assert.equal(result.created, true); assert.equal(result.value.revision, 3);
  assert.deepEqual(await service.saveOpening(owner, account, valid), { created: false, value: result.value });
  console.log('PASS OPEN-002/004 real service raw-type/precision/date/owner failures are atomic and rejected request keys remain reusable');
}

async function workerMain() {
  sentinel(true);
  const source = productionSource(); await source.initialize();
  try {
    const command = new Promise(resolve => process.once('message', resolve));
    process.send({ type: 'ready', pid: process.pid });
    const { method, args } = await command;
    assert.ok(['createAccount', 'createInstrument', 'saveOpening'].includes(method));
    let result;
    try { result = { ok: true, result: await accounting(source)[method](...args) }; }
    catch (error) { result = { ok: false, status: error?.getStatus?.() ?? null }; }
    process.send({ type: 'result', result });
  } finally { await source.destroy(); process.disconnect(); }
}

function startWorker() {
  const child = spawn(process.execPath, [__filename, '--worker'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.add(child);
  let readyResolve, readyReject, resultResolve, resultReject, result, output = '';
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const finished = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  ready.catch(() => {}); finished.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  const capture = chunk => { output += chunk; if (Buffer.byteLength(output) > 16384) child.kill('SIGKILL'); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.on('message', message => {
    if (message.type === 'ready') readyResolve(message.pid);
    if (message.type === 'result') result = message.result;
  });
  const fail = () => {
    const error = new Error('Isolated accounting worker failed (details withheld)');
    readyReject(error); resultReject(error);
  };
  child.on('error', fail);
  child.on('exit', (code, signal) => {
    clearTimeout(timer); children.delete(child);
    if (code !== 0 || signal || result === undefined || output !== '') fail();
    else resultResolve(result);
  });
  return { child, ready, finished, go: command => child.send(command) };
}

async function processRace(source, commands, table, accountId) {
  const workers = commands.map(() => startWorker());
  const blocker = source.createQueryRunner();
  try {
    const pids = await Promise.all(workers.map(worker => worker.ready));
    assert.equal(new Set(pids).size, commands.length, 'Real distinct Node processes contend for the same persisted identity');
    pids.forEach((pid, index) => assert.equal(pid, workers[index].child.pid));
    await blocker.connect(); await blocker.startTransaction();
    if (accountId) await blocker.query('SELECT id FROM manual_accounts WHERE id=$1 FOR UPDATE', [accountId]);
    else {
      assert.ok(['manual_accounts', 'accounting_instruments'].includes(table));
      await blocker.query(`LOCK TABLE ${table} IN SHARE MODE`);
    }
    workers.forEach((worker, index) => worker.go(commands[index]));
    const deadline = performance.now() + 3000;
    let observed = false;
    // Row-lock waiters can queue behind one another: the second process need not
    // name the original holder directly in pg_blocking_pids. This fresh database
    // has only these two writers, the idle blocker and the observing connection.
    while (performance.now() < deadline) {
      const [{ waiting }] = await source.query(`SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname=$1 AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0
        AND position($2 in query)>0`, [database, table]);
      if (waiting === workers.length) { observed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observed, 'Both real production writers must reach an observed database lock wait before release');
    await blocker.commitTransaction();
    return await Promise.all(workers.map(worker => worker.finished));
  } finally {
    try {
      try { if (blocker.isTransactionActive) await blocker.rollbackTransaction(); }
      finally { await blocker.release(); }
    } finally {
      for (const worker of workers) if (children.has(worker.child)) worker.child.kill('SIGKILL');
      await Promise.allSettled(workers.map(worker => worker.finished));
    }
  }
}

async function races(source, service, fixture) {
  stage = 'OPEN-003 actual cross-process account and instrument creation races';
  const { owner, instruments } = fixture;
  for (const [method, table] of [['createAccount', 'manual_accounts'], ['createInstrument', 'accounting_instruments']]) {
    const input = { requestId: randomUUID(), name: 'Concurrent synthetic identity' };
    const commands = [0, 1].map(() => ({ method, args: [owner, input] }));
    const results = await processRace(source, commands, table);
    assert.ok(results.every(result => result.ok));
    assert.deepEqual(results.map(result => result.result.created).sort(), [false, true]);
    assert.deepEqual(results[0].result.value, results[1].result.value);
    assert.equal((await source.query(`SELECT count(*)::int AS count FROM ${table}
      WHERE "ownerId"=$1 AND "requestId"=$2`, [owner, input.requestId]))[0].count, 1);
    await status(() => service[method](owner, { ...input, name: 'Conflicting committed identity' }), 409);
  }
  stage = 'OPEN-003 actual cross-process identical opening and competing CAS races';
  const account = (await service.createAccount(owner, { requestId: randomUUID(), name: 'Concurrent revisions' })).value;
  const first = opening([known(instruments[0])]);
  const same = await processRace(source, [0, 1].map(() =>
    ({ method: 'saveOpening', args: [owner, account.id, first] })), 'manual_accounts', account.id);
  assert.ok(same.every(result => result.ok));
  assert.deepEqual(same.map(result => result.result.created).sort(), [false, true]);
  assert.deepEqual(same[0].result.value, same[1].result.value);
  const competing = [opening([known(instruments[0], '2')], 1), opening([unknown(instruments[1])], 1)];
  const outcomes = await processRace(source, competing.map(input =>
    ({ method: 'saveOpening', args: [owner, account.id, input] })), 'manual_accounts', account.id);
  assert.equal(outcomes.filter(result => result.ok).length, 1);
  assert.equal(outcomes.find(result => !result.ok).status, 409);
  const winner = outcomes.find(result => result.ok).result;
  assert.equal(winner.created, true); assert.equal(winner.value.revision, 2);
  const snapshots = await source.query(`SELECT revision,"requestId" FROM account_opening_snapshots
    WHERE "ownerId"=$1 AND "accountId"=$2 ORDER BY revision`, [owner, account.id]);
  assert.deepEqual(snapshots, [{ revision: 1, requestId: first.requestId },
    { revision: 2, requestId: winner.value.requestId }]);
  assert.equal((await service.getAccount(owner, account.id)).currentRevision, 2);
  const before = await fingerprint(source, 'accounting');
  assert.deepEqual(await service.saveOpening(owner, account.id, first), { created: false, value: same[0].result.value });
  assert.equal(await fingerprint(source, 'accounting'), before);
  console.log('PASS OPEN-003 observed PostgreSQL waits across distinct processes: unique resource/replay races, one CAS winner and no losing request reservation');
}

async function deferredCommitFailure(source, service, fixture) {
  stage = 'OPEN-003 actual deferred COMMIT failure after snapshot/positions/pointer writes';
  const { owner, instruments } = fixture;
  const account = (await service.createAccount(owner, { requestId: randomUUID(), name: 'Commit rollback fixture' })).value;
  const input = opening([known(instruments[0], '987654321.123456789', '876543210.987654321'), unknown(instruments[1])]);
  const marker = 'synthetic-opening-commit-private-marker';
  const before = await fingerprint(source);
  let installed = false;
  try {
    await source.query('CREATE SEQUENCE synthetic_opening_commit_attempt START 1'); installed = true;
    await source.query(`CREATE FUNCTION synthetic_opening_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."requestId" = '${input.requestId}'::uuid THEN
          IF NOT EXISTS(SELECT 1 FROM manual_accounts WHERE "ownerId"=NEW."ownerId"
              AND id=NEW."accountId" AND "currentRevision"=NEW.revision)
            OR (SELECT count(*) FROM account_opening_positions WHERE "ownerId"=NEW."ownerId"
              AND "accountId"=NEW."accountId" AND revision=NEW.revision) <> 2 THEN
            RAISE EXCEPTION 'synthetic fixture did not observe all transactional writes';
          END IF;
          PERFORM nextval('synthetic_opening_commit_attempt');
          RAISE EXCEPTION '${marker}' USING DETAIL=NEW."canonicalPayload";
        END IF;
        RETURN NULL;
      END $$`);
    await source.query(`CREATE CONSTRAINT TRIGGER synthetic_opening_commit_failure
      AFTER INSERT ON account_opening_snapshots DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION synthetic_opening_commit_failure()`);
    let failure;
    try { await service.saveOpening(owner, account.id, input); } catch (error) { failure = error; }
    assert.ok(failure, 'A failed actual database commit cannot resolve as successful creation');
    assert.equal(failure?.driverError?.code ?? failure?.code, 'P0001', 'Reach the deliberate deferred exception');
    assert.ok(String(failure.message).includes(marker), 'Failure came from the selected commit trigger');
    const [attempt] = await source.query('SELECT last_value::text AS value,is_called FROM synthetic_opening_commit_attempt');
    assert.deepEqual(attempt, { value: '1', is_called: true }, 'All writes reached exactly one commit attempt without automatic retry');
    assert.equal(await fingerprint(source), before, 'Failed COMMIT rolls back snapshot, positions, pointer and request identity');

    // Apply the actual generic error projection to the real storage exception.
    // This is an error-filter boundary probe, not a claim of an authenticated HTTP request.
    const { GlobalExceptionFilter } = require('/app/backend/dist/shared/filters/global-exception.filter.js');
    const logs = []; let body, responseStatus;
    const filter = new GlobalExceptionFilter({ setContext() {}, error: (...args) => logs.push(args), warn: (...args) => logs.push(args) });
    const response = { status(value) { responseStatus = value; return this; }, json(value) { body = value; return this; } };
    filter.catch(failure, { switchToHttp: () => ({ getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: `/api/accounting/accounts/${account.id}/openings`, ip: '192.0.2.1' }) }) });
    assert.equal(responseStatus, 500); assert.equal(body.message, 'Internal server error');
    assert.equal(logs.length, 1);
    for (const secret of [marker, input.positions[0].quantity, input.positions[0].totalCostUsd,
      'canonicalPayload', 'account_opening_snapshots', database]) {
      assert.ok(!JSON.stringify([body, logs]).includes(secret), 'Generic response/log projection excludes private storage details');
    }
  } finally {
    if (installed) {
      await source.query('DROP TRIGGER IF EXISTS synthetic_opening_commit_failure ON account_opening_snapshots');
      await source.query('DROP FUNCTION IF EXISTS synthetic_opening_commit_failure()');
      await source.query('DROP SEQUENCE synthetic_opening_commit_attempt');
    }
  }
  const retry = await service.saveOpening(owner, account.id, input);
  assert.equal(retry.created, true); assert.equal(retry.value.revision, 1);
  assert.deepEqual(await service.saveOpening(owner, account.id, input), { created: false, value: retry.value });
  assert.equal((await source.query(`SELECT count(*)::int AS count FROM account_opening_snapshots
    WHERE "ownerId"=$1 AND "accountId"=$2`, [owner, account.id]))[0].count, 1);
  console.log('PASS OPEN-003 deferred COMMIT rejection rolls back every write, actual safe filter excludes private values, explicit retry creates once');
}

async function main() {
  sentinel();
  const admin = new Client({ host: settings.DB_HOST, port: 5432, user: settings.DB_USERNAME,
    password: settings.DB_PASSWORD, database: settings.DB_NAME, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount,
      0, 'Refuse preexisting fixture databases; never drop or reuse data');
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  const migration = spawnSync(process.execPath, ['/app/backend/dist/migrate.js'], {
    cwd: '/app/backend', env: { ...process.env, ...settings, DB_NAME: database },
    encoding: 'utf8', timeout: 60000,
  });
  assert.equal(migration.error, undefined); assert.equal(migration.signal, null);
  assert.equal(migration.status, 0, 'Actual CLI must create the complete isolated schema');
  const source = productionSource(); await source.initialize();
  try {
    assert.equal((await source.query('SELECT current_database() AS name'))[0].name, database);
    const migrations = await source.query('SELECT name FROM migrations ORDER BY timestamp');
    assert.equal(migrations.length, 17); assert.equal(migrations[12].name, 'AddManualOpeningPositions1790030000000');
    assert.equal(migrations[13].name, 'AddUsdTradeJournal1790040000000');
    assert.equal(migrations[14].name, 'AddUsdCsvImports1790050000000');
    assert.equal(migrations[15].name, 'AddKnownCostCarryIn1790060000000');
    assert.equal(migrations[16].name, 'AddExternalUsdFlows1790070000000');
    for (const table of tables) assert.deepEqual(await rows(source, table), []);
    const [owner, other] = await seed(source);
    const legacy = await fingerprint(source, 'legacy');
    const service = accounting(source);
    const fixture = await exactStorage(source, service, owner, other);
    assert.equal(await fingerprint(source, 'legacy'), legacy);
    for (const run of [constraints, rejectedBatches, races, deferredCommitFailure]) {
      if (run === constraints) await run(source, fixture);
      else await run(source, service, fixture);
      assert.equal(await fingerprint(source, 'legacy'), legacy, 'All prior financial/owner/admission/migration rows remain exact');
    }
    console.log('PASS isolated manual-opening production-service and PostgreSQL acceptance; all prior rows preserved');
  } finally { await source.destroy(); }
}

const watchdog = setTimeout(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL bounded isolated opening fixture at stage: ${stage}`);
  process.exit(1);
}, 120000);
watchdog.unref();
(process.argv[2] === '--worker' ? workerMain() : main()).catch(() => {
  for (const child of children) child.kill('SIGKILL');
  console.error(`FAIL isolated opening database acceptance at stage: ${stage} (private assertion details withheld)`);
  process.exitCode = 1;
}).finally(() => clearTimeout(watchdog));
