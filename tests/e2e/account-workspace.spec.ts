import { randomUUID } from 'node:crypto';
import { type Page, expect } from '@playwright/test';
import { isAnalysisRequest, selectAnalysis } from './analytics-workbench-fixtures';
import { providerRequests } from './manual-opening-fixtures';
import { fingerprint, query, test } from './mfa-fixtures';
import {
  type TradeReceipt,
  browserPost,
  readReceipt,
  tradeApi,
  tradeInput,
} from './usd-trades-fixtures';

async function selectSection(page: Page, name: string) {
  const button = page
    .getByRole('group', { name: 'Разделы счета', exact: true })
    .getByRole('button', { name, exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const id = await button.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  await expect(page.locator(`[id="${id}"]`)).toBeVisible();
}

// The installed macOS Chromium native popup ignores automation arrow navigation.
// Root's isolated browser diagnostic verified trusted Russian-layout type-ahead keys.
async function typeAnalysisChoice(page: Page, key: 'И' | 'У') {
  const session = await page.context().newCDPSession(page);
  const code = key === 'И' ? 'KeyB' : 'KeyE';
  const windowsVirtualKeyCode = key === 'И' ? 66 : 69;
  try {
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      text: key,
      unmodifiedText: key.toLowerCase(),
      windowsVirtualKeyCode,
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
    });
  } finally {
    await session.detach();
  }
}

test('WORKSPACE-UI: sections retain exact drafts, historical results and original committed trade retry', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  const account = await api.account(`Рабочий счет ${randomUUID()}`);
  const other = await api.account(`Другой счет ${randomUUID()}`);
  const instrument = await api.instrument(`Инструмент ${randomUUID()}`, 'EXACT');
  await api.initialize(account.id);
  await api.create(account.id, tradeInput(instrument.id, 0));
  const providers = providerRequests();
  const writes: unknown[] = [];
  let analyses = 0;
  const analyticsRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (isAnalysisRequest(request)) analyticsRequests.push(request.url());
    if (path.startsWith('/api/accounting/') && request.method() === 'POST')
      writes.push(request.postDataJSON());
    if (path === `/api/accounting/accounts/${account.id}/trade-journal/history`) analyses++;
  });
  await page.goto(`/manual-accounts/${account.id}`);
  const form = page.getByRole('group', { name: 'Сделка в USD', exact: true });
  await expect(form).toBeVisible();
  const instant = page.getByLabel('Дата среза', { exact: true });
  // Genuine predecessor RED: analysis and setup are always visible on the old page.
  await expect(instant).toBeHidden();
  const instrumentName = page.getByLabel('Название инструмента', { exact: true });
  await expect(instrumentName).toBeHidden();
  const quantity = form.getByLabel('Количество', { exact: true });
  await form.getByRole('combobox', { name: 'Инструмент', exact: true }).selectOption(instrument.id);
  await form.getByLabel('Дата сделки', { exact: true }).fill('2025-01-03');
  await form.getByLabel('Количество', { exact: true }).fill('0.123456789012345678');
  await form.getByLabel('Сумма сделки, USD', { exact: true }).fill('12.34');
  await form.getByLabel('Комиссия, USD', { exact: true }).fill('0.01');
  const originalInput = await quantity.elementHandle();

  await selectSection(page, 'Аналитика');
  // ANALYTICS-001: direct bounded predecessor RED, before selecting any new task.
  await expect(
    page.getByRole('heading', { name: 'Учётный срез на дату', exact: true }),
  ).not.toBeVisible({ timeout: 10_000 });
  const analysisChoice = page.getByRole('combobox', { name: 'Задача анализа', exact: true });
  await expect(analysisChoice).toBeVisible();
  expect(await analysisChoice.evaluate((node) => node.tagName)).toBe('SELECT');
  await expect(analysisChoice).toHaveValue('valuation');
  expect(await analysisChoice.locator('option').allTextContents()).toEqual([
    'Оценка на дату',
    'История стоимости',
    'Учётные позиции',
  ]);
  const owners = [
    page.getByRole('region', { name: 'Оценка счёта на дату', exact: true, includeHidden: true }),
    page.getByRole('region', { name: 'История стоимости счёта', exact: true, includeHidden: true }),
    page.getByRole('region', { name: 'Учётный срез на дату', exact: true, includeHidden: true }),
  ];
  const originalOwners = await Promise.all(owners.map((owner) => owner.elementHandle()));
  await expect(owners[0]).toBeVisible();
  await expect(owners[1]).toBeHidden();
  await expect(owners[2]).toBeHidden();
  const controlledPanel = await analysisChoice.getAttribute('aria-controls');
  expect(controlledPanel).toBeTruthy();
  await expect(page.locator(`[id="${controlledPanel}"]`)).toBeVisible();
  const valuationInstant = page.getByLabel('Дата оценки', { exact: true });
  await analysisChoice.focus();
  await page.keyboard.press('Tab');
  await expect(valuationInstant).toBeFocused();
  await valuationInstant.fill('2025-01-04');
  const beforeTaskNavigation = fingerprint(['auth_sessions', 'auth_request_limits']);
  await analysisChoice.focus();
  await typeAnalysisChoice(page, 'И');
  await expect(analysisChoice).toHaveValue('history');
  await expect(analysisChoice).toBeFocused();
  await expect(owners[1]).toBeVisible();
  await expect(owners[0]).toBeHidden();
  const historyFrom = page.getByLabel('Начало периода', { exact: true });
  const historyTo = page.getByLabel('Конец периода', { exact: true });
  await historyFrom.fill('2025-01-01');
  await historyTo.fill('2025-01-04');
  await analysisChoice.focus();
  await typeAnalysisChoice(page, 'У');
  await expect(analysisChoice).toHaveValue('accounting');
  await expect(analysisChoice).toBeFocused();
  await expect(owners[2]).toBeVisible();
  await expect(owners[1]).toBeHidden();
  for (const [index, owner] of owners.entries()) {
    expect(await owner.evaluate((node, original) => node === original, originalOwners[index])).toBe(
      true,
    );
    expect(await originalOwners[index]?.evaluate((node) => node.isConnected)).toBe(true);
  }
  expect(analyticsRequests).toEqual([]);
  expect(writes).toEqual([]);
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforeTaskNavigation);
  expect(providerRequests()).toEqual(providers);
  await expect(form).toBeHidden();
  await instant.fill('2025-01-02');
  await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
  const positions = page.getByRole('table', { name: 'Позиции на выбранный момент', exact: true });
  await expect(positions.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await expect(positions.getByRole('cell', { name: '100', exact: true })).toBeVisible();
  const originalResult = await positions.elementHandle();
  const taskReads = [...analyticsRequests];
  const taskRows = fingerprint(['auth_sessions', 'auth_request_limits']);
  for (const task of ['valuation', 'history', 'accounting'] as const) {
    await selectAnalysis(page, task);
    await expect(analysisChoice).toHaveValue(task);
  }
  await expect(valuationInstant).toHaveValue('2025-01-04');
  await expect(historyFrom).toHaveValue('2025-01-01');
  await expect(historyTo).toHaveValue('2025-01-04');
  await expect(instant).toHaveValue('2025-01-02');
  await expect(positions.getByRole('cell', { name: '100', exact: true })).toBeVisible();
  expect(await positions.evaluate((node, original) => node === original, originalResult)).toBe(
    true,
  );
  expect(analyticsRequests).toEqual(taskReads);
  expect(writes).toEqual([]);
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(taskRows);
  expect(providerRequests()).toEqual(providers);
  for (const node of originalOwners) await node?.dispose();
  await selectSection(page, 'Начальные данные');
  await instrumentName.fill('Несохраненный инструмент');
  await expect(
    page.getByText('Начальные позиции нельзя заменять после открытия журнала сделок.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Сохранить начальные позиции', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Сохраненные начальные позиции', exact: true }),
  ).toBeVisible();

  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const section of ['Операции', 'Аналитика', 'Начальные данные']) {
      await selectSection(page, section);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`workspace-${section}-${width}.png`),
        fullPage: false,
      });
    }
    await expect(instrumentName).toHaveValue('Несохраненный инструмент');
  }
  expect(await originalInput?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await originalResult?.evaluate((node) => node.isConnected)).toBe(true);
  expect(analyses).toBe(1);
  expect(writes).toEqual([]);
  await selectSection(page, 'Аналитика');
  await expect(analysisChoice).toHaveValue('accounting');
  expect(analyticsRequests).toEqual(taskReads);
  await expect(instant).toHaveValue('2025-01-02');
  await expect(positions.getByRole('cell', { name: '100', exact: true })).toBeVisible();
  await selectSection(page, 'Операции');
  await expect(quantity).toHaveValue('0.123456789012345678');

  const path = `/api/accounting/accounts/${account.id}/trades`;
  const pattern = `**${path}`;
  let committed: TradeReceipt | undefined;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'POST' || committed) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed = readReceipt(await response.json());
    await route.abort('connectionreset');
  });
  const context = page.locator('details').filter({
    has: page.locator('summary', { hasText: 'Параметры и правила учёта' }),
  });
  await context.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => context.evaluate((node: HTMLDetailsElement) => node.open)).toBe(true);
  expect(writes).toEqual([]);
  try {
    await page.getByRole('button', { name: 'Сохранить сделку', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Повторить исходный запрос', exact: true });
    await expect(retry).toBeVisible();
    await expect(retry.locator('xpath=ancestor::details')).toHaveCount(0);
    for (const expanded of [false, true]) {
      await context.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect
        .poll(() => context.evaluate((node: HTMLDetailsElement) => node.open))
        .toBe(expanded);
      await expect(retry).toBeVisible();
      await expect(quantity).toBeDisabled();
    }
    await expect(quantity).toBeDisabled();
    expect(writes).toHaveLength(1);
    await selectSection(page, 'Начальные данные');
    await expect(retry).toBeVisible();
    await expect(instrumentName).toHaveValue('Несохраненный инструмент');
    await selectSection(page, 'Аналитика');
    await expect(retry).toBeVisible();
    expect(writes).toHaveLength(1);
    const replay = await browserPost(page, `/accounts/${account.id}/trades`, () => retry.click());
    expect(replay.status()).toBe(200);
    expect(readReceipt(await replay.json())).toEqual(committed);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    // Existing invalidation on a changed journal revision still applies while the editor is hidden.
    await expect(positions).toHaveCount(0);
    expect(analyses).toBe(1);
    await selectSection(page, 'Операции');
    await expect.poll(() => context.evaluate((node: HTMLDetailsElement) => node.open)).toBe(true);
    await expect(context).toContainText('Ревизия журнала: 2.');
    await expect(context).toContainText(
      'Активных сделок: 2 / 1000, неизменяемых версий: 2 / 10000.',
    );
    const total = page.getByRole('region', { name: 'Итоги журнала', exact: true });
    await expect(
      total
        .getByText('Остаточная учётная стоимость', { exact: true })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('112.35');
    expect(
      query(
        `SELECT count(*) FROM account_trade_versions WHERE "tradeId"='${committed!.trade.tradeId}'`,
      ),
    ).toBe('1');
    await page.reload();
    await expect(
      total
        .getByText('Остаточная учётная стоимость', { exact: true })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('112.35');
    await page.getByRole('link', { name: '← Ручные счета', exact: true }).click();
    await page.locator(`a[href="/manual-accounts/${other.id}"]`).click();
    await expect(page.getByRole('heading', { name: other.name, exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Журнал требует явно подтверждённого пустого начала либо проверенных начальных лотов. Общий баланс не восстанавливает историю покупок автоматически.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(context.locator('summary')).toHaveCount(0);
    await selectSection(page, 'Начальные данные');
    await expect(instrumentName).toHaveValue('');
    await selectSection(page, 'Аналитика');
    await expect(analysisChoice).toHaveValue('valuation');
    await expect(
      page.getByRole('table', {
        name: 'Позиции на выбранный момент',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await selectAnalysis(page, 'accounting');
    await expect(instant).toHaveValue('');
    await expect(positions).toHaveCount(0);
    // Exercise parameter-only SPA reuse without the directory unmounting this page.
    await selectSection(page, 'Начальные данные');
    await instrumentName.fill('Черновик другого счета');
    const symbol = page.getByLabel('Символ (необязательно)', { exact: true });
    await symbol.fill('OTHER');
    await page.evaluate((accountId) => {
      history.pushState(history.state, '', `/manual-accounts/${accountId}`);
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, account.id);
    await expect(page.getByRole('heading', { name: account.name, exact: true })).toBeVisible();
    await expect(form).toBeVisible();
    await expect.poll(() => context.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);
    await expect(quantity).toHaveValue('');
    await selectSection(page, 'Аналитика');
    await expect(analysisChoice).toHaveValue('valuation');
    await expect(valuationInstant).toHaveValue('');
    await expect(historyFrom).toHaveValue('');
    await expect(historyTo).toHaveValue('');
    await expect(
      page.getByRole('table', {
        name: 'Позиции на выбранный момент',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await selectAnalysis(page, 'accounting');
    await expect(instant).toHaveValue('');
    await expect(positions).toHaveCount(0);
    await selectSection(page, 'Начальные данные');
    await expect(instrumentName).toHaveValue('');
    await expect(symbol).toHaveValue('');
    expect(writes).toHaveLength(2);
    expect(providerRequests()).toEqual(providers);
  } finally {
    await page.unroute(pattern);
    await originalInput?.dispose();
    await originalResult?.dispose();
  }
});
