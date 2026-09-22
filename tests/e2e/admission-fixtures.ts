import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { type Page, expect } from '@playwright/test';
import { upstreamsSince } from './replicas';

export type Scope = 'csrf-ip' | 'login-ip' | 'mfa-ip' | 'login-account';
export type Admission = { scope: Scope; subject: string; hits: number };
export type LedgerRow = {
  scope: Scope;
  subjectHash: string;
  hits: number;
  windowStartedAt: string;
  expiresAt: string;
  seconds: number;
  live: boolean;
};
export const sourceA = 'v4:172.30.90.10/32';
export const sourceB = 'v4:172.30.90.11/32';
export const sourceU = 'v4:172.30.91.30/32';
export const account = 'owner@example.invalid';

function query(sql: string): string {
  return execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'capital-tracker-e2e',
      '-f',
      resolve(__dirname, 'compose.yml'),
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
    {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

// Independent wire-format oracle: never import the production hash/policy code.
export function subjectHash(scope: Scope, subject: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['ct-auth-request-v1', scope, subject]), 'utf8')
    .digest('hex');
}
export function ledger(): LedgerRow[] {
  return JSON.parse(
    query(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY scope, "subjectHash"), '[]') FROM (
    SELECT scope, "subjectHash", hits, "windowStartedAt", "expiresAt",
      extract(epoch FROM ("expiresAt" - "windowStartedAt"))::float8 AS seconds,
      "expiresAt" > clock_timestamp() AS live
    FROM auth_request_limits
  ) r`),
  );
}
export function ledgerState(): string {
  return query(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY scope, "subjectHash")::text, '[]')
    FROM auth_request_limits r`);
}
export function resetAdmissionsBetweenCases(): void {
  expect(query('SELECT current_database()')).toBe('capital_tracker_e2e');
  query('DELETE FROM auth_request_limits');
  expect(ledger()).toEqual([]);
  browserCsrfCount = 0;
}
export function expectLedger(expected: Admission[], before: LedgerRow[] = []): void {
  const rows = ledger();
  const projected = expected
    .filter((value) => value.hits > 0)
    .map((value) => ({
      scope: value.scope,
      subjectHash: subjectHash(value.scope, value.subject),
      hits: value.hits,
    }))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.subjectHash.localeCompare(b.subjectHash));
  expect(
    rows.map(({ scope, subjectHash: hash, hits }) => ({ scope, subjectHash: hash, hits })),
  ).toEqual(projected);
  for (const row of rows) {
    expect(row.live, 'Exact count oracle must remain inside its original fixed window').toBe(true);
    expect(row.seconds).toBe(row.scope === 'login-account' ? 600 : 60);
    const previous = before.find(
      (value) => value.scope === row.scope && value.subjectHash === row.subjectHash,
    );
    if (previous) {
      expect(row.windowStartedAt).toBe(previous.windowStartedAt);
      expect(row.expiresAt).toBe(previous.expiresAt);
    }
  }
}
export function expectAdmissionDelta(before: LedgerRow[], additions: Admission[]): void {
  const expected = before.map((row) => ({
    scope: row.scope,
    subjectHash: row.subjectHash,
    hits: row.hits,
  }));
  for (const addition of additions) {
    const hash = subjectHash(addition.scope, addition.subject);
    const existing = expected.find(
      (row) => row.scope === addition.scope && row.subjectHash === hash,
    );
    if (existing) existing.hits += addition.hits;
    else if (addition.hits)
      expected.push({ scope: addition.scope, subjectHash: hash, hits: addition.hits });
  }
  expected.sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.subjectHash.localeCompare(b.subjectHash),
  );
  const after = ledger();
  expect(
    after.map(({ scope, subjectHash: hash, hits }) => ({ scope, subjectHash: hash, hits })),
  ).toEqual(expected);
  for (const row of after) {
    expect(row.live, 'No silent window expiry may satisfy an admission delta').toBe(true);
    expect(row.seconds).toBe(row.scope === 'login-account' ? 600 : 60);
    const previous = before.find(
      (value) => value.scope === row.scope && value.subjectHash === row.subjectHash,
    );
    if (previous) {
      expect(row.windowStartedAt).toBe(previous.windowStartedAt);
      expect(row.expiresAt).toBe(previous.expiresAt);
    }
  }
}
export function counts(subject: string, csrf = 0, login = 0, mfa = 0): Admission[] {
  return [
    { scope: 'csrf-ip', subject, hits: csrf },
    { scope: 'login-ip', subject, hits: login },
    { scope: 'mfa-ip', subject, hits: mfa },
  ];
}
export function ownerCount(hits: number, email = account): Admission {
  return { scope: 'login-account', subject: email, hits };
}
export async function hostSubject(): Promise<string> {
  const peers = new Set(
    (await upstreamsSince(0))
      .map((row) => row.source)
      .filter((peer) => !['172.30.90.10', '172.30.90.11', '127.0.0.1', '::1'].includes(peer)),
  );
  expect(peers.size, 'The host browser/API source is observed at the real HTTPS edge').toBe(1);
  const [peer] = peers;
  expect(peer).toMatch(/^(?:\d{1,3}\.){3}\d{1,3}$/);
  return `v4:${peer}/32`;
}
let browserCsrfCount = 0;
const observedPages = new WeakSet<Page>();
export function observeBrowserCsrf(page: Page): void {
  if (observedPages.has(page)) return;
  observedPages.add(page);
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/auth/csrf' && response.status() === 200)
      browserCsrfCount++;
  });
}
export function browserCsrfAdmissions(): number {
  return browserCsrfCount;
}
export async function expectHostAdmissions(
  login: number,
  mfa: number,
  explicitCsrf = 0,
  accounts: Admission[] = [ownerCount(login)],
): Promise<void> {
  expectLedger([
    ...counts(await hostSubject(), browserCsrfAdmissions() + explicitCsrf, login, mfa),
    ...accounts,
  ]);
}

export async function withAdmissionLock<T>(action: () => Promise<T>): Promise<T> {
  const root = resolve(__dirname, '../..');
  const child = spawn(
    'docker',
    [
      'compose',
      '-p',
      'capital-tracker-e2e',
      '-f',
      resolve(__dirname, 'compose.yml'),
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
    ],
    {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    },
  );
  const closed = new Promise<number | null>((resolve) => child.once('close', resolve));
  let timer: ReturnType<typeof setTimeout>;
  const ready = new Promise<void>((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('SYNTHETIC_ADMISSION_LOCK_HELD')) resolve();
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Synthetic lock holder exited before readiness')));
    timer = setTimeout(
      () => reject(new Error('Synthetic lock holder was not ready within five seconds')),
      5_000,
    );
  });
  child.stdin.write(
    "BEGIN; SELECT pg_advisory_xact_lock(1763669184); SELECT 'SYNTHETIC_ADMISSION_LOCK_HELD';\n",
  );
  try {
    await ready;
    clearTimeout(timer!);
    return await action();
  } finally {
    clearTimeout(timer!);
    // Releasing this external transaction never modifies an admission or auth row.
    child.stdin.end('ROLLBACK;\n');
    expect(await closed, 'The bounded synthetic lock holder must exit cleanly').toBe(0);
  }
}
