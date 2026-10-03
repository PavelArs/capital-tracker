import { randomUUID } from 'node:crypto';
import { type Locator, expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { coverageFrom, tradeApi, tradeInput } from './usd-trades-fixtures';

const previewPath = '/api/accounting/manual-valuation-preview';
const valuationAt = '2025-01-03T00:00:00.000Z';
const beforeCoverageAt = '2024-12-31T23:59:59.999Z';
const pricePath = (instrumentId: string) => `/instruments/${instrumentId}/usd-prices`;

type PortfolioSetup = {
  first: { id: string; name: string };
  sameSymbol: { id: string; name: string };
  accounts: {
    half: { id: string; name: string };
    double: { id: string; name: string };
    missingPrice: { id: string; name: string };
    noJournal: { id: string; name: string };
    beforeCoverage: { id: string; name: string };
  };
};

async function createPortfolio(
  api: Awaited<ReturnType<typeof tradeApi>>,
  prefix: string,
): Promise<PortfolioSetup> {
  const account = async (label: string) => api.account(`${prefix} ${label} ${randomUUID()}`);
  const half = await account('half');
  const double = await account('double');
  const missingPrice = await account('missing price');
  const noJournal = await account('no journal');
  const beforeCoverage = await account('coverage');
  const first = await api.instrument(`${prefix} shared instrument ${randomUUID()}`, 'SAME');
  const sameSymbol = await api.instrument(`${prefix} distinct UUID ${randomUUID()}`, 'SAME');

  for (const owned of [half, double, missingPrice, beforeCoverage]) {
    await api.initialize(owned.id);
  }
  await api.create(
    half.id,
    tradeInput(first.id, 0, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '0.5',
      grossUsd: '50',
    }),
  );
  await api.create(
    double.id,
    tradeInput(first.id, 0, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '2',
      grossUsd: '200',
    }),
  );
  await api.create(
    missingPrice.id,
    tradeInput(sameSymbol.id, 0, {
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '1',
      grossUsd: '100',
    }),
  );

  const price = await api.send('POST', pricePath(first.id), {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: valuationAt,
    priceUsd: '123.456',
    assertReviewed: true,
  });
  expect(price.status()).toBe(201);

  return {
    first,
    sameSymbol,
    accounts: { half, double, missingPrice, noJournal, beforeCoverage },
  };
}

function expectKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function summaryValue(region: Locator, label: string) {
  return region.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]');
}

async function preview(
  api: Awaited<ReturnType<typeof tradeApi>>,
  at: string,
  accountIds: string[],
) {
  return api.send('POST', '/manual-valuation-preview', { at, accountIds });
}

test('MPV-API: exact shared-instrument sum and private coverage gaps', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const data = await createPortfolio(api, 'MPV API');
  const foreign = seedForeign();
  const businessBeforeExact = fingerprint(['auth_sessions', 'auth_request_limits']);
  const providersBeforeExact = providerRequests();

  // This authenticated successful request is the behavioral RED oracle on old images.
  const exact = await preview(api, valuationAt, [data.accounts.double.id, data.accounts.half.id]);
  expect(exact.status()).toBe(200);
  noStore(exact);
  const exactBody = (await exact.json()) as Record<string, unknown>;
  expectKeys(exactBody, [
    'at',
    'accountIds',
    'scope',
    'basis',
    'priceSource',
    'quoteCurrency',
    'pricePolicy',
    'completeness',
    'unavailableAccountCount',
    'missingPriceCount',
    'pricedSubtotalUsd',
    'totalValueUsd',
    'unknownCostCount',
    'unrealizedPnlUsd',
    'unrealizedReturnPercent',
    'accounts',
  ]);
  const sortedExactIds = [data.accounts.half.id, data.accounts.double.id].sort();
  expect(exactBody).toMatchObject({
    at: valuationAt,
    accountIds: sortedExactIds,
    scope: 'selected-manual-accounts',
    basis: 'current-effective-history',
    priceSource: 'manual',
    quoteCurrency: 'USD',
    pricePolicy: 'exact-instant',
    completeness: 'complete',
    unavailableAccountCount: 0,
    missingPriceCount: 0,
    pricedSubtotalUsd: '308.64',
    totalValueUsd: '308.64',
    unknownCostCount: 0,
    unrealizedPnlUsd: '58.64',
    unrealizedReturnPercent: '23.46',
  });
  const exactAccounts = exactBody.accounts as Record<string, unknown>[];
  expect(exactAccounts.map((account) => account.accountId)).toEqual(sortedExactIds);
  for (const account of exactAccounts) {
    expectKeys(account, [
      'accountId',
      'name',
      'coverage',
      'coverageFrom',
      'journalRevision',
      'completeness',
      'missingPriceCount',
      'pricedSubtotalUsd',
      'totalValueUsd',
      'unknownCostCount',
      'unrealizedPnlUsd',
      'unrealizedReturnPercent',
      'items',
    ]);
    expect(account).toMatchObject({
      coverage: 'covered',
      coverageFrom,
      journalRevision: 1,
      completeness: 'complete',
      missingPriceCount: 0,
      unknownCostCount: 0,
      unrealizedPnlUsd: account.accountId === data.accounts.half.id ? '11.728' : '46.912',
      unrealizedReturnPercent: '23.46',
    });
    const items = account.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expectKeys(items[0], [
      'instrumentId',
      'instrumentName',
      'instrumentSymbol',
      'quantity',
      'costUsd',
      'price',
      'valueUsd',
      'unrealizedPnlUsd',
      'unrealizedReturnPercent',
    ]);
    expectKeys(items[0].price as Record<string, unknown>, ['priceUsd', 'observedAt', 'revision']);
    const isHalf = account.accountId === data.accounts.half.id;
    expect(items[0]).toMatchObject({
      instrumentId: data.first.id,
      instrumentName: data.first.name,
      instrumentSymbol: 'SAME',
      quantity: isHalf ? '0.5' : '2',
      costUsd: isHalf ? '50' : '200',
      price: { priceUsd: '123.456', observedAt: valuationAt, revision: 1 },
      valueUsd: isHalf ? '61.728' : '246.912',
      unrealizedPnlUsd: isHalf ? '11.728' : '46.912',
      unrealizedReturnPercent: '23.46',
    });
  }
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(businessBeforeExact);
  expect(providerRequests()).toEqual(providersBeforeExact);

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const businessBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
    const admissionsBefore = ledgerState();
    const providersBefore = providerRequests();

    const anonymous = await request.post(previewPath, {
      data: { at: valuationAt, accountIds: sortedExactIds },
    });
    expect(anonymous.status()).toBe(401);
    noStore(anonymous);
    const pendingResponse = await pendingContext.request.fetch(previewPath, {
      method: 'POST',
      data: { at: valuationAt, accountIds: sortedExactIds },
      headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
    });
    expect(pendingResponse.status()).toBe(401);
    noStore(pendingResponse);

    const missingCsrf = await api.request.fetch(previewPath, {
      method: 'POST',
      data: { at: valuationAt, accountIds: sortedExactIds },
      headers: { Origin: origin },
    });
    expect(missingCsrf.status()).toBe(403);
    noStore(missingCsrf);
    const extraField = await api.send('POST', '/manual-valuation-preview', {
      at: valuationAt,
      accountIds: sortedExactIds,
      includeAll: true,
    });
    expect(extraField.status()).toBe(400);
    const duplicate = await api.send('POST', '/manual-valuation-preview', {
      at: valuationAt,
      accountIds: [data.accounts.half.id, data.accounts.half.id],
    });
    expect(duplicate.status()).toBe(400);
    const tooMany = await api.send('POST', '/manual-valuation-preview', {
      at: valuationAt,
      accountIds: Array.from({ length: 11 }, () => randomUUID()),
    });
    expect(tooMany.status()).toBe(400);
    const extraQuery = await api.send('POST', '/manual-valuation-preview?offset=0', {
      at: valuationAt,
      accountIds: sortedExactIds,
    });
    expect(extraQuery.status()).toBe(400);
    const mixedForeign = await api.send('POST', '/manual-valuation-preview', {
      at: valuationAt,
      accountIds: [data.accounts.half.id, foreign.accountId],
    });
    expect(mixedForeign.status()).toBe(404);
    expect(JSON.stringify(await mixedForeign.json())).not.toContain(data.accounts.half.name);

    const gaps = await preview(api, valuationAt, [
      data.accounts.half.id,
      data.accounts.double.id,
      data.accounts.missingPrice.id,
      data.accounts.noJournal.id,
    ]);
    expect(gaps.status()).toBe(200);
    noStore(gaps);
    const gapsBody = (await gaps.json()) as Record<string, unknown>;
    expect(gapsBody).toMatchObject({
      completeness: 'incomplete',
      unavailableAccountCount: 1,
      missingPriceCount: 1,
      pricedSubtotalUsd: '308.64',
      totalValueUsd: null,
      unknownCostCount: 0,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
    });
    const accountRows = gapsBody.accounts as Record<string, unknown>[];
    const missingAccount = accountRows.find(
      (account) => account.accountId === data.accounts.noJournal.id,
    );
    expect(missingAccount).toMatchObject({
      name: data.accounts.noJournal.name,
      coverage: 'missing-journal',
      coverageFrom: null,
      journalRevision: null,
      completeness: 'incomplete',
      missingPriceCount: null,
      pricedSubtotalUsd: null,
      totalValueUsd: null,
      unknownCostCount: null,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
      items: [],
    });
    const distinctSameSymbol = accountRows.find(
      (account) => account.accountId === data.accounts.missingPrice.id,
    );
    expect(distinctSameSymbol).toMatchObject({
      completeness: 'incomplete',
      missingPriceCount: 1,
      pricedSubtotalUsd: '0',
      totalValueUsd: null,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
      items: [
        {
          instrumentId: data.sameSymbol.id,
          instrumentSymbol: 'SAME',
          quantity: '1',
          price: null,
          valueUsd: null,
          unrealizedPnlUsd: null,
          unrealizedReturnPercent: null,
        },
      ],
    });
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(businessBefore);
    expect(ledgerState()).toBe(admissionsBefore);
    expect(providerRequests()).toEqual(providersBefore);

    const zeroPrice = await api.send('POST', pricePath(data.sameSymbol.id), {
      requestId: randomUUID(),
      expectedRevision: 0,
      observedAt: valuationAt,
      priceUsd: '0',
      assertReviewed: true,
    });
    expect(zeroPrice.status()).toBe(201);
    const businessAfterZero = fingerprint(['auth_sessions', 'auth_request_limits']);
    const admissionsAfterZero = ledgerState();
    const zeroValued = await preview(api, valuationAt, [
      data.accounts.half.id,
      data.accounts.double.id,
      data.accounts.missingPrice.id,
    ]);
    expect(zeroValued.status()).toBe(200);
    noStore(zeroValued);
    const zeroBody = (await zeroValued.json()) as Record<string, unknown>;
    expect(zeroBody).toMatchObject({
      completeness: 'complete',
      unavailableAccountCount: 0,
      missingPriceCount: 0,
      pricedSubtotalUsd: '308.64',
      totalValueUsd: '308.64',
    });
    const zeroAccount = (zeroBody.accounts as Record<string, unknown>[]).find(
      (account) => account.accountId === data.accounts.missingPrice.id,
    );
    expect(zeroAccount).toMatchObject({
      completeness: 'complete',
      missingPriceCount: 0,
      pricedSubtotalUsd: '0',
      totalValueUsd: '0',
      items: [
        {
          instrumentId: data.sameSymbol.id,
          instrumentSymbol: 'SAME',
          quantity: '1',
          price: { priceUsd: '0', observedAt: valuationAt, revision: 1 },
          valueUsd: '0',
        },
      ],
    });
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(businessAfterZero);
    expect(ledgerState()).toBe(admissionsAfterZero);

    const precoverage = await preview(api, beforeCoverageAt, [data.accounts.beforeCoverage.id]);
    expect(precoverage.status()).toBe(200);
    noStore(precoverage);
    expect(await precoverage.json()).toMatchObject({
      completeness: 'incomplete',
      unavailableAccountCount: 1,
      missingPriceCount: 0,
      pricedSubtotalUsd: '0',
      totalValueUsd: null,
      accounts: [
        {
          accountId: data.accounts.beforeCoverage.id,
          coverage: 'before-coverage',
          coverageFrom,
          journalRevision: 0,
          completeness: 'incomplete',
          missingPriceCount: null,
          pricedSubtotalUsd: null,
          totalValueUsd: null,
          items: [],
        },
      ],
    });
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(businessAfterZero);
    expect(ledgerState()).toBe(admissionsAfterZero);
    expect(providerRequests()).toEqual(providersBefore);
  } finally {
    await pendingContext.close();
  }
});

test('MPV-UI: selected exact portfolio displays explicit gaps and ignores a late stale request', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const data = await createPortfolio(api, 'MPV UI');
  const providersBefore = providerRequests();
  const businessBefore = fingerprint(['auth_sessions', 'auth_request_limits']);
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === previewPath && request.method() !== 'GET') writes.push(url.href);
  });

  await page.goto('/manual-accounts');
  const directory = page.getByRole('region', { name: 'Счета', exact: true });
  await expect(directory).not.toContainText('Загрузка счетов…');
  const more = directory.getByRole('button', { name: 'Показать еще счета', exact: true });
  while (await more.isVisible()) {
    const nextPage = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/accounting/accounts' &&
        response.request().method() === 'GET',
    );
    await more.click();
    expect((await nextPage).status()).toBe(200);
    await expect(directory.getByRole('button', { name: 'Загрузка…', exact: true })).toHaveCount(0);
  }
  const disclosure = page.getByText('Оценить выбранные счета', { exact: true });
  await disclosure.click();
  const heading = page.getByRole('heading', { name: 'Оценка выбранных счетов', exact: true });
  // Retained valuation heading after explicitly opening the supplementary panel.
  await expect(heading).toBeVisible();
  const region = page.getByRole('region', { name: 'Оценка выбранных счетов', exact: true });
  const at = page.getByLabel('Момент оценки (UTC)', { exact: true });
  await at.fill(valuationAt);

  const halfChoice = page.getByRole('checkbox', {
    name: `Включить счет ${data.accounts.half.name}`,
    exact: true,
  });
  const doubleChoice = page.getByRole('checkbox', {
    name: `Включить счет ${data.accounts.double.name}`,
    exact: true,
  });
  const gapChoice = page.getByRole('checkbox', {
    name: `Включить счет ${data.accounts.missingPrice.name}`,
    exact: true,
  });
  await halfChoice.check();
  await doubleChoice.check();

  const initial = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === previewPath && response.request().method() === 'POST',
  );
  await region.getByRole('button', { name: 'Рассчитать оценку', exact: true }).click();
  expect((await initial).status()).toBe(200);
  await expect(region.getByText('Полная оценка выбранных счетов', { exact: true })).toBeVisible();
  await expect(summaryValue(region, 'Оценка выбранных счетов, USD')).toHaveText('308.64');
  await expect(summaryValue(region, 'Оценённая часть, USD')).toHaveText('308.64');
  await expect(summaryValue(region, 'Счетов без истории')).toHaveText('0');
  await expect(summaryValue(region, 'Позиций без цены')).toHaveText('0');
  const table = region.getByRole('table', { name: 'Оценка по счетам', exact: true });
  await expect(table).toBeVisible();
  const halfRow = table.getByRole('row').filter({ hasText: data.accounts.half.name });
  await expect(halfRow.getByRole('cell').nth(3)).toHaveText('61.728');
  await expect(halfRow.getByRole('cell').nth(4)).toHaveText('61.728');
  const doubleRow = table.getByRole('row').filter({ hasText: data.accounts.double.name });
  await expect(doubleRow.getByRole('cell').nth(3)).toHaveText('246.912');
  await expect(doubleRow.getByRole('cell').nth(4)).toHaveText('246.912');
  await expect(summaryValue(region, 'Нереализованная прибыль, USD')).toHaveText('58.64');
  await expect(summaryValue(region, 'Доход, %')).toHaveText('23.46 %');
  await expect(halfRow.getByRole('cell').nth(5)).toHaveText('11.728');
  await expect(halfRow.getByRole('cell').nth(6)).toHaveText('23.46 %');
  await expect(doubleRow.getByRole('cell').nth(5)).toHaveText('46.912');
  await expect(doubleRow.getByRole('cell').nth(6)).toHaveText('23.46 %');

  // DIRECTORY / MPV-UI-DISCLOSURE: hiding the panel must not replace its intent.
  const mountedValuation = await region.elementHandle();
  await disclosure.click();
  await expect(region).toBeHidden();
  await disclosure.click();
  expect(await mountedValuation?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(halfChoice).toBeChecked();
  await expect(doubleChoice).toBeChecked();
  await expect(at).toHaveValue(valuationAt);
  await expect(summaryValue(region, 'Оценка выбранных счетов, USD')).toHaveText('308.64');
  expect(writes).toHaveLength(1);
  await mountedValuation?.dispose();

  await gapChoice.check();
  await expect(region.getByText('Полная оценка выбранных счетов', { exact: true })).toBeHidden();
  const incomplete = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === previewPath && response.request().method() === 'POST',
  );
  await region.getByRole('button', { name: 'Рассчитать оценку', exact: true }).click();
  expect((await incomplete).status()).toBe(200);
  await expect(region.getByText('Неполная оценка выбранных счетов', { exact: true })).toBeVisible();
  await expect(summaryValue(region, 'Оценка выбранных счетов, USD')).toHaveText('Не определена');
  await expect(summaryValue(region, 'Оценённая часть, USD')).toHaveText('308.64');
  await expect(summaryValue(region, 'Позиций без цены')).toHaveText('1');
  await expect(summaryValue(region, 'Нереализованная прибыль, USD')).toHaveText('Не определена');
  await expect(
    table.getByRole('row').filter({ hasText: data.accounts.missingPrice.name }),
  ).toBeVisible();

  const matchesPreview = (url: URL) => url.pathname === previewPath;
  let release = () => {};
  let held = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    matchesPreview,
    async (route) => {
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      held = true;
      await gate;
      await route.fulfill({ response: actual });
    },
    { times: 1 },
  );
  try {
    const delayed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === previewPath && response.request().method() === 'POST',
    );
    await region.getByRole('button', { name: 'Рассчитать оценку', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await at.fill(beforeCoverageAt);
    await expect(
      region.getByText('Неполная оценка выбранных счетов', { exact: true }),
    ).toBeHidden();
    release();
    const late = await delayed;
    expect(late.status()).toBe(200);
    await expect(
      region.getByText('Неполная оценка выбранных счетов', { exact: true }),
    ).toBeHidden();

    const current = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === previewPath && response.request().method() === 'POST',
    );
    await region.getByRole('button', { name: 'Рассчитать оценку', exact: true }).click();
    expect((await current).status()).toBe(200);
    await expect(
      region.getByText('Неполная оценка выбранных счетов', { exact: true }),
    ).toBeVisible();
    await expect(summaryValue(region, 'Счетов без истории')).toHaveText('3');
    await expect(summaryValue(region, 'Оценка выбранных счетов, USD')).toHaveText('Не определена');
    await expect(region.getByText('Момент раньше начала истории', { exact: true })).toHaveCount(3);
    expect(writes).toHaveLength(4);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(businessBefore);
    expect(providerRequests()).toEqual(providersBefore);
  } finally {
    release();
    await page.unroute(matchesPreview);
  }
});
