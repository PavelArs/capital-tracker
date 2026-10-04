import { randomUUID } from 'node:crypto';
import { type Locator, type Page, type Request, type Route, expect } from '@playwright/test';
import { noStore, providerRequests, seedForeign } from './manual-opening-fixtures';
import { fingerprint, origin, passwordStep, test } from './mfa-fixtures';
import { browserPost, tradeApi, tradeInput } from './usd-trades-fixtures';

const at = '2025-01-03T00:00:00.000Z';
const swapsPath = (id: string) => `/accounts/${id}/swaps`;
const businessRows = () => fingerprint(['auth_sessions', 'auth_request_limits']);

async function openAccountFromDirectory(page: Page, accountId: string): Promise<void> {
  const directory = page.getByRole('region', { name: 'Счета', exact: true });
  const link = directory.locator(`a[href="/manual-accounts/${accountId}"]`);
  const more = directory.getByRole('button', { name: 'Показать еще счета', exact: true });
  for (let loaded = 0; ; loaded++) {
    await expect
      .poll(
        async () =>
          (await link.count()) === 1 || ((await more.isVisible()) && (await more.isEnabled())),
      )
      .toBe(true);
    if (await link.count()) break;
    expect(loaded, 'Exact synthetic account discovery is bounded').toBeLessThan(10);
    const previous = await directory.getByRole('link').count();
    await more.click();
    await expect.poll(() => directory.getByRole('link').count()).toBeGreaterThan(previous);
  }
  await expect(link).toBeVisible();
  await link.click();
}

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

test('SWAP-UI: owner reviews exact evidence and retries a committed exchange across SPA remount', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  const account = await api.account(`Swap UI ${randomUUID()}`);
  const outgoing = await api.instrument(`UI outgoing ${randomUUID()}`, 'SAME');
  const incoming = await api.instrument(`UI incoming ${randomUUID()}`, 'SAME');
  await api.initialize(account.id);
  await api.create(account.id, tradeInput(outgoing.id, 0));
  await page.goto(`/manual-accounts/${account.id}`);
  await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('swaps');
  const section = page.getByRole('region', {
    name: 'Обмены активов',
    exact: true,
  });
  await expect(section).toBeVisible();
  const form = section.getByRole('form', {
    name: 'Редактор обмена',
    exact: true,
  });
  // ENTRY-001-A: the predecessor's unassociated prose must fail before editing.
  await expect(form.getByLabel('Оценка обмена в USD', { exact: true })).toHaveAccessibleDescription(
    /неизвестн[\s\S]*не[\s\S]*нул/iu,
  );
  await expect(
    form.getByLabel('Получаемое количество до комиссии', { exact: true }),
  ).toHaveAccessibleDescription(/до[\s\S]*комисси/iu);
  await expect(form.getByLabel('Источник комиссии', { exact: true })).toHaveAccessibleDescription(
    /остат[\s\S]*FIFO[\s\S]*получаем|получаем[\s\S]*остат[\s\S]*FIFO/iu,
  );
  await expect(form.getByLabel('Дата обмена', { exact: true })).toHaveAccessibleDescription(
    /00:00 UTC/u,
  );
  await expect(form.getByLabel('Время обмена, UTC', { exact: true })).toHaveAccessibleDescription(
    /UTC/u,
  );
  await expect(form.getByLabel('Порядок в моменте', { exact: true })).toHaveAccessibleDescription(
    /поряд[\s\S]*(?:одинаков|одном)|(?:одинаков|одном)[\s\S]*поряд/iu,
  );

  await form.getByLabel('Отдаваемый актив', { exact: true }).selectOption(outgoing.id);
  await form.getByLabel('Получаемый актив', { exact: true }).selectOption(incoming.id);
  await form.getByLabel('Отдаваемое количество', { exact: true }).fill('1');
  await form.getByLabel('Получаемое количество до комиссии', { exact: true }).fill('3');
  await form.getByLabel('Дата обмена', { exact: true }).fill(at.slice(0, 10));
  await form.getByLabel('Порядок в моменте', { exact: true }).fill('0');
  await form
    .getByLabel('Оценка обмена в USD', { exact: true })
    .selectOption({ label: 'Неизвестна' });
  await form
    .getByLabel('Источник комиссии', { exact: true })
    .selectOption({ label: 'Без комиссии' });
  await page.waitForLoadState('networkidle');
  const beforeLayout = businessRows();
  const layoutProviders = providerRequests();
  // ENTRY-003-A: populate conditional evidence without reviewing or writing it.
  await form.getByLabel('Оценка обмена в USD', { exact: true }).selectOption('known');
  await form.getByLabel('Сумма оценки, USD', { exact: true }).fill('150.000000000000000001');
  await form.getByLabel('Источник комиссии', { exact: true }).selectOption('held');
  await form.getByLabel('Актив комиссии', { exact: true }).selectOption(outgoing.id);
  await form.getByLabel('Количество комиссии', { exact: true }).fill('0.000000000000000001');
  const originalViewport = page.viewportSize();
  const originalTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(form.getByLabel('Сумма оценки, USD', { exact: true })).toHaveValue(
        '150.000000000000000001',
      );
      await expect(form.getByLabel('Количество комиссии', { exact: true })).toHaveValue(
        '0.000000000000000001',
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      for (const control of await form
        .locator('input:not([type="checkbox"]), select, button')
        .all()) {
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
      const checkbox = form.getByRole('checkbox');
      const checkBounds = await checkbox.boundingBox();
      expect(checkBounds).not.toBeNull();
      expect(checkBounds!.width).toBeLessThan(44);
      expect(checkBounds!.height).toBeLessThan(44);
      await form.evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: testInfo.outputPath(`swap-ui-${theme}-${width}-top.png`),
        animations: 'disabled',
        fullPage: false,
      });
      const bounds = await form.boundingBox();
      expect(bounds).not.toBeNull();
      if (bounds!.height > 900) {
        await form.evaluate((node) => node.scrollIntoView({ block: 'end' }));
        await page.screenshot({
          path: testInfo.outputPath(`swap-ui-${theme}-${width}-bottom.png`),
          animations: 'disabled',
          fullPage: false,
        });
      }
    }
  }
  await page.evaluate((value) => {
    if (value === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
  }, originalTheme);
  if (originalViewport) await page.setViewportSize(originalViewport);
  expect(businessRows()).toBe(beforeLayout);
  expect(providerRequests()).toEqual(layoutProviders);
  await form.getByLabel('Оценка обмена в USD', { exact: true }).selectOption('unknown');
  await form.getByLabel('Источник комиссии', { exact: true }).selectOption('none');
  await expect(form.getByLabel('Сумма оценки, USD', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('Количество комиссии', { exact: true })).toHaveCount(0);
  await form
    .getByRole('checkbox', {
      name: 'Подтверждаю: это уже выполненный обмен внутри этого счёта.',
      exact: true,
    })
    .check();
  await form.getByRole('button', { name: 'Проверить обмен', exact: true }).click();
  const review = section.getByRole('region', {
    name: 'Проверка обмена',
    exact: true,
  });
  await expect(review).toContainText(outgoing.id);
  await expect(review).toContainText(incoming.id);
  await form.getByLabel('Получаемое количество до комиссии', { exact: true }).fill('4');
  await expect(review).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Записать обмен', exact: true })).toBeDisabled();
  await form.getByLabel('Получаемое количество до комиссии', { exact: true }).fill('3');
  await form.getByRole('button', { name: 'Проверить обмен', exact: true }).click();
  const submitted: unknown[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/accounting${swapsPath(account.id)}`
    )
      submitted.push(request.postDataJSON());
  });
  let receipt: { swap: { swapId: string } } | undefined;
  let dropped = false;
  const routePattern = `**/api/accounting${swapsPath(account.id)}`;
  await page.route(routePattern, async (route) => {
    if (route.request().method() !== 'POST' || dropped) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    receipt = await response.json();
    dropped = true;
    await route.abort('connectionreset');
  });
  try {
    await form.getByRole('button', { name: 'Записать обмен', exact: true }).click();
    await expect(
      form.getByRole('button', {
        name: 'Повторить тот же запрос',
        exact: true,
      }),
    ).toBeEnabled();
    // SHELL-002-B: resizing and disclosing navigation must not remount the
    // editor, reset a separate draft or retry the ambiguous command implicitly.
    const independentDraft = page.getByRole('group', {
      name: 'Сделка в USD',
      exact: true,
      includeHidden: true,
    });
    await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('trades');
    await independentDraft.getByLabel('Количество', { exact: true }).fill('17');
    await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('swaps');
    const mountedEditor = await form.elementHandle();
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 1000) {
        const menu = page.getByRole('button', { name: 'Меню', exact: true });
        await menu.click();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(menu).toBeFocused();
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
      }
      expect(await mountedEditor?.evaluate((node) => node.isConnected)).toBe(true);
      await expect(independentDraft.getByLabel('Количество', { exact: true })).toHaveValue('17');
      await expect(
        form.getByLabel('Получаемое количество до комиссии', { exact: true }),
      ).toHaveValue('3');
      await expect(
        form.getByRole('button', {
          name: 'Повторить тот же запрос',
          exact: true,
        }),
      ).toBeEnabled();
      expect(submitted).toHaveLength(1);
    }
    await mountedEditor?.dispose();
    await page.getByRole('link', { name: '← Ручные счета', exact: true }).click();
    await openAccountFromDirectory(page, account.id);
    await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('swaps');
    await expect(form.getByLabel('Получаемое количество до комиссии', { exact: true })).toHaveValue(
      '3',
    );
    await expect(
      form.getByRole('button', {
        name: 'Повторить тот же запрос',
        exact: true,
      }),
    ).toBeEnabled();
    expect(submitted).toHaveLength(1);
    const retried = await browserPost(page, swapsPath(account.id), () =>
      form.getByRole('button', { name: 'Повторить тот же запрос', exact: true }).click(),
    );
    expect(retried.status()).toBe(200);
    expect(await retried.json()).toEqual(receipt);
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[0]).toMatchObject({
      expectedJournalRevision: 1,
      considerationUsd: null,
      feeSource: null,
      feeInstrumentId: null,
      feeQuantity: '0',
    });
  } finally {
    await page.unroute(routePattern);
  }
  const tradeDraft = page.getByRole('group', {
    name: 'Сделка в USD',
    exact: true,
    includeHidden: true,
  });
  await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('trades');
  await tradeDraft.getByLabel('Количество', { exact: true }).fill('17');
  await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('swaps');
  const article = section.getByRole('article', {
    name: `Обмен ${receipt?.swap.swapId}`,
    exact: true,
  });
  await expect(article).toContainText('Неизвестно');
  await article.getByRole('button', { name: 'Показать распределение обмена', exact: true }).click();
  const allocation = article.getByRole('region', {
    name: 'Распределение обмена',
    exact: true,
  });
  await expect(
    allocation.getByText('Реализованный результат обменов, USD').locator('+ dd'),
  ).toContainText('Неизвестно');
  await expect(
    allocation.getByText('Себестоимость отданных активов, USD').locator('+ dd'),
  ).toHaveText('100');
  const lots = page.getByRole('table', { name: 'Открытые лоты', exact: true });
  await expect(lots).toContainText(`Обмен ${receipt?.swap.swapId}, версия 1`);
  await expect(lots).toContainText('Интервал исходного лота: 0–3');
  const captureFocusContext = async (focusTarget: Locator, boundsTarget: Locator, name: string) => {
    const viewport = page.viewportSize();
    const colorScheme = await page.evaluate(() =>
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    );
    const rowsBefore = businessRows();
    const providersBefore = providerRequests();
    try {
      for (const [width, themeName] of [
        [360, 'dark'],
        [1440, 'light'],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: themeName });
        await expect(page.locator('html')).toHaveAttribute('data-theme', themeName);
        await focusTarget.focus();
        await expect(focusTarget).toBeFocused();
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          )
          .toBe(true);
        const bounds = await boundsTarget.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return { top: box.top + window.scrollY, height: box.height };
        });
        for (let index = 0; index < Math.ceil(bounds.height / 800); index++) {
          const offset = Math.min(index * 800, Math.max(0, bounds.height - 800));
          await page.evaluate(
            (top) => window.scrollTo(0, Math.max(0, top - 16)),
            bounds.top + offset,
          );
          await expect(
            page.getByRole('link', { name: 'К содержимому', exact: true }),
          ).not.toBeInViewport();
          await page.screenshot({
            path: testInfo.outputPath(`swap-focus-${name}-${themeName}-${width}-${index + 1}.png`),
            animations: 'disabled',
            fullPage: false,
          });
        }
      }
    } finally {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      if (viewport) await page.setViewportSize(viewport);
    }
    expect(businessRows()).toBe(rowsBefore);
    expect(providerRequests()).toEqual(providersBefore);
  };
  const observeNavigation = async (navigate: () => Promise<void>) => {
    const rowsBefore = businessRows();
    const providersBefore = providerRequests();
    const posts: string[] = [];
    const recordPost = (request: Request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname.startsWith('/api/accounting/')
      )
        posts.push(request.url());
    };
    page.on('request', recordPost);
    try {
      await navigate();
      expect(posts, 'Review navigation must not submit commands').toEqual([]);
      expect(businessRows()).toBe(rowsBefore);
      expect(providerRequests()).toEqual(providersBefore);
      await expect(tradeDraft.getByLabel('Количество', { exact: true })).toHaveValue('17');
    } finally {
      page.off('request', recordPost);
    }
  };
  await observeNavigation(async () => {
    for (const [buttonName, editorName, submitName, captureName] of [
      ['Исправить обмен', 'Исправление обмена', 'Записать исправление', 'correction'],
      ['Отменить обмен', 'Отмена обмена', 'Отменить обмен', 'void'],
    ]) {
      const opener = article.getByRole('button', { name: buttonName, exact: true });
      await opener.click();
      await expect(opener).not.toBeFocused({ timeout: 10_000 });
      const editor = section.getByRole('region', { name: editorName, exact: true });
      // ENTRY-004: meaningful bounded RED before any other newly required behavior.
      await expect(editor).toBeFocused({ timeout: 10_000 });
      await expect(editor).toHaveAttribute('tabindex', '-1');
      await expect(form.getByRole('button', { name: submitName, exact: true })).toBeDisabled();
      await expect(form.getByRole('checkbox')).not.toBeChecked();
      await expect(form.getByLabel('Отдаваемое количество', { exact: true })).toHaveValue('1');
      await captureFocusContext(editor, editor, captureName);
      await form.getByRole('button', { name: 'Отменить редактирование', exact: true }).click();
      await expect(opener).toBeEnabled();
      await expect(opener).toBeFocused();
      await expect(section.getByRole('region', { name: 'Новый обмен', exact: true })).toBeVisible();
      await expect(form.getByLabel('Отдаваемое количество', { exact: true })).toHaveValue('');
      await expect(form.getByLabel('Отдаваемый актив', { exact: true })).toHaveValue('');
      await expect(form.getByLabel('Получаемый актив', { exact: true })).toHaveValue('');
      await expect(
        form.getByLabel('Получаемое количество до комиссии', { exact: true }),
      ).toHaveValue('');
      await expect(form.getByLabel('Оценка обмена в USD', { exact: true })).toHaveValue('unknown');
      await expect(form.getByLabel('Источник комиссии', { exact: true })).toHaveValue('none');
      await expect(form.getByRole('checkbox')).not.toBeChecked();
    }
  });
  await article.getByRole('button', { name: 'Исправить обмен', exact: true }).click();
  await form.getByLabel('Оценка обмена в USD', { exact: true }).selectOption({ label: 'Известна' });
  await form.getByLabel('Сумма оценки, USD', { exact: true }).fill('0');
  await form
    .getByRole('checkbox', {
      name: 'Подтверждаю: это уже выполненный обмен внутри этого счёта.',
      exact: true,
    })
    .check();
  let releaseHistory: (() => void) | undefined;
  const historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  let historyHeld = false;
  let historyDelivered = false;
  const versionsRoute = `**/api/accounting${swapsPath(account.id)}/${receipt?.swap.swapId}/versions**`;
  const delayActualHistory = async (route: import('@playwright/test').Route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect((await response.json()).items[0].version).toBe(1);
    historyHeld = true;
    await historyGate;
    await route.fulfill({ response });
    historyDelivered = true;
  };
  await page.route(versionsRoute, delayActualHistory);
  try {
    await form.getByRole('button', { name: 'Проверить исправление', exact: true }).click();
    await expect.poll(() => historyHeld).toBe(true);
    // Real concurrent write advances the same journal pin while the old review is in flight.
    await api.create(
      account.id,
      tradeInput(outgoing.id, 2, { occurredAt: '2025-01-04T00:00:00.000Z' }),
    );
    await section.getByRole('button', { name: 'Обновить обмены', exact: true }).click();
    await expect(section).toContainText('ревизия журнала: 3.');
    const response = page.waitForResponse((result) =>
      new URL(result.url()).pathname.endsWith(`/${receipt?.swap.swapId}/versions`),
    );
    releaseHistory?.();
    await (await response).finished();
    await expect.poll(() => historyDelivered).toBe(true);
    await page.waitForLoadState('networkidle');
    await expect(review).toHaveCount(0);
    await expect(
      form.getByRole('button', { name: 'Записать исправление', exact: true }),
    ).toBeDisabled();
    await expect(form.getByLabel('Сумма оценки, USD', { exact: true })).toHaveValue('0');
    await expect(tradeDraft.getByLabel('Количество', { exact: true })).toHaveValue('17');
  } finally {
    releaseHistory?.();
    await page.unroute(versionsRoute, delayActualHistory);
  }
  await form.getByRole('button', { name: 'Проверить исправление', exact: true }).click();
  const corrected = await browserPost(
    page,
    `${swapsPath(account.id)}/${receipt?.swap.swapId}/correct`,
    () => form.getByRole('button', { name: 'Записать исправление', exact: true }).click(),
  );
  expect(corrected.status()).toBe(201);
  expect(await corrected.json()).toMatchObject({
    swap: { version: 2, considerationUsd: '0' },
  });
  await expect(article.getByText('Версия', { exact: true }).locator('+ dd')).toHaveText(
    '2 · Активно',
  );
  await form.getByLabel('Отдаваемое количество', { exact: true }).fill('23');
  const historyOpener = article.getByRole('button', { name: 'История обмена', exact: true });
  const historyRegion = article.getByRole('region', { name: 'История обмена', exact: true });
  const historyHeading = historyRegion.getByRole('heading', {
    name: 'История обмена',
    exact: true,
    level: 4,
  });
  const historyPath = `/api/accounting${swapsPath(account.id)}/${receipt?.swap.swapId}/versions`;
  const historyPattern = (url: URL) => url.pathname === historyPath;
  const readHistoryWithDelay = async (closePending: boolean) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let complete = () => {};
    const handlerDone = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let started = false;
    let held = false;
    const holdActualHistory = async (route: Route) => {
      started = true;
      try {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({
          items: [
            expect.objectContaining({
              swapId: receipt?.swap.swapId,
              version: 2,
              journalRevision: 4,
              kind: 'correct',
              outgoingQuantity: '1',
              incomingQuantity: '3',
              considerationUsd: '0',
            }),
            expect.objectContaining({
              swapId: receipt?.swap.swapId,
              version: 1,
              journalRevision: 2,
              kind: 'create',
              considerationUsd: null,
            }),
          ],
          nextBeforeVersion: null,
        });
        held = true;
        await gate;
        await route.fulfill({ response });
      } finally {
        complete();
      }
    };
    await page.route(historyPattern, holdActualHistory, { times: 1 });
    try {
      await historyOpener.click();
      await expect(historyHeading).toBeFocused();
      await expect(historyHeading).toHaveAttribute('tabindex', '-1');
      await expect.poll(() => held).toBe(true);
      await expect(historyOpener).toBeDisabled();
      if (closePending) {
        await historyRegion.getByRole('button', { name: 'Закрыть историю', exact: true }).click();
        await expect(historyRegion).toHaveCount(0);
        await expect(historyOpener).toBeEnabled();
        await expect(historyOpener).toBeFocused();
      } else {
        // Focus only: the own unsaved quantity remains exactly 23 throughout the read.
        await form.getByLabel('Отдаваемое количество', { exact: true }).focus();
      }
      const delivered = page.waitForResponse(
        (response) => new URL(response.url()).pathname === historyPath,
      );
      release();
      const response = await delivered;
      expect(response.status()).toBe(200);
      await response.finished();
      await handlerDone;
      await page.waitForLoadState('networkidle');
      await expect(form.getByLabel('Отдаваемое количество', { exact: true })).toHaveValue('23');
      if (closePending) {
        await expect(historyRegion).toHaveCount(0);
        await expect(historyOpener).toBeFocused();
        await expect(historyOpener).toBeEnabled();
      } else {
        await expect(form.getByLabel('Отдаваемое количество', { exact: true })).toBeFocused();
        await expect(historyRegion).toContainText('Версия 2');
        await expect(historyRegion).toContainText('Версия 1');
        await captureFocusContext(historyHeading, historyRegion, 'history');
        await historyRegion.getByRole('button', { name: 'Закрыть историю', exact: true }).click();
        await expect(historyRegion).toHaveCount(0);
        await expect(historyOpener).toBeFocused();
      }
    } finally {
      release();
      if (started) await handlerDone;
      await page.unroute(historyPattern, holdActualHistory);
    }
  };
  await observeNavigation(async () => {
    await readHistoryWithDelay(false);
    await readHistoryWithDelay(true);
  });
  await article.getByRole('button', { name: 'Отменить обмен', exact: true }).click();
  await form.getByRole('button', { name: 'Проверить отмену', exact: true }).click();
  const voided = await browserPost(
    page,
    `${swapsPath(account.id)}/${receipt?.swap.swapId}/void`,
    () => form.getByRole('button', { name: 'Отменить обмен', exact: true }).click(),
  );
  expect(voided.status()).toBe(201);
  expect(await voided.json()).toMatchObject({
    swap: { version: 3, kind: 'void' },
  });
  await expect(article).toContainText('Отменено');
  await expect(tradeDraft.getByLabel('Количество', { exact: true })).toHaveValue('17');
});
