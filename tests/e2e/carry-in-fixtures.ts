import { randomUUID } from 'node:crypto';
import { type Page, expect } from '@playwright/test';
import { openingInput, rows, uuid } from './manual-opening-fixtures';
import { fingerprint } from './mfa-fixtures';
import { browserPost, tradeApi, tradeTables } from './usd-trades-fixtures';

// Maintained predecessor-image acceptance. Setup uses only verified MFA and opening
// APIs; neither a future production import nor an existing carry-in table is required.
export const baselineTable = 'account_carry_in_lots';
export const coverageFrom = '2025-01-01T00:00:00.000Z';
export const reviewLabel =
  'Подтверждаю исходные данные лотов и понимаю, что начальные лоты пока нельзя изменить.';
export const initialSummary = {
  grossBuysUsd: '0',
  buyFeesUsd: '0',
  grossSalesUsd: '0',
  sellFeesUsd: '0',
  netSalesUsd: '0',
  consumedCostUsd: '0',
  realizedUsd: '0',
  remainingCostUsd: '300',
};
export const soldSummary = {
  ...initialSummary,
  grossSalesUsd: '450',
  netSalesUsd: '450',
  consumedCostUsd: '200',
  realizedUsd: '250',
  remainingCostUsd: '100',
};

export type LotInput = {
  instrumentId: string;
  acquiredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string;
  remainingQuantity: string;
};
export type CarryInOrigin = {
  accountId: string;
  requestId: string;
  originKind: 'known-cost-carry-in';
  coverageFrom: string;
  openingRevision: number;
  lotCount: number;
  carryInCostUsd: string;
  createdAt: string;
};
export type InitialLot = Omit<LotInput, 'remainingQuantity'> & {
  lotId: string;
  ordinal: number;
  instrumentName: string;
  instrumentSymbol: string | null;
  carriedQuantity: string;
  priorDisposedQuantity: string;
  priorAllocatedCostUsd: string;
  carriedCostUsd: string;
};
export type InitialLots = {
  accountId: string;
  openingRevision: number;
  items: InitialLot[];
  nextAfterOrdinal: number | null;
};

export function retainedRows(accountId: string, extraExcluded: string[] = []): unknown {
  uuid(accountId);
  const mutable = [...tradeTables, baselineTable];
  // Discover only tables that actually exist on either image. Preserve every other
  // account's journal/baseline, as well as all opening, CSV, owner and MFA rows.
  const tables = rows<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  ).filter(({ tablename }) => mutable.includes(tablename));
  return {
    existing: fingerprint(['auth_sessions', 'auth_request_limits', ...mutable, ...extraExcluded]),
    otherAccounts: Object.fromEntries(
      tables.map(({ tablename }) => [
        tablename,
        rows(
          `SELECT to_jsonb(t) AS row FROM ${tablename} t
           WHERE "accountId" <> '${accountId}' ORDER BY to_jsonb(t)::text`,
        ),
      ]),
    ),
  };
}

export async function fixture(page: Page, name = `Исходный TOKEN ${randomUUID()}`) {
  const api = await tradeApi(page);
  const account = await api.account();
  const instrument = await api.instrument(name, 'TOKEN');
  const opening = await api.save(
    account.id,
    openingInput(instrument.id, {
      asOf: coverageFrom,
      positions: [
        { instrumentId: instrument.id, quantity: '2', costStatus: 'known', totalCostUsd: '300' },
      ],
    }),
  );
  expect(opening.revision).toBe(1);
  expect(await api.state(account.id)).toEqual({
    accountId: account.id,
    eligible: false,
    ineligibilityReason: 'opening-history',
    journal: null,
  });
  const lots: LotInput[] = [
    {
      instrumentId: instrument.id,
      acquiredAt: '2024-12-30T00:00:00.000Z',
      orderWithinTimestamp: 0,
      originalQuantity: '1',
      originalCostUsd: '100',
      remainingQuantity: '1',
    },
    {
      instrumentId: instrument.id,
      acquiredAt: '2024-12-31T00:00:00.000Z',
      orderWithinTimestamp: 0,
      originalQuantity: '1',
      originalCostUsd: '200',
      remainingQuantity: '1',
    },
  ];
  return {
    api,
    account,
    instrument,
    opening,
    lots,
    path: `/accounts/${account.id}/trade-journal/carry-in`,
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export async function fillLot(page: Page, index: number, lot: LotInput) {
  const group = page.getByRole('group', { name: `Лот ${index + 1}`, exact: true });
  await expect(group).toBeVisible();
  const instrument = group.getByRole('combobox', { name: 'Инструмент', exact: true });
  await expect(instrument).toBeEnabled();
  await expect(instrument.locator(`option[value="${lot.instrumentId}"]`)).toHaveCount(1);
  await instrument.selectOption(lot.instrumentId);
  await group.getByLabel('Дата и время приобретения (UTC)', { exact: true }).fill(lot.acquiredAt);
  await group
    .getByLabel('Порядок в этот момент', { exact: true })
    .fill(String(lot.orderWithinTimestamp));
  await group.getByLabel('Исходное количество', { exact: true }).fill(lot.originalQuantity);
  await group.getByLabel('Исходная стоимость, USD', { exact: true }).fill(lot.originalCostUsd);
  await group.getByLabel('Количество на начало учета', { exact: true }).fill(lot.remainingQuantity);
}

export function command(data: Fixture) {
  return {
    requestId: randomUUID(),
    expectedOpeningRevision: 1,
    lots: data.lots,
    assertReviewed: true,
  };
}

export const initializeButton = (page: Page) =>
  page.getByRole('button', {
    name: 'Начать журнал с начальными лотами',
    exact: true,
  });
export const retryButton = (page: Page) =>
  page.getByRole('button', {
    name: 'Повторить исходную инициализацию',
    exact: true,
  });

export async function fillAndPreview(page: Page, data: Fixture) {
  await fillLot(page, 0, data.lots[0]);
  await page.getByRole('button', { name: 'Добавить лот', exact: true }).click();
  await fillLot(page, 1, data.lots[1]);
  const response = await browserPost(page, `${data.path}/preview`, () =>
    page.getByRole('button', { name: 'Проверить начальные лоты', exact: true }).click(),
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    canInitialize: true,
    carryInCostUsd: '300',
    issues: [],
  });
  await page.getByRole('checkbox', { name: reviewLabel, exact: true }).check();
  await expect(initializeButton(page)).toBeEnabled();
}
