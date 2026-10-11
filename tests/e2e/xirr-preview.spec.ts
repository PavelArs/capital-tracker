import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { test } from './external-usd-flows-fixtures';
import { noStore, providerRequests } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep } from './mfa-fixtures';
import { coverageFrom, tradeApi } from './usd-trades-fixtures';

const journalPath = '/portfolio/cash-flow-journal';
const flowsPath = '/portfolio/cash-flows';
const profitPath = '/portfolio/profit-preview';
const xirrPath = '/portfolio/xirr-preview';
const xirrEndpoint = `/api/accounting${xirrPath}`;
const from = coverageFrom;
const to = '2026-01-01T00:00:00.000Z';

function previewInput(overrides: Record<string, unknown> = {}) {
  return {
    from,
    to,
    openingValueUsd: '0',
    closingValueUsd: '1100',
    assertReviewed: true,
    ...overrides,
  };
}

function contribution() {
  return {
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    direction: 'contribution',
    occurredAt: from,
    amountUsd: '1000',
    assertExternal: true,
  };
}

function xirrResult(value: unknown) {
  expect(value).toMatchObject({
    from,
    to,
    coverageFrom,
    journalRevision: 1,
    basis: 'manual-usd-valuations',
    flowBasis: 'owner-declared-usd-flows',
    completeness: 'unreconciled',
    openingValueUsd: '0',
    closingValueUsd: '1100',
    flows: {
      contributionsUsd: '1000',
      withdrawalsUsd: '0',
      netContributionsUsd: '1000',
      flowCount: 1,
    },
    profitUsd: '100',
    xirr: {
      status: 'available',
      reason: null,
      convention: 'ACT/365F-UTC-ms',
      rateTolerance: '0.0000000001',
      cashFlowDateCount: 2,
      shortPeriod: false,
    },
  });
  const xirr = (value as { xirr: { annualRate: string; annualPercent: string } }).xirr;
  expect(typeof xirr.annualRate).toBe('string');
  expect(typeof xirr.annualPercent).toBe('string');
  expect(Math.abs(Number(xirr.annualRate) - 0.1)).toBeLessThanOrEqual(1e-10);
  expect(Math.abs(Number(xirr.annualPercent) - 10)).toBeLessThanOrEqual(1e-8);
}

test('XIRR-YEAR / XIRR-PRIVATE: actual authenticated dated cash flows and protected snapshot', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom,
    assertReviewed: true,
  });
  await api.result('POST', flowsPath, 201, contribution());

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const accountingBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    const admissionsBefore = ledgerState();
    const providersBefore = providerRequests();

    const profit = await api.send('POST', profitPath, previewInput());
    expect(profit.status()).toBe(200);
    noStore(profit);
    const existingProfit = await profit.json();
    expect(existingProfit).toMatchObject({
      journalRevision: 1,
      profitUsd: '100',
      flows: { contributionsUsd: '1000', withdrawalsUsd: '0', flowCount: 1 },
    });
    expect(existingProfit).not.toHaveProperty('xirr');

    const response = await api.send('POST', xirrPath, previewInput());
    expect(response.status()).toBe(200);
    noStore(response);
    const result = await response.json();
    xirrResult(result);
    expect(result).toMatchObject(existingProfit);

    const uncovered = await api.send(
      'POST',
      xirrPath,
      previewInput({ from: '2024-12-31T00:00:00.000Z' }),
    );
    expect(uncovered.status()).toBe(409);
    noStore(uncovered);
    const invalid = await api.send('POST', xirrPath, previewInput({ assertReviewed: false }));
    expect(invalid.status()).toBe(400);
    noStore(invalid);

    const anonymous = await request.fetch(xirrEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin },
    });
    expect(anonymous.status()).toBe(401);
    noStore(anonymous);
    const pendingMfa = await pendingContext.request.fetch(xirrEndpoint, {
      method: 'POST',
      data: previewInput(),
      headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
    });
    expect(pendingMfa.status()).toBe(401);
    noStore(pendingMfa);
    const foreignOrigin = await api.send('POST', xirrPath, previewInput(), {
      Origin: 'https://foreign.example.invalid',
    });
    expect(foreignOrigin.status()).toBe(403);
    noStore(foreignOrigin);
    const invalidCsrf = await api.send('POST', xirrPath, previewInput(), {
      'X-CSRF-Token': 'invalid-synthetic-csrf',
    });
    expect(invalidCsrf.status()).toBe(403);
    noStore(invalidCsrf);

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
      'Profit and XIRR previews preserve all financial rows',
    ).toBe(accountingBefore);
    expect(ledgerState(), 'Read-only XIRR requests do not consume admissions').toBe(
      admissionsBefore,
    );
    expect(providerRequests(), 'XIRR preview makes no provider calls').toEqual(providersBefore);
    expect(api.calls).toBeLessThanOrEqual(80);
  } finally {
    await pendingContext.close();
  }
});
