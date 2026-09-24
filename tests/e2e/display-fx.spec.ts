import { type Locator, expect } from '@playwright/test';
import { noStore, providerRequests } from './manual-opening-fixtures';
import { compose, fingerprint, origin, passwordStep, query, test } from './mfa-fixtures';
import { tradeApi } from './usd-trades-fixtures';

const displayPath = '/api/reporting/usd-display';
const refreshPath = `${displayPath}/refresh`;
const providerUrl = 'https://open.er-api.com/v6/latest/USD';
const fxTables = ['display_fx_observations', 'display_fx_collection'];

function fixtureFxResponse(status: number, body: string, retryAfter?: string) {
  return { status, body, ...(retryAfter === undefined ? {} : { retryAfter }) };
}

function validProviderBody() {
  const now = Math.floor(Date.now() / 1000);
  return {
    body: JSON.stringify({
      result: 'success',
      base_code: 'USD',
      time_last_update_unix: now - 60,
      time_next_update_unix: now + 24 * 60 * 60,
      time_eol_unix: 0,
      rates: { USD: 1, EUR: 0.9, RUB: 90.12 },
    }),
    publishedAt: new Date((now - 60) * 1000).toISOString(),
    nextUpdateAt: new Date((now + 24 * 60 * 60) * 1000).toISOString(),
  };
}

function setProviderResponse(response: ReturnType<typeof fixtureFxResponse>) {
  const script = `
    const fs = require('node:fs');
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    fetch('http://providers:8080/__control/fx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }).then(async (result) => {
      const text = await result.text();
      if (!result.ok) throw new Error('FX fixture control failed');
      process.stdout.write(text);
    }).catch(() => { process.exitCode = 1; });
  `;
  compose(['exec', '-T', 'backend', 'node', '-e', script], JSON.stringify(response));
}

function resetFxRows() {
  expect(query("SELECT current_database() || ':' || current_user")).toBe(
    'capital_tracker_e2e:capital_e2e',
  );
  query(`TRUNCATE ${fxTables.join(', ')}`);
}

function makeCollectionDue() {
  query(`UPDATE display_fx_collection
    SET "nextAttemptAt" = clock_timestamp() - interval '1 second',
        "leaseId" = NULL, "leaseUntil" = NULL
    WHERE provider = 'exchangerate-api-open'`);
}

function displayFingerprint() {
  return fingerprint(['auth_sessions', 'auth_request_limits', ...fxTables]);
}

function displayUrl(amount: string) {
  return `${displayPath}?amountUsd=${encodeURIComponent(amount)}`;
}

async function getDisplay(api: Awaited<ReturnType<typeof tradeApi>>, amount: string) {
  const response = await api.request.get(displayUrl(amount));
  noStore(response);
  return response;
}

async function refreshDisplay(
  api: Awaited<ReturnType<typeof tradeApi>>,
  body: unknown = {},
  path = refreshPath,
  headers: Record<string, string> = {},
) {
  const response = await api.request.fetch(path, {
    method: 'POST',
    data: body,
    headers: { Origin: origin, 'X-CSRF-Token': api.csrfToken, ...headers },
  });
  noStore(response);
  return response;
}

function expectDisplayIdentity(body: Record<string, unknown>) {
  expect(Object.keys(body).sort()).toEqual(
    [
      'amountUsd',
      'enabled',
      'source',
      'kind',
      'basis',
      'status',
      'observation',
      'collection',
    ].sort(),
  );
  expect(body).toMatchObject({
    enabled: true,
    source: 'exchangerate-api-open',
    kind: 'indicative-daily',
    basis: 'latest-stored-observation',
  });
}

async function expectCurrencyRow(table: Locator, currency: string, rate: string, amount: string) {
  const row = table.getByRole('row').filter({ hasText: currency });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell')).toHaveText([currency, rate, amount]);
}

test('DFX-API: private stored conversion, explicit collection, cooldown and last-good failure', async ({
  page,
  browser,
  request,
}) => {
  // Preserve a true missing-route RED before any fixture touches migration19 tables.
  const anonymous = await request.get(displayUrl('1'));
  expect(anonymous.status()).toBe(401);
  noStore(anonymous);
  const anonymousRefresh = await request.post(refreshPath, {
    data: {},
    headers: { Origin: origin },
  });
  expect(anonymousRefresh.status()).toBe(401);
  noStore(anonymousRefresh);

  const api = await tradeApi(page);
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const pendingRead = await pendingContext.request.get(displayUrl('1'));
    expect(pendingRead.status()).toBe(401);
    noStore(pendingRead);
    resetFxRows();
    const validBody = validProviderBody();
    setProviderResponse(fixtureFxResponse(200, validBody.body));

    const beforeReads = displayFingerprint();
    const admissionsBeforeReads = query(
      `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY scope, "subjectHash")::text, '[]') FROM auth_request_limits r`,
    );
    const providersBeforeReads = providerRequests();
    const unavailable = await getDisplay(api, '123.45');
    expect(unavailable.status()).toBe(200);
    const empty = await unavailable.json();
    expectDisplayIdentity(empty);
    expect(empty).toMatchObject({ amountUsd: '123.45', status: 'unavailable', observation: null });
    expect(Object.keys(empty.collection).sort()).toEqual(
      ['lastAttemptAt', 'lastSuccessAt', 'nextAttemptAt', 'outcome', 'inProgress'].sort(),
    );
    expect(empty.collection).toMatchObject({
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextAttemptAt: null,
      outcome: 'idle',
      inProgress: false,
    });

    const pendingRefresh = await pendingContext.request.fetch(refreshPath, {
      method: 'POST',
      data: {},
      headers: { Origin: origin, 'X-CSRF-Token': pending.csrfToken },
    });
    expect(pendingRefresh.status()).toBe(401);
    noStore(pendingRefresh);
    const missingAmount = await api.request.get(displayPath);
    expect(missingAmount.status()).toBe(400);
    noStore(missingAmount);
    for (const path of [
      `${displayUrl('1')}&providerUrl=https%3A%2F%2Fexample.invalid`,
      `${displayUrl('1e3')}`,
    ]) {
      const invalid = await api.request.get(path);
      expect(invalid.status()).toBe(400);
      noStore(invalid);
    }
    const unknownRefreshField = await refreshDisplay(api, {
      providerUrl: 'https://example.invalid',
    });
    expect(unknownRefreshField.status()).toBe(400);
    const unknownRefreshUrl = await refreshDisplay(
      api,
      {},
      `${refreshPath}?url=https%3A%2F%2Fexample.invalid`,
    );
    expect(unknownRefreshUrl.status()).toBe(400);
    const missingCsrf = await api.request.fetch(refreshPath, {
      method: 'POST',
      data: {},
      headers: { Origin: origin },
    });
    expect(missingCsrf.status()).toBe(403);
    noStore(missingCsrf);
    expect(providerRequests()).toEqual(providersBeforeReads);
    expect(displayFingerprint()).toBe(beforeReads);
    expect(
      query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY scope, "subjectHash")::text, '[]') FROM auth_request_limits r`,
      ),
    ).toBe(admissionsBeforeReads);

    const beforeCollect = providerRequests();
    const collected = await refreshDisplay(api);
    expect(collected.status()).toBe(200);
    expect(await collected.json()).toEqual({ outcome: 'collected' });
    expect(providerRequests()).toEqual([...beforeCollect, { method: 'GET', url: providerUrl }]);

    const afterCollect = await getDisplay(api, '123.45');
    expect(afterCollect.status()).toBe(200);
    const good = await afterCollect.json();
    expectDisplayIdentity(good);
    expect(Object.keys(good.observation).sort()).toEqual(
      [
        'observedAt',
        'fetchedAt',
        'nextUpdateAt',
        'endOfLifeAt',
        'eurRate',
        'rubRate',
        'eurAmount',
        'rubAmount',
      ].sort(),
    );
    expect(good).toMatchObject({
      amountUsd: '123.45',
      status: 'fresh',
      observation: {
        observedAt: validBody.publishedAt,
        nextUpdateAt: validBody.nextUpdateAt,
        eurRate: '0.9',
        rubRate: '90.12',
        eurAmount: '111.105',
        rubAmount: '11125.314',
        endOfLifeAt: null,
      },
      collection: { outcome: 'ok', inProgress: false },
    });
    expect(new Date(good.observation.fetchedAt).toISOString()).toBe(good.observation.fetchedAt);
    expect(new Date(good.observation.nextUpdateAt).toISOString()).toBe(
      good.observation.nextUpdateAt,
    );
    const zeroAmount = await getDisplay(api, '0');
    expect((await zeroAmount.json()).observation).toMatchObject({
      eurAmount: '0',
      rubAmount: '0',
    });
    const afterReadFingerprint = displayFingerprint();
    const beforeCooldownProviders = providerRequests();
    const cooldown = await refreshDisplay(api);
    expect(cooldown.status()).toBe(200);
    expect(await cooldown.json()).toEqual({ outcome: 'cooldown' });
    expect(providerRequests()).toEqual(beforeCooldownProviders);
    expect(displayFingerprint()).toBe(afterReadFingerprint);

    makeCollectionDue();
    const priorObservation = good.observation;
    setProviderResponse(fixtureFxResponse(500, 'private-fixture-provider-error'));
    const failed = await refreshDisplay(api);
    expect(failed.status()).toBe(200);
    expect(await failed.json()).toEqual({ outcome: 'failed' });
    const stale = await getDisplay(api, '123.45');
    expect(stale.status()).toBe(200);
    const staleBody = await stale.json();
    expectDisplayIdentity(staleBody);
    expect(staleBody).toMatchObject({ status: 'stale', observation: priorObservation });
    expect(JSON.stringify(staleBody)).not.toContain('private-fixture-provider-error');
    expect(providerRequests()).toEqual([
      ...beforeCollect,
      { method: 'GET', url: providerUrl },
      { method: 'GET', url: providerUrl },
    ]);
  } finally {
    await pendingContext.close();
  }
});

test('DFX-UI: Settings explicitly collects, converts exact amounts and discards stale amount reads', async ({
  page,
}) => {
  await tradeApi(page);
  await page.goto('/settings');
  const nav = page.getByRole('button', { name: 'Курсы для отображения', exact: true });
  await expect(nav).toBeVisible();
  // This first new-UI assertion must fail before SQL reaches migration19 on predecessor images.
  resetFxRows();
  const validBody = validProviderBody();
  setProviderResponse(fixtureFxResponse(200, validBody.body));
  const providersBefore = providerRequests();
  const financialBefore = displayFingerprint();
  const initialRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === displayPath && response.request().method() === 'GET',
  );
  await nav.click();
  const panel = page.getByRole('region', { name: 'Пересчёт USD в EUR и RUB', exact: true });
  await expect(
    page.getByRole('heading', { name: 'Пересчёт USD в EUR и RUB', exact: true }),
  ).toBeVisible();
  const amount = page.getByLabel('Сумма в USD', { exact: true });
  await expect(amount).toHaveValue('1');
  const initial = await initialRead;
  expect(initial.status()).toBe(200);
  expect((await initial.json()).status).toBe('unavailable');
  await expect(panel.getByText('Нет сохранённых курсов', { exact: true })).toBeVisible();
  expect(providerRequests()).toEqual(providersBefore);
  expect(displayFingerprint()).toBe(financialBefore);

  const firstCollectionRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === displayPath && response.request().method() === 'GET',
  );
  const firstCollectionPost = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === refreshPath && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Получить свежие курсы', exact: true }).click();
  expect((await firstCollectionPost).status()).toBe(200);
  expect(await firstCollectionPost.then((response) => response.json())).toEqual({
    outcome: 'collected',
  });
  const collectedRead = await firstCollectionRead;
  expect(collectedRead.status()).toBe(200);
  const stored = await collectedRead.json();
  expect(stored).toMatchObject({
    status: 'fresh',
    observation: { eurAmount: '0.9', rubAmount: '90.12' },
  });
  await expect(panel.getByText('Сохранённые курсы актуальны', { exact: true })).toBeVisible();
  await expect(
    panel.getByRole('link', { name: 'Rates By Exchange Rate API', exact: true }),
  ).toHaveAttribute('href', 'https://www.exchangerate-api.com');
  expect(stored.observation.observedAt).toBe(validBody.publishedAt);
  expect(stored.observation.nextUpdateAt).toBe(validBody.nextUpdateAt);
  await expect(panel.getByText(stored.observation.observedAt, { exact: false })).toBeVisible();
  await expect(panel.getByText(stored.observation.fetchedAt, { exact: false })).toBeVisible();

  await amount.fill('123.45');
  const conversion = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === displayPath && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Рассчитать по сохранённым курсам', exact: true }).click();
  const converted = await conversion;
  expect(converted.status()).toBe(200);
  expect(await converted.json()).toMatchObject({
    amountUsd: '123.45',
    observation: { eurAmount: '111.105', rubAmount: '11125.314' },
  });
  const table = panel.getByRole('table', { name: 'Справочный пересчёт', exact: true });
  await expect(table).toBeVisible();
  await expectCurrencyRow(table, 'EUR', '0.9', '111.105');
  await expectCurrencyRow(table, 'RUB', '90.12', '11125.314');
  expect(providerRequests()).toEqual([...providersBefore, { method: 'GET', url: providerUrl }]);
  expect(displayFingerprint()).toBe(financialBefore);

  const pattern = (url: URL) => url.pathname === displayPath && url.searchParams.has('amountUsd');
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
        new URL(response.url()).pathname === displayPath && response.request().method() === 'GET',
    );
    await page
      .getByRole('button', { name: 'Рассчитать по сохранённым курсам', exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    await amount.fill('200');
    release();
    const late = await delayed;
    expect(late.status()).toBe(200);
    expect(await late.json()).toMatchObject({ amountUsd: '123.45' });
    await expect(table).toHaveCount(0);

    const finalRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === displayPath && response.request().method() === 'GET',
    );
    await page
      .getByRole('button', { name: 'Рассчитать по сохранённым курсам', exact: true })
      .click();
    const final = await finalRead;
    expect(await final.json()).toMatchObject({
      amountUsd: '200',
      observation: { eurAmount: '180', rubAmount: '18024' },
    });
    await expectCurrencyRow(table, 'EUR', '0.9', '180');
    await expectCurrencyRow(table, 'RUB', '90.12', '18024');
    expect(displayFingerprint()).toBe(financialBefore);
    expect(providerRequests()).toEqual([...providersBefore, { method: 'GET', url: providerUrl }]);
  } finally {
    release();
    await page.unroute(pattern);
  }

  // Advance only the synthetic collection deadline; retain budget and last-good data.
  makeCollectionDue();
  setProviderResponse(fixtureFxResponse(503, 'synthetic-provider-unavailable'));
  const failedRead = page.waitForResponse(
    (response) => new URL(response.url()).pathname === displayPath,
  );
  await page.getByRole('button', { name: 'Получить свежие курсы', exact: true }).click();
  expect((await failedRead).status()).toBe(200);
  await expect(panel.getByText('Данные устарели', { exact: true })).toBeVisible();
  await expectCurrencyRow(table, 'EUR', '0.9', '180');
  await expectCurrencyRow(table, 'RUB', '90.12', '18024');
  expect(displayFingerprint()).toBe(financialBefore);
  expect(providerRequests()).toEqual([
    ...providersBefore,
    { method: 'GET', url: providerUrl },
    { method: 'GET', url: providerUrl },
  ]);
});
