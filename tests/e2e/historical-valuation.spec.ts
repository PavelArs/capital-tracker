import { randomUUID } from 'node:crypto';
import { type Locator, expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { inspectAnalysis } from './analytics-workbench-fixtures';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { coverageFrom, tradeApi, tradeInput } from './usd-trades-fixtures';

const valuationPath = (accountId: string) => `/api/accounting/accounts/${accountId}/valuation`;
const pricePath = (instrumentId: string) => `/instruments/${instrumentId}/usd-prices`;
const at = '2025-01-03T00:00:00.000Z';

function summaryValue(region: Locator, label: string) {
  return region.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]');
}

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

test('VAL-UI: account valuation refreshes exact totals, preserves the trade draft and ignores late results', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  const { account, first, second, firstTrade } = await createPositions(api, 'Valuation UI');
  const firstSet = await setPrice(api, first.id, 0, '300');
  expect(firstSet.status()).toBe(201);
  let financialBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
  const providers = providerRequests();
  const path = valuationPath(account.id);
  const requests: string[] = [];
  const valuationWrites: string[] = [];
  page.on('request', (browserRequest) => {
    const url = new URL(browserRequest.url());
    if (url.pathname === path) {
      requests.push(url.href);
      if (browserRequest.method() !== 'GET') valuationWrites.push(url.href);
    }
  });

  try {
    await page.goto(`/manual-accounts/${account.id}`);
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Оценка счёта на дату', exact: true }),
    ).toBeVisible();
    const section = page.getByRole('region', { name: 'Оценка счёта на дату', exact: true });
    const instant = page.getByLabel('Дата оценки', { exact: true });
    await instant.fill(at.slice(0, 10));
    const firstRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Рассчитать стоимость', exact: true }).click();
    const firstResponse = await firstRead;
    expect(firstResponse.status()).toBe(200);
    expect(firstResponse.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    expect(await firstResponse.json()).toMatchObject({
      completeness: 'incomplete',
      missingPriceCount: 1,
      pricedSubtotalUsd: '150',
      totalValueUsd: null,
      unrealizedPnlUsd: null,
    });
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Initial valuation read preserves business rows',
    ).toBe(financialBefore);
    await expect(section.getByText('Нет точной цены', { exact: true })).toBeVisible();
    await expect(section.getByText('Итого недоступно', { exact: true })).toBeVisible();
    await expect(section.getByText('Оценённая часть, USD', { exact: true })).toBeVisible();
    await expect(summaryValue(section, 'Оценённая часть, USD')).toHaveText('150');
    await expect(section.getByText(first.name, { exact: false })).toBeVisible();
    await expect(section.locator('script')).toHaveCount(0);
    const valuationTable = section.getByRole('table', { name: 'Оценка позиций', exact: true });
    const firstPosition = valuationTable.getByRole('row').filter({ hasText: first.id });
    const secondPosition = valuationTable.getByRole('row').filter({ hasText: second.id });
    await expect(firstPosition.getByRole('cell').nth(1)).toHaveText('0.5');
    await expect(firstPosition.getByRole('cell').nth(2)).toHaveText('50');
    await expect(firstPosition.getByText('300', { exact: true })).toBeVisible();
    await expect(firstPosition.getByRole('cell').nth(4)).toHaveText('150');
    await expect(secondPosition.getByRole('cell').nth(3)).toHaveText('Нет точной цены');
    await expect(secondPosition.getByRole('cell').nth(4)).toHaveText('—');
    await expect(firstPosition.getByRole('cell').nth(5)).toHaveText('100');
    await expect(firstPosition.getByRole('cell').nth(6)).toHaveText('200.00 %');
    await expect(secondPosition.getByRole('cell').nth(5)).toHaveText('Нужна точная цена');
    await expect(
      section.getByText('Нереализованная прибыль недоступна: нет точной цены для 1 позиций.', {
        exact: true,
      }),
    ).toBeVisible();
    await inspectAnalysis(page, testInfo, section, 'valuation');

    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    const tradeTable = page.getByRole('table', { name: 'Сделки журнала', exact: true });
    const tradeRow = tradeTable.getByRole('row').filter({ hasText: firstTrade.trade.tradeId });
    await tradeRow.getByRole('button', { name: 'Исправить', exact: true }).click();
    const tradeForm = page.getByRole('group', {
      name: 'Сделка в USD',
      exact: true,
      includeHidden: true,
    });
    const gross = tradeForm.getByLabel('Валовая сумма, USD', { exact: true });
    await gross.fill('120');
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();

    const zero = await setPrice(api, second.id, 0, '0');
    expect(zero.status()).toBe(201);
    financialBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
    const admissionsAfterPriceWrite = ledgerState();
    const completeRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Обновить оценку', exact: true }).click();
    const completeResponse = await completeRead;
    expect(completeResponse.status()).toBe(200);
    expect(completeResponse.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    expect(await completeResponse.json()).toMatchObject({
      completeness: 'complete',
      missingPriceCount: 0,
      pricedSubtotalUsd: '150',
      totalValueUsd: '150',
      unrealizedPnlUsd: '-300',
      unrealizedReturnPercent: '-66.67',
    });
    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Refreshed valuation read preserves business rows',
    ).toBe(financialBefore);
    expect(ledgerState()).toBe(admissionsAfterPriceWrite);
    await expect(section.getByText('Стоимость позиций, USD', { exact: true })).toBeVisible();
    await expect(summaryValue(section, 'Стоимость позиций, USD')).toHaveText('150');
    await expect(section.getByText(second.name, { exact: false })).toBeVisible();
    await expect(
      secondPosition.getByRole('cell').nth(3).getByText('0', { exact: true }),
    ).toBeVisible();
    await expect(secondPosition.getByRole('cell').nth(4)).toHaveText('0');
    await expect(summaryValue(section, 'Нереализованная прибыль, USD')).toHaveText('-300');
    await expect(summaryValue(section, 'Доход, %')).toHaveText('-66.67 %');
    await expect(secondPosition.getByRole('cell').nth(5)).toHaveText('-400');
    await expect(secondPosition.getByRole('cell').nth(6)).toHaveText('-100.00 %');

    const pattern = `**${path}?*`;
    let release = () => {};
    let held = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      pattern,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        held = true;
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    try {
      const delayed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === path && response.request().method() === 'GET',
      );
      await page.getByRole('button', { name: 'Обновить оценку', exact: true }).click();
      await expect.poll(() => held).toBe(true);
      await instant.fill('2025-01-04');
      release();
      const late = await delayed;
      expect(late.status()).toBe(200);
      expect(late.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
      expect(await late.json()).toMatchObject({ at, totalValueUsd: '150' });
      await expect(section.getByText(at, { exact: true })).toHaveCount(0);
      await expect(section.getByRole('table', { name: 'Оценка позиций', exact: true })).toHaveCount(
        0,
      );
      expect(requests).toHaveLength(3);
      await expect(gross).toHaveValue('120');
      expect(valuationWrites).toEqual([]);
    } finally {
      release();
      await page.unroute(pattern);
    }

    expect(
      fingerprint(['auth_sessions', 'auth_request_limits']),
      'Late and edited valuation reads preserve business rows',
    ).toBe(financialBefore);
    expect(ledgerState()).toBe(admissionsAfterPriceWrite);
    expect(providerRequests()).toEqual(providers);
  } finally {
    expect(valuationWrites).toEqual([]);
  }
});
