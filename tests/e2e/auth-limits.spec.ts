import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  counts,
  expectAdmissionDelta,
  expectLedger,
  hostSubject,
  ledger,
  ledgerState,
  ownerCount,
  sourceA,
  sourceB,
  subjectHash,
  withAdmissionLock,
} from './admission-fixtures';
import {
  cookieName,
  enrollOwner,
  fingerprint,
  loginWithMfa,
  origin,
  owner,
  query,
  recoveryFactor,
  test,
} from './mfa-fixtures';
import { restartBackends, selectBackend, upstreamMark, upstreamsSince } from './replicas';
import { type SourceJar, type SourceResponse, sendDirect, sendFrom } from './source-client';

const clientA = '172.30.90.10';
const clientB = '172.30.90.11';
const upstreams = { primary: '172.30.91.10:3000', replica: '172.30.91.11:3000' };
const wrongCredentials = { email: owner.email, password: 'Synthetic-wrong-password-42!' };

// Initial versions at 10fee53 captured real expected429/actual401 RED on the
// previous image without future-table reads. Current acceptance retains those
// HTTP/upstream oracles and adds exact persistent-ledger checks.
const retainedState = () => fingerprint(['auth_sessions', 'auth_request_limits']);

async function anonymous(client: 'client-a' | 'client-b') {
  const result = await sendFrom(client, {
    requests: [{ method: 'GET', path: '/api/auth/csrf' }],
  });
  expect(result.responses[0].status).toBe(200);
  expect(result.responses[0].body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(result.jar[cookieName]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { jar: result.jar, csrfToken: result.responses[0].body.csrfToken as string };
}

function wrongLogins(csrfToken: string, count: number) {
  return Array.from({ length: count }, () => ({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'X-CSRF-Token': csrfToken },
    body: wrongCredentials,
  }));
}

async function exhaustPrimary(session: { jar: SourceJar; csrfToken: string }) {
  const mark = await upstreamMark();
  const started = Date.now();
  const result = await sendFrom('client-a', {
    jar: session.jar,
    requests: wrongLogins(session.csrfToken, 6),
  });
  expect(result.responses.map((response) => response.status)).toEqual([
    401, 401, 401, 401, 401, 429,
  ]);
  expect(result.jar[cookieName]).toBe(session.jar[cookieName]);
  const evidence = (await upstreamsSince(mark)).filter((entry) => entry.source === clientA);
  expect(evidence).toHaveLength(6);
  for (const entry of evidence) {
    expect(entry.backend).toBe('primary');
    expect(entry.upstream).toBe(upstreams.primary);
  }
  return started;
}

async function assertUpstream(
  mark: number,
  source: string,
  backend: 'primary' | 'replica',
  count = 1,
) {
  const evidence = (await upstreamsSince(mark)).filter((entry) => entry.source === source);
  expect(evidence).toHaveLength(count);
  for (const entry of evidence) {
    expect(entry.backend).toBe(backend);
    expect(entry.upstream).toBe(upstreams[backend]);
  }
}

function assertStillExhausted(response: SourceResponse, started: number) {
  expect(Date.now() - started, 'The fixed 60-second window cannot have expired').toBeLessThan(
    55_000,
  );
  expect(
    response.status,
    'A second process must retain the exhausted source admission budget',
  ).toBe(429);
}

test('LIMIT-001-A: a second real replica cannot grant an exhausted source another password guess', async () => {
  await selectBackend('primary');
  await restartBackends();
  try {
    const before = retainedState();
    const a = await anonymous('client-a');
    const started = await exhaustPrimary(a);

    await selectBackend('replica');
    const mark = await upstreamMark();
    const probe = await sendFrom('client-a', {
      jar: a.jar,
      requests: wrongLogins(a.csrfToken, 1),
    });
    // Prove actual routing before the behavior assertion, including on RED.
    await assertUpstream(mark, clientA, 'replica');
    expect(probe.jar[cookieName]).toBe(a.jar[cookieName]);

    const b = await anonymous('client-b');
    const bMark = await upstreamMark();
    const independent = await sendFrom('client-b', {
      jar: b.jar,
      requests: wrongLogins(b.csrfToken, 1),
    });
    await assertUpstream(bMark, clientB, 'replica');
    expect(
      independent.responses[0].status,
      'Client B retains its independent source allowance',
    ).toBe(401);
    expect(retainedState()).toBe(before);
    assertStillExhausted(probe.responses[0], started);
    expectLedger([...counts(sourceA, 1, 5), ...counts(sourceB, 1, 1), ownerCount(6)]);
  } finally {
    await selectBackend('both');
  }
});

test('LIMIT-001-B: restarting both real processes cannot reset an exhausted password budget', async () => {
  await selectBackend('primary');
  await restartBackends();
  try {
    const before = retainedState();
    const a = await anonymous('client-a');
    const started = await exhaustPrimary(a);
    const admissions = ledgerState();

    // The helper independently verifies both restarts and both health checks.
    await restartBackends();
    await selectBackend('primary');
    const mark = await upstreamMark();
    const probe = await sendFrom('client-a', {
      jar: a.jar,
      requests: wrongLogins(a.csrfToken, 1),
    });
    await assertUpstream(mark, clientA, 'primary');
    expect(probe.jar[cookieName]).toBe(a.jar[cookieName]);
    expect(retainedState()).toBe(before);
    assertStillExhausted(probe.responses[0], started);
    expect(ledgerState()).toBe(admissions);
    expectLedger([...counts(sourceA, 1, 5), ownerCount(5)]);
  } finally {
    await selectBackend('both');
  }
});

function limited(response: SourceResponse, maximum = 60): number {
  expect(response.status).toBe(429);
  expect(response.body.message).toBe('Too many requests');
  expect(response.headers['cache-control']).toContain('no-store');
  const header = response.headers['retry-after'];
  expect(typeof header).toBe('string');
  expect(header).toMatch(/^[1-9][0-9]*$/);
  const retry = Number(header);
  expect(retry).toBeGreaterThanOrEqual(1);
  expect(retry).toBeLessThanOrEqual(maximum);
  return retry;
}

async function pendingFrom(client: 'client-a' | 'client-b') {
  const session = await anonymous(client);
  const result = await sendFrom(client, {
    jar: session.jar,
    requests: [
      {
        method: 'POST',
        path: '/api/auth/login',
        headers: { 'X-CSRF-Token': session.csrfToken },
        body: { email: owner.email, password: owner.password },
      },
    ],
  });
  expect(result.responses[0].status).toBe(200);
  expect(result.responses[0].body.mfaRequired).toBe(true);
  return { jar: result.jar, csrfToken: result.responses[0].body.csrfToken as string };
}

function expireSyntheticLoginSources(): void {
  // Contracted negative-time fixture, not an admission reset: preserve the exact
  // 60-second SQL duration, touch only A/B source rows, and never the account row.
  const hashes = [sourceA, sourceB]
    .map((subject) => `'${subjectHash('login-ip', subject)}'`)
    .join(',');
  expect(
    query(`WITH now AS MATERIALIZED (SELECT clock_timestamp() AS t), expired AS (
    UPDATE auth_request_limits SET "windowStartedAt" = now.t - interval '61 seconds',
      "expiresAt" = now.t - interval '1 second' FROM now
    WHERE scope = 'login-ip' AND "subjectHash" IN (${hashes}) RETURNING scope
  ) SELECT count(*) FROM expired`),
  ).toBe('2');
}

test('LIMIT-001-B/LIMIT-001-D: CSRF path variants share thirty admissions across both restarts', async () => {
  const started = Date.now();
  const result = await sendFrom('client-a', {
    requests: Array.from({ length: 30 }, (_, index) => ({
      method: index % 2 ? 'HEAD' : 'GET',
      path: [
        '/api/auth/csrf',
        '/api/auth/CSRF',
        '/api/auth/csrf?probe=synthetic',
        '/api/auth/csrf/',
      ][index % 4],
    })),
  });
  expect(result.responses.map((response) => response.status)).toEqual(Array(30).fill(200));
  expectLedger(counts(sourceA, 30));
  const before = fingerprint(['auth_request_limits']);
  const windows = ledgerState();
  const rejected = await sendFrom('client-a', {
    jar: result.jar,
    requests: [{ method: 'GET', path: '/api/auth/csrf' }],
  });
  const retry = limited(rejected.responses[0]);
  await restartBackends();
  expect(ledgerState()).toBe(windows);
  const after = await sendFrom('client-a', {
    jar: result.jar,
    requests: [{ method: 'HEAD', path: '/api/auth/CSRF/' }],
  });
  // HEAD carries the same actual denial headers without a response body.
  expect(after.responses[0].status).toBe(429);
  expect(after.responses[0].headers['cache-control']).toContain('no-store');
  expect(Number(after.responses[0].headers['retry-after'])).toBeGreaterThanOrEqual(1);
  expect(Number(after.responses[0].headers['retry-after'])).toBeLessThanOrEqual(retry);
  expect(Date.now() - started).toBeLessThan(55_000);
  expect(ledgerState()).toBe(windows);
  expect(fingerprint(['auth_request_limits'])).toBe(before);
  await anonymous('client-b');
  expectLedger([...counts(sourceA, 30), ...counts(sourceB, 1)]);
});

test('LIMIT-001-B: factor request admission survives both restarts without consuming a recovery code', async ({
  mfa,
}) => {
  const pending = await pendingFrom('client-a');
  const started = Date.now();
  const before = fingerprint(['auth_request_limits']);
  const invalid = await sendFrom('client-a', {
    jar: pending.jar,
    requests: Array.from({ length: 5 }, () => ({
      method: 'POST',
      path: '/api/auth/mfa',
      headers: { 'X-CSRF-Token': pending.csrfToken },
      body: { kind: 'totp', code: 123456 },
    })),
  });
  expect(invalid.responses.map((response) => response.status)).toEqual(Array(5).fill(400));
  expectLedger([...counts(sourceA, 1, 1, 5), ownerCount(1)]);
  const windows = ledgerState();
  const factor = recoveryFactor(mfa);
  const request = {
    method: 'POST',
    path: '/api/auth/mfa',
    headers: { 'X-CSRF-Token': pending.csrfToken },
    body: factor,
  };
  const rejected = await sendFrom('client-a', { jar: pending.jar, requests: [request] });
  const retry = limited(rejected.responses[0]);
  await restartBackends();
  const after = await sendFrom('client-a', { jar: pending.jar, requests: [request] });
  expect(limited(after.responses[0])).toBeLessThanOrEqual(retry);
  expect(Date.now() - started).toBeLessThan(55_000);
  expect(ledgerState()).toBe(windows);
  expect(fingerprint(['auth_request_limits'])).toBe(before);
});

test('LIMIT-001-C: ten overlapping wrong passwords across two real replicas admit exactly five', async () => {
  await selectBackend('both');
  const session = await anonymous('client-a');
  const before = fingerprint(['auth_request_limits']);
  const mark = await upstreamMark();
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      sendFrom('client-a', {
        jar: session.jar,
        requests: wrongLogins(session.csrfToken, 1),
      }),
    ),
  );
  const evidence = (await upstreamsSince(mark)).filter((row) => row.source === clientA);
  expect(evidence).toHaveLength(10);
  expect(new Set(evidence.map((row) => row.backend))).toEqual(new Set(['primary', 'replica']));
  expect(results.map((result) => result.responses[0].status).sort()).toEqual([
    401, 401, 401, 401, 401, 429, 429, 429, 429, 429,
  ]);
  for (const result of results)
    if (result.responses[0].status === 429) limited(result.responses[0]);
  expectLedger([...counts(sourceA, 1, 5), ownerCount(5)]);
  expect(query("SELECT count(*) FROM auth_sessions WHERE state = 'authenticated'")).toBe('0');
  expect(fingerprint(['auth_request_limits'])).toBe(before);
});

for (const email of [owner.email, 'absent-limited@example.invalid']) {
  test(`LIMIT-002-A: normalized account admission aggregates actual A/B sources for ${email}`, async () => {
    const a = await anonymous('client-a');
    const b = await anonymous('client-b');
    const before = fingerprint(['auth_request_limits']);
    for (const [client, session] of [
      ['client-a', a],
      ['client-b', b],
    ] as const) {
      const attempted = await sendFrom(client, {
        jar: session.jar,
        requests: Array.from({ length: 5 }, (_, index) => ({
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'X-CSRF-Token': session.csrfToken },
          body: {
            email: index % 2 ? `  ${email.toUpperCase()}  ` : email,
            password: wrongCredentials.password,
          },
        })),
      });
      expect(attempted.responses.map((response) => response.status)).toEqual(Array(5).fill(401));
    }
    expectLedger([...counts(sourceA, 1, 5), ...counts(sourceB, 1, 5), ownerCount(10, email)]);
    const windows = ledger();
    expireSyntheticLoginSources();
    const denied = await sendFrom('client-a', {
      jar: a.jar,
      requests: [
        {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'X-CSRF-Token': a.csrfToken },
          body: { email, password: owner.password },
        },
      ],
    });
    limited(denied.responses[0], 600);
    expectLedger(
      [...counts(sourceA, 1, 1), ...counts(sourceB, 1), ownerCount(10, email)],
      windows.filter((row) => row.scope !== 'login-ip'),
    );
    expect(fingerprint(['auth_request_limits'])).toBe(before);
  });
}

test('LIMIT-002-C: account denial cannot touch a real full-session re-login', async ({ page }) => {
  const full = await loginWithMfa(page);
  const host = await hostSubject();
  for (const [client, count] of [
    ['client-a', 5],
    ['client-b', 4],
  ] as const) {
    const session = await anonymous(client);
    const wrong = await sendFrom(client, {
      jar: session.jar,
      requests: wrongLogins(session.csrfToken, count),
    });
    expect(wrong.responses.map((response) => response.status)).toEqual(Array(count).fill(401));
  }
  expectLedger([
    ...counts(sourceA, 1, 5),
    ...counts(sourceB, 1, 4),
    ...counts(host, browserCsrfAdmissions(), 1, 1),
    ownerCount(10),
  ]);
  const before = fingerprint(['auth_request_limits']);
  const admissions = ledger();
  const denied = await page.context().request.post('/api/auth/login', {
    headers: { Origin: origin, 'X-CSRF-Token': full.csrfToken },
    data: { email: owner.email, password: owner.password },
  });
  expect(denied.status()).toBe(429);
  expect((await denied.json()).message).toBe('Too many requests');
  expect(denied.headers()['cache-control']).toContain('no-store');
  expect(Number(denied.headers()['retry-after'])).toBeGreaterThanOrEqual(1);
  expect(Number(denied.headers()['retry-after'])).toBeLessThanOrEqual(600);
  expectAdmissionDelta(admissions, [{ scope: 'login-ip', subject: host, hits: 1 }]);
  // Includes the exact full-session lastSeenAt, owner, factors, codes and finances.
  expect(fingerprint(['auth_request_limits'])).toBe(before);
});

test('LIMIT-002-B: invalid source charges zero and invalid session, CSRF or DTO charges only source', async ({
  request,
}) => {
  const a = await anonymous('client-a');
  const before = fingerprint(['auth_request_limits']);
  const original = ledgerState();
  // Send actual malformed JSON bytes: the protocol client intentionally serializes
  // objects and cannot exercise this parser boundary.
  const malformedJson = await request.post('/api/auth/login', {
    headers: { 'Content-Type': 'application/json', Origin: origin },
    data: '{',
  });
  expect(malformedJson.status()).toBe(400);
  expect(ledgerState()).toBe(original);
  expect(fingerprint(['auth_request_limits'])).toBe(before);
  const malformed = await sendDirect('trusted', {
    jar: a.jar,
    requests: [
      {
        method: 'POST',
        path: '/auth/login',
        headers: { 'X-Forwarded-For': [clientA, clientA], 'X-CSRF-Token': a.csrfToken },
        body: wrongCredentials,
      },
    ],
  });
  expect(malformed.responses[0].status).toBe(400);
  expect(ledgerState()).toBe(original);
  const missing = await sendFrom('client-a', { requests: wrongLogins(a.csrfToken, 1) });
  expect(missing.responses[0].status).toBe(403);
  const result = await sendFrom('client-a', {
    jar: a.jar,
    requests: [
      {
        method: 'POST',
        path: '/api/auth/login',
        headers: { Origin: 'https://foreign.example.invalid', 'X-CSRF-Token': a.csrfToken },
        body: wrongCredentials,
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        headers: { 'X-CSRF-Token': 'wrong-csrf' },
        body: wrongCredentials,
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        headers: { 'X-CSRF-Token': a.csrfToken },
        body: { email: [owner.email], password: owner.password },
      },
      ...wrongLogins(a.csrfToken, 1),
    ],
  });
  expect(result.responses.map((response) => response.status)).toEqual([403, 403, 400, 401]);
  expectLedger([...counts(sourceA, 1, 5), ownerCount(1)]);
  expect(fingerprint(['auth_request_limits'])).toBe(before);
});

test('LIMIT-003-A/LIMIT-005-A: success spends slots and repeated denial or real CLI enrollment never resets windows', async ({
  mfa,
}) => {
  const session = await anonymous('client-a');
  const wrong = await sendFrom('client-a', {
    jar: session.jar,
    requests: wrongLogins(session.csrfToken, 2),
  });
  expect(wrong.responses.map((response) => response.status)).toEqual([401, 401]);
  const windows = ledger();
  const login = await sendFrom('client-a', {
    jar: session.jar,
    requests: [
      {
        method: 'POST',
        path: '/api/auth/login',
        headers: { 'X-CSRF-Token': session.csrfToken },
        body: { email: owner.email, password: owner.password },
      },
    ],
  });
  expect(login.responses[0].status).toBe(200);
  const full = await sendFrom('client-a', {
    jar: login.jar,
    requests: [
      {
        method: 'POST',
        path: '/api/auth/mfa',
        headers: { 'X-CSRF-Token': login.responses[0].body.csrfToken },
        body: recoveryFactor(mfa),
      },
    ],
  });
  expect(full.responses[0].status).toBe(200);
  expectLedger([...counts(sourceA, 1, 3, 1), ownerCount(3)], windows);
  const logout = await sendFrom('client-a', {
    jar: full.jar,
    requests: [
      {
        method: 'POST',
        path: '/api/auth/logout',
        headers: { 'X-CSRF-Token': full.responses[0].body.csrfToken },
      },
    ],
  });
  expect(logout.responses[0].status).toBe(204);
  const next = await anonymous('client-a');
  const remaining = await sendFrom('client-a', {
    jar: next.jar,
    requests: wrongLogins(next.csrfToken, 2),
  });
  expect(remaining.responses.map((response) => response.status)).toEqual([401, 401]);
  expectLedger([...counts(sourceA, 2, 5, 1), ownerCount(5)], windows);
  const exhausted = ledgerState();
  const before = fingerprint(['auth_request_limits']);
  let previous = 60;
  for (let index = 0; index < 3; index++) {
    const result = await sendFrom('client-a', {
      jar: next.jar,
      requests: wrongLogins(next.csrfToken, 1),
    });
    const retry = limited(result.responses[0]);
    expect(retry).toBeLessThanOrEqual(previous);
    previous = retry;
    expect(ledgerState()).toBe(exhausted);
    expect(fingerprint(['auth_request_limits'])).toBe(before);
  }
  enrollOwner();
  expect(ledgerState()).toBe(exhausted);
});

test('LIMIT-005-B: a real PostgreSQL admission lock fails HTTPS factor processing closed until an explicit retry', async ({
  mfa,
}) => {
  const pending = await pendingFrom('client-a');
  const factor = recoveryFactor(mfa);
  const attempt = {
    method: 'POST',
    path: '/api/auth/mfa',
    headers: { 'X-CSRF-Token': pending.csrfToken },
    body: factor,
  };
  const before = fingerprint(['auth_request_limits']);
  const admissions = ledgerState();
  await withAdmissionLock(async () => {
    const started = Date.now();
    const result = await sendFrom('client-a', { jar: pending.jar, requests: [attempt] });
    expect(Date.now() - started).toBeLessThan(10_000);
    const response = result.responses[0];
    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.message).toBe('Authentication service unavailable');
    expect(Object.keys(response.body).sort()).toEqual([
      'error',
      'message',
      'path',
      'statusCode',
      'timestamp',
    ]);
    expect(response.body.statusCode).toBe(503);
    expect(response.body.error).toBe('Service Unavailable');
    expect(response.body.path).toBe('/auth/mfa');
    expect(JSON.stringify(response.body).includes(factor.code)).toBe(false);
    expect(ledgerState()).toBe(admissions);
    expect(fingerprint(['auth_request_limits'])).toBe(before);
  });
  // The failed request itself must not execute a delayed admission after release.
  expect(ledgerState()).toBe(admissions);
  expect(fingerprint(['auth_request_limits'])).toBe(before);
  const retry = await sendFrom('client-a', { jar: pending.jar, requests: [attempt] });
  expect(retry.responses[0].status).toBe(200);
  expect(retry.responses[0].body.user).toMatchObject({ id: owner.id });
  expectLedger([...counts(sourceA, 1, 1, 1), ownerCount(1)]);
  expect(query('SELECT count(*) FROM owner_mfa_recovery WHERE "usedAt" IS NOT NULL')).toBe('1');
});
