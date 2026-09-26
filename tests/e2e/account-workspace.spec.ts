import { randomUUID } from 'node:crypto';
import { type Page, expect } from '@playwright/test';
import { providerRequests } from './manual-opening-fixtures';
import { query, test } from './mfa-fixtures';
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
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/accounting/') && request.method() === 'POST')
      writes.push(request.postDataJSON());
    if (path === `/api/accounting/accounts/${account.id}/trade-journal/history`) analyses++;
  });
  await page.goto(`/manual-accounts/${account.id}`);
  const form = page.getByRole('group', { name: 'Сделка в USD', exact: true });
  await expect(form).toBeVisible();
  const instant = page.getByLabel('Момент времени (ISO, с часовым поясом)', { exact: true });
  // Genuine predecessor RED: analysis and setup are always visible on the old page.
  await expect(instant).toBeHidden();
  const instrumentName = page.getByLabel('Название инструмента', { exact: true });
  await expect(instrumentName).toBeHidden();
  const quantity = form.getByLabel('Количество', { exact: true });
  await form.getByRole('combobox', { name: 'Инструмент', exact: true }).selectOption(instrument.id);
  await form
    .getByLabel('Дата и время сделки (UTC)', { exact: true })
    .fill('2025-01-03T00:00:00.000Z');
  await form.getByLabel('Количество', { exact: true }).fill('0.123456789012345678');
  await form.getByLabel('Валовая сумма, USD', { exact: true }).fill('12.34');
  await form.getByLabel('Комиссия, USD', { exact: true }).fill('0.01');
  const originalInput = await quantity.elementHandle();

  await selectSection(page, 'Аналитика');
  await expect(form).toBeHidden();
  await instant.fill('2025-01-02T00:00:00Z');
  await page.getByRole('button', { name: 'Показать учётный срез', exact: true }).click();
  const positions = page.getByRole('table', { name: 'Позиции на выбранный момент', exact: true });
  await expect(positions.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await expect(positions.getByRole('cell', { name: '100', exact: true })).toBeVisible();
  const originalResult = await positions.elementHandle();
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
  await expect(instant).toHaveValue('2025-01-02T00:00:00Z');
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
      await expect.poll(() => context.evaluate((node: HTMLDetailsElement) => node.open)).toBe(expanded);
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
    await expect(context).toContainText('Активных сделок: 2 / 1000, неизменяемых версий: 2 / 10000.');
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
    await expect(page.getByText(
      'Журнал требует явно подтверждённого пустого начала либо проверенных начальных лотов. Общий баланс не восстанавливает историю покупок автоматически.',
      { exact: true },
    )).toBeVisible();
    await expect(context.locator('summary')).toHaveCount(0);
    await selectSection(page, 'Начальные данные');
    await expect(instrumentName).toHaveValue('');
    await selectSection(page, 'Аналитика');
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
