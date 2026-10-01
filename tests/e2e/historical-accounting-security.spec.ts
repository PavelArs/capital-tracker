import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import {
  backendLogs,
  noStore,
  openingInput,
  providerRequests,
  seedForeign,
} from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { coverageFrom, tradeApi, tradeInput } from './usd-trades-fixtures';

test('HIST-004-B: anonymous and real MFA-pending history reads preserve every protected row', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const account = await api.account();
  const instrument = await api.instrument(`Private history ${randomUUID()}`, 'HIST');
  await api.initialize(account.id);
  await api.create(account.id, tradeInput(instrument.id, 0));
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    await passwordStep(await pendingContext.newPage());
    const before = fingerprint([]);
    const admissions = ledgerState();
    const providers = providerRequests();
    for (const client of [request, pendingContext.request]) {
      const response = await client.get(
        `/api/accounting/accounts/${account.id}/trade-journal/history?at=${encodeURIComponent(coverageFrom)}`,
      );
      expect(response.status()).toBe(401);
      noStore(response);
      const body = await response.text();
      expect(body).not.toContain(instrument.name);
      expect(body).not.toContain('remainingCostUsd');
    }
    expect(fingerprint([]), 'Denied history reads do not even update last-seen state').toBe(before);
    expect(ledgerState()).toBe(admissions);
    expect(providerRequests()).toEqual(providers);
  } finally {
    await pendingContext.close();
  }
});

test('HIST-002-B / HIST-004-B: actual malformed, foreign and unavailable history never mutates data or guesses cost', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account();
  await api.initialize(account.id);
  const unknownAccount = await api.account();
  const instrument = await api.instrument(`Unknown-cost history ${randomUUID()}`, 'HIST');
  await api.save(unknownAccount.id, openingInput(instrument.id));
  const foreign = seedForeign();
  const canary = `private-historical-query-${randomUUID()}`;
  const path = `/accounts/${account.id}/trade-journal/history`;
  const at = encodeURIComponent(coverageFrom);
  const before = fingerprint(['auth_sessions']);
  const admissions = ledgerState();
  const providers = providerRequests();
  const invalid = [
    '',
    '?at=2025-01-01',
    '?at=2025-01-01T00:00:00',
    '?at=2025-02-30T00:00:00Z',
    '?at=2025-01-01T00:00:00.0001Z',
    `?at=${at}&at=${at}`,
    `?at=${at}&at[]=2025-01-01`,
    `?at=${at}&ownerId=${foreign.accountId}`,
    `?at=${at}&unexpected=${canary}`,
    `?at=${at}&offset=1`,
    `?at=${at}&offset=100000&journalRevision=0`,
    `?at=${at}&limit=0`,
    `?at=${at}&limit=101`,
    `?at=${at}&limit=1&limit=2`,
    `?at=${at}&journalRevision=01`,
    `?at=${at}&journalRevision=10001`,
  ];
  for (const query of invalid) {
    const response = await api.send('GET', `${path}${query}`);
    expect(response.status()).toBe(400);
    noStore(response);
    expect(await response.text()).not.toContain(canary);
  }
  for (const id of [foreign.accountId, randomUUID()]) {
    const response = await api.send('GET', `/accounts/${id}/trade-journal/history?at=${at}`);
    expect(response.status()).toBe(404);
    noStore(response);
    expect(await response.text()).not.toContain('Synthetic foreign');
  }
  for (const url of [
    `${path}?at=2024-12-31T23:59:59.999Z`,
    `${path}?at=${at}&journalRevision=1`,
    `/accounts/${unknownAccount.id}/trade-journal/history?at=${at}`,
  ]) {
    const response = await api.send('GET', url);
    expect(response.status()).toBe(409);
    noStore(response);
    expect(await response.text()).not.toContain(instrument.name);
  }
  const empty = await api.send('GET', `${path}?at=${at}`);
  expect(empty.status()).toBe(200);
  noStore(empty);
  const emptyBody = await empty.json();
  expect(emptyBody).toEqual({
    accountId: account.id,
    at: coverageFrom,
    coverageFrom,
    journalRevision: 0,
    basis: 'current-effective-history',
    originKind: 'declared-empty',
    openingRevision: null,
    initialCostUsd: '0',
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
    items: [],
    nextOffset: null,
  });
  const farDerivedPage = await api.send(
    'GET',
    `${path}?at=${at}&offset=99999&limit=100&journalRevision=0`,
  );
  expect(farDerivedPage.status()).toBe(200);
  noStore(farDerivedPage);
  expect(await farDerivedPage.json()).toEqual(emptyBody);
  expect(
    fingerprint(['auth_sessions']),
    'History responses preserve all accounting and admission rows',
  ).toBe(before);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
  expect(backendLogs()).not.toContain(canary);
  expect(api.calls).toBeLessThanOrEqual(80);
});
