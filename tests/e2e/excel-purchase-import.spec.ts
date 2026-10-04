import { createHash, randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { emptySummary, expectJournalSummary } from './csv-import-fixtures';
import { rows, uuid } from './manual-opening-fixtures';
import { test } from './mfa-fixtures';
import { browserPost, tradeApi } from './usd-trades-fixtures';

// The owner's purchase sheet exactly as Excel shows it (tab-separated, decimal commas).
const header = [
  'Дата',
  'Купил',
  'Количество',
  'Купил за',
  'За количество',
  'в USD',
  'Курс',
  'Текущий курс',
  'Текущая стоимость',
  'Разница',
  'Доход',
];
const sample = [
  '13.06.2025',
  'BTC',
  '0,00918359',
  'USDT',
  '1000',
  '1000',
  '108889,8786',
  '84945',
  '780,1000526',
  '-219,8999475',
  '-21,99%',
];

test('SHEET-UI: owner imports the Excel purchase sheet as tab-separated text and reconciles it in Russian', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account();
  const instrument = await api.instrument(`Bitcoin ${randomUUID()}`, 'BTC');
  await api.initialize(account.id);
  await api.result('POST', `/instruments/${instrument.id}/usd-prices`, 201, {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: '2025-10-01T00:00:00Z',
    priceUsd: '84945',
    assertReviewed: true,
  });
  const buffer = Buffer.from(`${[header, sample].map((row) => row.join('\t')).join('\r\n')}\r\n`);

  await page.goto(`/manual-accounts/${account.id}`);
  await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('imports');
  await page
    .getByLabel('Файл CSV', { exact: true })
    .setInputFiles({ name: 'Покупки.tsv', mimeType: 'text/tab-separated-values', buffer });
  const uploaded = await browserPost(page, `/accounts/${account.id}/csv-imports`, () =>
    page.getByRole('button', { name: 'Загрузить CSV', exact: true }).click(),
  );
  expect(uploaded.status()).toBe(201);
  const identity = await uploaded.json();
  expect(identity.sha256).toBe(createHash('sha256').update(buffer).digest('hex'));
  const batch = uuid(identity.batchId);

  await page.getByRole('combobox', { name: 'Разделитель', exact: true }).selectOption('\t');
  const inspected = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/inspect`,
    () => page.getByRole('button', { name: 'Просмотреть исходные строки', exact: true }).click(),
  );
  expect(await inspected.json()).toMatchObject({
    valid: true,
    headers: header,
    rows: [{ ordinal: 1, startLine: 2, cells: sample }],
  });

  const group = page.getByRole('group', { name: 'Сопоставление колонок и значений', exact: true });
  await group.getByRole('button', { name: 'Заполнить по таблице покупок', exact: true }).click();
  await expect(group.getByRole('combobox', { name: 'Колонка: Дата сделки' })).toHaveValue('0');
  await expect(group.getByRole('combobox', { name: 'Формат времени' })).toHaveValue(
    'day-month-year-utc',
  );
  await expect(group.getByRole('checkbox', { name: 'Все строки — покупки' })).toBeChecked();
  const select = group.getByRole('combobox', { name: 'Инструмент для BTC', exact: true });
  const option = select.locator(`option[value="${instrument.id}"]`);
  const more = group.getByRole('button', { name: 'Загрузить ещё инструменты для CSV' });
  for (let loaded = 0; ; loaded++) {
    await expect
      .poll(
        async () =>
          (await option.count()) > 0 || ((await more.isVisible()) && (await more.isEnabled())),
      )
      .toBe(true);
    if (await option.count()) break;
    expect(loaded, 'Synthetic instrument discovery is bounded').toBeLessThan(10);
    const previous = await select.locator('option').count();
    await more.click();
    await expect
      .poll(
        async () =>
          (await option.count()) > 0 || (await select.locator('option').count()) > previous,
      )
      .toBe(true);
  }
  await select.selectOption(instrument.id);
  await group
    .getByRole('checkbox', { name: 'Валовые суммы и комиссии выражены в USD', exact: true })
    .check();

  const previewed = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/preview`,
    () => page.getByRole('button', { name: 'Проверить импорт', exact: true }).click(),
  );
  expect(await previewed.json()).toMatchObject({
    canConfirm: true,
    rowErrors: [],
    rows: [
      {
        ordinal: 1,
        execution: {
          instrumentId: instrument.id,
          side: 'buy',
          occurredAt: '2025-06-13T00:00:00.000Z',
          orderWithinTimestamp: 1,
          quantity: '0.00918359',
          grossUsd: '1000',
          feeUsd: '0',
        },
      },
    ],
    candidateSummary: { grossBuysUsd: '1000', buyFeesUsd: '0', remainingCostUsd: '1000' },
  });
  const confirmed = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/confirm`,
    () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
  );
  expect(confirmed.status()).toBe(201);
  expect(
    rows(`SELECT to_char(v."occurredAt" AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS at,
      v."orderWithinTimestamp" AS "order", trim_scale(v.quantity)::text AS quantity,
      trim_scale(v."grossUsd")::text AS gross, trim_scale(v."feeUsd")::text AS fee
      FROM account_trade_versions v JOIN account_csv_import_rows r
      ON r."tradeId"=v."tradeId" AND r."createVersion"=v.version WHERE r."batchId"='${batch}'`),
  ).toEqual([
    { at: '2025-06-13 00:00', order: 1, quantity: '0.00918359', gross: '1000', fee: '0' },
  ]);

  await expectJournalSummary(page, {
    ...emptySummary,
    grossBuysUsd: '1000',
    remainingCostUsd: '1000',
  });
  await expect(
    page.getByText(/Чтобы сверить партию с таблицей, просмотрите исходные строки файла/),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Разделитель', exact: true })).toHaveValue('\t');
  await page.getByRole('button', { name: 'Просмотреть исходные строки', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Сверка с таблицей' });
  await expect(panel.getByRole('combobox', { name: 'Колонка таблицы: Курс' })).toHaveValue('6');
  const reconciled = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      `/api/accounting/accounts/${account.id}/csv-imports/${batch}/reconciliation`,
  );
  await panel.getByRole('button', { name: 'Сверить с таблицей', exact: true }).click();
  expect((await reconciled).status()).toBe(200);
  const table = panel.getByRole('table', { name: 'Сверка строк с таблицей' });
  const row = table.getByRole('row').nth(1);
  await expect(row).toContainText('13.06.2025');
  for (const text of [
    'в USD: 1000 / 1000 — совпадает',
    'Курс: 108889,8786 / 108889.8786 — совпадает',
    'Текущая стоимость: 780,1000526 / 780.1000526 — совпадает',
    'Разница: -219,8999475 / -219.8999475 — совпадает',
    'Доход, %: -21,99% / -21.99 — совпадает',
    '84945 на 01.10.2025',
    '-219.89994745',
  ])
    await expect(row).toContainText(text);
  await expect(panel.getByText(/Совпадает: 5 · расходится: 0 · не читается: 0/)).toBeVisible();
  // The wide comparison table scrolls inside its own wrapper, never the page.
  const viewport = page.viewportSize();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
  if (viewport) await page.setViewportSize(viewport);
});
