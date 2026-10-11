import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { coverageFrom, tradeApi, tradeInput } from './usd-trades-fixtures';

const valuationPath = (accountId: string) => `/api/accounting/accounts/${accountId}/valuation`;
const pricePath = (instrumentId: string) => `/instruments/${instrumentId}/usd-prices`;
const at = '2025-01-03T00:00:00.000Z';

async function createPositions(api: Awaited<ReturnType<typeof tradeApi>>, prefix: string) {
  const account = await api.account(`${prefix} ${randomUUID()}`);
  const name = `<script>literal-${randomUUID()}</script>`;
  const first = await api.instrument(name, 'SAME');
  const second = await api.instrument(`${prefix} second ${randomUUID()}`, 'SAME');
  await api.initialize(account.id);
  const firstTrade = await api.create(
    account.id,
    tradeInput(first.id, 0, { occurredAt: '2025-01-02T00:00:00.000Z', grossUsd: '100' }),
  );
  await api.create(
    account.id,
    tradeInput(second.id, 1, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 1,
      quantity: '2',
      grossUsd: '400',
    }),
  );
  const sale = await api.create(
    account.id,
    tradeInput(first.id, 2, {
      side: 'sell',
      occurredAt: at,
      orderWithinTimestamp: 0,
      quantity: '0.5',
      grossUsd: '150',
    }),
  );
  return { account, first, second, firstTrade, sale };
}

async function setPrice(
  api: Awaited<ReturnType<typeof tradeApi>>,
  instrumentId: string,
  expectedRevision: number,
  priceUsd: string,
) {
  const response = await api.send('POST', pricePath(instrumentId), {
    requestId: randomUUID(),
    expectedRevision,
    observedAt: at,
    priceUsd,
    assertReviewed: true,
  });
  return response;
}

test('VAL-API: authenticated valuation uses exact UUID prices and preserves incomplete, zero, correction and void states', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const { account, first, second } = await createPositions(api, 'Valuation API');
  const firstSet = await setPrice(api, first.id, 0, '300');
  expect(firstSet.status()).toBe(201);
  const foreign = seedForeign();
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    await passwordStep(await pendingContext.newPage());
    let before = fingerprint(['auth_sessions', 'auth_request_limits']);
    let admissions = ledgerState();
    const providers = providerRequests();
    const anonymous = await request.get(
      `${valuationPath(account.id)}?at=${encodeURIComponent(at)}`,
    );
    expect(anonymous.status()).toBe(401);
    noStore(anonymous);
    const pending = await pendingContext.request.get(
      `${valuationPath(account.id)}?at=${encodeURIComponent(at)}`,
    );
    expect(pending.status()).toBe(401);
    noStore(pending);

    const invalid = await api.send(
      'GET',
      `/accounts/${account.id}/valuation?at=${encodeURIComponent(at)}&at=${encodeURIComponent(at)}`,
    );
    expect(invalid.status()).toBe(400);
    noStore(invalid);
    const unexpectedQuery = await api.send(
      'GET',
      `/accounts/${account.id}/valuation?at=${encodeURIComponent(at)}&offset=0`,
    );
    expect(unexpectedQuery.status()).toBe(400);
    noStore(unexpectedQuery);
    const foreignRead = await api.send(
      'GET',
      `/accounts/${foreign.accountId}/valuation?at=${encodeURIComponent(at)}`,
    );
    expect(foreignRead.status()).toBe(404);
    noStore(foreignRead);

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Denied valuation reads preserve business rows',
    ).toBe(before);
    const incomplete = await api.send(
      'GET',
      `/accounts/${account.id}/valuation?at=${encodeURIComponent(at)}`,
    );
    expect(incomplete.status()).toBe(200);
    noStore(incomplete);
    const incompleteBody = await incomplete.json();
    expect(incompleteBody).toEqual({
      accountId: account.id,
      at,
      coverageFrom,
      journalRevision: 3,
      basis: 'current-effective-history',
      originKind: 'declared-empty',
      openingRevision: null,
      priceSource: 'manual',
      quoteCurrency: 'USD',
      pricePolicy: 'exact-instant',
      completeness: 'incomplete',
      missingPriceCount: 1,
      unknownCostCount: 0,
      pricedSubtotalUsd: '150',
      totalValueUsd: null,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
      items: [
        {
          instrumentId: first.id,
          instrumentName: first.name,
          instrumentSymbol: 'SAME',
          quantity: '0.5',
          costUsd: '50',
          price: { priceUsd: '300', observedAt: at, revision: 1 },
          valueUsd: '150',
          unrealizedPnlUsd: '100',
          unrealizedReturnPercent: '200.00',
        },
        {
          instrumentId: second.id,
          instrumentName: second.name,
          instrumentSymbol: 'SAME',
          quantity: '2',
          costUsd: '400',
          price: null,
          valueUsd: null,
          unrealizedPnlUsd: null,
          unrealizedReturnPercent: null,
        },
      ].sort((left, right) => left.instrumentId.localeCompare(right.instrumentId)),
    });
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Incomplete valuation reads preserve business rows',
    ).toBe(before);
    expect(ledgerState()).toBe(admissions);

    const zero = await setPrice(api, second.id, 0, '0');
    expect(zero.status()).toBe(201);
    expect(await zero.json()).toMatchObject({ revision: 1, priceUsd: '0' });
    before = fingerprint(['auth_sessions', 'auth_request_limits']);
    admissions = ledgerState();
    const complete = await api.send(
      'GET',
      `/accounts/${account.id}/valuation?at=${encodeURIComponent(at)}`,
    );
    expect(complete.status()).toBe(200);
    noStore(complete);
    expect(await complete.json()).toMatchObject({
      completeness: 'complete',
      missingPriceCount: 0,
      pricedSubtotalUsd: '150',
      totalValueUsd: '150',
      unrealizedPnlUsd: '-300',
      unrealizedReturnPercent: '-66.67',
      items: expect.arrayContaining([
        expect.objectContaining({
          instrumentId: second.id,
          quantity: '2',
          price: { priceUsd: '0', observedAt: at, revision: 1 },
          valueUsd: '0',
          unrealizedPnlUsd: '-400',
          unrealizedReturnPercent: '-100.00',
        }),
      ]),
    });
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Complete valuation reads preserve business rows',
    ).toBe(before);
    expect(ledgerState()).toBe(admissions);

    const correction = await setPrice(api, first.id, 1, '320');
    expect(correction.status()).toBe(201);
    expect(await correction.json()).toMatchObject({ revision: 2, priceUsd: '320' });
    before = fingerprint(['auth_sessions', 'auth_request_limits']);
    admissions = ledgerState();
    const corrected = await api.send(
      'GET',
      `/accounts/${account.id}/valuation?at=${encodeURIComponent(at)}`,
    );
    expect(corrected.status()).toBe(200);
    noStore(corrected);
    expect(await corrected.json()).toMatchObject({
      completeness: 'complete',
      pricedSubtotalUsd: '160',
      totalValueUsd: '160',
      unrealizedPnlUsd: '-290',
      unrealizedReturnPercent: '-64.44',
      items: expect.arrayContaining([
        expect.objectContaining({
          instrumentId: first.id,
          quantity: '0.5',
          costUsd: '50',
          price: { priceUsd: '320', observedAt: at, revision: 2 },
          valueUsd: '160',
          unrealizedPnlUsd: '110',
          unrealizedReturnPercent: '220.00',
        }),
      ]),
    });
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Corrected valuation reads preserve business rows',
    ).toBe(before);
    expect(ledgerState()).toBe(admissions);

    const voided = await api.send('POST', `${pricePath(second.id)}/void`, {
      requestId: randomUUID(),
      expectedRevision: 1,
      observedAt: at,
      assertReviewed: true,
    });
    expect(voided.status()).toBe(201);
    expect(await voided.json()).toMatchObject({ revision: 2, kind: 'void', priceUsd: null });
    before = fingerprint(['auth_sessions', 'auth_request_limits']);
    admissions = ledgerState();
    const afterVoid = await api.send(
      'GET',
      `/accounts/${account.id}/valuation?at=${encodeURIComponent(at)}`,
    );
    expect(afterVoid.status()).toBe(200);
    noStore(afterVoid);
    expect(await afterVoid.json()).toMatchObject({
      completeness: 'incomplete',
      missingPriceCount: 1,
      pricedSubtotalUsd: '160',
      totalValueUsd: null,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
      items: expect.arrayContaining([
        expect.objectContaining({
          instrumentId: second.id,
          quantity: '2',
          price: null,
          valueUsd: null,
        }),
      ]),
    });
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Voided valuation reads preserve business rows',
    ).toBe(before);
    expect(ledgerState()).toBe(admissions);
    expect(providerRequests()).toEqual(providers);
  } finally {
    await pendingContext.close();
  }
});
