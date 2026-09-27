import { randomUUID } from 'node:crypto';
import { type Locator, type Page, type Request, expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
  ledgerState,
} from './admission-fixtures';
import { test as flowTest } from './external-usd-flows-fixtures';
import { literal, noStore, providerRequests } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, query } from './mfa-fixtures';
import { browserPost, tradeApi, tradeInput } from './usd-trades-fixtures';

const priceBook = (instrumentId: string) => `/instruments/${instrumentId}/usd-prices`;
const priceEndpoint = (instrumentId: string) => `/api/accounting${priceBook(instrumentId)}`;
const pointAt = '2025-01-02T00:00:00.000Z';
const precisePrice = '0.000000000000000000000000000001';
const unrelatedAccounting = ['manual_usd_price_versions'];

const test = flowTest.extend<{ isolatedManualPriceBook: undefined }>({
  isolatedManualPriceBook: [
    async ({ mfa }, use) => {
      expect(mfa).toBeDefined();
      query(`DO $$ BEGIN
        IF current_database() <> 'capital_tracker_e2e' OR current_user <> 'capital_e2e' THEN
          RAISE EXCEPTION 'Refuse manual-price fixture outside synthetic acceptance';
        END IF;
        IF to_regclass('public.manual_usd_price_versions') IS NOT NULL THEN
          TRUNCATE manual_usd_price_versions;
        END IF;
      END $$`);
      await use(undefined);
    },
    { auto: true },
  ],
});

function oldRows(): string {
  return fingerprint(['auth_sessions', 'auth_request_limits', ...unrelatedAccounting]);
}

function priceRows(...instrumentIds: string[]): string {
  const ids = instrumentIds.map(literal).join(',');
  return query(`SELECT COALESCE(jsonb_agg(to_jsonb(rows)
    ORDER BY rows."instrumentId", rows.revision)::text, '[]')
    FROM (SELECT "ownerId", "instrumentId", revision, "requestId", kind,
      "observedAt", "priceUsd"::text, "canonicalPayload", "createdAt"
      FROM manual_usd_price_versions WHERE "instrumentId" IN (${ids})) rows`);
}

function setCommand(expectedRevision: number, observedAt = pointAt, priceUsd = precisePrice) {
  return {
    requestId: randomUUID(),
    expectedRevision,
    observedAt,
    priceUsd,
    assertReviewed: true,
  };
}

async function browserGet(page: Page, instrumentId: string, action: () => Promise<void>) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === priceEndpoint(instrumentId) &&
      response.request().method() === 'GET',
  );
  await action();
  const response = await pending;
  expect(response.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
  return response;
}

test('PRICE-1 / PRICE-2 / PRICE-3: real private API records exact manual versions by instrument UUID', async ({
  page,
  browser,
  request,
}) => {
  const api = await tradeApi(page);
  const account = await api.account(`Manual-price API ${randomUUID()}`);
  const firstInstrument = await api.instrument(`Shared ticker A ${randomUUID()}`, 'SAME');
  const secondInstrument = await api.instrument(`Shared ticker B ${randomUUID()}`, 'SAME');
  await api.initialize(account.id);
  await api.create(account.id, tradeInput(firstInstrument.id, 0, { grossUsd: '100' }));

  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  let admissionsBefore: string;
  try {
    await passwordStep(await pendingContext.newPage());
    const pendingResponse = await pendingContext.request.get(priceEndpoint(firstInstrument.id));
    expect(pendingResponse.status()).toBe(401);
    noStore(pendingResponse);
    const anonymous = await request.get(priceEndpoint(firstInstrument.id));
    expect(anonymous.status()).toBe(401);
    noStore(anonymous);
    admissionsBefore = ledgerState();
  } finally {
    await pendingContext.close();
  }

  const preserved = oldRows();
  const providersBefore = providerRequests();
  const emptyResponse = await api.send('GET', priceBook(firstInstrument.id));
  expect(emptyResponse.status()).toBe(200);
  expect(await emptyResponse.json()).toEqual({
    instrument: {
      id: firstInstrument.id,
      name: firstInstrument.name,
      symbol: 'SAME',
      namespace: 'manual',
    },
    currentRevision: 0,
    source: 'manual',
    quoteCurrency: 'USD',
    items: [],
    nextOffset: null,
  });

  const first = setCommand(0);
  const firstResponse = await api.send('POST', priceBook(firstInstrument.id), first);
  expect(firstResponse.status()).toBe(201);
  const firstReceipt = await firstResponse.json();
  expect(firstReceipt).toMatchObject({
    instrumentId: firstInstrument.id,
    revision: 1,
    requestId: first.requestId,
    kind: 'set',
    observedAt: pointAt,
    priceUsd: precisePrice,
    source: 'manual',
    quoteCurrency: 'USD',
  });

  const zeroPoint = setCommand(1, '2025-01-03T00:00:00.000Z', '0');
  const zeroResponse = await api.send('POST', priceBook(firstInstrument.id), zeroPoint);
  expect(zeroResponse.status()).toBe(201);
  expect(await zeroResponse.json()).toMatchObject({ revision: 2, priceUsd: '0' });

  const corrected = setCommand(2, pointAt, '110.250000000000000000000000000001');
  const correctedResponse = await api.send('POST', priceBook(firstInstrument.id), corrected);
  expect(correctedResponse.status()).toBe(201);
  expect(await correctedResponse.json()).toMatchObject({
    revision: 3,
    priceUsd: corrected.priceUsd,
  });

  const voidCommand = {
    requestId: randomUUID(),
    expectedRevision: 3,
    observedAt: pointAt,
    assertReviewed: true,
  };
  const voidResponse = await api.send('POST', `${priceBook(firstInstrument.id)}/void`, voidCommand);
  expect(voidResponse.status()).toBe(201);
  expect(await voidResponse.json()).toMatchObject({
    revision: 4,
    kind: 'void',
    observedAt: pointAt,
    priceUsd: null,
  });

  const restored = setCommand(4, pointAt, '120');
  const restoredResponse = await api.send('POST', priceBook(firstInstrument.id), restored);
  expect(restoredResponse.status()).toBe(201);
  expect(await restoredResponse.json()).toMatchObject({ revision: 5, priceUsd: '120' });

  const replay = await api.send('POST', priceBook(firstInstrument.id), first);
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(firstReceipt);
  const alteredReplay = await api.send('POST', priceBook(firstInstrument.id), {
    ...first,
    priceUsd: '2',
  });
  expect(alteredReplay.status()).toBe(409);
  const stale = await api.send(
    'POST',
    priceBook(firstInstrument.id),
    setCommand(0, '2025-01-04T00:00:00.000Z', '3'),
  );
  expect(stale.status()).toBe(409);

  const current = await api.send('GET', `${priceBook(firstInstrument.id)}?revision=5`);
  expect(current.status()).toBe(200);
  expect(await current.json()).toMatchObject({
    currentRevision: 5,
    source: 'manual',
    quoteCurrency: 'USD',
    items: [
      { observedAt: '2025-01-03T00:00:00.000Z', priceUsd: '0', kind: 'set' },
      { observedAt: pointAt, priceUsd: '120', kind: 'set' },
    ],
    nextOffset: null,
  });
  const history = await api.send(
    'GET',
    `${priceBook(firstInstrument.id)}/history?observedAt=${encodeURIComponent(pointAt)}`,
  );
  expect(history.status()).toBe(200);
  expect(await history.json()).toMatchObject({
    instrumentId: firstInstrument.id,
    observedAt: pointAt,
    source: 'manual',
    quoteCurrency: 'USD',
    items: [
      { revision: 5, kind: 'set', priceUsd: '120' },
      { revision: 4, kind: 'void', priceUsd: null },
      { revision: 3, kind: 'set', priceUsd: corrected.priceUsd },
      { revision: 1, kind: 'set', priceUsd: precisePrice },
    ],
    nextBeforeRevision: null,
  });

  const secondBook = await api.send('GET', priceBook(secondInstrument.id));
  expect(secondBook.status()).toBe(200);
  expect(await secondBook.json()).toMatchObject({ currentRevision: 0, items: [] });
  const missing = await api.send('GET', priceBook(randomUUID()));
  expect(missing.status()).toBe(404);

  const priceStateAfterValidCommands = priceRows(firstInstrument.id, secondInstrument.id);
  const forbiddenOrigin = await api.send('POST', priceBook(firstInstrument.id), setCommand(5), {
    Origin: 'https://foreign.example.invalid',
  });
  expect(forbiddenOrigin.status()).toBe(403);
  const forbiddenCsrf = await api.send('POST', priceBook(firstInstrument.id), setCommand(5), {
    'X-CSRF-Token': 'synthetic-invalid-csrf',
  });
  expect(forbiddenCsrf.status()).toBe(403);
  expect(
    priceRows(firstInstrument.id, secondInstrument.id),
    'Rejected origin and CSRF commands do not change price versions',
  ).toBe(priceStateAfterValidCommands);

  expect(oldRows(), 'Manual price writes and reads preserve all existing accounting rows').toBe(
    preserved,
  );
  expect(ledgerState(), 'Price endpoints do not change auth admissions').toBe(admissionsBefore);
  expect(providerRequests(), 'Manual prices never invoke an external provider').toEqual(
    providersBefore,
  );
});

test('PRICE-UI / PRICE-RECOVERY: actual Russian editor retries the committed command and ignores a late instrument read', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  const account = await api.account(`Manual-price UI ${randomUUID()}`);
  const firstInstrument = await api.instrument(`UI shared ticker A ${randomUUID()}`, 'SAME');
  const secondInstrument = await api.instrument(`UI shared ticker B ${randomUUID()}`, 'SAME');
  await api.initialize(account.id);
  await api.create(account.id, tradeInput(firstInstrument.id, 0, { grossUsd: '100' }));

  const preserved = oldRows();
  const providersBefore = providerRequests();
  const admissionsBefore = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const browserWrites: Record<string, unknown>[] = [];
  let loseFirstPost = true;
  const endpoint = priceEndpoint(firstInstrument.id);

  await page.goto('/manual-prices');
  await expect(
    page.getByRole('heading', { name: 'Ручные цены инструментов', exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  const instrumentPicker = page.getByLabel('Инструмент', { exact: true });
  const load = page.getByRole('button', { name: 'Загрузить цены', exact: true });
  const save = page.getByRole('button', { name: 'Сохранить цену', exact: true });

  const dateInput = page.getByLabel('Дата цены (UTC)', { exact: true });
  const editPrice = page.getByLabel('Цена за единицу, USD', { exact: true });
  const editor = page.getByRole('region', { name: 'Редактирование цены', exact: true });
  const currentRegion = page.getByRole('region', { name: 'Сохранённые цены', exact: true });
  const historyRegion = page.getByRole('region', { name: 'История цены', exact: true });
  const rulesSummary = page.getByText('Правила ручных цен', { exact: true });
  await expect(rulesSummary).toBeVisible();
  expect(await rulesSummary.evaluate((node) => node.tagName)).toBe('SUMMARY');
  const rules = rulesSummary.locator('..');
  expect(await rules.evaluate((node) => node.tagName)).toBe('DETAILS');
  await expect(rules).not.toHaveAttribute('open', '');
  const header = page.locator('.prices-page > header');
  for (const scope of [/ручн|вручную/i, /не\s*свер|несверенн/i, /отдельн|точк|непрерывн/i]) {
    await expect(header.locator('p').filter({ hasText: scope }).first()).toBeVisible();
  }
  await expect(instrumentPicker).toHaveAccessibleDescription(/UUID|идентификатор/i);
  await expect(dateInput).toHaveAccessibleDescription(/UTC|часов.*пояс|смещени/i);
  await expect(editPrice).toHaveAccessibleDescription(/USD/);
  await expect(editPrice).toHaveAccessibleDescription(/единиц/i);
  await expect(editPrice).toHaveAccessibleDescription(/неотрицательн|не меньше нуля|≥\s*0|>=\s*0/i);
  await expect(editPrice).toHaveAccessibleDescription(/нол|нулев|\b0\b/i);
  await expect(editPrice).toHaveAccessibleDescription(/точн|округл|строк/i);
  expect(
    await editor.evaluate((node) => {
      const book = document.querySelector('[aria-label="Сохранённые цены"]');
      return Boolean(book && node.compareDocumentPosition(book) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);

  const withoutRequests = async (action: () => Promise<void>, postOnly = false) => {
    const requests: string[] = [];
    const record = (request: Request) => {
      if (!postOnly || request.method() === 'POST') requests.push(request.url());
    };
    page.on('request', record);
    try {
      await action();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(
        requests,
        postOnly
          ? 'Staging/cancel/close send no price command'
          : 'Native rules toggle makes no request',
      ).toEqual([]);
    } finally {
      page.off('request', record);
    }
  };
  const rulesRows = priceRows(firstInstrument.id, secondInstrument.id);
  await withoutRequests(async () => {
    await rulesSummary.focus();
    await page.keyboard.press('Enter');
    await expect(rules).toHaveAttribute('open', '');
    await expect(rules).toContainText(/UUID|идентификатор/i);
    await expect(rules).toContainText(/исправ|повтор/i);
    await expect(rules).toContainText(/исключ/i);
    await page.keyboard.press('Space');
    await expect(rules).not.toHaveAttribute('open', '');
  });
  expect(priceRows(firstInstrument.id, secondInstrument.id)).toBe(rulesRows);

  const capturePresentation = async () => {
    const rowsBefore = priceRows(firstInstrument.id, secondInstrument.id);
    const callsBefore = providerRequests();
    const viewport = page.viewportSize();
    const originalTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    const capture = async (target: Locator, name: string) => {
      const bounds = await target.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { top: box.top + window.scrollY, height: box.height };
      });
      for (let index = 0; index < Math.ceil(bounds.height / 900); index++) {
        const offset = Math.min(index * 900, Math.max(0, bounds.height - 900));
        await page.evaluate(
          (top) => window.scrollTo(0, Math.max(0, top - 16)),
          bounds.top + offset,
        );
        await expect(
          page.getByRole('link', { name: 'К содержимому', exact: true }),
        ).not.toBeInViewport();
        await testInfo.attach(`${name}-${index + 1}`, {
          body: await page.screenshot({
            path: testInfo.outputPath(`${name}-${index + 1}.png`),
            animations: 'disabled',
            fullPage: false,
          }),
          contentType: 'image/png',
        });
      }
    };
    try {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(
          (value) => document.documentElement.setAttribute('data-theme', value),
          theme,
        );
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        for (const width of [360, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect
            .poll(() =>
              page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            )
            .toBe(true);
          const controls = await page
            .locator(
              '.prices-page input:not([type="checkbox"]), .prices-page select, .prices-page button, .prices-page summary, .prices-page .prices-review',
            )
            .evaluateAll((nodes) =>
              nodes
                .filter((node) => node.getClientRects().length > 0)
                .map((node) => ({
                  label: node.textContent || node.getAttribute('aria-label') || node.tagName,
                  height: node.getBoundingClientRect().height,
                })),
            );
          expect(controls.length).toBeGreaterThan(0);
          for (const control of controls)
            expect(control.height, control.label).toBeGreaterThanOrEqual(44);
          const region = currentRegion.getByRole('region', {
            name: 'Таблица сохранённых цен',
            exact: true,
          });
          await expect(region).toHaveAttribute('tabindex', '0');
          await expect(region.locator('caption')).toBeVisible();
          if (width === 360) {
            expect(await region.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
            await region.evaluate((node) => {
              node.scrollLeft = 0;
            });
            await region.focus();
            await page.keyboard.press('ArrowRight');
            await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
            await region.evaluate((node) => {
              node.scrollLeft = 0;
            });
          }
          for (const [name, target] of [
            ['header', header],
            ['editor', editor],
            ['book', currentRegion],
            ['history', historyRegion],
          ] as const) {
            await capture(target, `manual-price-${name}-${theme}-${width}`);
          }
          await expect(editPrice).toHaveValue('115');
          await expect(currentRegion.getByText('110', { exact: true })).toBeVisible();
          await expect(historyRegion.getByText('100', { exact: true })).toBeVisible();
        }
      }
    } finally {
      await page.evaluate((value) => {
        if (value === null) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', value);
      }, originalTheme);
      if (viewport) await page.setViewportSize(viewport);
    }
    expect(priceRows(firstInstrument.id, secondInstrument.id)).toBe(rowsBefore);
    expect(providerRequests()).toEqual(callsBefore);
  };

  await instrumentPicker.selectOption(firstInstrument.id);
  const initialRead = await browserGet(page, firstInstrument.id, () => load.click());
  expect(initialRead.status()).toBe(200);
  await expect(save).toBeDisabled();

  await page.getByLabel('Дата цены (UTC)', { exact: true }).fill(pointAt);
  await page.getByLabel('Цена за единицу, USD', { exact: true }).fill('100');
  const review = page.getByLabel('Я проверил инструмент, дату и цену', { exact: true });
  await review.check();

  await page.route(`${endpoint}**`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      browserWrites.push(body);
      if (loseFirstPost) {
        loseFirstPost = false;
        await route.fetch(); // Let the real service commit, but conceal its response from the UI.
        await route.abort();
        return;
      }
    }
    await route.continue();
  });

  const firstFailedRequest = page.waitForEvent(
    'requestfailed',
    (request) => new URL(request.url()).pathname === endpoint && request.method() === 'POST',
  );
  await save.click();
  await firstFailedRequest;
  const committed = await api.send('GET', priceBook(firstInstrument.id));
  expect(committed.status()).toBe(200);
  expect(await committed.json()).toMatchObject({
    currentRevision: 1,
    items: [{ observedAt: pointAt, priceUsd: '100', revision: 1 }],
  });
  await expect(save).toBeEnabled();
  // The editor keeps the same reviewed form available for an explicit retry.
  const replayResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === endpoint && response.request().method() === 'POST',
  );
  await save.click();
  expect((await replayResponse).status()).toBe(200);
  expect(browserWrites).toHaveLength(2);
  expect(browserWrites[1]).toEqual(browserWrites[0]);

  await expect(currentRegion.getByText('100', { exact: true })).toBeVisible();
  await editPrice.fill('110');
  await expect(review).not.toBeChecked();
  await review.check();
  let loseRefresh = true;
  await page.route(`${endpoint}**`, async (route) => {
    if (loseRefresh && route.request().method() === 'GET') {
      loseRefresh = false;
      await route.fetch(); // Preserve the actual read; lose only response delivery.
      await route.abort();
      return;
    }
    await route.continue();
  });
  const lostRefresh = page.waitForEvent(
    'requestfailed',
    (request) => new URL(request.url()).pathname === endpoint && request.method() === 'GET',
  );
  const corrected = await browserPost(page, priceBook(firstInstrument.id), () => save.click());
  expect(corrected.status()).toBe(201);
  expect(await corrected.json()).toMatchObject({ revision: 2, priceUsd: '110' });
  await lostRefresh;
  await expect(page.getByRole('status').filter({ hasText: 'Команда сохранена.' })).toBeVisible();
  await expect(save).toBeDisabled();
  const recoveredRead = await browserGet(page, firstInstrument.id, () => load.click());
  expect(recoveredRead.status()).toBe(200);
  expect(await recoveredRead.json()).toMatchObject({ currentRevision: 2 });

  await editPrice.fill('115');
  const savedRow = currentRegion.getByRole('row').filter({ hasText: '110' });
  const voidAction = savedRow.getByRole('button', { name: 'Исключить цену', exact: true });
  const historyAction = savedRow.getByRole('button', { name: 'История', exact: true });
  const stageRows = priceRows(firstInstrument.id, secondInstrument.id);
  await withoutRequests(async () => {
    await voidAction.click();
    await expect(
      editor.getByRole('heading', { name: 'Исключение цены', exact: true }),
    ).toBeFocused();
    await expect(review).not.toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Подтвердить исключение', exact: true }),
    ).toBeDisabled();
    await expect(editPrice).toHaveValue('115');
    await page.getByRole('button', { name: 'Отменить исключение', exact: true }).click();
    await expect(voidAction).toBeFocused();
    await expect(review).not.toBeChecked();
    await expect(editPrice).toHaveValue('115');
    await expect(dateInput).toHaveValue(pointAt);
  }, true);
  expect(priceRows(firstInstrument.id, secondInstrument.id)).toBe(stageRows);

  const historyEndpoint = `${endpoint}/history`;
  const historyPattern = `**${historyEndpoint}?*`;
  const delayedHistory = async (closeBeforeDelivery: boolean) => {
    let release: () => void = () => {};
    let fetched = false;
    let started = false;
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route(
      historyPattern,
      async (route) => {
        started = true;
        try {
          expect(new URL(route.request().url()).pathname).toBe(historyEndpoint);
          expect(route.request().method()).toBe('GET');
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          expect(await response.json()).toMatchObject({
            instrumentId: firstInstrument.id,
            observedAt: pointAt,
            items: [
              { revision: 2, priceUsd: '110' },
              { revision: 1, priceUsd: '100' },
            ],
          });
          fetched = true;
          await gate;
          await route.fulfill({ response });
        } finally {
          finish();
        }
      },
      { times: 1 },
    );
    const before = priceRows(firstInstrument.id, secondInstrument.id);
    try {
      await historyAction.click();
      await expect(
        historyRegion.getByRole('heading', { name: 'История цены', exact: true }),
      ).toBeFocused();
      await expect.poll(() => fetched).toBe(true);
      await editPrice.focus();
      const delivered = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === historyEndpoint &&
          response.request().method() === 'GET',
      );
      if (closeBeforeDelivery) {
        await withoutRequests(async () => {
          await page.getByRole('button', { name: 'Закрыть историю', exact: true }).click();
          await expect(historyRegion).toHaveCount(0);
          await expect(historyAction).toBeFocused();
        }, true);
      }
      release();
      expect((await delivered).status()).toBe(200);
      if (closeBeforeDelivery) {
        await expect(historyRegion).toHaveCount(0);
        await expect(historyAction).toBeFocused();
      } else {
        await expect(historyRegion.getByText('110', { exact: true })).toBeVisible();
        await expect(historyRegion.getByText('100', { exact: true })).toBeVisible();
        await expect(editPrice).toBeFocused();
      }
      await expect(editPrice).toHaveValue('115');
      expect(priceRows(firstInstrument.id, secondInstrument.id)).toBe(before);
    } finally {
      release();
      if (started) await done;
      await page.unroute(historyPattern);
    }
  };
  await delayedHistory(false);
  await expect(historyRegion.getByText('110', { exact: true })).toBeVisible();
  await expect(historyRegion.getByText('100', { exact: true })).toBeVisible();
  await capturePresentation();
  await delayedHistory(true);

  let releaseLateRead!: () => void;
  let reportReadStarted!: () => void;
  let holdFirstRead = true;
  const lateReadStarted = new Promise<void>((resolve) => {
    reportReadStarted = resolve;
  });
  await page.route(`${endpoint}**`, async (route) => {
    if (route.request().method() !== 'GET' || !holdFirstRead) return route.continue();
    holdFirstRead = false;
    const response = await route.fetch();
    reportReadStarted();
    await new Promise<void>((resolve) => {
      releaseLateRead = resolve;
    });
    await route.fulfill({ response });
  });
  await instrumentPicker.selectOption(firstInstrument.id);
  const oldSelectionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === endpoint && response.request().method() === 'GET',
  );
  const oldSelectionLoad = load.click();
  await lateReadStarted;
  await instrumentPicker.selectOption(secondInstrument.id);
  const secondRead = await browserGet(page, secondInstrument.id, () => load.click());
  expect(secondRead.status()).toBe(200);
  await expect(page.getByRole('region', { name: 'Сохранённые цены', exact: true })).toContainText(
    'Сохранённых цен нет.',
  );
  releaseLateRead();
  expect((await oldSelectionResponse).status()).toBe(200);
  await oldSelectionLoad;
  const emptyRegion = page.getByRole('region', { name: 'Сохранённые цены', exact: true });
  await expect(emptyRegion).toContainText('Сохранённых цен нет.');
  await expect(emptyRegion.getByText('110', { exact: true })).toHaveCount(0);

  await instrumentPicker.selectOption(firstInstrument.id);
  const backToFirst = await browserGet(page, firstInstrument.id, () => load.click());
  expect(backToFirst.status()).toBe(200);
  const firstRow = page.getByRole('row').filter({ hasText: '110' });
  await firstRow.getByRole('button', { name: 'Исключить цену', exact: true }).click();
  await expect(editor.getByRole('heading', { name: 'Исключение цены', exact: true })).toBeFocused();
  await expect(review).not.toBeChecked();
  await review.check();
  await page.getByRole('button', { name: 'Подтвердить исключение', exact: true }).click();
  await expect(page.getByText('Сохранённых цен нет.', { exact: true })).toBeVisible();
  await page.getByLabel('Дата цены (UTC)', { exact: true }).fill(pointAt);
  const dateHistoryAction = page.getByRole('button', {
    name: 'История указанной даты',
    exact: true,
  });
  await dateHistoryAction.click();
  await expect(
    historyRegion.getByRole('heading', { name: 'История цены', exact: true }),
  ).toBeFocused();
  await expect(historyRegion.getByText('Исключена', { exact: true })).toBeVisible();
  await expect(historyRegion.getByText('110', { exact: true })).toBeVisible();
  await expect(historyRegion.getByText('100', { exact: true })).toBeVisible();
  const closeRows = priceRows(firstInstrument.id, secondInstrument.id);
  await withoutRequests(async () => {
    await page.getByRole('button', { name: 'Закрыть историю', exact: true }).click();
    await expect(historyRegion).toHaveCount(0);
    await expect(dateHistoryAction).toBeFocused();
  }, true);
  expect(priceRows(firstInstrument.id, secondInstrument.id)).toBe(closeRows);
  await page.reload();
  await instrumentPicker.selectOption(firstInstrument.id);
  const afterReload = await browserGet(page, firstInstrument.id, () => load.click());
  expect(afterReload.status()).toBe(200);
  await expect(page.getByText('Сохранённых цен нет.', { exact: true })).toBeVisible();

  expect(oldRows(), 'UI price commands preserve all pre-existing accounting rows').toBe(preserved);
  expect(providerRequests(), 'The manual price screen never calls providers').toEqual(
    providersBefore,
  );
  expectAdmissionDelta(admissionsBefore, [
    { scope: 'csrf-ip', subject: await hostSubject(), hits: browserCsrfAdmissions() - csrfBefore },
  ]);
});
