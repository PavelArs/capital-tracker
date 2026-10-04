import { expect } from '@playwright/test';
import {
  type CsvExecution,
  assertCommitted,
  csvFixture,
  emptySummary,
  inspectAndMap,
  previewInBrowser,
  readCsvReceipt,
  uploadInBrowser,
} from './csv-import-fixtures';
import { rows, uuid } from './manual-opening-fixtures';
import { test } from './mfa-fixtures';
import { browserPost } from './usd-trades-fixtures';

// The owner's Bybit purchase: 100000 RUB at the Bank of Russia rate 79.0246 RUB per USD.
const rubPurchase: CsvExecution = {
  source: 'TOKEN',
  side: 'buy',
  time: '2025-11-21T00:00:00Z',
  order: 0,
  quantity: '0.01',
  gross: '100000',
  fee: '0',
};
const usd = '1265.42873991';
const paid = 'Оплачено 100000 RUB, комиссия 0 RUB, курс 79.0246 RUB за 1 USD';

test('PCUR-UI: owner imports a RUB purchase at its rate and sees the paid amount next to USD after reload', async ({
  page,
}) => {
  const { account, instrument } = await csvFixture(page);
  await page.goto(`/manual-accounts/${account.id}`);
  await page.getByRole('combobox', { name: 'Вид операций', exact: true }).selectOption('imports');
  const batch = await uploadInBrowser(page, account.id, [rubPurchase]);
  await inspectAndMap(page, account.id, batch, instrument.id, [rubPurchase]);

  const mapping = page.getByRole('group', { name: 'Сопоставление колонок и значений', exact: true });
  const currency = mapping.getByRole('combobox', {
    name: 'Валюта оплаты для всего файла',
    exact: true,
  });
  await expect(currency).toHaveValue('USD');
  await currency.selectOption('RUB');
  await mapping
    .getByRole('textbox', { name: 'Курс: сколько RUB за 1 USD', exact: true })
    .fill('79.0246');
  await expect(
    mapping.getByRole('combobox', { name: 'Колонка: Валовая сумма в валюте оплаты', exact: true }),
  ).toHaveValue('5');
  // The USD attestation ticked by inspectAndMap no longer applies to RUB amounts.
  const attest = mapping.getByRole('checkbox', {
    name: 'Валовые суммы и комиссии выражены в валюте оплаты',
    exact: true,
  });
  await expect(attest).not.toBeChecked();
  await attest.check();

  await previewInBrowser(page, account.id, batch, {
    ...emptySummary,
    grossBuysUsd: usd,
    remainingCostUsd: usd,
  });
  const preview = page.getByRole('table', { name: 'Сделки перед импортом', exact: true });
  await expect(preview.getByRole('row').filter({ hasText: usd })).toContainText(paid);

  const accepted = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/confirm`,
    () => page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
  );
  expect(accepted.status()).toBe(201);
  assertCommitted(readCsvReceipt(await accepted.json()));
  expect(
    rows(
      `SELECT p.currency,p.gross::text AS gross,p.fee::text AS fee,p."perUsd"::text AS "perUsd",v."grossUsd"::text AS "grossUsd"
       FROM account_trade_version_payments p JOIN account_trade_versions v
       USING ("ownerId","accountId","tradeId",version) WHERE p."accountId"='${uuid(account.id)}'`,
    ),
  ).toEqual([
    {
      currency: 'RUB',
      gross: '100000.000000000000000000000000000000',
      fee: '0.000000000000000000000000000000',
      perUsd: '79.024600000000000000000000000000',
      grossUsd: '1265.428739910000000000000000000000',
    },
  ]);

  await page.reload();
  const journal = page.getByRole('table', { name: 'Сделки журнала', exact: true });
  const row = journal.getByRole('row').filter({ hasText: usd });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(paid);
});
