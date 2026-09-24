import { randomUUID } from 'node:crypto';
import { type Locator, expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { coverageFrom, tradeApi, tradeInput } from './usd-trades-fixtures';

const from = coverageFrom;
const to = '2025-01-04T00:00:00.000Z';
const dayTwo = '2025-01-02T00:00:00.000Z';
const dayThree = '2025-01-03T00:00:00.000Z';
const dayFour = to;
const historyPath = (accountId: string) =>
  `/api/accounting/accounts/${accountId}/valuation-history`;
const pricePath = (instrumentId: string) => `/instruments/${instrumentId}/usd-prices`;

async function createTimeline(api: Awaited<ReturnType<typeof tradeApi>>, prefix: string) {
  const account = await api.account(`${prefix} ${randomUUID()}`);
  const instrument = await api.instrument(`${prefix} <script>${randomUUID()}</script>`, 'VCH');
  await api.initialize(account.id);
  const first = await api.create(
    account.id,
    tradeInput(instrument.id, 0, {
      occurredAt: dayTwo,
      orderWithinTimestamp: 0,
      quantity: '1',
      grossUsd: '100',
    }),
  );
  await api.create(
    account.id,
    tradeInput(instrument.id, 1, {
      occurredAt: dayThree,
      orderWithinTimestamp: 0,
      quantity: '1',
      grossUsd: '200',
    }),
  );
  await api.create(
    account.id,
    tradeInput(instrument.id, 2, {
      side: 'sell',
      occurredAt: dayFour,
      orderWithinTimestamp: 0,
      quantity: '1.5',
      grossUsd: '450',
    }),
  );
  const jan2 = await api.send('POST', pricePath(instrument.id), {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: dayTwo,
    priceUsd: '100',
    assertReviewed: true,
  });
  expect(jan2.status()).toBe(201);
  const jan4 = await api.send('POST', pricePath(instrument.id), {
    requestId: randomUUID(),
    expectedRevision: 1,
    observedAt: dayFour,
    priceUsd: '300',
    assertReviewed: true,
  });
  expect(jan4.status()).toBe(201);
  return { account, instrument, firstTrade: first.trade };
}

async function expectPointRow(table: Locator, at: string, values: string[]): Promise<void> {
  const row = table.getByRole('row').filter({ hasText: at });
  await expect(row).toHaveCount(1);
  const cells = await row.getByRole('cell').allTextContents();
  expect(cells).toContain(at);
  for (const value of values) expect(cells).toContain(value);
}

test('VCH-API: one private exact timeline reports empty, priced, missing and sold-down points', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const { account, instrument } = await createTimeline(api, 'Valuation history API');
  const foreign = seedForeign();
  const noJournal = await api.account(`Valuation history no journal ${randomUUID()}`);
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    await passwordStep(await pendingContext.newPage());
    const path = historyPath(account.id);
    let financialBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
    let admissionsBefore = ledgerState();
    const providersBefore = providerRequests();

    const anonymous = await request.get(
      `${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(anonymous.status()).toBe(401);
    noStore(anonymous);
    const pending = await pendingContext.request.get(
      `${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(pending.status()).toBe(401);
    noStore(pending);

    const invalidQueries = [
      `?from=bad&to=${encodeURIComponent(to)}`,
      `?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`,
      '?from=2025-01-01T00%3A00%3A00.000Z&to=2025-02-01T00%3A00%3A00.000Z',
      `?from=${encodeURIComponent(from)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=31`,
    ];
    for (const query of invalidQueries) {
      const response = await api.send('GET', `/accounts/${account.id}/valuation-history${query}`);
      expect(response.status()).toBe(400);
      noStore(response);
    }
    const foreignRead = await api.send(
      'GET',
      `/accounts/${foreign.accountId}/valuation-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(foreignRead.status()).toBe(404);
    noStore(foreignRead);
    const absentJournal = await api.send(
      'GET',
      `/accounts/${noJournal.id}/valuation-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(absentJournal.status()).toBe(409);
    noStore(absentJournal);
    const precoverage = await api.send(
      'GET',
      `/accounts/${account.id}/valuation-history?from=2024-12-31T00%3A00%3A00.000Z&to=${encodeURIComponent(from)}`,
    );
    expect(precoverage.status()).toBe(409);
    noStore(precoverage);

    const response = await api.send(
      'GET',
      `/accounts/${account.id}/valuation-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(response.status()).toBe(200);
    noStore(response);
    expect(await response.json()).toEqual({
      accountId: account.id,
      from,
      to,
      coverageFrom: from,
      journalRevision: 3,
      originKind: 'declared-empty',
      openingRevision: null,
      basis: 'current-effective-history',
      priceSource: 'manual',
      quoteCurrency: 'USD',
      pricePolicy: 'exact-instant',
      sampling: '24h-from-start-and-end',
      points: [
        {
          at: from,
          completeness: 'complete',
          missingPriceCount: 0,
          pricedSubtotalUsd: '0',
          totalValueUsd: '0',
        },
        {
          at: dayTwo,
          completeness: 'complete',
          missingPriceCount: 0,
          pricedSubtotalUsd: '100',
          totalValueUsd: '100',
        },
        {
          at: dayThree,
          completeness: 'incomplete',
          missingPriceCount: 1,
          pricedSubtotalUsd: '0',
          totalValueUsd: null,
        },
        {
          at: dayFour,
          completeness: 'complete',
          missingPriceCount: 0,
          pricedSubtotalUsd: '150',
          totalValueUsd: '150',
        },
      ],
    });
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(financialBefore);
    expect(ledgerState()).toBe(admissionsBefore);
    expect(providerRequests()).toEqual(providersBefore);

    const zero = await api.send('POST', pricePath(instrument.id), {
      requestId: randomUUID(),
      expectedRevision: 2,
      observedAt: dayThree,
      priceUsd: '0',
      assertReviewed: true,
    });
    expect(zero.status()).toBe(201);
    financialBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
    admissionsBefore = ledgerState();
    const refreshed = await api.send(
      'GET',
      `/accounts/${account.id}/valuation-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(refreshed.status()).toBe(200);
    noStore(refreshed);
    expect(await refreshed.json()).toMatchObject({
      points: [
        {
          at: dayThree,
          completeness: 'complete',
          missingPriceCount: 0,
          pricedSubtotalUsd: '0',
          totalValueUsd: '0',
        },
      ],
    });
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(financialBefore);
    expect(ledgerState()).toBe(admissionsBefore);
    expect(providerRequests()).toEqual(providersBefore);
  } finally {
    await pendingContext.close();
  }
});

test('VCH-UI: chart history refreshes zero data and ignores a late period response without losing the trade draft', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const { account, instrument, firstTrade } = await createTimeline(api, 'Valuation history UI');
  const path = historyPath(account.id);
  const providersBefore = providerRequests();
  const financialBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === path && request.method() !== 'GET') writes.push(url.href);
  });

  await page.goto(`/manual-accounts/${account.id}`);
  await expect(
    page.getByRole('heading', { name: 'История стоимости счёта', exact: true }),
  ).toBeVisible();
  const region = page.getByRole('region', { name: 'История стоимости счёта', exact: true });
  const fromInput = page.getByLabel('Начало периода (ISO)', { exact: true });
  const toInput = page.getByLabel('Конец периода (ISO)', { exact: true });
  await fromInput.fill(from);
  await toInput.fill(to);
  const result = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Показать историю', exact: true }).click();
  const firstResponse = await result;
  expect(firstResponse.status()).toBe(200);
  expect(firstResponse.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(financialBefore);
  expect(providerRequests()).toEqual(providersBefore);
  expect(await firstResponse.json()).toMatchObject({
    points: [
      { at: from, totalValueUsd: '0' },
      { at: dayTwo, totalValueUsd: '100' },
      { at: dayThree, totalValueUsd: null },
      { at: dayFour, totalValueUsd: '150' },
    ],
  });
  const table = region.getByRole('table', { name: 'Оценки по датам', exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(5);
  await expectPointRow(table, from, ['Полная оценка', '0']);
  await expectPointRow(table, dayTwo, ['Полная оценка', '100']);
  await expectPointRow(table, dayThree, ['Нет полной оценки', '—', '0', '1']);
  await expectPointRow(table, dayFour, ['Полная оценка', '150']);
  await expect(
    region.getByRole('img', { name: 'График стоимости счёта', exact: true }),
  ).toBeVisible();
  await expect(region.getByText(instrument.name, { exact: false })).toBeVisible();
  await expect(region.locator('script')).toHaveCount(0);

  const tradeTable = page.getByRole('table', { name: 'Сделки журнала', exact: true });
  const firstRow = tradeTable.getByRole('row').filter({ hasText: firstTrade.tradeId });
  await firstRow.getByRole('button', { name: 'Исправить', exact: true }).click();
  const tradeForm = page.getByRole('group', { name: 'Сделка в USD', exact: true });
  const gross = tradeForm.getByLabel('Валовая сумма, USD', { exact: true });
  await gross.fill('110');

  const zero = await api.send('POST', pricePath(instrument.id), {
    requestId: randomUUID(),
    expectedRevision: 2,
    observedAt: dayThree,
    priceUsd: '0',
    assertReviewed: true,
  });
  expect(zero.status()).toBe(201);
  const financialAfterPriceWrite = fingerprint(['auth_sessions', 'auth_request_limits']);
  const admissionsAfterPriceWrite = ledgerState();
  const providersAfterPriceWrite = providerRequests();
  const refreshedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
  const complete = await refreshedResponse;
  expect(complete.status()).toBe(200);
  expect((await complete.json()).points).toContainEqual({
    at: dayThree,
    completeness: 'complete',
    missingPriceCount: 0,
    pricedSubtotalUsd: '0',
    totalValueUsd: '0',
  });
  await expectPointRow(table, dayThree, ['Полная оценка', '0']);
  await expect(gross).toHaveValue('110');
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(financialAfterPriceWrite);
  expect(ledgerState()).toBe(admissionsAfterPriceWrite);
  expect(providerRequests()).toEqual(providersAfterPriceWrite);

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
    const lateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await toInput.fill(dayThree);
    release();
    const late = await lateResponse;
    expect(late.status()).toBe(200);
    expect(late.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
    expect(await late.json()).toMatchObject({ to });
    await expect(table).toHaveCount(0);
    await expect(gross).toHaveValue('110');
    expect(writes).toEqual([]);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(financialAfterPriceWrite);
    expect(ledgerState()).toBe(admissionsAfterPriceWrite);
    expect(providerRequests()).toEqual(providersAfterPriceWrite);
  } finally {
    release();
    await page.unroute(pattern);
  }
});
