import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { tradeApi } from './usd-trades-fixtures';

const rewardsPath = (accountId: string) => `/accounts/${accountId}/rewards`;
const valuationPath = (accountId: string, at: string) =>
  `/accounts/${accountId}/valuation?at=${encodeURIComponent(at)}`;
const pricePath = (instrumentId: string) => `/instruments/${instrumentId}/usd-prices`;
const at = '2025-01-02T00:00:00.000Z';
const businessRows = () => fingerprint(['auth_sessions', 'auth_request_limits']);

function rewardCommand(
  expectedJournalRevision: number,
  instrumentId: string,
  values: Partial<Record<string, unknown>> = {},
) {
  return {
    requestId: randomUUID(),
    expectedJournalRevision,
    assertReward: true,
    instrumentId,
    category: 'staking',
    occurredAt: at,
    orderWithinTimestamp: 0,
    quantity: '2',
    acquisitionBasisUsd: null,
    incomeValueUsd: '40',
    ...values,
  };
}

async function setPrice(
  api: Awaited<ReturnType<typeof tradeApi>>,
  instrumentId: string,
  priceUsd: string,
) {
  return api.send('POST', pricePath(instrumentId), {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: at,
    priceUsd,
    assertReviewed: true,
  });
}

test('REWARD-API: null basis, zero, income and manual value stay distinct across private lifecycle', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`Reward API ${randomUUID()}`);
  const unknownAsset = await api.instrument(`Unknown basis reward ${randomUUID()}`, 'RWD');
  const zeroAsset = await api.instrument(`Known zero reward ${randomUUID()}`, 'RWD');
  await api.initialize(account.id);
  const path = rewardsPath(account.id);

  // First new-feature assertion is a valid create, so the predecessor fails on route absence.
  const firstCommand = rewardCommand(0, unknownAsset.id);
  const firstResponse = await api.send('POST', path, firstCommand);
  expect(firstResponse.status()).toBe(201);
  const firstReceipt = await firstResponse.json();
  expect(firstReceipt).toMatchObject({
    accountId: account.id,
    journalRevision: 1,
    reward: {
      rewardId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      version: 1,
      kind: 'create',
      requestId: firstCommand.requestId,
      journalRevision: 1,
      instrumentId: unknownAsset.id,
      category: 'staking',
      quantity: '2',
      acquisitionBasisUsd: null,
      incomeValueUsd: '40',
    },
  });
  const firstId = String(firstReceipt.reward.rewardId);

  const secondCommand = rewardCommand(1, zeroAsset.id, {
    category: 'unclassified',
    orderWithinTimestamp: 1,
    quantity: '1',
    acquisitionBasisUsd: '0',
    incomeValueUsd: '0',
  });
  const secondReceipt = (await api.result('POST', path, 201, secondCommand)) as {
    journalRevision: number;
    reward: { rewardId: string; version: number; category: string; acquisitionBasisUsd: string };
  };
  expect(secondReceipt).toMatchObject({
    journalRevision: 2,
    reward: { version: 1, category: 'unclassified', acquisitionBasisUsd: '0', incomeValueUsd: '0' },
  });
  const secondId = secondReceipt.reward.rewardId;

  expect((await setPrice(api, unknownAsset.id, '5')).status()).toBe(201);
  expect((await setPrice(api, zeroAsset.id, '7')).status()).toBe(201);
  const foreign = seedForeign();
  const providers = providerRequests();
  const rowsBeforeDenials = businessRows();
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const pendingPage = await pendingContext.newPage();
  try {
    await passwordStep(pendingPage);
    const pending = await pendingContext.request.get(`/api/accounting${path}`);
    expect(pending.status()).toBe(401);
    noStore(pending);
  } finally {
    await pendingContext.close();
  }
  const anonymous = await request.get(`/api/accounting${path}`);
  expect(anonymous.status()).toBe(401);
  noStore(anonymous);
  const foreignRead = await api.send('GET', rewardsPath(foreign.accountId));
  expect(foreignRead.status()).toBe(404);
  const absentPath = rewardsPath(randomUUID());
  const absentRead = await api.send('GET', absentPath);
  expect(absentRead.status()).toBe(404);
  const foreignError = await foreignRead.json();
  const absentError = await absentRead.json();
  expect(foreignError).toMatchObject({
    statusCode: 404,
    message: 'Not Found',
    error: 'NotFoundException',
    path: `/accounting${rewardsPath(foreign.accountId)}`,
  });
  expect(absentError).toMatchObject({
    statusCode: 404,
    message: 'Not Found',
    error: 'NotFoundException',
    path: `/accounting${absentPath}`,
  });
  expect(foreignError.timestamp).toEqual(expect.any(String));
  expect(new Date(foreignError.timestamp).toISOString()).toBe(foreignError.timestamp);
  expect(absentError.timestamp).toEqual(expect.any(String));
  expect(new Date(absentError.timestamp).toISOString()).toBe(absentError.timestamp);
  const stableEnvelope = (value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'timestamp' && key !== 'path'),
    );
  expect(stableEnvelope(foreignError)).toEqual(stableEnvelope(absentError));
  expect(await foreignRead.text()).not.toContain('Synthetic foreign');

  const malformedBody = {
    requestId: randomUUID(),
    expectedJournalRevision: 2,
    assertReward: true,
    instrumentId: unknownAsset.id,
    category: 'staking',
    occurredAt: at,
    orderWithinTimestamp: 0,
    quantity: '2',
    acquisitionBasisUsd: null,
  };
  const malformedBefore = businessRows();
  const malformed = await api.send('POST', path, malformedBody);
  expect(malformed.status()).toBe(400);
  expect(businessRows()).toBe(malformedBefore);

  const originBefore = businessRows();
  const hostileOrigin = await api.send('POST', path, rewardCommand(2, unknownAsset.id), {
    Origin: 'https://foreign.example.invalid',
  });
  expect(hostileOrigin.status()).toBe(403);
  expect(businessRows()).toBe(originBefore);
  const csrfBefore = businessRows();
  const missingCsrf = await page.context().request.post(`/api/accounting${path}`, {
    data: rewardCommand(2, unknownAsset.id),
    headers: { Origin: origin },
  });
  expect(missingCsrf.status()).toBe(403);
  noStore(missingCsrf);
  expect(businessRows()).toBe(csrfBefore);
  expect(businessRows()).toBe(rowsBeforeDenials);
  expect(providerRequests()).toEqual(providers);

  const oldRowsBeforeReads = businessRows();
  const providersBeforeReads = providerRequests();
  const journalResponse = await api.send('GET', `/accounts/${account.id}/trade-journal`);
  expect(journalResponse.status()).toBe(200);
  const journal = (await journalResponse.json()).journal;
  expect(journal).toMatchObject({
    journalRevision: 2,
    versionCount: 0,
    summary: {
      grossBuysUsd: '0',
      realizedUsd: '0',
      remainingCostUsd: null,
    },
    rewardSummary: {
      activeCount: 2,
      declaredBasisUsd: null,
      declaredIncomeUsd: null,
      knownBasisSubtotalUsd: '0',
      knownIncomeSubtotalUsd: '40',
      unknownBasisCount: 1,
      unknownIncomeCount: 0,
      unclassifiedCount: 1,
    },
  });

  const valuationResponse = await api.send('GET', valuationPath(account.id, at));
  expect(valuationResponse.status()).toBe(200);
  const valuation = await valuationResponse.json();
  expect(valuation).toMatchObject({
    journalRevision: 2,
    priceSource: 'manual',
    completeness: 'complete',
    pricedSubtotalUsd: '17',
    totalValueUsd: '17',
    unknownCostCount: 1,
    unrealizedPnlUsd: null,
    unrealizedReturnPercent: null,
    items: expect.arrayContaining([
      expect.objectContaining({
        instrumentId: unknownAsset.id,
        quantity: '2',
        costUsd: null,
        knownCostSubtotalUsd: '0',
        unknownCostQuantity: '2',
        price: { priceUsd: '5', observedAt: at, revision: 1 },
        valueUsd: '10',
        unrealizedPnlUsd: null,
        unrealizedReturnPercent: null,
      }),
      expect.objectContaining({
        instrumentId: zeroAsset.id,
        quantity: '1',
        costUsd: '0',
        price: { priceUsd: '7', observedAt: at, revision: 1 },
        valueUsd: '7',
        unrealizedPnlUsd: '7',
        unrealizedReturnPercent: null,
      }),
    ]),
  });
  expect(businessRows()).toBe(oldRowsBeforeReads);
  expect(providerRequests()).toEqual(providersBeforeReads);
  expect(providersBeforeReads).toEqual(providers);

  const firstCorrection = {
    ...firstCommand,
    expectedJournalRevision: 2,
    expectedVersion: 1,
    requestId: randomUUID(),
    acquisitionBasisUsd: '0',
  };
  const corrected = (await api.result(
    'POST',
    `${path}/${firstId}/correct`,
    201,
    firstCorrection,
  )) as {
    journalRevision: number;
    reward: Record<string, unknown>;
  };
  expect(corrected).toMatchObject({
    journalRevision: 3,
    reward: { version: 2, acquisitionBasisUsd: '0', incomeValueUsd: '40' },
  });
  const firstVersions = (await api.result('GET', `${path}/${firstId}/versions?limit=10`, 200)) as {
    items: Record<string, unknown>[];
  };
  expect(firstVersions.items).toHaveLength(2);
  expect(firstVersions.items.find((item) => item.version === 1)).toMatchObject({
    version: 1,
    acquisitionBasisUsd: null,
    incomeValueUsd: '40',
  });

  const voided = (await api.result('POST', `${path}/${secondId}/void`, 201, {
    requestId: randomUUID(),
    expectedJournalRevision: 3,
    expectedVersion: 1,
  })) as { journalRevision: number; reward: Record<string, unknown> };
  expect(voided).toMatchObject({
    journalRevision: 4,
    reward: { rewardId: secondId, version: 2, kind: 'void' },
  });
  const rowsBeforeReplay = businessRows();
  expect(await api.result('POST', path, 200, firstCommand)).toEqual(firstReceipt);
  expect(businessRows()).toBe(rowsBeforeReplay);

  const listed = (await api.result('GET', `${path}?journalRevision=4&offset=0&limit=50`, 200)) as {
    journalRevision: number;
    activeCount: number;
    versionCount: number;
    items: Record<string, unknown>[];
  };
  expect(listed).toMatchObject({ journalRevision: 4, activeCount: 1, versionCount: 4 });
  expect(listed.items.map((item) => item.rewardId)).toContain(secondId);
  expect(listed.items.find((item) => item.rewardId === secondId)).toMatchObject({ kind: 'void' });

  const rowsBeforeReads = businessRows();
  const providersAfterWrites = providerRequests();
  const history = await api.send(
    'GET',
    `/accounts/${account.id}/trade-journal/history?at=${encodeURIComponent(at)}`,
  );
  expect(history.status()).toBe(200);
  expect(await history.json()).toMatchObject({
    journalRevision: 4,
    summary: { grossBuysUsd: '0', remainingCostUsd: '0', realizedUsd: '0' },
    rewardSummary: {
      activeCount: 1,
      declaredBasisUsd: '0',
      declaredIncomeUsd: '40',
      knownBasisSubtotalUsd: '0',
      knownIncomeSubtotalUsd: '40',
      unknownBasisCount: 0,
      unknownIncomeCount: 0,
      unclassifiedCount: 0,
    },
    items: [
      expect.objectContaining({
        instrumentId: unknownAsset.id,
        quantity: '2',
        costUsd: '0',
      }),
    ],
  });
  const after = await api.send('GET', valuationPath(account.id, at));
  expect(after.status()).toBe(200);
  expect((await after.json()).totalValueUsd).toBe('10');
  expect(businessRows()).toBe(rowsBeforeReads);
  expect(providerRequests()).toEqual(providersAfterWrites);
  expect(providersAfterWrites).toEqual(providers);
  expect(firstId).not.toBe(secondId);
});
