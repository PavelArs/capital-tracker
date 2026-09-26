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
  const revision = page.getByText(`Ревизия журнала: 1. Граница покрытия UTC: ${coverageFrom}.`, {
    exact: true,
  });
  const capacity = page.getByText('Активных сделок: 1 / 1000, неизменяемых версий: 1 / 10000.', {
    exact: false,
  });
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
  const scope = page.getByText('Учёт операций в USD. Без рыночной оценки.', { exact: true });
  await expect(scope).toBeVisible();
  const toggleContext = async (expanded: boolean) => {
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(summary).toBeFocused();
    await expect
      .poll(() => context.evaluate((node: HTMLDetailsElement) => node.open))
      .toBe(expanded);
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
  await quantity.fill('0.');
  await quantity.pressSequentially('123456789012345678');
  await expect(quantity).toBeFocused();
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
        path: testInfo.outputPath(
          `journal-context-${expanded ? 'expanded' : 'compact'}-${width}.png`,
        ),
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
  const correctAction = row.getByRole('button', { name: 'Исправить', exact: true });
  const correctActionNode = await correctAction.elementHandle();
  await correctAction.scrollIntoViewIfNeeded();
  await correctAction.focus();
  await expect(correctAction).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(choice).toHaveValue('trades');
  await expect(quantity).toHaveValue('1');
  // First new oracle: the predecessor reveals the editor but leaves keyboard focus in history.
  // Keep this before named-group, guidance and layout assertions so RED proves the behavior gap.
  await expect(correctAction).not.toBeFocused();
  const correctionWorkbench = page.getByRole('group', {
    name: 'Исправление сделки',
    exact: true,
  });
  await expect(correctionWorkbench).toBeFocused();
  await expect
    .poll(() => correctionWorkbench.evaluate((node) => node.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(() => correctionWorkbench.evaluate((node) => node.getBoundingClientRect().top))
    .toBeLessThanOrEqual(96);
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
  expect(await quantity.evaluate((element, original) => element === original, correctionNode)).toBe(
    true,
  );
  await expect(quantity).toHaveValue('1');
  await expect(cancelCorrection).toBeVisible();
  await correctionNode?.dispose();
  await cancelCorrection.focus();
  await page.keyboard.press('Enter');
  await expect(correctAction).toBeFocused();
  expect(
    await correctAction.evaluate((node, original) => node === original, correctActionNode),
  ).toBe(true);
  await correctActionNode?.dispose();
  await choice.selectOption('rewards');
  const voidAction = row.getByRole('button', { name: 'Аннулировать', exact: true });
  const voidActionNode = await voidAction.elementHandle();
  await voidAction.scrollIntoViewIfNeeded();
  await voidAction.focus();
  await expect(voidAction).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(voidAction).not.toBeFocused();
  const voidWorkbench = page.getByRole('group', {
    name: 'Аннулирование сделки',
    exact: true,
  });
  await expect(voidWorkbench).toBeFocused();
  await expect
    .poll(() => voidWorkbench.evaluate((node) => node.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(() => voidWorkbench.evaluate((node) => node.getBoundingClientRect().top))
    .toBeLessThanOrEqual(96);
  await expect(choice).toHaveValue('trades');
  await expect(
    page.getByText(`Аннулировать сделку ${bought.trade.tradeId}, версия 1?`, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Подтвердить аннулирование', exact: true }),
  ).toBeVisible();
  const cancelVoid = page.getByRole('button', { name: 'Отменить аннулирование', exact: true });
  await cancelVoid.focus();
  await page.keyboard.press('Enter');
  await expect(voidAction).toBeFocused();
  expect(await voidAction.evaluate((node, original) => node === original, voidActionNode)).toBe(
    true,
  );
  await voidActionNode?.dispose();

  const newWorkbench = page.getByRole('group', { name: 'Новая сделка', exact: true });
  await expect(newWorkbench).toBeVisible();
  for (const label of [
    'Инструмент',
    'Тип сделки',
    'Количество',
    'Дата и время сделки (UTC)',
    'Порядок в этот момент',
    'Валовая сумма, USD',
    'Комиссия, USD',
  ]) {
    const field = ['Инструмент', 'Тип сделки'].includes(label)
      ? trade.getByRole('combobox', { name: label, exact: true })
      : trade.getByLabel(label, { exact: true });
    await expect(field).toBeVisible();
  }
  const gross = trade.getByLabel('Валовая сумма, USD', { exact: true });
  const fee = trade.getByLabel('Комиссия, USD', { exact: true });
  await expect(gross).toHaveAccessibleDescription(
    /(?:общ|полн|валов).*сумм.*(?:не.*цен.*единиц|не.*единичн)/i,
  );
  await expect(fee).toHaveAccessibleDescription(/(?:отдельн.*USD|USD.*отдельн)/i);
  await expect(
    trade.getByLabel('Дата и время сделки (UTC)', { exact: true }),
  ).toHaveAccessibleDescription(/UTC/);
  await expect(
    trade.getByLabel('Порядок в этот момент', { exact: true }),
  ).toHaveAccessibleDescription(/(?:одинаков|совпадающ).*времен|(?:одинаков|совпадающ).*момент/i);
  await gross.fill('100.000000000000000001');
  await expect(gross).toBeFocused();
  await expect(gross).toHaveValue('100.000000000000000001');
  await fee.fill('0.000000000000000001');
  await expect(fee).toBeFocused();
  await expect(fee).toHaveValue('0.000000000000000001');
  await toggleContext(true);
  await toggleContext(false);
  await expect(summary).toBeFocused();

  const originalTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  for (const theme of ['light', 'dark']) {
    // Presentation-only theme selection; no fabricated input/change events or business data.
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(summary).toBeFocused();
      await expect(gross).toHaveValue('100.000000000000000001');
      await expect(fee).toHaveValue('0.000000000000000001');
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      await newWorkbench.evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: testInfo.outputPath(`trade-workbench-${theme}-${width}.png`),
        fullPage: false,
      });
      await table.scrollIntoViewIfNeeded();
      const tableContainer = table.locator('..');
      await expect(tableContainer).toHaveCSS('overflow-x', 'auto');
      if (width === 360) {
        await expect
          .poll(() => tableContainer.evaluate((node) => node.scrollWidth - node.clientWidth))
          .toBeGreaterThan(0);
      }
      for (const action of await table.getByRole('button').all()) {
        const bounds = await action.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
      }
      await expect(row).toContainText(bought.trade.tradeId);
      await expect(row.getByRole('cell', { name: '100', exact: true })).toBeVisible();
      await expect(lotTable).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`trade-results-${theme}-${width}.png`),
        fullPage: false,
      });
      await expect(summary).toBeFocused();
    }
  }
  await page.evaluate((value) => {
    if (value === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
  }, originalTheme);
  await choice.selectOption('rewards');
  await expect(reward).toHaveValue('2.000000000000000001');
  expect(requests).toEqual([]);
  expect(businessState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);

  // A genuine journal refresh replaces the originating history button. Cancellation
  // must fall back to the current workbench rather than the disconnected old action.
  const refreshOrigin = await correctAction.elementHandle();
  await correctAction.scrollIntoViewIfNeeded();
  await correctAction.focus();
  await page.keyboard.press('Enter');
  await expect(correctionWorkbench).toBeFocused();
  const refreshJournal = page.getByRole('button', { name: 'Обновить журнал', exact: true });
  await refreshJournal.click();
  await expect.poll(() => refreshOrigin!.evaluate((node) => node.isConnected)).toBe(false);
  await expect(correctAction).toBeEnabled();
  expect(await correctAction.evaluate((node, original) => node === original, refreshOrigin)).toBe(
    false,
  );
  await expect(cancelCorrection).toBeEnabled();
  // Native focus may leave the refresh button while loading disables it; refresh must not
  // schedule the explicit history-action focus on the correction workbench.
  await expect(correctionWorkbench).not.toBeFocused();
  await cancelCorrection.focus();
  await page.keyboard.press('Enter');
  await expect(newWorkbench).toBeFocused();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
  expect(businessState()).toBe(prior);
  expect(providerRequests()).toEqual(providers);
  await refreshOrigin?.dispose();
  await originalFile.dispose();
  for (const node of [tradeNode, swapNode, rewardNode, fileNode]) await node?.dispose();
});
