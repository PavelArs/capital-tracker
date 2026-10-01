import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Browser, type Page, expect } from '@playwright/test';
import {
  counts,
  expectAdmissionDelta,
  expectHostAdmissions,
  expectLedger,
  hostSubject,
  ledger,
  ledgerState,
  ownerCount,
  sourceA,
  sourceB,
} from './admission-fixtures';
import {
  type Enrollment,
  type Factor,
  completeFactor,
  compose,
  cookie,
  cookieName,
  databaseCounter,
  enrollOwner,
  fingerprint,
  getCsrf,
  hashToken,
  nextFactor,
  origin,
  owner,
  passwordStep,
  query,
  recoveryFactor,
  restartBackend,
  test,
  totpAt,
} from './mfa-fixtures';
import { sendFrom } from './source-client';

function authenticatedCount(): number {
  return Number(query("SELECT count(*) FROM auth_sessions WHERE state = 'authenticated'"));
}

function factorState(): string {
  return query(`SELECT md5(jsonb_build_object(
    'mfa', (SELECT to_jsonb(m) FROM owner_mfa m WHERE id = 1),
    'recovery', (SELECT jsonb_agg(to_jsonb(r) ORDER BY "codeHash") FROM owner_mfa_recovery r)
  )::text)`);
}

function providerRequests(): string {
  return compose([
    'exec',
    '-T',
    'providers',
    'node',
    '-e',
    "fetch('http://127.0.0.1:8080/__control/requests').then(r=>r.text()).then(t=>process.stdout.write(t))",
  ]);
}

async function factorRequest(request: APIRequestContext, csrfToken: string, data: unknown) {
  return request.post('/api/auth/mfa', {
    headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
    data,
  });
}

async function independentPending(browser: Browser) {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
  });
  const page = await context.newPage();
  try {
    return { context, page, ...(await passwordStep(page)) };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function rejectFactor(
  request: APIRequestContext,
  csrfToken: string,
  data: unknown,
  status: number,
) {
  const response = await factorRequest(request, csrfToken, data);
  expect(response.status()).toBe(status);
  const body = await response.json();
  expect(Object.hasOwn(body, 'user')).toBe(false);
  expect(Object.hasOwn(body, 'csrfToken')).toBe(false);
  expect((await request.get('/api/auth/me')).status()).toBe(401);
  return body;
}

function unusedWrongCode(enrollment: Enrollment): string {
  const counter = databaseCounter();
  const valid = new Set([-1, 0, 1, 2].map((offset) => totpAt(enrollment, counter + offset)));
  for (let value = 0; value < 100; value++) {
    const code = value.toString().padStart(6, '0');
    if (!valid.has(code)) return code;
  }
  throw new Error('Unable to choose a synthetic invalid factor');
}

async function assertPending(page: Page, token: string) {
  expect(query(`SELECT state FROM auth_sessions WHERE "tokenHash" = '${hashToken(token)}'`)).toBe(
    'pending_mfa',
  );
  expect(
    query(`SELECT "mfaVerifiedAt" IS NULL AND "expiresAt" > clock_timestamp()
    AND "expiresAt" <= "createdAt" + interval '5 minutes'
    FROM auth_sessions WHERE "tokenHash" = '${hashToken(token)}'`),
  ).toBe('t');
  await expect(page.getByLabel('Код из приложения', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
}

test('MFA-002-A: real password submission grants only five-minute pending state and no private access', async ({
  page,
}) => {
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const factorsBefore = factorState();
  const callsBefore = providerRequests();
  const pending = await passwordStep(page);
  await assertPending(page, pending.token);
  for (const path of [
    '/api/auth/me',
    '/api/crypto',
    '/api/assets',
    '/api/liabilities',
    '/api/metrics',
    '/api/currencies/list',
  ]) {
    const response = await page.context().request.get(path);
    expect(response.status(), path).toBe(401);
    expect((await response.text()).includes(owner.email)).toBe(false);
  }
  expect(authenticatedCount()).toBe(0);
  expect(providerRequests()).toBe(callsBefore);
  expect(factorState()).toBe(factorsBefore);
  await expectHostAdmissions(1, 0);
  expect(
    fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
  ).toBe(before);
});

test('MFA-002-B: real TOTP form rotates pending cookie and CSRF into a durable full session', async ({
  page,
  request,
  mfa,
}) => {
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const pending = await passwordStep(page);
  const factor = nextFactor(mfa);
  const full = await completeFactor(page, factor);
  expect(full.token === pending.token).toBe(false);
  expect(full.csrfToken === pending.csrfToken).toBe(false);
  expect(
    query(`SELECT count(*) FROM auth_sessions WHERE "tokenHash" = '${hashToken(pending.token)}'`),
  ).toBe('0');
  expect(
    query(`SELECT state = 'authenticated' AND "mfaVerifiedAt" IS NOT NULL
    AND "expiresAt" <= "createdAt" + interval '12 hours'
    FROM auth_sessions WHERE "tokenHash" = '${hashToken(full.token)}'`),
  ).toBe('t');
  expect(Number(query('SELECT "lastCounter" FROM owner_mfa WHERE id = 1'))).toBeGreaterThan(
    mfa.confirmationCounter,
  );
  expect(
    (
      await request.get('/api/auth/me', { headers: { Cookie: `${cookieName}=${pending.token}` } })
    ).status(),
  ).toBe(401);
  expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('token');
  await restartBackend(request);
  await page.reload();
  await expect(page.getByRole('navigation').getByText(owner.email, { exact: true })).toBeVisible();
  expect((await page.context().request.get('/api/auth/me')).status()).toBe(200);
  await expectHostAdmissions(1, 1);
  expect(
    fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
  ).toBe(before);
});

test('MFA-002-C: a provisioned but explicitly unenrolled owner cannot authenticate with a password', async ({
  request,
}) => {
  // Negative-only fixture: remove the synthetic enrollment; restore through the real CLI.
  query(
    `DELETE FROM owner_mfa_recovery WHERE "userId" = '${owner.id}'; DELETE FROM owner_mfa WHERE id = 1 AND "userId" = '${owner.id}'`,
  );
  try {
    const before = fingerprint([
      'auth_sessions',
      'owner_mfa',
      'owner_mfa_recovery',
      'auth_request_limits',
    ]);
    const csrfToken = await getCsrf(request);
    const response = await request.post('/api/auth/login', {
      headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
      data: { email: owner.email, password: owner.password },
    });
    expect(response.status()).toBe(401);
    expect(Object.hasOwn(await response.json(), 'user')).toBe(false);
    expect((await request.get('/api/auth/me')).status()).toBe(401);
    expect(authenticatedCount()).toBe(0);
    expect(query("SELECT count(*) FROM auth_sessions WHERE state = 'pending_mfa'")).toBe('0');
    await expectHostAdmissions(1, 0, 1);
    expect(
      fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
    ).toBe(before);
  } finally {
    enrollOwner();
  }
});

for (const mismatch of ['expired', 'revision', 'owner'] as const) {
  test(`MFA-002-C: ${mismatch} pending state cannot consume a factor or issue full access`, async ({
    page,
    mfa,
  }) => {
    const pending = await passwordStep(page);
    const before = fingerprint([
      'auth_sessions',
      'owner_mfa',
      'owner_mfa_recovery',
      'auth_request_limits',
    ]);
    const factorsBefore = factorState();
    const mutation =
      mismatch === 'expired'
        ? '"expiresAt" = clock_timestamp() - interval \'1 second\''
        : mismatch === 'revision'
          ? `"credentialVersion" = '${randomUUID()}'`
          : '"userId" = \'22222222-2222-4222-8222-222222222222\'';
    query(`UPDATE auth_sessions SET ${mutation} WHERE "tokenHash" = '${hashToken(pending.token)}'`);
    await rejectFactor(
      page.context().request,
      pending.csrfToken,
      { kind: 'totp', code: totpAt(mfa) },
      401,
    );
    expect(authenticatedCount()).toBe(0);
    expect(factorState()).toBe(factorsBefore);
    await expectHostAdmissions(1, 1);
    expect(
      fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
    ).toBe(before);
  });
}

test('MFA-002-C: anonymous factor submission fails before CSRF and leaves the factor untouched', async ({
  request,
  mfa,
}) => {
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const factorsBefore = factorState();
  const csrfToken = await getCsrf(request);
  for (const csrf of ['', csrfToken]) {
    await rejectFactor(request, csrf, { kind: 'totp', code: totpAt(mfa) }, 401);
  }
  expect(authenticatedCount()).toBe(0);
  expect(factorState()).toBe(factorsBefore);
  await expectHostAdmissions(0, 2, 1, []);
  expect(
    fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
  ).toBe(before);
});

test('MFA-002-C: invalid Origin or CSRF cannot mutate pending authentication state', async ({
  page,
  mfa,
}) => {
  const pending = await passwordStep(page);
  const before = fingerprint(['auth_request_limits']);
  const admissions = ledger();
  const subject = await hostSubject();
  let spent = 0;
  const data = { kind: 'totp', code: totpAt(mfa) };
  for (const headers of [
    { Origin: origin },
    { Origin: origin, 'X-CSRF-Token': 'incorrect-synthetic-csrf' },
    { Origin: 'https://attacker.example.invalid', 'X-CSRF-Token': pending.csrfToken },
    { Origin: 'null', 'X-CSRF-Token': pending.csrfToken },
    { 'X-CSRF-Token': pending.csrfToken },
  ] as Array<Record<string, string>>) {
    const response = await page.context().request.post('/api/auth/mfa', { headers, data });
    expect(response.status()).toBe(403);
    expectAdmissionDelta(admissions, [{ scope: 'mfa-ip', subject, hits: ++spent }]);
    expect(fingerprint(['auth_request_limits'])).toBe(before);
  }
  expect(authenticatedCount()).toBe(0);
});

test('MFA-002-C: logging out a pending challenge prevents factor completion and cookie replay', async ({
  page,
  request,
  mfa,
}) => {
  const pending = await passwordStep(page);
  const factorsBefore = factorState();
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const logout = await page.context().request.post('/api/auth/logout', {
    headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
  });
  expect(logout.status()).toBe(204);
  const response = await request.post('/api/auth/mfa', {
    headers: {
      Origin: origin,
      'X-CSRF-Token': pending.csrfToken,
      Cookie: `${cookieName}=${pending.token}`,
    },
    data: { kind: 'totp', code: totpAt(mfa) },
  });
  expect(response.status()).toBe(401);
  expect(
    query(`SELECT count(*) FROM auth_sessions WHERE "tokenHash" = '${hashToken(pending.token)}'`),
  ).toBe('0');
  expect(authenticatedCount()).toBe(0);
  expect(factorState()).toBe(factorsBefore);
  await expectHostAdmissions(1, 1);
  expect(
    fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
  ).toBe(before);
});

for (const kind of ['totp', 'recovery'] as const) {
  test(`MFA-003-A: malformed ${kind} values remain 400 without coercion or consumed guesses`, async ({
    page,
    mfa,
  }) => {
    const pending = await passwordStep(page);
    const before = fingerprint([
      'auth_sessions',
      'owner_mfa',
      'owner_mfa_recovery',
      'auth_request_limits',
    ]);
    const factorsBefore = factorState();
    const admissions = ledger();
    const subject = await hostSubject();
    let spent = 0;
    const malformed =
      kind === 'totp'
        ? [123456, ['123456'], { code: '123456' }, '１２３４５６', '12345']
        : [
            42,
            mfa.recoveryCodes[0].replaceAll('-', ''),
            ` ${mfa.recoveryCodes[0]}`,
            `${mfa.recoveryCodes[0]} `,
            mfa.recoveryCodes[0].replace('-', '—'),
          ];
    for (const code of malformed) {
      await rejectFactor(page.context().request, pending.csrfToken, { kind, code }, 400);
      expect(factorState()).toBe(factorsBefore);
      expectAdmissionDelta(admissions, [{ scope: 'mfa-ip', subject, hits: ++spent }]);
      expect(
        query(
          `SELECT "failedAttempts" FROM auth_sessions WHERE "tokenHash" = '${hashToken(pending.token)}'`,
        ),
      ).toBe('0');
    }
    expect(authenticatedCount()).toBe(0);
    await expectHostAdmissions(1, 5);
    expect(
      fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
    ).toBe(before);
  });
}

test('MFA-003-B: confirmation and login counters cannot be reused, including after restart', async ({
  page,
  browser,
  request,
  mfa,
}) => {
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const pending = await passwordStep(page);
  await rejectFactor(
    page.context().request,
    pending.csrfToken,
    { kind: 'totp', code: totpAt(mfa, mfa.confirmationCounter) },
    401,
  );
  const used = { kind: 'totp', code: totpAt(mfa) } satisfies Factor;
  await completeFactor(page, used);
  const lastCounter = query('SELECT "lastCounter" FROM owner_mfa WHERE id = 1');
  const replay = await independentPending(browser);
  try {
    await rejectFactor(replay.context.request, replay.csrfToken, used, 401);
    await restartBackend(request);
    await rejectFactor(replay.context.request, replay.csrfToken, used, 401);
    expect(query('SELECT "lastCounter" FROM owner_mfa WHERE id = 1')).toBe(lastCounter);
    expect(authenticatedCount()).toBe(1);
    await expectHostAdmissions(2, 4);
    expect(
      fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
    ).toBe(before);
  } finally {
    await replay.context.close();
  }
});

for (const kind of ['totp', 'recovery'] as const) {
  test(`MFA-003-B/MFA-004-A: concurrent real ${kind} verification issues exactly one full session`, async ({
    browser,
    request,
    mfa,
  }) => {
    const before = fingerprint([
      'auth_sessions',
      'owner_mfa',
      'owner_mfa_recovery',
      'auth_request_limits',
    ]);
    const left = await independentPending(browser);
    const right = await independentPending(browser);
    try {
      const factor = kind === 'totp' ? { kind, code: totpAt(mfa) } : recoveryFactor(mfa);
      const responses = await Promise.all([
        factorRequest(left.context.request, left.csrfToken, factor),
        factorRequest(right.context.request, right.csrfToken, factor),
      ]);
      expect(responses.map((response) => response.status()).sort()).toEqual([200, 401]);
      expect(authenticatedCount()).toBe(1);
      const winner = responses[0].status() === 200 ? left : right;
      const loser = responses[0].status() === 401 ? left : right;
      expect((await winner.context.request.get('/api/auth/me')).status()).toBe(200);
      expect((await loser.context.request.get('/api/auth/me')).status()).toBe(401);
      const full = await cookie(winner.page);
      expect(full === winner.token).toBe(false);
      expect(
        query(
          `SELECT count(*) FROM auth_sessions WHERE "tokenHash" = '${hashToken(winner.token)}'`,
        ),
      ).toBe('0');
      if (kind === 'recovery')
        expect(query('SELECT count(*) FROM owner_mfa_recovery WHERE "usedAt" IS NOT NULL')).toBe(
          '1',
        );
      await restartBackend(request);
      await rejectFactor(loser.context.request, loser.csrfToken, factor, 401);
      expect(authenticatedCount()).toBe(1);
      if (kind === 'recovery')
        expect(query('SELECT count(*) FROM owner_mfa_recovery WHERE "usedAt" IS NOT NULL')).toBe(
          '1',
        );
      await expectHostAdmissions(2, 3);
      expect(
        fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
      ).toBe(before);
    } finally {
      await left.context.close();
      await right.context.close();
    }
  });
}

test('MFA-004-A: the real recovery form accepts case-insensitive CLI codes once', async ({
  page,
  browser,
  mfa,
}) => {
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  await passwordStep(page);
  const factor = recoveryFactor(mfa);
  const lastCounter = query('SELECT "lastCounter" FROM owner_mfa WHERE id = 1');
  await completeFactor(page, { ...factor, code: factor.code.toUpperCase() });
  expect(query('SELECT count(*) FROM owner_mfa_recovery WHERE "usedAt" IS NOT NULL')).toBe('1');
  expect(query('SELECT "lastCounter" FROM owner_mfa WHERE id = 1')).toBe(lastCounter);
  const replay = await independentPending(browser);
  try {
    await rejectFactor(replay.context.request, replay.csrfToken, factor, 401);
    expect(query('SELECT count(*) FROM owner_mfa_recovery WHERE "usedAt" IS NOT NULL')).toBe('1');
    expect(authenticatedCount()).toBe(1);
    await expectHostAdmissions(2, 2);
    expect(
      fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
    ).toBe(before);
  } finally {
    await replay.context.close();
  }
});

test('MFA-005-A/MFA-005-B: challenge and owner lockouts persist across renewal and restart, then expire', async ({
  browser,
  request,
  mfa,
}) => {
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const wrong = { kind: 'totp', code: unusedWrongCode(mfa) };
  for (const [challenge, client] of (['client-a', 'client-b'] as const).entries()) {
    const csrf = await sendFrom(client, {
      requests: [{ method: 'GET', path: '/api/auth/csrf' }],
    });
    expect(csrf.responses[0].status).toBe(200);
    const login = await sendFrom(client, {
      jar: csrf.jar,
      requests: [
        {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'X-CSRF-Token': csrf.responses[0].body.csrfToken },
          body: { email: owner.email, password: owner.password },
        },
      ],
    });
    expect(login.responses[0].status).toBe(200);
    const token = login.jar[cookieName];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await sendFrom(client, {
        jar: login.jar,
        requests: [
          {
            method: 'POST',
            path: '/api/auth/mfa',
            headers: { 'X-CSRF-Token': login.responses[0].body.csrfToken },
            body: wrong,
          },
        ],
      });
      expect(response.responses[0].status).toBe(challenge === 1 && attempt === 5 ? 429 : 401);
    }
    expect(
      query(`SELECT count(*) FROM auth_sessions WHERE "tokenHash" = '${hashToken(token)}'`),
    ).toBe('0');
    expect(query('SELECT "failedAttempts" FROM owner_mfa WHERE id = 1')).toBe(
      String((challenge + 1) * 5),
    );
    expect(authenticatedCount()).toBe(0);
    const admissions = ledgerState();
    await restartBackend(request);
    expect(ledgerState(), 'Both process restarts preserve request windows').toBe(admissions);
  }
  const blocked = await independentPending(browser);
  try {
    const host = await hostSubject();
    expect([sourceA, sourceB]).not.toContain(host);
    const admissions = ledger();
    const blockedState = fingerprint(['auth_request_limits']);
    let spent = 0;
    const deadline = query('SELECT "blockedUntil"::text FROM owner_mfa WHERE id = 1');
    expect(query('SELECT "blockedUntil" > clock_timestamp() FROM owner_mfa WHERE id = 1')).toBe(
      't',
    );
    const factor = { kind: 'totp', code: totpAt(mfa) };
    for (const extra of [
      {},
      { 'X-Forwarded-For': '203.0.113.19', 'X-Real-IP': '203.0.113.20' },
    ] as Array<Record<string, string>>) {
      const response = await blocked.context.request.post('/api/auth/mfa', {
        headers: { Origin: origin, 'X-CSRF-Token': blocked.csrfToken, ...extra },
        data: factor,
      });
      expect(response.status()).toBe(429);
      expect((await response.json()).message).toBe('Too many attempts');
      expect(fingerprint(['auth_request_limits'])).toBe(blockedState);
      expectAdmissionDelta(admissions, [{ scope: 'mfa-ip', subject: host, hits: ++spent }]);
      expect(query('SELECT "blockedUntil"::text FROM owner_mfa WHERE id = 1')).toBe(deadline);
    }
    // External negative-time fixture expires an existing block; never fabricates authentication.
    query(`UPDATE owner_mfa SET "blockedUntil" = clock_timestamp() - interval '1 second',
      "failureWindowStart" = clock_timestamp() - interval '11 minutes' WHERE id = 1`);
    const result = await factorRequest(blocked.context.request, blocked.csrfToken, {
      kind: 'totp',
      code: totpAt(mfa),
    });
    expect(result.status()).toBe(200);
    expect((await blocked.context.request.get('/api/auth/me')).status()).toBe(200);
    expect(
      query('SELECT "failedAttempts" = 0 AND "blockedUntil" IS NULL FROM owner_mfa WHERE id = 1'),
    ).toBe('t');
    expect(authenticatedCount()).toBe(1);
    expectLedger([
      ...counts(sourceA, 1, 1, 5),
      ...counts(sourceB, 1, 1, 5),
      ...counts(host, 1, 1, 3),
      ownerCount(3),
    ]);
    expect(
      fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
    ).toBe(before);
  } finally {
    await blocked.context.close();
  }
});

test('MFA-001-C: CLI-confirmed replacement invalidates old factors, codes, and pending/full cookies', async ({
  page,
  browser,
  request,
  mfa,
}) => {
  const before = fingerprint([
    'owner_auth',
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  await passwordStep(page);
  const full = await completeFactor(page);
  const pending = await independentPending(browser);
  try {
    const replacement = enrollOwner();
    expect(query(`SELECT count(*) FROM auth_sessions WHERE "userId" = '${owner.id}'`)).toBe('0');
    for (const token of [full.token, pending.token]) {
      expect(
        (
          await request.get('/api/auth/me', { headers: { Cookie: `${cookieName}=${token}` } })
        ).status(),
      ).toBe(401);
    }
    const nextPending = await passwordStep(page);
    await rejectFactor(page.context().request, nextPending.csrfToken, recoveryFactor(mfa), 401);
    await rejectFactor(
      page.context().request,
      nextPending.csrfToken,
      { kind: 'totp', code: totpAt(mfa) },
      401,
    );
    await completeFactor(page, nextFactor(replacement));
    expect(authenticatedCount()).toBe(1);
    expect(query('SELECT "userId" FROM owner_auth WHERE id = 1')).toBe(owner.id);
    await expectHostAdmissions(3, 4);
    expect(
      fingerprint([
        'owner_auth',
        'auth_sessions',
        'owner_mfa',
        'owner_mfa_recovery',
        'auth_request_limits',
      ]),
    ).toBe(before);
  } finally {
    await pending.context.close();
  }
});

test('MFA-001-A: no public HTTP enrollment or replacement route exists', async ({ request }) => {
  const before = fingerprint([]);
  for (const path of [
    '/api/auth/mfa/prepare',
    '/api/auth/mfa/confirm',
    '/api/auth/mfa/enroll',
    '/api/auth/mfa/setup',
  ]) {
    const response = await request.post(path, { data: { userId: owner.id } });
    expect(response.status()).toBe(404);
    expect(fingerprint([])).toBe(before);
  }
});

test('MFA-003-A: factor failures and request logs never echo submitted codes or enrollment secrets', async ({
  page,
  mfa,
}) => {
  const pending = await passwordStep(page);
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const wrong = unusedWrongCode(mfa);
  const response = await factorRequest(page.context().request, pending.csrfToken, {
    kind: 'totp',
    code: wrong,
  });
  expect(response.status()).toBe(401);
  expect((await response.text()).includes(wrong)).toBe(false);
  const full = await completeFactor(page, recoveryFactor(mfa));
  const logs = compose(['logs', '--no-color', '--tail', '1500', 'backend', 'backend-replica']);
  const secret = new URL(mfa.uri).searchParams.get('secret');
  expect(typeof secret).toBe('string');
  for (const value of [
    mfa.uri,
    secret!,
    pending.token,
    pending.csrfToken,
    full.token,
    full.csrfToken,
    ...mfa.recoveryCodes,
  ]) {
    expect(logs.includes(value)).toBe(false);
  }
  // Exact JSON values avoid accidentally matching a six-digit substring of a timestamp.
  expect(new RegExp(`"code"\\s*:\\s*"${wrong}"`).test(logs)).toBe(false);
  await expectHostAdmissions(1, 2);
  expect(
    fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
  ).toBe(before);
});

test('MFA-006-A: a tampered active envelope fails safely without consuming the real factor', async ({
  page,
  mfa,
}) => {
  const pending = await passwordStep(page);
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const lastCounter = query('SELECT "lastCounter" FROM owner_mfa WHERE id = 1');
  const code = totpAt(mfa);
  // Negative-only database fixture. Replacement through the trusted CLI restores validity.
  query(
    `UPDATE owner_mfa SET "activeEnvelope" = jsonb_set("activeEnvelope", '{tag}', '"AAAAAAAAAAAAAAAAAAAAAA=="'::jsonb) WHERE id = 1`,
  );
  try {
    const response = await factorRequest(page.context().request, pending.csrfToken, {
      kind: 'totp',
      code,
    });
    expect(response.status()).toBe(401);
    expect((await response.text()).includes(code)).toBe(false);
    expect(authenticatedCount()).toBe(0);
    expect(query('SELECT "lastCounter" FROM owner_mfa WHERE id = 1')).toBe(lastCounter);
    expect(query('SELECT count(*) FROM owner_mfa_recovery WHERE "usedAt" IS NOT NULL')).toBe('0');
    expect((await page.context().request.get('/api/auth/me')).status()).toBe(401);
    await expectHostAdmissions(1, 1);
    expect(
      fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
    ).toBe(before);
  } finally {
    enrollOwner();
  }
});

test('MFA-003-A/SES-002-D: toString objects in login and factor fields return 400 without state changes', async ({
  page,
  request,
  mfa,
}) => {
  const pending = await passwordStep(page);
  const anonymousCsrf = await getCsrf(request);
  const before = fingerprint([
    'auth_sessions',
    'owner_mfa',
    'owner_mfa_recovery',
    'auth_request_limits',
  ]);
  const factorsBefore = factorState();
  const admissions = ledger();
  const subject = await hostSubject();
  let loginSpent = 0;
  let factorSpent = 0;
  const assertUnchanged = async () => {
    expect(factorState()).toBe(factorsBefore);
    expectAdmissionDelta(admissions, [
      { scope: 'login-ip', subject, hits: loginSpent },
      { scope: 'mfa-ip', subject, hits: factorSpent },
    ]);
    expect(
      fingerprint(['auth_sessions', 'owner_mfa', 'owner_mfa_recovery', 'auth_request_limits']),
    ).toBe(before);
    expect(authenticatedCount()).toBe(0);
    expect(
      query(`SELECT state = 'pending_mfa' AND "failedAttempts" = 0
        FROM auth_sessions WHERE "tokenHash" = '${hashToken(pending.token)}'`),
    ).toBe('t');
    expect((await page.context().request.get('/api/auth/me')).status()).toBe(401);
  };

  // Together with the genuine password step, this uses only three login requests.
  // These JSON properties are strings, not callable JavaScript conversion methods.
  for (const data of [
    { email: { toString: owner.email }, password: owner.password },
    { email: owner.email, password: { toString: owner.password } },
  ]) {
    const response = await request.post('/api/auth/login', {
      headers: { Origin: origin, 'X-CSRF-Token': anonymousCsrf },
      data,
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(Object.hasOwn(body, 'user')).toBe(false);
    expect(JSON.stringify(body).includes(owner.password)).toBe(false);
    expect((await request.get('/api/auth/me')).status()).toBe(401);
    loginSpent++;
    await assertUnchanged();
  }

  const freshCode = totpAt(mfa);
  for (const data of [
    { kind: 'totp', code: { toString: freshCode } },
    { kind: { toString: 'totp' }, code: freshCode },
  ]) {
    const body = await rejectFactor(page.context().request, pending.csrfToken, data, 400);
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(JSON.stringify(body).includes(freshCode)).toBe(false);
    factorSpent++;
    await assertUnchanged();
  }
});
