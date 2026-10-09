import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { test } from './external-usd-flows-fixtures';
import { noStore, providerRequests } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep } from './mfa-fixtures';
import { coverageFrom, tradeApi } from './usd-trades-fixtures';

const journalPath = '/portfolio/cash-flow-journal';
const flowsPath = '/portfolio/cash-flows';
const boundaryPath = '/portfolio/twr-boundaries';
const linkedPath = '/portfolio/linked-twr-preview';
const from = coverageFrom;
const to = '2025-01-03T00:00:00.000Z';
const boundaryAt = '2025-01-02T00:00:00.000Z';

function periodQuery(start = from, end = to) {
  return `?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`;
}

function previewInput(
  expectedJournalRevision: number,
  boundaryValuations: { at: string; valueBeforeUsd: string }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    from,
    to,
    openingValueUsd: '1000',
    closingValueUsd: '2310',
    assertReviewed: true,
    expectedJournalRevision,
    boundaryValuations,
    ...overrides,
  };
}

function flowCommand(expectedJournalRevision: number, amountUsd: string, occurredAt = boundaryAt) {
  return {
    requestId: randomUUID(),
    expectedJournalRevision,
    direction: 'contribution',
    occurredAt,
    amountUsd,
    assertExternal: true,
  };
}

function assertLinked(value: unknown, journalRevision: number) {
  expect(value).toMatchObject({
    from,
    to,
    coverageFrom: from,
    journalRevision,
    basis: 'manual-usd-valuations',
    flowBasis: 'owner-declared-usd-flows',
    completeness: 'unreconciled',
    openingValueUsd: '1000',
    closingValueUsd: '2310',
    flows: {
      contributionsUsd: '1000',
      withdrawalsUsd: '0',
      netContributionsUsd: '1000',
      flowCount: 1,
    },
    profitUsd: '310',
    linkedTwr: {
      method: 'geometrically-linked-UTC-ms',
      rateRoundingBound: '0.0000000000005',
      boundaryLimit: 32,
      netFlowAtStartUsd: '0',
      startingCapitalUsd: '1000',
      interiorNetFlowDateCount: 1,
      status: 'available',
      reason: null,
      periodRate: '0.21',
      periodPercent: '21',
      boundaries: [
        {
          at: boundaryAt,
          netFlowUsd: '1000',
          valueBeforeUsd: '1100',
          valueAfterUsd: '2100',
        },
      ],
    },
  });
}

test('LTWR-API: actual revision-pinned boundary plan and linked preview remain private', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  await api.result('POST', journalPath, 201, {
    requestId: randomUUID(),
    coverageFrom: from,
    assertReviewed: true,
  });
  const created = (await api.result('POST', flowsPath, 201, flowCommand(0, '1000'))) as {
    flow: { flowId: string };
  };

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const plan = await api.send('GET', `${boundaryPath}${periodQuery()}`);
    expect(plan.status()).toBe(200);
    const planBody = await plan.json();
    expect(planBody).toMatchObject({
      from,
      to,
      coverageFrom: from,
      journalRevision: 1,
      basis: 'owner-declared-usd-flows',
      completeness: 'unreconciled',
      boundaryLimit: 32,
      netFlowAtStartUsd: '0',
      interiorNetFlowDateCount: 1,
      status: 'ready',
      reason: null,
      boundaries: [{ at: boundaryAt, netFlowUsd: '1000' }],
    });

    let financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    let admissionsBefore = ledgerState();
    let providersBefore = providerRequests();
    const missing = await api.send('POST', linkedPath, previewInput(1, []));
    expect(missing.status()).toBe(200);
    expect(await missing.json()).toMatchObject({
      journalRevision: 1,
      profitUsd: '310',
      linkedTwr: {
        status: 'unavailable',
        reason: 'missing-flow-boundary-valuations',
        periodRate: null,
        periodPercent: null,
        boundaries: [
          {
            at: boundaryAt,
            netFlowUsd: '1000',
            valueBeforeUsd: null,
            valueAfterUsd: null,
          },
        ],
      },
    });

    const response = await api.send(
      'POST',
      linkedPath,
      previewInput(1, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
    );
    expect(response.status()).toBe(200);
    assertLinked(await response.json(), 1);
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
    ).toBe(financialBefore);
    expect(ledgerState()).toBe(admissionsBefore);
    expect(providerRequests()).toEqual(providersBefore);

    const correction = await api.result(
      'POST',
      `${flowsPath}/${created.flow.flowId}/corrections`,
      201,
      flowCommand(1, '1200'),
    );
    expect(correction).toMatchObject({ journalRevision: 2 });
    financialBefore = fingerprint([
      'auth_sessions',
      'auth_request_limits',
      'owner_mfa',
      'owner_mfa_recovery',
    ]);
    admissionsBefore = ledgerState();
    providersBefore = providerRequests();
    const stale = await api.send(
      'POST',
      linkedPath,
      previewInput(1, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
    );
    expect(stale.status()).toBe(409);

    const refreshed = await api.send('GET', `${boundaryPath}${periodQuery()}`);
    expect(refreshed.status()).toBe(200);
    expect(await refreshed.json()).toMatchObject({
      journalRevision: 2,
      boundaries: [{ at: boundaryAt, netFlowUsd: '1200' }],
    });

    const invalid = await api.send(
      'POST',
      linkedPath,
      previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }], { ownerId: randomUUID() }),
    );
    expect(invalid.status()).toBe(400);
    const badPlan = await api.send(
      'GET',
      `${boundaryPath}${periodQuery()}&ownerId=${encodeURIComponent(randomUUID())}`,
    );
    expect(badPlan.status()).toBe(400);

    const pendingPlan = await pendingContext.request.fetch(
      `/api/accounting${boundaryPath}${periodQuery()}`,
      { headers: { Origin: origin } },
    );
    expect(pendingPlan.status()).toBe(401);
    noStore(pendingPlan);
    const pendingPreview = await pendingContext.request.fetch(`/api/accounting${linkedPath}`, {
      method: 'POST',
      data: previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
      headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
    });
    expect(pendingPreview.status()).toBe(401);
    noStore(pendingPreview);
    const anonymousPlan = await request.fetch(`/api/accounting${boundaryPath}${periodQuery()}`, {
      headers: { Origin: origin },
    });
    expect(anonymousPlan.status()).toBe(401);
    noStore(anonymousPlan);
    const anonymousPreview = await request.fetch(`/api/accounting${linkedPath}`, {
      method: 'POST',
      data: previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
      headers: { Origin: origin },
    });
    expect(anonymousPreview.status()).toBe(401);
    noStore(anonymousPreview);
    const hostileOrigin = await api.send(
      'POST',
      linkedPath,
      previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
      { Origin: 'https://foreign.example.invalid' },
    );
    expect(hostileOrigin.status()).toBe(403);
    const missingCsrf = await page.request.fetch(`/api/accounting${linkedPath}`, {
      method: 'POST',
      data: previewInput(2, [{ at: boundaryAt, valueBeforeUsd: '1100' }]),
      headers: { Origin: origin },
    });
    expect(missingCsrf.status()).toBe(403);
    noStore(missingCsrf);

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits', 'owner_mfa', 'owner_mfa_recovery']),
      'Boundary plans and previews preserve all financial rows',
    ).toBe(financialBefore);
    expect(ledgerState(), 'Read-only plans, previews and denials do not consume admissions').toBe(
      admissionsBefore,
    );
    expect(providerRequests()).toEqual(providersBefore);
  } finally {
    await pendingContext.close();
  }
});
