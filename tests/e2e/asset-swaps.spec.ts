import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { tradeApi, tradeInput } from './usd-trades-fixtures';

const at = '2025-01-03T00:00:00.000Z';
const swapsPath = (id: string) => `/accounts/${id}/swaps`;
const businessRows = () => fingerprint(['auth_sessions', 'auth_request_limits']);

function swapCommand(revision: number, outgoing: string, incoming: string) {
  return {
    requestId: randomUUID(),
    expectedJournalRevision: revision,
    assertExecuted: true,
    outgoingInstrumentId: outgoing,
    incomingInstrumentId: incoming,
    occurredAt: at,
    orderWithinTimestamp: 0,
    outgoingQuantity: '1',
    incomingQuantity: '3',
    considerationUsd: '150' as string | null,
    feeSource: 'incoming' as 'incoming' | 'held' | null,
    feeInstrumentId: incoming as string | null,
    feeQuantity: '0.1',
  };
}

test('SWAP-API: atomic exchange preserves fee origin, unknown evidence and private immutable lifecycle', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`Swap API ${randomUUID()}`);
  const outgoing = await api.instrument(`Outgoing ${randomUUID()}`, 'SAME');
  const incoming = await api.instrument(`Incoming ${randomUUID()}`, 'SAME');
  await api.initialize(account.id);
  await api.create(account.id, tradeInput(outgoing.id, 0));
  await api.create(account.id, tradeInput(incoming.id, 1, { grossUsd: '1' }));
  const path = swapsPath(account.id);
  const command = swapCommand(2, outgoing.id, incoming.id);

  // The predecessor reaches a valid new operation and fails on its missing route.
  const response = await api.send('POST', path, command);
  expect(response.status()).toBe(201);
  noStore(response);
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    accountId: account.id,
    journalRevision: 3,
    swap: {
      swapId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      version: 1,
      kind: 'create',
      requestId: command.requestId,
      considerationUsd: '150',
      outgoingInstrumentId: outgoing.id,
      incomingInstrumentId: incoming.id,
      incomingQuantity: '3',
      feeSource: 'incoming',
      feeQuantity: '0.1',
    },
  });
  const swapId = String(receipt.swap.swapId);
  expect(await api.result('POST', path, 200, command)).toEqual(receipt);

  const journal = (await api.result('GET', `/accounts/${account.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(journal.journal).toMatchObject({
    journalRevision: 3,
    versionCount: 2,
    summary: { grossBuysUsd: '101', grossSalesUsd: '0', realizedUsd: '0', remainingCostUsd: '146' },
    swapSummary: {
      activeCount: 1,
      considerationUsd: '150',
      principalBasisUsd: '100',
      feeConsumedBasisUsd: '5',
      realizedUsd: '45',
    },
  });
  const lots = (await api.result('GET', `/accounts/${account.id}/trade-lots`, 200)) as {
    items: unknown[];
  };
  expect(lots.items).toHaveLength(2);
  expect(lots.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        instrumentId: incoming.id,
        remainingQuantity: '1',
        remainingCostUsd: '1',
      }),
      expect.objectContaining({
        sourceKind: 'swap',
        instrumentId: incoming.id,
        remainingQuantity: '2.9',
        remainingCostUsd: '145',
        intervalStart: '0.1',
        intervalEnd: '3',
        origin: expect.objectContaining({ swapId, originalQuantity: '3', originalCostUsd: '150' }),
      }),
    ]),
  );
  const allocation = await api.result('GET', `${path}/${swapId}/allocation`, 200);
  expect(allocation).toMatchObject({
    principalBasisUsd: '100',
    feeConsumedBasisUsd: '5',
    realizedUsd: '45',
    items: expect.arrayContaining([
      expect.objectContaining({
        kind: 'fee',
        costUsd: '5',
        intervalStart: '0',
        intervalEnd: '0.1',
        origin: expect.objectContaining({ kind: 'swap', swapId }),
      }),
    ]),
  });

  const foreign = seedForeign();
  const providers = providerRequests();
  const beforeDenials = businessRows();
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    await passwordStep(await pendingContext.newPage());
    const pending = await pendingContext.request.get(`/api/accounting${path}`);
    expect(pending.status()).toBe(401);
    noStore(pending);
  } finally {
    await pendingContext.close();
  }
  const anonymous = await request.get(`/api/accounting${path}`);
  expect(anonymous.status()).toBe(401);
  noStore(anonymous);
  for (const id of [foreign.accountId, randomUUID()]) {
    const denied = await api.send('GET', swapsPath(id));
    expect(denied.status()).toBe(404);
    noStore(denied);
    const body = await denied.json();
    expect(body).toEqual({
      statusCode: 404,
      message: 'Not Found',
      error: 'NotFoundException',
      path: `/accounting${swapsPath(id)}`,
      timestamp: expect.any(String),
    });
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  }
  const missingCsrf = await page
    .context()
    .request.post(`/api/accounting${path}`, { data: command, headers: { Origin: origin } });
  expect(missingCsrf.status()).toBe(403);
  noStore(missingCsrf);
  expect(
    (await api.send('POST', path, command, { Origin: 'https://foreign.example.invalid' })).status(),
  ).toBe(403);
  expect(
    (
      await api.send('POST', path, { ...command, requestId: randomUUID(), outgoingQuantity: 1 })
    ).status(),
  ).toBe(400);
  expect((await api.send('POST', path, { ...command, considerationUsd: '151' })).status()).toBe(
    409,
  );
  expect((await api.send('POST', path, { ...command, requestId: randomUUID() })).status()).toBe(
    409,
  );
  expect(businessRows()).toBe(beforeDenials);

  const correction = {
    ...command,
    requestId: randomUUID(),
    expectedJournalRevision: 3,
    expectedVersion: 1,
    considerationUsd: null,
  };
  const unknown = await api.result('POST', `${path}/${swapId}/correct`, 201, correction);
  expect(unknown).toMatchObject({
    journalRevision: 4,
    swap: { version: 2, considerationUsd: null },
  });
  expect(await api.result('GET', `${path}/${swapId}/allocation`, 200)).toMatchObject({
    considerationUsd: null,
    principalBasisUsd: '100',
    feeConsumedBasisUsd: null,
    realizedUsd: null,
    coverage: {
      consideration: { knownSubtotalUsd: '0', unknownCount: 1 },
      principal: { knownSubtotalUsd: '100', unknownCount: 0 },
      fee: { knownSubtotalUsd: '0', unknownCount: 1 },
      realized: { knownSubtotalUsd: '0', unknownCount: 1 },
    },
  });
  const zero = await api.result('POST', `${path}/${swapId}/correct`, 201, {
    ...correction,
    requestId: randomUUID(),
    expectedJournalRevision: 4,
    expectedVersion: 2,
    considerationUsd: '0',
  });
  expect(zero).toMatchObject({ journalRevision: 5, swap: { version: 3, considerationUsd: '0' } });
  expect(await api.result('GET', `${path}/${swapId}/allocation`, 200)).toMatchObject({
    considerationUsd: '0',
    principalBasisUsd: '100',
    feeConsumedBasisUsd: '0',
    realizedUsd: '-100',
  });
  await api.result('POST', `${path}/${swapId}/void`, 201, {
    requestId: randomUUID(),
    expectedJournalRevision: 5,
    expectedVersion: 3,
  });
  expect(await api.result('POST', path, 200, command)).toEqual(receipt);
  const end = (await api.result('GET', `/accounts/${account.id}/trade-journal`, 200)) as {
    journal: Record<string, unknown>;
  };
  expect(end.journal).toMatchObject({
    journalRevision: 6,
    versionCount: 2,
    summary: { grossBuysUsd: '101', grossSalesUsd: '0', remainingCostUsd: '101' },
    swapSummary: {
      activeCount: 0,
      considerationUsd: '0',
      principalBasisUsd: '0',
      feeConsumedBasisUsd: '0',
      realizedUsd: '0',
    },
  });
  const beforeReads = businessRows();
  expect(await api.result('GET', `${path}/${swapId}/versions`, 200)).toMatchObject({
    items: [
      expect.objectContaining({ version: 4, kind: 'void' }),
      expect.objectContaining({ version: 3 }),
      expect.objectContaining({ version: 2 }),
      receipt.swap,
    ],
  });
  expect(businessRows()).toBe(beforeReads);
  expect(providerRequests()).toEqual(providers);
});
