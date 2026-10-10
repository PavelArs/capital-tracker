import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { compose, fingerprint, loginWithMfa, origin, owner, test } from './mfa-fixtures';

// These maintained cases also run against migration 12's real release image.
// No future table, application mock or injected authentication is a prerequisite.
const accountingTables = [
  'manual_accounts',
  'accounting_instruments',
  'account_opening_snapshots',
  'account_opening_positions',
];
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

type AccountSummary = {
  id: string;
  name: string;
  currentRevision: number;
  createdAt: string;
};

function expectEmptySummary(account: AccountSummary, name: string): void {
  expect(Object.keys(account).sort()).toEqual(['createdAt', 'currentRevision', 'id', 'kind', 'name']);
  expect(account.id).toMatch(uuidV4);
  expect(account.name).toBe(name);
  expect(account.currentRevision).toBe(0);
  expect(account.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(new Date(account.createdAt).toISOString()).toBe(account.createdAt);
}

function retainedState(): string {
  // The authorized session may touch lastSeenAt. All preexisting financial,
  // owner, factor and admission rows must otherwise remain byte-for-byte equal.
  return fingerprint(['auth_sessions', ...accountingTables]);
}

function providerRequests(): unknown {
  const value: unknown = JSON.parse(
    compose([
      'exec',
      '-T',
      'providers',
      'node',
      '-e',
      `fetch('http://127.0.0.1:8080/__control/requests').then(async response => {
        if (!response.ok) throw new Error('Unable to read synthetic provider requests');
        process.stdout.write(await response.text());
      }).catch(() => { process.exitCode = 1; });`,
    ]),
  );
  expect(Array.isArray(value)).toBe(true);
  return value;
}

test('OPEN-001-B / OPEN-003-A: an empty account is private, exact and canonically replayable', async ({
  page,
}) => {
  const { csrfToken } = await loginWithMfa(page);
  const request = page.context().request;
  const identity = await request.get('/api/auth/me');
  expect(identity.status(), 'The real password and factor session is authenticated').toBe(200);
  expect(await identity.json()).toMatchObject({ id: owner.id, email: owner.email });
  const before = retainedState();
  const providersBefore = providerRequests();
  const requestId = randomUUID();
  const name = `Синтетический ручной счет ${requestId}`;
  const headers = { Origin: origin, 'X-CSRF-Token': csrfToken };

  try {
    const created = await request.post('/api/accounting/accounts', {
      headers,
      data: { requestId, name: `  ${name}  ` },
    });
    expect(created.status(), 'A fully authenticated owner can create a manual account').toBe(201);
    expect(created.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    const account = (await created.json()) as AccountSummary;
    expectEmptySummary(account, name);

    const detail = await request.get(`/api/accounting/accounts/${account.id}`);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toEqual({ ...account, currentOpening: null });

    const replay = await request.post('/api/accounting/accounts', {
      headers,
      data: { requestId: requestId.toUpperCase(), name },
    });
    expect(
      replay.status(),
      'Equivalent UUID casing and trimmed name reuse the original account',
    ).toBe(200);
    expect(await replay.json()).toEqual(account);

    const history = await request.get(`/api/accounting/accounts/${account.id}/openings`);
    expect(history.status()).toBe(200);
    expect(await history.json()).toEqual({ items: [], nextCursor: null });

    const unchanged = await request.get(`/api/accounting/accounts/${account.id}`);
    expect(unchanged.status()).toBe(200);
    expect(await unchanged.json()).toEqual({ ...account, currentOpening: null });
  } finally {
    expect
      .soft(retainedState(), 'Manual-account requests preserve every preexisting business row')
      .toBe(before);
    expect
      .soft(providerRequests(), 'Manual-account requests never contact a provider')
      .toEqual(providersBefore);
  }
});
