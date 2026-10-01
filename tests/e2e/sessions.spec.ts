import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { type APIRequestContext, type APIResponse, type Page, expect } from '@playwright/test';
import {
  expectAdmissionDelta,
  expectHostAdmissions,
  hostSubject,
  ledger,
  observeBrowserCsrf,
  ownerCount,
  subjectHash,
} from './admission-fixtures';
import { loginWithMfa, recoveryFactor, test } from './mfa-fixtures';
import { restartBackends } from './replicas';

// All credentials and database rows belong to the disposable HTTPS acceptance project.
const repositoryRoot = resolve(__dirname, '../..');
const composeFile = resolve(repositoryRoot, 'tests/e2e/compose.yml');
const ownerId = '11111111-1111-4111-8111-111111111111';
const ownerEmail = 'owner@example.invalid';
const ownerPassword = 'Synthetic-password-42!';
const origin = 'https://127.0.0.1:8443';
const cookieName = '__Host-ct-session';

type SessionRow = {
  tokenHash: string;
  csrfToken: string;
  state: 'anonymous' | 'pending_mfa' | 'authenticated';
  userId: string | null;
  credentialVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

function compose(...args: string[]): string {
  return execFileSync(
    'docker',
    ['compose', '-p', 'capital-tracker-e2e', '-f', composeFile, ...args],
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 },
  ).trim();
}

function query(sql: string): string {
  return compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'capital_e2e',
    '-d',
    'capital_tracker_e2e',
    '-At',
    '-c',
    sql,
  );
}

async function restartBackend(request: APIRequestContext): Promise<void> {
  await restartBackends();
  await expect
    .poll(
      async () => {
        try {
          return (await request.get('/api/health', { timeout: 2_000 })).status();
        } catch {
          return 0;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(200);
}

function tokenHash(token: string): string {
  expect(/^[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
  expect(Buffer.from(token, 'base64url').length).toBe(32);
  return createHash('sha256').update(token).digest('hex');
}

function sessionRows(token: string): SessionRow[] {
  return JSON.parse(
    query(`SELECT COALESCE(json_agg(s), '[]') FROM auth_sessions s
    WHERE "tokenHash" = '${tokenHash(token)}'`),
  );
}

function fingerprint(includeSessions = false, excludeAdmissions = false): string {
  const tables = query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )
    .split('\n')
    .filter(
      (name) =>
        includeSessions || !['auth_sessions', 'owner_mfa', 'owner_mfa_recovery'].includes(name),
    );
  if (excludeAdmissions) {
    expect(tables).toContain('auth_request_limits');
    tables.splice(tables.indexOf('auth_request_limits'), 1);
  }
  expect(tables).toContain('crypto_wallets');
  expect(tables).toContain('owner_auth');
  for (const table of tables) expect(table).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  return query(
    tables
      .map(
        (table) => `SELECT '${table}',
    md5(COALESCE(jsonb_agg(row_data ORDER BY row_data::text)::text, '[]'))
    FROM (SELECT to_jsonb(t) AS row_data FROM public."${table}" t) rows`,
      )
      .join(' UNION ALL '),
  );
}

function noStore(response: APIResponse): void {
  expect(response.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
}

async function csrf(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/csrf');
  expect(response.status()).toBe(200);
  noStore(response);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(['csrfToken']);
  expect(typeof body.csrfToken).toBe('string');
  expect(/^[A-Za-z0-9_-]{43}$/.test(body.csrfToken)).toBe(true);
  return body.csrfToken;
}

async function sessionCookie(page: Page): Promise<string> {
  const cookies = (await page.context().cookies(origin)).filter(
    (cookie) => cookie.name === cookieName,
  );
  expect(cookies).toHaveLength(1);
  const cookie = cookies[0];
  expect({
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    domain: cookie.domain,
    path: cookie.path,
  }).toEqual({ secure: true, httpOnly: true, sameSite: 'Strict', domain: '127.0.0.1', path: '/' });
  tokenHash(cookie.value);
  expect((await page.evaluate(() => document.cookie)).includes(cookieName)).toBe(false);
  return cookie.value;
}

async function browserLogin(page: Page): Promise<{ token: string; csrfToken: string }> {
  return loginWithMfa(page);
}

async function deniedReplay(request: APIRequestContext, token: string): Promise<void> {
  // A copied real credential is used only to prove revocation, never to create positive auth.
  const response = await request.get('/api/auth/me', {
    headers: { Cookie: `${cookieName}=${token}` },
  });
  expect(response.status()).toBe(401);
  noStore(response);
  expect((await response.text()).includes(ownerEmail)).toBe(false);
}

function preferences(): string {
  return query(`SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text, '[]')
    FROM user_currency_preferences p WHERE "userId" = '${ownerId}'::uuid`);
}

test('SES-001-B: real browser logout revokes a copied issued credential', async ({
  page,
  request,
}) => {
  const { token } = await browserLogin(page);
  const before = fingerprint();
  const pending = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/logout',
  );
  await page.getByRole('button', { name: 'Выход', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(204);
  const clearCookie =
    (await response.headersArray()).find((header) => header.name.toLowerCase() === 'set-cookie')
      ?.value ?? '';
  expect(clearCookie.startsWith(`${cookieName}=`)).toBe(true);
  expect(clearCookie).toMatch(/;\s*Path=\//i);
  expect(clearCookie).toMatch(/;\s*HttpOnly/i);
  expect(clearCookie).toMatch(/;\s*Secure/i);
  expect(clearCookie).toMatch(/;\s*SameSite=Strict/i);
  expect(clearCookie).not.toMatch(/;\s*Domain=/i);
  expect(clearCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  await expect(page).toHaveURL(`${origin}/login`);
  await deniedReplay(request, token);
  expect(sessionRows(token)).toHaveLength(0);
  expect(fingerprint()).toBe(before);
});

test('SES-001-A: successful browser login exposes no bearer or browser-storage credential', async ({
  page,
}) => {
  observeBrowserCsrf(page);
  await page.goto('/login');
  await page.evaluate(() =>
    localStorage.setItem('token', 'synthetic-legacy-token-must-be-cleared'),
  );
  let bearerSent = false;
  page.on('request', (request) => {
    bearerSent ||= Boolean(request.headers().authorization);
  });
  const before = fingerprint(false, true);
  await csrf(page.context().request);
  const anonymous = await sessionCookie(page);
  const anonRows = sessionRows(anonymous);
  expect(anonRows).toHaveLength(1);
  expect(anonRows[0].state).toBe('anonymous');
  expect(anonRows[0].userId).toBeNull();
  expect(
    new Date(anonRows[0].expiresAt).getTime() - new Date(anonRows[0].createdAt).getTime(),
  ).toBe(300_000);
  const { token, csrfToken } = await browserLogin(page);
  expect(token === anonymous).toBe(false);
  expect(sessionRows(anonymous)).toHaveLength(0);
  const rows = sessionRows(token);
  expect(rows).toHaveLength(1);
  expect(rows[0].state).toBe('authenticated');
  expect(rows[0].userId).toBe(ownerId);
  expect(rows[0].csrfToken === csrfToken).toBe(true);
  expect(rows[0].csrfToken === anonRows[0].csrfToken).toBe(false);
  expect(rows[0].tokenHash === token).toBe(false);
  expect(
    query("SELECT COALESCE(json_agg(s)::text, '[]') FROM auth_sessions s").includes(token),
  ).toBe(false);
  expect(new Date(rows[0].expiresAt).getTime() - new Date(rows[0].createdAt).getTime()).toBe(
    43_200_000,
  );
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(Object.hasOwn(storage.local, 'token')).toBe(false);
  expect(Object.hasOwn(storage.session, 'token')).toBe(false);
  expect(JSON.stringify(storage).includes(token)).toBe(false);
  expect(JSON.stringify(storage).includes(csrfToken)).toBe(false);
  expect(bearerSent).toBe(false);
  await expectHostAdmissions(1, 1, 1);
  expect(fingerprint(false, true)).toBe(before);
});

test('SES-002-A: missing CSRF and foreign Origin cannot hide owner currencies', async ({
  page,
  request,
}) => {
  const { csrfToken } = await browserLogin(page);
  const foreignCsrf = await csrf(request);
  const currencies = JSON.parse(
    query(`SELECT json_agg(c) FROM (
    SELECT id, code FROM currencies WHERE "isSystem" = true AND code IN ('USD', 'EUR') ORDER BY code
  ) c`),
  ) as { id: string; code: string }[];
  expect(currencies).toHaveLength(2);
  const preferencesBefore = preferences();
  const before = fingerprint(true);
  const cases: { name: string; headers: Record<string, string> }[] = [
    { name: 'missing CSRF', headers: { Origin: origin } },
    { name: 'wrong CSRF', headers: { Origin: origin, 'X-CSRF-Token': 'A'.repeat(43) } },
    { name: 'cross-session CSRF', headers: { Origin: origin, 'X-CSRF-Token': foreignCsrf } },
    { name: 'missing Origin', headers: { 'X-CSRF-Token': csrfToken } },
    ...[
      'null',
      'https://foreign.example.invalid',
      'http://127.0.0.1:8443',
      'https://127.0.0.1:8444',
      `${origin}.foreign.example.invalid`,
      `${origin} https://foreign.example.invalid`,
    ].map((value) => ({
      name: `Origin ${value}`,
      headers: { Origin: value, 'X-CSRF-Token': csrfToken },
    })),
    {
      name: 'forged forwarding headers',
      headers: {
        Origin: 'https://foreign.example.invalid',
        'X-CSRF-Token': csrfToken,
        Host: 'foreign.example.invalid',
        'X-Forwarded-Host': 'foreign.example.invalid',
        'X-Forwarded-Proto': 'https',
      },
    },
  ];
  for (const example of cases) {
    const response = await page.context().request.post('/api/currencies/hide', {
      headers: example.headers,
      data: { currencyId: currencies[0].id, isHidden: true },
    });
    expect(response.status(), example.name).toBe(403);
    noStore(response);
    expect(preferences(), `${example.name}: denied write preserves existing preferences`).toBe(
      preferencesBefore,
    );
    expect(fingerprint(true), `${example.name}: denied write leaves all state unchanged`).toBe(
      before,
    );
  }
});

test('SES-004-A: backend root is private by default', async ({ request }) => {
  for (const path of [
    '/api/',
    '/api/auth/me',
    '/api/assets',
    '/api/liabilities',
    '/api/crypto',
    '/api/currencies/list',
    '/api/metrics',
    '/api/metrics/history',
    '/api/health/details',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    noStore(response);
  }
  expect((await request.get('/api/does-not-exist')).status()).toBe(404);
  expect((await request.post('/api/auth/register', { data: {} })).status()).toBe(404);
});

test('SES-004-A: public liveness contains only the minimal status', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('SES-002-B: login requires pre-session, exact Origin and bound CSRF before password verification', async ({
  request,
}) => {
  const data = { email: ownerEmail, password: ownerPassword };
  const admissions = ledger();
  const subject = await hostSubject();
  const before = fingerprint(true, true);
  const noSession = await request.post('/api/auth/login', {
    headers: { Origin: origin, 'X-CSRF-Token': 'A'.repeat(43) },
    data,
  });
  expect(noSession.status()).toBe(403);
  expectAdmissionDelta(admissions, [{ scope: 'login-ip', subject, hits: 1 }]);
  expect(fingerprint(true, true)).toBe(before);
  const csrfToken = await csrf(request);
  const admissionsInvalid = ledger();
  let spent = 0;
  const beforeInvalid = fingerprint(true, true);
  for (const headers of [
    { Origin: origin },
    { 'X-CSRF-Token': csrfToken },
    { Origin: 'https://foreign.example.invalid', 'X-CSRF-Token': csrfToken },
  ] as Array<Record<string, string>>) {
    const response = await request.post('/api/auth/login', { headers, data });
    expect(response.status()).toBe(403);
    expectAdmissionDelta(admissionsInvalid, [{ scope: 'login-ip', subject, hits: ++spent }]);
    noStore(response);
    expect(fingerprint(true, true)).toBe(beforeInvalid);
  }
  expect((await request.get('/api/auth/me')).status()).toBe(401);
});

test('SES-002-B: forged logout cannot revoke an authenticated session', async ({ page }) => {
  const { token, csrfToken } = await browserLogin(page);
  const before = fingerprint(true);
  for (const headers of [{ Origin: origin }, { 'X-CSRF-Token': csrfToken }] as Array<
    Record<string, string>
  >) {
    const response = await page.context().request.post('/api/auth/logout', { headers });
    expect(response.status()).toBe(403);
    noStore(response);
    expect(fingerprint(true)).toBe(before);
    expect((await sessionCookie(page)) === token).toBe(true);
  }
  expect((await page.context().request.get('/api/auth/me')).status()).toBe(200);
});

test('SES-002-C: two tabs reuse CSRF and foreign Origin cannot read or allocate it', async ({
  page,
  request,
}) => {
  await browserLogin(page);
  const first = await csrf(page.context().request);
  const token = await sessionCookie(page);
  const secondTab = await page.context().newPage();
  await secondTab.goto('/login');
  const second = await secondTab.evaluate(async () => {
    const response = await fetch('/api/auth/csrf');
    return { status: response.status, body: await response.json() };
  });
  expect(second.status).toBe(200);
  expect(second.body.csrfToken === first).toBe(true);
  expect((await sessionCookie(page)) === token).toBe(true);
  await secondTab.waitForLoadState('networkidle');
  const admissions = ledger();
  const subject = await hostSubject();
  let spent = 0;
  const before = fingerprint(true, true);
  for (const client of [request, page.context().request]) {
    const response = await client.get('/api/auth/csrf', {
      headers: { Origin: 'https://foreign.example.invalid' },
    });
    expect(response.status()).toBe(403);
    expectAdmissionDelta(admissions, [{ scope: 'csrf-ip', subject, hits: ++spent }]);
    noStore(response);
    expect((await response.text()).includes(first)).toBe(false);
    expect(fingerprint(true, true)).toBe(before);
  }
  await secondTab.close();
});

test('SES-001-D: malformed, duplicate, anonymous, header and URL credentials cannot authenticate', async ({
  page,
  request,
}) => {
  const { token } = await browserLogin(page);
  await csrf(request);
  // The request fixture has only an anonymous cookie; private access must still fail.
  expect((await request.get('/api/auth/me')).status()).toBe(401);
  for (const cookie of [
    `${cookieName}=malformed`,
    `${cookieName}=${'A'.repeat(43)}`,
    `${cookieName}=${token}; ${cookieName}=${token}`,
    `${cookieName}=${token}; ${cookieName}=malformed`,
    `${cookieName}=malformed; ${cookieName}=${token}`,
  ]) {
    const response = await request.get('/api/auth/me', { headers: { Cookie: cookie } });
    expect(response.status()).toBe(401);
    noStore(response);
  }
  for (const headers of [
    { Authorization: `Bearer ${token}` },
    { 'X-Session-Token': token },
  ] as Array<Record<string, string>>) {
    expect((await request.get('/api/auth/me', { headers })).status()).toBe(401);
  }
  expect((await request.get(`/api/auth/me?token=${token}`)).status()).toBe(401);
});

test('SES-001-C: activity and backend restart retain a session without extending absolute expiry', async ({
  page,
  request,
}) => {
  const { token } = await browserLogin(page);
  query(`UPDATE auth_sessions SET "lastSeenAt" = clock_timestamp() - interval '20 minutes'
    WHERE "tokenHash" = '${tokenHash(token)}'`);
  const before = sessionRows(token)[0];
  const response = await page.context().request.get('/api/auth/me');
  expect(response.status()).toBe(200);
  noStore(response);
  const touched = sessionRows(token)[0];
  expect(new Date(touched.lastSeenAt).getTime()).toBeGreaterThan(
    new Date(before.lastSeenAt).getTime(),
  );
  expect(touched.expiresAt).toBe(before.expiresAt);
  await restartBackend(request);
  await page.reload();
  await expect(page.getByRole('navigation').getByText(ownerEmail, { exact: true })).toBeVisible();
  expect((await sessionCookie(page)) === token).toBe(true);
  expect(sessionRows(token)[0].expiresAt).toBe(before.expiresAt);
});

for (const boundary of ['idle', 'absolute'] as const) {
  test(`SES-001-C: the PostgreSQL ${boundary} expiry boundary denies access without revival`, async ({
    page,
    request,
  }) => {
    const { token } = await browserLogin(page);
    const admissions = ledger();
    const subject = await hostSubject();
    const before = fingerprint(false, true);
    const times =
      boundary === 'idle'
        ? '"lastSeenAt" = clock_timestamp() - interval \'30 minutes\''
        : '"createdAt" = clock_timestamp() - interval \'12 hours\', "expiresAt" = clock_timestamp(), "lastSeenAt" = clock_timestamp()';
    query(`UPDATE auth_sessions SET ${times} WHERE "tokenHash" = '${tokenHash(token)}'`);
    const expired = sessionRows(token)[0];
    await deniedReplay(request, token);
    const after = sessionRows(token);
    expect(after.length === 0 || after[0].lastSeenAt === expired.lastSeenAt).toBe(true);
    await csrf(page.context().request);
    expect((await sessionCookie(page)) === token).toBe(false);
    expect((await page.context().request.get('/api/auth/me')).status()).toBe(401);
    await deniedReplay(request, token);
    expectAdmissionDelta(admissions, [{ scope: 'csrf-ip', subject, hits: 1 }]);
    expect(fingerprint(false, true)).toBe(before);
  });
}

test('SES-001-A: re-login rotates an authenticated cookie and consumes the old CSRF', async ({
  page,
  request,
}) => {
  const first = await browserLogin(page);
  // The UI redirects an already authenticated owner away from /login. Re-enter the real
  // password through the same browser cookie jar to exercise server-side re-login rotation.
  const relogin = await page.context().request.post('/api/auth/login', {
    headers: { Origin: origin, 'X-CSRF-Token': first.csrfToken },
    data: { email: ownerEmail, password: ownerPassword },
  });
  expect(relogin.status()).toBe(200);
  const body = await relogin.json();
  expect(Object.keys(body).sort()).toEqual(['csrfToken', 'mfaRequired']);
  expect(body.mfaRequired).toBe(true);
  expect((await page.context().request.get('/api/auth/me')).status()).toBe(401);
  const completed = await page.context().request.post('/api/auth/mfa', {
    headers: { Origin: origin, 'X-CSRF-Token': body.csrfToken },
    data: recoveryFactor(),
  });
  expect(completed.status()).toBe(200);
  const full = await completed.json();
  expect(Object.keys(full).sort()).toEqual(['csrfToken', 'user']);
  const second = { token: await sessionCookie(page), csrfToken: full.csrfToken as string };
  await expectHostAdmissions(2, 2);
  expect(first.token === second.token).toBe(false);
  expect(first.csrfToken === second.csrfToken).toBe(false);
  expect(sessionRows(first.token)).toHaveLength(0);
  await deniedReplay(request, first.token);
  const before = fingerprint(true);
  const response = await page.context().request.post('/api/auth/logout', {
    headers: { Origin: origin, 'X-CSRF-Token': first.csrfToken },
  });
  expect(response.status()).toBe(403);
  expect(fingerprint(true)).toBe(before);
  expect((await page.context().request.get('/api/auth/me')).status()).toBe(200);
});

test('SES-004-B: auth/private responses are no-store and logs redact captured credentials', async ({
  page,
  request,
}) => {
  const { token, csrfToken } = await browserLogin(page);
  for (const path of ['/api/auth/me', '/api/crypto']) {
    const response = await page.context().request.get(path);
    expect(response.status()).toBe(200);
    noStore(response);
    const denied = await request.get(path);
    expect(denied.status()).toBe(401);
    noStore(denied);
  }
  const rejected = await page.context().request.post('/api/auth/logout', {
    headers: { Origin: 'https://foreign.example.invalid', 'X-CSRF-Token': csrfToken },
  });
  expect(rejected.status()).toBe(403);
  noStore(rejected);
  // This independent request jar has no cookie. A URL credential cannot authenticate,
  // and even a rejected credential must not be echoed through error paths or request logs.
  const urlCredential = await request.get(`/api/auth/me?token=${token}`);
  expect(urlCredential.status()).toBe(401);
  noStore(urlCredential);
  expect((await urlCredential.text()).includes(token)).toBe(false);
  const logs = compose('logs', '--no-color', '--tail', '1000', 'backend', 'backend-replica');
  expect(logs.includes(token)).toBe(false);
  expect(logs.includes(csrfToken)).toBe(false);
});

test('SES-002-D: malformed login values are rejected without server errors or data changes', async ({
  request,
}) => {
  const csrfToken = await csrf(request);
  const admissions = ledger();
  const subject = await hostSubject();
  let spent = 0;
  const before = fingerprint(false, true);
  const errors: unknown[] = [];
  // Independent-case ledger isolation leaves exactly five validation admissions;
  // process restart never resets a request window.
  for (const credentials of [
    { email: { value: ownerEmail }, password: ownerPassword },
    { email: [ownerEmail], password: ownerPassword },
    { email: ownerEmail, password: 1234567890123456 },
    { email: ownerEmail, password: [ownerPassword] },
    { email: ownerEmail, password: { value: ownerPassword } },
  ]) {
    const response = await request.post('/api/auth/login', {
      headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
      data: credentials,
    });
    expect(response.status()).toBe(400);
    expectAdmissionDelta(admissions, [{ scope: 'login-ip', subject, hits: ++spent }]);
    noStore(response);
    const body = await response.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(Object.hasOwn(body, 'user')).toBe(false);
    expect(Object.hasOwn(body, 'access_token')).toBe(false);
    expect(JSON.stringify(body).includes(ownerPassword)).toBe(false);
    errors.push({ error: body.error, message: body.message });
    expect(fingerprint(false, true)).toBe(before);
    expect((await request.get('/api/auth/me')).status()).toBe(401);
  }
  expect(errors[1]).toEqual(errors[0]);
  expect((await request.get('/api/auth/me')).status()).toBe(401);
});

test('SES-003-B: concurrent real password requests cannot upgrade one anonymous session twice', async ({
  page,
  request,
}) => {
  observeBrowserCsrf(page);
  await page.goto('/login');
  const csrfToken = await csrf(page.context().request);
  const anonymous = await sessionCookie(page);
  const before = fingerprint(false, true);
  const responses = await Promise.all(
    [0, 1].map(() =>
      page.context().request.post('/api/auth/login', {
        headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
        data: { email: ownerEmail, password: ownerPassword },
      }),
    ),
  );
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 403]);
  for (const response of responses) noStore(response);
  const success = responses.find((response) => response.status() === 200)!;
  const result = await success.json();
  expect(Object.keys(result).sort()).toEqual(['csrfToken', 'mfaRequired']);
  expect(result.mfaRequired).toBe(true);
  const setCookie =
    success.headersArray().find((header) => header.name.toLowerCase() === 'set-cookie')?.value ??
    '';
  const issued = setCookie.match(/^__Host-ct-session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
  expect(issued !== undefined).toBe(true);
  expect(sessionRows(issued!)).toHaveLength(1);
  expect(sessionRows(issued!)[0].state).toBe('pending_mfa');
  expect(query("SELECT count(*) FROM auth_sessions WHERE state = 'authenticated'")).toBe('0');
  expect(sessionRows(anonymous)).toHaveLength(0);
  await deniedReplay(request, anonymous);
  // The losing request may fail its read-only session check before account admission,
  // or pass it before the winner rotates: both paths still charge the source exactly twice.
  const accountHits = ledger().find(
    (row) =>
      row.scope === 'login-account' && row.subjectHash === subjectHash('login-account', ownerEmail),
  )?.hits;
  expect([1, 2]).toContain(accountHits);
  await expectHostAdmissions(2, 0, 1, [ownerCount(accountHits!)]);
  expect(fingerprint(false, true)).toBe(before);
});
