import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { test } from './mfa-fixtures';
import { tradeApi, tradeInput } from './usd-trades-fixtures';

// All names, amounts and dates are synthetic. The shared acceptance database holds other
// cases' operations too, so this case works in its own account and finds its own rows.
type Version = { version: number; kind: 'create' | 'correct' | 'void' };
type Listed = { id: string; type: string | null; quantity: string; account: { id: string } | null };

test('MANUAL-OPS-UI: add a buy without a journal, sell only what is available, delete with a guard', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });

  const api = await tradeApi(page);
  const suffix = randomUUID().slice(0, 8);
  const accountName = `MANUAL-OPS account ${suffix}`;
  const symbol = `MOPS${suffix}`;
  // No journal is opened first: the first trade starts it (OPS-ADD-BUY).
  const account = await api.account(accountName);
  const coin = (await api.result('POST', '/instruments', 201, {
    requestId: randomUUID(),
    name: `MANUAL-OPS coin ${suffix}`,
    symbol,
    assetType: 'crypto',
  })) as { id: string };
  const mine = async () =>
    ((await api.result('GET', '/operations', 200)) as { operations: Listed[] }).operations.filter(
      (operation) => operation.account?.id === account.id,
    );

  await page.goto('/transactions');
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { level: 1, name: 'Transactions', exact: true }),
  ).toBeVisible();
  const openDialog = async (name: string) => {
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog.getByRole('group', { name: 'Asset' })).toBeVisible();
    await dialog.getByRole('button', { name: symbol, exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Wallet or account' }).selectOption({
      label: accountName,
    });
    return dialog;
  };

  // OPS-ADD-BUY: Buy 1 coin for 80000 USD on 01.03.2025 in an account without a journal.
  await main.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const buy = await openDialog('Add transaction');
  await buy.getByLabel('Amount').fill('1');
  await buy.getByLabel('Date').fill('2025-03-01');
  await buy.getByLabel('Total paid').fill('80000');
  await expect(buy.getByText('Cost $80,000.00')).toBeVisible();
  await buy.getByRole('button', { name: 'Save transaction' }).click();
  await expect(buy).toHaveCount(0);
  const state = (await api.result('GET', `/accounts/${account.id}/trade-journal`, 200)) as {
    journal: { originKind: string; summary: { remainingCostUsd: string } } | null;
  };
  expect(state.journal?.originKind).toBe('declared-empty');
  expect(state.journal?.summary.remainingCostUsd).toBe('80000');
  const [bought] = await mine();
  expect([bought.type, bought.quantity]).toEqual(['buy', '1']);

  // A later sale of 0.8 on 01.05.2025 leaves 0.2 to sell on 01.04.2025 (OPS-OVERSPEND).
  await api.create(
    account.id,
    tradeInput(coin.id, 1, {
      side: 'sell',
      occurredAt: '2025-05-01T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '0.8',
      grossUsd: '76000',
    }),
  );
  await page.reload();
  await main.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const sell = await openDialog('Add transaction');
  await sell.getByRole('radio', { name: 'Sell' }).check();
  await sell.getByLabel('Date').fill('2025-04-01');
  // The balance on the date is looked up once the date field loses focus.
  await sell.getByLabel('Date').blur();
  await expect(
    sell.getByText(`Available in ${accountName}: 0.2 ${symbol} · Use all`),
  ).toBeVisible();
  await sell.getByLabel('Amount').fill('0.3');
  await sell.getByLabel('Amount').blur();
  await expect(sell.getByRole('alert')).toHaveText(
    `Only 0.2 ${symbol} is available in ${accountName} on Apr 1, 2025 · Use all`,
  );
  await sell.getByLabel('Total received').fill('17000');
  await page.screenshot({ path: testInfo.outputPath('manual-ops-overspend-1440-dark.png') });
  await sell.getByRole('button', { name: 'Save transaction' }).click();
  await expect(sell).toBeVisible();
  expect(await mine()).toHaveLength(2);
  await sell.getByRole('button', { name: 'Use all' }).click();
  await expect(sell.getByLabel('Amount')).toHaveValue('0.2');
  await expect(sell.getByRole('alert')).toHaveCount(0);
  await sell.getByRole('button', { name: 'Save transaction' }).click();
  await expect(sell).toHaveCount(0);

  const table = main.getByRole('table', { name: 'Transactions', exact: true });
  // Day headings are rows of their own; operations are the other rows.
  const rows = table.locator('tbody tr:not(.transactions-day)');
  await main.getByRole('combobox', { name: 'Account', exact: true }).selectOption({
    label: accountName,
  });
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1).getByRole('cell').nth(1)).toHaveText(symbol);
  await expect(rows.nth(1).getByRole('cell').nth(2)).toHaveText('-0.2');

  // OPS-DELETE-GUARD: the purchase the sales spend cannot be deleted, and nothing changes.
  await rows.nth(2).getByRole('button', { name: 'Buy' }).click();
  const drawer = page.getByRole('dialog', { name: `Buy · ${symbol}` });
  await drawer.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this transaction?' });
  await expect(confirm).toContainText(`Buy of 1 ${symbol} on Mar 1, 2025 in ${accountName}`);
  await confirm.getByRole('button', { name: 'Delete transaction' }).click();
  const refusal = page.getByRole('alertdialog', { name: "This purchase can't be deleted" });
  await expect(refusal).toHaveText(
    new RegExp(
      `Sell of 0\\.2 ${symbol} on Apr 1, 2025 in ${accountName} spends these ${symbol}\\. ` +
        `Without this purchase ${accountName} would not hold enough\\. Delete or change that transaction first\\.`,
    ),
  );
  await page.screenshot({ path: testInfo.outputPath('manual-ops-delete-guard-1440-dark.png') });
  await refusal.getByRole('button', { name: 'OK' }).click();
  await expect(refusal).toHaveCount(0);
  expect(await mine()).toHaveLength(3);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // OPS-DELETE: the 01.04.2025 sale goes after confirming; its history keeps the void.
  const smallSale = (await mine()).find((operation) => operation.quantity === '0.2');
  expect(smallSale?.type).toBe('sell');
  await rows.nth(1).getByRole('button', { name: 'Sell' }).click();
  const sale = page.getByRole('dialog', { name: `Sell · ${symbol}` });
  await sale.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this transaction?' })
    .getByRole('button', { name: 'Delete transaction' })
    .click();
  await expect(sale).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  const left = await mine();
  expect(left.map((operation) => [operation.type, operation.quantity])).toEqual([
    ['sell', '0.8'],
    ['buy', '1'],
  ]);
  const tradeId = smallSale?.id.replace(/^trade:/, '');
  const versions = (await api.result(
    'GET',
    `/accounts/${account.id}/trades/${tradeId}/versions`,
    200,
  )) as { items: Version[] };
  expect(versions.items.map(({ version, kind }) => [version, kind])).toEqual([
    [2, 'void'],
    [1, 'create'],
  ]);
  expect(errors).toEqual([]);
});
