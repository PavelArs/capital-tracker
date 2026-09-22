import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { type APIRequestContext, type Page, test as base, expect } from '@playwright/test';

export const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.invalid',
  password: 'Synthetic-password-42!',
};
export const origin = 'https://127.0.0.1:8443';
export const cookieName = '__Host-ct-session';
const repositoryRoot = resolve(__dirname, '../..');
const composeArgs = [
  'compose',
  '-p',
  'capital-tracker-e2e',
  '-f',
  resolve(repositoryRoot, 'tests/e2e/compose.yml'),
];

export type Enrollment = {
  uri: string;
  candidateId: string;
  confirmationCounter: number;
  recoveryCodes: string[];
  usedTotp: boolean;
  recoveryIndex: number;
};
export type Factor = { kind: 'totp' | 'recovery'; code: string };
let activeEnrollment: Enrollment | undefined;

export function compose(args: string[], input?: string): string {
  return execFileSync('docker', [...composeArgs, ...args], {
    cwd: repositoryRoot,
    input,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function query(sql: string): string {
  return compose([
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
  ]);
}

export function hashToken(token: string): string {
  expect(/^[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
  return createHash('sha256').update(token).digest('hex');
}

export function fingerprint(
  excluded = ['auth_sessions', 'owner_mfa', 'owner_mfa_recovery'],
): string {
  const tables = query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )
    .split('\n')
    .filter((table) => !excluded.includes(table));
  expect(tables).toContain('users');
  if (!excluded.includes('owner_auth')) expect(tables).toContain('owner_auth');
  expect(tables).toContain('crypto_wallets');
  for (const table of tables) expect(table).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  return query(
    tables
      .map(
        (table) =>
          `SELECT '${table}', md5(COALESCE(jsonb_agg(row_data ORDER BY row_data::text)::text, '[]')) FROM (SELECT to_jsonb(t) AS row_data FROM public."${table}" t) rows`,
      )
      .join(' UNION ALL '),
  );
}

function nodeFixture(script: string, data: unknown): string {
  return compose(['exec', '-T', 'backend', 'node', '-e', script], JSON.stringify(data));
}

function privateOutput<T>(path: string): T {
  return JSON.parse(
    nodeFixture(
      `
    const fs = require('node:fs');
    const path = JSON.parse(fs.readFileSync(0, 'utf8'));
    const stat = fs.lstatSync(path);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('Unsafe synthetic CLI output');
    const content = fs.readFileSync(path, 'utf8');
    fs.unlinkSync(path);
    process.stdout.write(content);
  `,
      path,
    ),
  ) as T;
}

export function runMfaCli(
  args: string[],
  code?: string,
): { status: number | null; output: string } {
  const result = spawnSync(
    'docker',
    [...composeArgs, 'exec', '-T', 'backend', 'node', '/app/backend/dist/mfa-cli.js', ...args],
    {
      cwd: repositoryRoot,
      input: code === undefined ? undefined : JSON.stringify({ code }),
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const output = result.stdout + result.stderr;
  if (code) expect(output.includes(code)).toBe(false);
  expect(output.includes('otpauth://')).toBe(false);
  return { status: result.status, output };
}

export function databaseCounter(): number {
  return Number(query('SELECT floor(extract(epoch FROM clock_timestamp()) / 30)::bigint'));
}

export function totpAt(enrollment: Pick<Enrollment, 'uri'>, counter = databaseCounter()): string {
  const code = nodeFixture(
    `
    const fs = require('node:fs');
    const OTPAuth = require('/app/backend/node_modules/otpauth');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const totp = OTPAuth.URI.parse(input.uri);
    process.stdout.write(totp.generate({ timestamp: input.counter * 30000 }));
  `,
    { uri: enrollment.uri, counter },
  );
  expect(/^[0-9]{6}$/.test(code)).toBe(true);
  return code;
}

export function enrollOwner(): Enrollment {
  for (let candidate = 0; candidate < 3; candidate++) {
    const preparedPath = `/tmp/capital-mfa-prepare-${randomUUID()}.json`;
    const prepared = runMfaCli([
      'prepare',
      '--user-id',
      owner.id,
      '--output',
      preparedPath,
      '--replace',
    ]);
    expect(prepared.status, 'Production CLI prepares the explicitly selected synthetic owner').toBe(
      0,
    );
    const enrollment = privateOutput<{ uri: string; candidateId: string; expiresAt: string }>(
      preparedPath,
    );
    expect(Object.keys(enrollment).sort()).toEqual(['candidateId', 'expiresAt', 'uri']);
    expect(enrollment.candidateId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(typeof enrollment.uri).toBe('string');
    expect(enrollment.uri.startsWith('otpauth://totp/')).toBe(true);
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = databaseCounter();
      const codes = [-1, 0, 1].map((delta) => totpAt(enrollment, current + delta));
      // Rare adjacent-code collisions would obscure which counter confirmation consumed.
      if (new Set(codes).size !== codes.length) break;
      const confirmedPath = `/tmp/capital-mfa-confirm-${randomUUID()}.json`;
      const confirmed = runMfaCli(
        [
          'confirm',
          '--user-id',
          owner.id,
          '--candidate-id',
          enrollment.candidateId,
          '--output',
          confirmedPath,
          '--code-stdin',
        ],
        codes[0],
      );
      if (confirmed.status !== 0 && databaseCounter() !== current) continue;
      expect(
        confirmed.status,
        'Production CLI confirms a previously valid step without resetting replay state',
      ).toBe(0);
      const { recoveryCodes } = privateOutput<{ recoveryCodes: string[] }>(confirmedPath);
      expect(Array.isArray(recoveryCodes) && recoveryCodes.length === 10).toBe(true);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const code of recoveryCodes)
        expect(/^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/i.test(code)).toBe(true);
      expect(query('SELECT "lastCounter" FROM owner_mfa WHERE id = 1')).toBe(String(current - 1));
      return {
        ...enrollment,
        confirmationCounter: current - 1,
        recoveryCodes,
        usedTotp: false,
        recoveryIndex: 0,
      };
    }
  }
  throw new Error(
    'Unable to confirm a collision-free synthetic enrollment within bounded attempts',
  );
}

export function currentEnrollment(): Enrollment {
  expect(activeEnrollment, 'Real CLI enrollment fixture is installed').toBeDefined();
  return activeEnrollment!;
}

export function recoveryFactor(enrollment = currentEnrollment()): Factor {
  const code = enrollment.recoveryCodes[enrollment.recoveryIndex++];
  expect(typeof code, 'Fixture must not exhaust or reuse issued recovery codes').toBe('string');
  return { kind: 'recovery', code };
}

export function nextFactor(enrollment = currentEnrollment()): Factor {
  if (enrollment.usedTotp) return recoveryFactor(enrollment);
  enrollment.usedTotp = true;
  return { kind: 'totp', code: totpAt(enrollment) };
}

export async function cookie(page: Page): Promise<string> {
  const selected = (await page.context().cookies(origin)).find(
    (value) => value.name === cookieName,
  );
  expect(selected).toBeDefined();
  expect(selected?.httpOnly).toBe(true);
  expect(selected?.secure).toBe(true);
  expect(selected?.sameSite).toBe('Strict');
  expect(selected?.domain).toBe('127.0.0.1');
  expect(selected?.path).toBe('/');
  hashToken(selected!.value);
  return selected!.value;
}

export async function getCsrf(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/csrf');
  expect(response.status()).toBe(200);
  const { csrfToken } = await response.json();
  expect(typeof csrfToken).toBe('string');
  return csrfToken;
}

export async function passwordStep(page: Page, password = owner.password) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Вход', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(['csrfToken', 'mfaRequired']);
  expect(body.mfaRequired).toBe(true);
  expect(typeof body.csrfToken).toBe('string');
  await expect(page.getByLabel('Код из приложения', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  return { token: await cookie(page), csrfToken: body.csrfToken as string };
}

export async function completeFactor(page: Page, factor = nextFactor()) {
  if (factor.kind === 'recovery') {
    await page
      .getByRole('button', { name: 'Использовать код восстановления', exact: true })
      .click();
  }
  await page
    .getByLabel(factor.kind === 'totp' ? 'Код из приложения' : 'Код восстановления', {
      exact: true,
    })
    .fill(factor.code);
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/mfa' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(['csrfToken', 'user']);
  expect(body.user).toMatchObject({ id: owner.id, email: owner.email });
  expect(typeof body.csrfToken).toBe('string');
  await expect(page.getByRole('navigation').getByText(owner.email, { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  return { token: await cookie(page), csrfToken: body.csrfToken as string, user: body.user };
}

export async function loginWithMfa(page: Page, password = owner.password) {
  await passwordStep(page, password);
  return completeFactor(page);
}

export async function restartBackend(request: APIRequestContext): Promise<void> {
  compose(['restart', 'backend']);
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

export const test = base.extend<{ mfa: Enrollment }>({
  mfa: [
    async ({ request }, use) => {
      await restartBackend(request);
      activeEnrollment = enrollOwner();
      try {
        await use(activeEnrollment);
      } finally {
        activeEnrollment = undefined;
      }
    },
    { auto: true },
  ],
});
