import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { type APIRequestContext, type Page, expect } from '@playwright/test';
import { loginWithMfa, test } from './mfa-fixtures';

const repositoryRoot = resolve(__dirname, '../..');
const composeFile = resolve(repositoryRoot, 'tests/e2e/compose.yml');
const composeArgs = ['compose', '-p', 'capital-tracker-e2e', '-f', composeFile];
const ownerId = '11111111-1111-4111-8111-111111111111';
const ownerEmail = 'owner@example.invalid';
const ownerPassword = 'Synthetic-password-42!';
const foreignId = '22222222-2222-4222-8222-222222222222';
const origin = 'https://127.0.0.1:8443';
const cookieName = '__Host-ct-session';

function compose(args: string[], input?: string): string {
  return execFileSync('docker', [...composeArgs, ...args], {
    cwd: repositoryRoot,
    input,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function query(sql: string): string {
  return execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'capital-tracker-e2e',
      '-f',
      composeFile,
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
    ],
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 30_000 },
  ).trim();
}

function databaseFingerprint(excludedTables: string[] = []): string {
  // Compare all public table data without printing password hashes or credential revisions.
  // Discover owner_auth if it exists, so the initial behavioral RED needs no new migration.
  const tables = query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )
    .split('\n')
    .filter((table) => table && !excludedTables.includes(table));
  if (!excludedTables.includes('users')) expect(tables).toContain('users');
  expect(tables).toContain('crypto_wallets');
  for (const table of tables) expect(table).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  return query(
    tables
      .map(
        (table) => `
    SELECT '${table}' AS table_name,
      md5(COALESCE(jsonb_agg(row_data ORDER BY row_data::text)::text, '[]')) AS checksum
    FROM (SELECT to_jsonb(t) AS row_data FROM public."${table}" t) rows
  `,
      )
      .join(' UNION ALL '),
  );
}

function preservedData(): { tables: string; otherUsers: string } {
  return {
    tables: databaseFingerprint([
      'users',
      'owner_auth',
      'auth_sessions',
      'owner_mfa',
      'owner_mfa_recovery',
    ]),
    otherUsers: query(`SELECT md5(COALESCE(jsonb_agg(row_data ORDER BY row_data::text)::text, '[]'))
      FROM (SELECT to_jsonb(u) AS row_data FROM users u WHERE id <> '${ownerId}'::uuid) rows`),
  };
}

function ownerCli(args: string[], password: string): void {
  const output = compose(
    [
      'exec',
      '-T',
      'backend',
      'node',
      '/app/backend/dist/owner-cli.js',
      ...args,
      '--password-stdin',
    ],
    JSON.stringify({ password, confirmation: password }),
  );
  // Boolean assertions avoid echoing a credential into a failure report if the CLI regresses.
  expect(output.includes(password)).toBe(false);
  expect(output.includes('$argon2')).toBe(false);
  expect(output.includes('credentialVersion')).toBe(false);
}

function assertPublicUser(user: Record<string, unknown>): void {
  expect(user).toMatchObject({ id: ownerId, email: ownerEmail });
  const permitted = [
    'id',
    'email',
    'firstName',
    'lastName',
    'emailVerified',
    'createdAt',
    'updatedAt',
  ];
  for (const field of Object.keys(user)) expect(permitted).toContain(field);
}

async function browserLogin(page: Page, password = ownerPassword): Promise<string> {
  const result = await loginWithMfa(page, password);
  assertPublicUser(result.user);
  return result.token;
}

async function passwordLogin(
  request: APIRequestContext,
  credentials: { email: string; password: string },
) {
  const response = await request.get('/api/auth/csrf');
  expect(response.status()).toBe(200);
  const { csrfToken } = await response.json();
  expect(typeof csrfToken).toBe('string');
  return request.post('/api/auth/login', {
    headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
    data: credentials,
  });
}

async function expectPrivateDenial(
  request: APIRequestContext,
  token: string,
  legacyBearer = false,
): Promise<void> {
  for (const path of ['/api/auth/me', '/api/crypto']) {
    const headers = legacyBearer
      ? { Authorization: `Bearer ${token}` }
      : { Cookie: `${cookieName}=${token}` };
    const response = await request.get(path, { headers });
    expect(response.status()).toBe(401);
    const body = await response.text();
    expect(body.includes(ownerEmail)).toBe(false);
    expect(body.includes('synthetic-foreign-bitcoin-address')).toBe(false);
    expect(body.includes('"balance"')).toBe(false);
  }
}

function attackBearer(payload: Record<string, unknown>): string {
  // Negative-only fixture: a correctly signed legacy/non-owner bearer must be rejected.
  // Positive authentication always goes through the browser and the actual password verifier.
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + 60 })).toString(
    'base64url',
  );
  const signature = createHmac(
    'sha256',
    'synthetic-acceptance-secret-not-for-production-0123456789',
  )
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

const retiredApis = [
  {
    path: '/api/auth/register',
    data: { email: 'disabled-signup@example.invalid', password: 'Synthetic-disabled-password-42!' },
  },
  { path: '/api/auth/forgot-password', data: { email: 'absent@example.invalid' } },
  {
    path: '/api/auth/reset-password',
    data: {
      token: 'synthetic-retired-reset-token',
      newPassword: 'Synthetic-disabled-password-42!',
    },
  },
  { path: '/api/auth/verify-email', data: { token: 'synthetic-retired-verification-token' } },
  { path: '/api/auth/resend-verification', data: { email: 'owner@example.invalid' } },
];

for (const endpoint of retiredApis) {
  test(`OWN-004-A: retired POST ${endpoint.path} has no state-changing effect`, async ({
    request,
  }) => {
    const before = databaseFingerprint();
    const response = await request.post(endpoint.path, { data: endpoint.data });
    expect.soft(response.status()).toBe(404);
    expect(databaseFingerprint()).toBe(before);
  });
}

for (const path of [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password?token=synthetic-retired-reset-token',
  '/verify-email?token=synthetic-retired-verification-token',
  '/resend-verification',
]) {
  test(`OWN-004-B: ${path} exposes only owner login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL('https://127.0.0.1:8443/login');
    await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Вход', exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /регистраци|забыли пароль|верификаци/i }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Доступ владельца создаёт и восстанавливает оператор сервера.', {
        exact: true,
      }),
    ).toBeVisible();
  });
}

test.describe('OWN-003: real owner authorization and CLI recovery', () => {
  test('OWN-003-A: non-owner passwords and legacy/non-owner bearers fail generically', async ({
    request,
  }) => {
    const before = databaseFingerprint(['auth_sessions']);
    const sessionsBefore = query(
      "SELECT count(*) FROM auth_sessions WHERE state = 'authenticated'",
    );
    const messages: unknown[] = [];
    for (const credentials of [
      { email: ownerEmail, password: 'Synthetic-incorrect-password-42!' },
      { email: 'foreign@example.invalid', password: ownerPassword },
      { email: 'missing@example.invalid', password: ownerPassword },
    ]) {
      const response = await passwordLogin(request, credentials);
      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.access_token).toBeUndefined();
      expect(body.user).toBeUndefined();
      messages.push({ statusCode: body.statusCode, error: body.error, message: body.message });
    }
    expect(messages[1]).toEqual(messages[0]);
    expect(messages[2]).toEqual(messages[0]);
    const credentialVersion = query('SELECT "credentialVersion" FROM owner_auth WHERE id = 1');
    expect(credentialVersion).toMatch(/^[a-f0-9-]{36}$/i);
    for (const payload of [
      { sub: ownerId, email: ownerEmail },
      { sub: foreignId, email: 'foreign@example.invalid' },
      { sub: foreignId, email: 'foreign@example.invalid', credentialVersion },
    ]) {
      await expectPrivateDenial(request, attackBearer(payload), true);
    }
    expect(databaseFingerprint(['auth_sessions'])).toBe(before);
    expect(query("SELECT count(*) FROM auth_sessions WHERE state = 'authenticated'")).toBe(
      sessionsBefore,
    );
  });

  test('OWN-003-A: removing only the synthetic owner binding denies passwords and real-issued tokens', async ({
    page,
    request,
  }) => {
    const token = await browserLogin(page);
    const before = preservedData();
    // External negative fixture only. Restore through the production bootstrap CLI in finally.
    expect(
      query(`WITH removed AS (
      DELETE FROM owner_auth WHERE id = 1 AND "userId" = '${ownerId}'::uuid RETURNING id
    ) SELECT count(*) FROM removed`),
    ).toBe('1');
    try {
      const response = await passwordLogin(request, { email: ownerEmail, password: ownerPassword });
      expect(response.status()).toBe(401);
      expect((await response.json()).access_token).toBeUndefined();
      await expectPrivateDenial(request, token);
      expect(query('SELECT count(*) FROM owner_auth')).toBe('0');
      expect(preservedData()).toEqual(before);
    } finally {
      ownerCli(['bootstrap', '--email', ownerEmail, '--existing-user-id', ownerId], ownerPassword);
    }
    expect(query('SELECT "userId" FROM owner_auth WHERE id = 1')).toBe(ownerId);
    expect(preservedData()).toEqual(before);
  });

  test('OWN-003-B/SES-001-B/MFA-004-B: CLI recovery revokes the old password and cookie while preserving the confirmed factor and codes', async ({
    page,
    request,
  }) => {
    const before = preservedData();
    const token = await browserLogin(page);
    const factorBefore = query(`SELECT md5(jsonb_build_object(
      'activeVersion', "activeVersion", 'activeEnvelope', "activeEnvelope", 'lastCounter', "lastCounter"
    )::text) FROM owner_mfa WHERE id = 1`);
    const recoveryBefore = query(`SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY "codeHash")::text)
      FROM owner_mfa_recovery r`);
    const previousRevision = query(
      'SELECT md5("credentialVersion"::text) FROM owner_auth WHERE id = 1',
    );
    const recoveredPassword = '  Synthetic-новый-password-42!  ';
    try {
      ownerCli(['recover', '--user-id', ownerId], recoveredPassword);
      expect(
        query(`SELECT md5(jsonb_build_object(
        'activeVersion', "activeVersion", 'activeEnvelope', "activeEnvelope", 'lastCounter', "lastCounter"
      )::text) FROM owner_mfa WHERE id = 1`),
      ).toBe(factorBefore);
      expect(
        query(`SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY "codeHash")::text)
        FROM owner_mfa_recovery r`),
      ).toBe(recoveryBefore);
      expect(
        query(`SELECT "candidateId" IS NULL AND "failedAttempts" = 0
        AND "blockedUntil" IS NULL FROM owner_mfa WHERE id = 1`),
      ).toBe('t');
      expect(query(`SELECT count(*) FROM auth_sessions WHERE "userId" = '${ownerId}'::uuid`)).toBe(
        '0',
      );
      expect(query('SELECT md5("credentialVersion"::text) FROM owner_auth WHERE id = 1')).not.toBe(
        previousRevision,
      );
      await expectPrivateDenial(request, token);

      for (const password of [ownerPassword, recoveredPassword.trim()]) {
        const response = await passwordLogin(request, { email: ownerEmail, password });
        expect(response.status()).toBe(401);
        expect((await response.json()).access_token).toBeUndefined();
      }

      const recoveredToken = await browserLogin(page, recoveredPassword);
      expect(recoveredToken === token).toBe(false);
      const profile = await page.context().request.get('/api/auth/me');
      expect(profile.status()).toBe(200);
      assertPublicUser(await profile.json());
      await expectPrivateDenial(request, token);
      expect(preservedData()).toEqual(before);
    } finally {
      // Leave the fixture's ordinary credentials ready for the independent retained wallet suite.
      ownerCli(['recover', '--user-id', ownerId], ownerPassword);
    }
    expect(preservedData()).toEqual(before);
  });
});
