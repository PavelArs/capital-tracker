import { randomUUID } from 'node:crypto';
import { type Page, expect } from '@playwright/test';
import { compose, fingerprint, loginWithMfa, origin, owner, test } from './mfa-fixtures';

// Maintained acceptance on the actual predecessor image: no future trade table,
// production import, authentication mock or injected cookie is a prerequisite.
const tradeTables = ['account_trade_journals', 'account_trades', 'account_trade_versions'];
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

type Account = { id: string; name: string; currentRevision: number; createdAt: string };
type JournalOrigin = {
  accountId: string;
  requestId: string;
  originKind: 'declared-empty';
  coverageFrom: string;
  createdAt: string;
};

function timestamp(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(new Date(value as string).toISOString()).toBe(value);
}

async function realEmptyAccount(page: Page) {
  const { csrfToken } = await loginWithMfa(page);
  const request = page.context().request;
  const identity = await request.get('/api/auth/me');
  expect(identity.status(), 'Actual password and MFA establish the owner session first').toBe(200);
  expect(await identity.json()).toMatchObject({ id: owner.id, email: owner.email });
  const headers = { Origin: origin, 'X-CSRF-Token': csrfToken };
  const name = `Синтетический журнал ${randomUUID()}`;
  const created = await request.post('/api/accounting/accounts', {
    headers,
    data: { requestId: randomUUID(), name },
  });
  expect(created.status(), 'The predecessor already supports real empty manual accounts').toBe(201);
  const account = (await created.json()) as Account;
  expect(Object.keys(account).sort()).toEqual(['createdAt', 'currentRevision', 'id', 'name']);
  expect(account.id).toMatch(uuidV4);
  expect(account.name).toBe(name);
  expect(account.currentRevision).toBe(0);
  timestamp(account.createdAt);
  const detail = await request.get(`/api/accounting/accounts/${account.id}`);
  expect(detail.status()).toBe(200);
  expect(await detail.json()).toEqual({ ...account, currentOpening: null });
  const history = await request.get(`/api/accounting/accounts/${account.id}/openings`);
  expect(history.status()).toBe(200);
  expect(await history.json()).toEqual({ items: [], nextCursor: null });
  return { account, request, headers };
}

function retainedState(): string {
  // Initialization may add only journal state. Prior opening/account/instrument,
  // financial, owner, factor and admission rows stay unchanged. Authorized requests
  // may touch session lastSeenAt; the existing helper discovers tables on both images.
  return fingerprint(['auth_sessions', ...tradeTables]);
}

function providerRequests(): unknown[] {
  const value: unknown = JSON.parse(
    compose([
      'exec',
      '-T',
      'providers',
      'node',
      '-e',
      `
      fetch('http://127.0.0.1:8080/__control/requests').then(async response => {
        if (!response.ok) throw new Error('Synthetic provider log unavailable');
        process.stdout.write(await response.text());
      }).catch(() => { process.exitCode = 1; });
    `,
    ]),
  );
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

test('TRADE-001-A: a real owner explicitly initializes an empty-origin journal and replays its immutable receipt', async ({
  page,
}) => {
  const { account, request, headers } = await realEmptyAccount(page);
  const before = retainedState();
  const providersBefore = providerRequests();
  const requestId = randomUUID();
  const path = `/api/accounting/accounts/${account.id}/trade-journal`;

  try {
    const created = await request.post(path, {
      headers,
      data: { requestId, coverageFrom: '2025-01-01T02:00:00+02:00', assertEmpty: true },
    });
    expect(
      created.status(),
      'Explicit journal initialization succeeds after real full authentication',
    ).toBe(201);
    expect(created.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    const receipt = (await created.json()) as JournalOrigin;
    expect(Object.keys(receipt).sort()).toEqual([
      'accountId',
      'coverageFrom',
      'createdAt',
      'originKind',
      'requestId',
    ]);
    expect(receipt).toEqual({
      accountId: account.id,
      requestId,
      originKind: 'declared-empty',
      coverageFrom: '2025-01-01T00:00:00.000Z',
      createdAt: expect.any(String),
    });
    timestamp(receipt.createdAt);

    const replay = await request.post(
      `/api/accounting/accounts/${account.id.toUpperCase()}/trade-journal`,
      {
        headers,
        data: {
          requestId: requestId.toUpperCase(),
          coverageFrom: '2025-01-01T00:00:00.000Z',
          assertEmpty: true,
        },
      },
    );
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(receipt);

    const state = await request.get(path);
    expect(state.status()).toBe(200);
    expect(state.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    expect(await state.json()).toEqual({
      accountId: account.id,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      journal: {
        ...receipt,
        journalRevision: 0,
        activeTradeCount: 0,
        versionCount: 0,
        limits: { activeTrades: 1000, versions: 10000 },
        summary: {
          grossBuysUsd: '0',
          buyFeesUsd: '0',
          grossSalesUsd: '0',
          sellFeesUsd: '0',
          netSalesUsd: '0',
          consumedCostUsd: '0',
          realizedUsd: '0',
          remainingCostUsd: '0',
        },
      },
    });
    const detail = await request.get(`/api/accounting/accounts/${account.id}`);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toEqual({ ...account, currentOpening: null });
  } finally {
    expect
      .soft(retainedState(), 'Journal initialization preserves every predecessor business row')
      .toBe(before);
    // No process restart occurs inside this measured flow: legacy warmups are outside it.
    expect
      .soft(providerRequests(), 'Journal initialization and reads never call providers')
      .toEqual(providersBefore);
  }
});
