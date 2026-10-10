import { createHash } from 'node:crypto';
import { type Locator, type Page, expect } from '@playwright/test';
import { rows, uuid } from './manual-opening-fixtures';
import { fingerprint } from './mfa-fixtures';
import {
  type Summary,
  type TradeVersion,
  browserPost,
  readTradeVersion,
  tradeApi,
  tradeTables,
} from './usd-trades-fixtures';

export const csvTables = [
  'account_csv_imports',
  'account_csv_import_commands',
  'account_csv_import_rows',
];
export const emptySummary: Summary = {
  grossBuysUsd: '0',
  buyFeesUsd: '0',
  grossSalesUsd: '0',
  sellFeesUsd: '0',
  netSalesUsd: '0',
  consumedCostUsd: '0',
  realizedUsd: '0',
  remainingCostUsd: '0',
};
export type CsvExecution = {
  source: string;
  side: 'buy' | 'sell';
  time: string;
  order: number;
  quantity: string;
  gross: string;
  fee: string;
};
export const buy: CsvExecution = {
  source: 'TOKEN',
  side: 'buy',
  time: '2025-01-02T00:00:00Z',
  order: 0,
  quantity: '1',
  gross: '100',
  fee: '0',
};
export const example: CsvExecution[] = [
  { ...buy, side: 'sell', time: '2025-01-04T00:00:00Z', quantity: '1.5', gross: '450' },
  buy,
  { ...buy, time: '2025-01-03T00:00:00Z', gross: '200' },
];
export function csvSource(executions = [buy]): Buffer {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const records = executions
    .map((row) =>
      [row.source, row.side, row.time, row.order, row.quantity, row.gross, row.fee]
        .map(cell)
        .join(','),
    )
    .join('\r\n');
  return Buffer.from(`\uFEFFinstrument,side,time,order,quantity,gross,fee\r\n${records}\r\n`);
}
export type CsvSettings = {
  format: {
    delimiter: ',' | ';';
    decimalSeparator: '.' | ',';
    timestampMode: 'offset' | 'fixed-offset';
    fixedOffset?: string;
  };
  mapping: {
    columns: {
      instrument: number;
      side: number;
      occurredAt: number;
      order: number;
      quantity: number;
      grossUsd: number;
      feeUsd: number;
      currency?: number;
    };
    instruments: { source: string; instrumentId: string }[];
    sides: { source: string; side: 'buy' | 'sell' }[];
  };
  assertUsd: true;
};
export type CsvConfirm = CsvSettings & {
  requestId: string;
  expectedJournalRevision: number;
  parserVersion: string;
  previewHash: string;
};
export type CsvRollback = { requestId: string; expectedJournalRevision: number };
export type CsvReceipt = {
  accountId: string;
  batchId: string;
  requestId: string;
  kind: 'confirm' | 'rollback';
  rowCount: number;
  firstJournalRevision: number;
  lastJournalRevision: number;
  createdAt: string;
};
export function readCsvReceipt(value: unknown): CsvReceipt {
  expect(value !== null && typeof value === 'object' && !Array.isArray(value)).toBe(true);
  const row = value as Record<string, unknown>;
  expect(Object.keys(row).sort()).toEqual(
    [
      'accountId',
      'batchId',
      'requestId',
      'kind',
      'rowCount',
      'firstJournalRevision',
      'lastJournalRevision',
      'createdAt',
    ].sort(),
  );
  uuid(row.accountId);
  uuid(row.batchId);
  uuid(row.requestId);
  expect(['confirm', 'rollback']).toContain(row.kind);
  for (const key of ['rowCount', 'firstJournalRevision', 'lastJournalRevision']) {
    expect(Number.isSafeInteger(row[key]) && Number(row[key]) > 0).toBe(true);
  }
  expect(row.lastJournalRevision).toBe(Number(row.firstJournalRevision) + Number(row.rowCount) - 1);
  expect(row.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  return row as CsvReceipt;
}
export async function csvFixture(page: Page) {
  const api = await tradeApi(page);
  const account = await api.account();
  const instrument = await api.instrument();
  await api.initialize(account.id);
  return { api, account, instrument };
}
export function retainedState(extraExcluded: string[] = []): string {
  return fingerprint([
    'auth_sessions',
    'auth_request_limits',
    ...csvTables,
    ...tradeTables,
    ...extraExcluded,
  ]);
}
export function csvRows(account: string): unknown {
  uuid(account);
  return Object.fromEntries(
    csvTables.map((table) => [
      table,
      rows(
        `SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE "accountId"='${account}' ORDER BY row`,
      ),
    ]),
  );
}
export function assertCommitted(receipt: CsvReceipt): void {
  expect(
    rows(`SELECT "requestId",kind,"rowCount","firstJournalRevision","lastJournalRevision"
    FROM account_csv_import_commands WHERE "ownerId"='11111111-1111-4111-8111-111111111111'
      AND "accountId"='${uuid(receipt.accountId)}' AND "batchId"='${uuid(receipt.batchId)}'
      AND "requestId"='${uuid(receipt.requestId)}'`),
  ).toEqual([
    {
      requestId: receipt.requestId,
      kind: receipt.kind,
      rowCount: receipt.rowCount,
      firstJournalRevision: receipt.firstJournalRevision,
      lastJournalRevision: receipt.lastJournalRevision,
    },
  ]);
}
export async function navigateToAccount(page: Page, account: string): Promise<void> {
  // G1: the older screens are reached from Settings, not from the sidebar.
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'Older screens' })
    .getByRole('link', { name: 'Open manual accounts', exact: true })
    .click();
  const link = page.locator(`a[href="/manual-accounts/${uuid(account)}"]`);
  const more = page.getByRole('button', { name: 'Показать еще счета', exact: true });
  for (let loaded = 0; ; loaded++) {
    await expect
      .poll(
        async () =>
          (await link.count()) > 0 || ((await more.isVisible()) && (await more.isEnabled())),
      )
      .toBe(true);
    if (await link.count()) break;
    expect(loaded, 'Synthetic account discovery is bounded').toBeLessThan(10);
    const previous = await page.locator('.manual-account-list li').count();
    await more.click();
    await expect
      .poll(() => page.locator('.manual-account-list li').count())
      .toBeGreaterThan(previous);
  }
  await link.click();
  await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('imports');
  await expect(page.getByRole('heading', { name: 'Импорт CSV', exact: true })).toBeVisible();
}
export async function uploadInBrowser(
  page: Page,
  account: string,
  executions = [buy],
  filename = 'Сделки 📒.csv',
): Promise<string> {
  await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('imports');
  const buffer = csvSource(executions);
  await expect(page.getByRole('heading', { name: 'Импорт CSV', exact: true })).toBeVisible();
  await page
    .getByLabel('Файл CSV', { exact: true })
    .setInputFiles({ name: filename, mimeType: 'text/csv', buffer });
  const response = await browserPost(page, `/accounts/${account}/csv-imports`, () =>
    page.getByRole('button', { name: 'Загрузить CSV', exact: true }).click(),
  );
  expect(response.status()).toBe(201);
  const identity = await response.json();
  expect(identity.sha256).toBe(createHash('sha256').update(buffer).digest('hex'));
  expect(identity.byteLength).toBe(buffer.length);
  const batch = uuid(identity.batchId);
  expect(
    rows(
      `SELECT encode("originalBytes",'hex') AS bytes,filename,state FROM account_csv_imports WHERE id='${batch}'`,
    ),
  ).toEqual([{ bytes: buffer.toString('hex'), filename, state: 'draft' }]);
  await expect(
    page.getByRole('combobox', { name: 'Сохранённая партия CSV', exact: true }),
  ).toHaveValue(batch);
  return batch;
}
export async function inspectAndMap(
  page: Page,
  account: string,
  batch: string,
  instrument: string,
  executions = [buy],
): Promise<void> {
  const response = await browserPost(
    page,
    `/accounts/${account}/csv-imports/${batch}/inspect`,
    () => page.getByRole('button', { name: 'Просмотреть исходные строки', exact: true }).click(),
  );
  expect(response.status()).toBe(200);
  const inspected = await response.json();
  expect(inspected.valid).toBe(true);
  expect(inspected.rows).toEqual(
    executions.map((row, index) => ({
      ordinal: index + 1,
      startLine: index + 2,
      cells: [row.source, row.side, row.time, String(row.order), row.quantity, row.gross, row.fee],
    })),
  );
  const group = page.getByRole('group', { name: 'Сопоставление колонок и значений', exact: true });
  await expect(group).toBeVisible();
  const labels = [
    'Инструмент',
    'Тип сделки',
    'Дата сделки',
    'Порядок в одну дату',
    'Количество',
    'Валовая сумма USD',
    'Комиссия USD',
  ];
  for (const [index, label] of labels.entries())
    await group
      .getByRole('combobox', { name: `Колонка: ${label}`, exact: true })
      .selectOption(String(index));
  for (const source of new Set(executions.map((row) => row.source))) {
    const select = group.getByRole('combobox', { name: `Инструмент для ${source}`, exact: true });
    await expect(select).toBeVisible();
    const option = select.locator(`option[value="${uuid(instrument)}"]`);
    const more = group.getByRole('button', {
      name: 'Загрузить ещё инструменты для CSV',
      exact: true,
    });
    for (let loaded = 0; ; loaded++) {
      await expect
        .poll(
          async () =>
            (await option.count()) > 0 || ((await more.isVisible()) && (await more.isEnabled())),
        )
        .toBe(true);
      if (await option.count()) break;
      expect(loaded).toBeLessThan(10);
      const previous = await select.locator('option').count();
      await more.click();
      await expect
        .poll(
          async () =>
            (await option.count()) > 0 || (await select.locator('option').count()) > previous,
        )
        .toBe(true);
    }
    await select.selectOption(instrument);
  }
  for (const side of new Set(executions.map((row) => row.side)))
    await group
      .getByRole('combobox', { name: `Тип сделки для ${side}`, exact: true })
      .selectOption(side);
  await group
    .getByRole('checkbox', { name: 'Валовые суммы и комиссии выражены в USD', exact: true })
    .check();
}
export async function previewInBrowser(
  page: Page,
  account: string,
  batch: string,
  summary: Summary,
  revision = 0,
): Promise<void> {
  const response = await browserPost(
    page,
    `/accounts/${account}/csv-imports/${batch}/preview`,
    () => page.getByRole('button', { name: 'Проверить импорт', exact: true }).click(),
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    canConfirm: true,
    journalRevision: revision,
    rowErrors: [],
    batchErrors: [],
    candidateSummary: summary,
  });
  await expectCsvSummary(page, 'После импорта', summary);
  await expect(
    page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }),
  ).toBeEnabled();
}
export async function expectCsvSummary(
  page: Page,
  region: string,
  summary: Summary,
): Promise<void> {
  const names: Record<keyof Summary, string> = {
    grossBuysUsd: 'Покупки без комиссий',
    buyFeesUsd: 'Комиссии покупок',
    grossSalesUsd: 'Продажи до комиссий',
    sellFeesUsd: 'Комиссии продаж',
    netSalesUsd: 'Чистые продажи',
    consumedCostUsd: 'Списанная себестоимость',
    realizedUsd: 'Реализованный результат',
    remainingCostUsd: 'Остаточная себестоимость',
  };
  const target = page.getByRole('region', { name: region, exact: true });
  await expect(target).toBeVisible();
  for (const [key, label] of Object.entries(names))
    await expect(
      target
        .locator('div.csv-summary-line')
        .filter({ has: page.getByText(`${label}, USD`, { exact: true }) })
        .locator('dd'),
    ).toHaveText(summary[key as keyof Summary]);
}
export function retryButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Повторить исходный запрос CSV', exact: true });
}

export async function expectJournalSummary(page: Page, summary: Summary): Promise<void> {
  const names: Record<keyof Summary, string> = {
    grossBuysUsd: 'Сумма покупок, USD',
    buyFeesUsd: 'Комиссии покупок, USD',
    grossSalesUsd: 'Сумма продаж, USD',
    sellFeesUsd: 'Комиссии продаж, USD',
    netSalesUsd: 'Чистая выручка, USD',
    consumedCostUsd: 'Списанная себестоимость, USD',
    realizedUsd: 'Реализованный результат продаж за USD',
    remainingCostUsd: 'Остаточная учётная стоимость',
  };
  const target = page.getByRole('region', { name: 'Итоги журнала', exact: true });
  for (const [key, label] of Object.entries(names))
    await expect(
      target
        .locator('dt')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText(summary[key as keyof Summary]);
}
export type CsvProvenance = {
  ordinal: number;
  startLine: number;
  tradeId: string;
  createVersion: TradeVersion;
  rollbackVersion: TradeVersion | null;
};
export async function provenanceInBrowser(
  page: Page,
  account: string,
  batch: string,
): Promise<CsvProvenance[]> {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/accounting/accounts/${account}/csv-imports/${batch}/rows` &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Показать происхождение сделок', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.batchId).toBe(batch);
  expect(body.nextAfterOrdinal).toBeNull();
  expect(Array.isArray(body.items)).toBe(true);
  const items: CsvProvenance[] = body.items.map((row: Record<string, unknown>) => {
    expect(Object.keys(row).sort()).toEqual(
      ['ordinal', 'startLine', 'tradeId', 'createVersion', 'rollbackVersion'].sort(),
    );
    expect(Number.isInteger(row.ordinal) && Number(row.ordinal) >= 1).toBe(true);
    expect(Number.isInteger(row.startLine) && Number(row.startLine) >= 2).toBe(true);
    return {
      ordinal: Number(row.ordinal),
      startLine: Number(row.startLine),
      tradeId: uuid(row.tradeId),
      createVersion: readTradeVersion(row.createVersion),
      rollbackVersion: row.rollbackVersion === null ? null : readTradeVersion(row.rollbackVersion),
    };
  });
  const table = page.getByRole('table', {
    name: 'Происхождение импортированных сделок',
    exact: true,
  });
  await expect(table.locator('tbody tr')).toHaveCount(items.length);
  for (const item of items) {
    const row = table.getByRole('row').filter({ hasText: item.tradeId });
    await expect(
      row.getByRole('cell', { name: `${item.ordinal} / ${item.startLine}`, exact: true }),
    ).toBeVisible();
    await expect(row).toContainText(item.createVersion.instrumentId);
    await expect(row).toContainText(
      `Количество ${item.createVersion.quantity}; валовая сумма ${item.createVersion.grossUsd} USD; комиссия ${item.createVersion.feeUsd} USD`,
    );
  }
  return items;
}

export async function hasVisibleLiteral(
  locator: Locator,
  source: string,
  contextualText: string,
): Promise<boolean> {
  return locator.evaluate(
    (root, expected) => {
      const candidates = [root, ...root.querySelectorAll('*')].filter(
        (element) => !element.closest('select'),
      );
      return candidates.some((element) => {
        const style = getComputedStyle(element);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          element.getClientRects().length === 0
        )
          return false;
        const directText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join('');
        if (directText.includes(JSON.stringify(expected.source))) return true;
        return (
          ['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace) &&
          (directText === expected.source || directText.includes(expected.contextualText))
        );
      });
    },
    { source, contextualText },
  );
}
