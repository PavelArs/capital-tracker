import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { businessState, providerRequests } from './manual-opening-fixtures';
import { test } from './mfa-fixtures';
import { coverageFrom, tradeApi, tradeInput } from './usd-trades-fixtures';

test('WORKFLOW-UI: choose one operation and retain all independent drafts without implicit commands', async ({
  page,
}, testInfo) => {
  const api = await tradeApi(page);
  const account = await api.account(`Выбор операций ${randomUUID()}`);
  const instrument = await api.instrument(`Точный актив ${randomUUID()}`, 'UI');
  await api.initialize(account.id);
  const bought = await api.create(account.id, tradeInput(instrument.id, 0));
  await page.goto(`/manual-accounts/${account.id}`);
  const trade = page.getByRole('group', { name: 'Сделка в USD', exact: true });
  await expect(trade).toBeVisible();
  const revision = page.getByText(
    `Ревизия журнала: 1. Граница покрытия UTC: ${coverageFrom}.`,
    { exact: true },
  );
  const capacity = page.getByText(
    'Активных сделок: 1 / 1000, неизменяемых версий: 1 / 10000.',
    { exact: false },
  );
  // Genuine predecessor RED: initialized journal details used to be always visible.
  await expect(revision).toBeHidden();
  await expect(capacity).toBeHidden();
  const initialization = page.getByText(
    'Журнал требует явно подтверждённого пустого начала либо проверенных начальных лотов. Общий баланс не восстанавливает историю покупок автоматически.',
    { exact: true },
  );
  await expect(initialization).toBeHidden();
  const context = page.locator('details').filter({
    has: page.locator('summary', { hasText: 'Параметры и правила учёта' }),
  });
  const summary = context.locator('summary');
  await expect(summary).toHaveText('Параметры и правила учёта');
  await expect.poll(() => context.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);
  const scope = page.getByText(
    'Учёт операций в USD. Без рыночной оценки.',
    { exact: true },
  );
  await expect(scope).toBeVisible();
  const toggleContext = async (expanded: boolean) => {
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(summary).toBeFocused();
    await expect.poll(() => context.evaluate((node: HTMLDetailsElement) => node.open)).toBe(expanded);
    if (expanded) {
      await expect(initialization).toBeVisible();
      await expect(revision).toBeVisible();
      await expect(capacity).toBeVisible();
      await expect(context).toContainText(
        'Это учётные результаты журнала, не рыночная стоимость, не доходность портфеля и не налоговый отчёт.',
      );
      await expect(capacity).toContainText(
        'Распределение себестоимости: 30 десятичных знаков, остаток получает последняя часть лота.',
      );
    } else {
      await expect(initialization).toBeHidden();
      await expect(revision).toBeHidden();
      await expect(capacity).toBeHidden();
    }
    await expect(scope).toBeVisible();
  };
  const csv = page.getByLabel('Файл CSV', { exact: true });
  // Actual predecessor behavior: all operation workflows are visible together.
  await expect(csv).toBeHidden();
  const swap = page.getByLabel('Получаемое количество до комиссии', { exact: true });
  const reward = page.getByLabel('Полученное количество', { exact: true });
  await expect(swap).toBeHidden();
  await expect(reward).toBeHidden();
  const choice = page.getByRole('combobox', { name: 'Вид операций', exact: true });
  await expect(choice).toHaveValue('trades');
  await expect(choice.locator('option')).toHaveText([
    'Сделки в USD',
    'Обмены активов',
    'Вознаграждения',
    'Импорт CSV',
  ]);
  await page.waitForLoadState('networkidle');
  const prior = businessState();
  const providers = providerRequests();
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/accounting/'))
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const quantity = trade.getByLabel('Количество', { exact: true });
  await quantity.fill('0.123456789012345678');
  const tradeNode = await quantity.elementHandle();
  await toggleContext(true);
  await toggleContext(false);
  await expect(quantity).toHaveValue('0.123456789012345678');
  await choice.focus();
  // Arrow sequences did not change this native select in installed macOS Chromium.
  // Send a Cyrillic key for native type-ahead via CDP; keyboard.press rejects it.
  // No DOM value/event is fabricated.
  const keyboard = await page.context().newCDPSession(page);
  await keyboard.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'о',
    code: 'KeyJ',
    text: 'о',
    unmodifiedText: 'о',
    windowsVirtualKeyCode: 74,
  });
  await keyboard.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'о',
    code: 'KeyJ',
    windowsVirtualKeyCode: 74,
  });
  await keyboard.detach();
  await expect(choice).toBeFocused();
  await expect(choice).toHaveValue('swaps');
  await expect(quantity).toBeHidden();
  await swap.fill('3.000000000000000001');
  const swapNode = await swap.elementHandle();
  await choice.selectOption('rewards');
  await reward.fill('2.000000000000000001');
  const rewardNode = await reward.elementHandle();
  await choice.selectOption('imports');
  await csv.setInputFiles({
    name: 'Неподтвержденные сделки.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('asset,quantity\nUI,1\n'),
  });
  const fileNode = await csv.elementHandle();
  const originalFile = await csv.evaluateHandle((input: HTMLInputElement) => input.files![0]);
  const lotTable = page.getByRole('table', { name: 'Открытые лоты', exact: true });
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const expanded of [false, true]) {
      if (expanded) await toggleContext(true);
      await summary.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`journal-context-${expanded ? 'expanded' : 'compact'}-${width}.png`),
        fullPage: false,
      });
    }
    for (const workflow of ['trades', 'swaps', 'rewards', 'imports']) {
      await choice.selectOption(workflow);
      await expect(choice).toHaveValue(workflow);
      await expect(revision).toBeVisible();
      await expect(lotTable).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      await choice.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`workflow-${workflow}-${width}.png`),
        fullPage: false,
      });
    }
    await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    await expect(choice).toHaveValue('imports');
    await expect(revision).toBeVisible();
    await toggleContext(false);
  }
  for (const node of [tradeNode, swapNode, rewardNode, fileNode])
    expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
  for (const [workflow, input, node] of [
    ['trades', quantity, tradeNode],
    ['swaps', swap, swapNode],
    ['rewards', reward, rewardNode],
    ['imports', csv, fileNode],
  ] as const) {
    await choice.selectOption(workflow);
    expect(await input.evaluate((element, original) => element === original, node)).toBe(true);
  }
  expect(
    await csv.evaluate(
      (input: HTMLInputElement, original) => input.files![0] === original,
      originalFile,
    ),
  ).toBe(true);
  await choice.selectOption('trades');
  await expect(quantity).toHaveValue('0.123456789012345678');
  await choice.selectOption('swaps');
  await expect(swap).toHaveValue('3.000000000000000001');
  await choice.selectOption('rewards');
  await expect(reward).toHaveValue('2.000000000000000001');
  const table = page.getByRole('table', { name: 'Сделки журнала', exact: true });
  const row = table.getByRole('row').filter({ hasText: bought.trade.tradeId });
  await row.getByRole('button', { name: 'Исправить', exact: true }).click();
  await expect(choice).toHaveValue('trades');
  await expect(quantity).toHaveValue('1');
  await expect(trade.getByLabel('Валовая сумма, USD', { exact: true })).toHaveValue('100');
  const cancelCorrection = page.getByRole('button', {
    name: 'Отменить исправление',
    exact: true,
  });
  await expect(cancelCorrection).toBeVisible();
  const correctionNode = await quantity.elementHandle();
  await toggleContext(true);
  await toggleContext(false);
  expect(await correctionNode?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await quantity.evaluate((element, original) => element === original, correctionNode)).toBe(true);
  await expect(quantity).toHaveValue('1');
  await expect(cancelCorrection).toBeVisible();
  await correctionNode?.dispose();
  await cancelCorrection.click();
  await choice.selectOption('rewards');
  await row.getByRole('button', { name: 'Аннулировать', exact: true }).click();
  await expect(choice).toHaveValue('trades');
  await expect(
    page.getByText(`Аннулировать сделку ${bought.trade.tradeId}, версия 1?`, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Подтвердить аннулирование', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Отменить аннулирование', exact: true }).click();
  await choice.selectOption('rewards');
  await expect(reward).toHaveValue('2.000000000000000001');
  expect(requests).toEqual([]);
  expect(businessState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  await originalFile.dispose();
  for (const node of [tradeNode, swapNode, rewardNode, fileNode]) await node?.dispose();
});
