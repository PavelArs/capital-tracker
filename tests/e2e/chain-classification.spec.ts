import { createHash, randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { compose, origin, test } from './mfa-fixtures';
import { tradeApi } from './usd-trades-fixtures';

// All names, amounts and the address are synthetic; no other case uses this address. The
// shared acceptance database holds other cases' rows too, so this case filters by its wallet.
const address = 'bc1q4ccg8xlwyzyfuk3qy59gqt40tlt0dv6lv5xyc2';
// providers.cjs transaction 0 receives 100000 sats; transaction 1 spends 57001 and gets
// 5701 back (fee 300), so 0.000513 BTC leave the address.
const txid = (i: number) => createHash('sha256').update(`ct-e2e-tx:${address}:${i}`).digest('hex');

type ListedOperation = {
  type: string | null;
  quantity: string;
  valueUsd: string | null;
  status: string;
  account: { id: string } | null;
  chain: { txid: string } | null;
};

function bitcoinHistory(body: Record<string, unknown>): void {
  compose([
    'exec',
    '-T',
    'providers',
    'node',
    '-e',
    `fetch('http://127.0.0.1:8080/__control/bitcoin-history', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })
      .then((response) => { if (!response.ok) process.exitCode = 1; }).catch(() => { process.exitCode = 1; });`,
  ]);
}
const cells = (row: Locator) => row.getByRole('cell');

test('CLS-UI: owner classifies a blockchain receipt as a buy, hides a payment, and both survive a resync', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });

  const api = await tradeApi(page);
  const headers = { Origin: origin, 'X-CSRF-Token': api.csrfToken };
  const accountName = `CLS-UI wallet ${randomUUID().slice(0, 8)}`;
  const account = await api.account(accountName);
  bitcoinHistory({ address, count: 2 });
  const registered = await api.request.post('/api/wallet-addresses', {
    data: { address, accountId: account.id, label: 'Savings' },
    headers,
  });
  expect(registered.status()).toBe(201);
  const wallet = (await registered.json()) as { id: string };
  const sync = async () =>
    expect(
      (await api.request.post(`/api/wallet-addresses/${wallet.id}/sync`, { headers })).status(),
    ).toBe(200);
  await sync();
  const waiting = async () =>
    (
      (await (
        await api.request.get('/api/accounting/chain-transactions/needs-classification')
      ).json()) as { count: number }
    ).count;
  const before = await waiting();
  expect(before).toBeGreaterThanOrEqual(2);
  const mine = async () =>
    ((await api.result('GET', '/operations', 200)) as { operations: ListedOperation[] }).operations
      .filter((operation) => operation.account?.id === account.id)
      .map((operation) => [
        operation.chain?.txid,
        operation.type,
        operation.quantity,
        operation.valueUsd,
        operation.status,
      ]);
  expect(await mine()).toEqual([
    [txid(1), null, '0.000513', null, 'needs-classification'],
    [txid(0), null, '0.001', null, 'needs-classification'],
  ]);

  // CLS-COUNT: the sidebar counts what waits; the Dashboard says so and links to it.
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByLabel(`${before} to classify`, { exact: true })).toBeVisible();
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention).toContainText(`${before} blockchain transactions need classification`);
  await attention.getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL(/\/transactions\?status=needs-classification/);

  const main = page.getByRole('main');
  const table = main.getByRole('table', { name: 'Transactions', exact: true });
  const rows = table.locator('tbody tr:not(.transactions-day)');
  await main.getByRole('combobox', { name: 'Account', exact: true }).selectOption({
    label: accountName,
  });
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole('button', { name: 'Incoming' }).click();
  const drawer = page.getByRole('dialog', { name: 'Incoming transaction · BTC' });
  const question = drawer.getByRole('group', { name: 'What was this transaction?' });
  await expect(question.getByRole('button')).toHaveText([
    'Buy',
    'Income',
    'Reward',
    'Staking reward',
    'Airdrop',
    'Gift received',
  ]);
  await expect(drawer.getByText(`${before - 1} left to classify`)).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Save' })).toBeDisabled();

  // CLS-BUY: bought for 1000 USDT; only the fields a buy needs appear.
  await question.getByRole('button', { name: 'Buy' }).click();
  await drawer.getByLabel('You paid').fill('1000');
  await expect(drawer.getByRole('radio', { name: 'USDT' })).toBeChecked();
  await drawer.getByText('More options').click();
  await drawer.getByLabel('Comment').fill('From the exchange');
  await page.screenshot({ path: testInfo.outputPath('classify-buy-1440-dark.png') });
  await drawer.getByRole('button', { name: 'Save' }).click();

  // The next transaction of this wallet opens at once.
  const next = page.getByRole('dialog', { name: 'Outgoing transaction · BTC' });
  await expect(next.getByRole('status')).toHaveText('Saved as Buy. Here is the next one.');
  await expect(
    next.getByRole('group', { name: 'What was this transaction?' }).getByRole('button'),
  ).toHaveText(['Sell', 'Expense', 'Gift sent', 'Fee']);
  await expect(nav.getByLabel(`${before - 1} to classify`, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('classify-next-1440-dark.png') });

  // CLS-HIDE: a payment that should not count is hidden without a type.
  await next.getByText('More options').click();
  await next.getByText('Hide from calculations').click();
  await next.getByRole('button', { name: 'Save' }).click();
  await expect(next).toHaveCount(0);
  // The wallet is done; other cases' transactions may still wait elsewhere.
  await expect(
    main.getByText(
      /^(Hidden from calculations\. Nothing else to classify here\.|All transactions classified\. The last one was hidden\.)$/,
    ),
  ).toBeVisible();
  expect(await waiting()).toBe(before - 2);

  await main.getByRole('button', { name: /^All/ }).click();
  await expect(rows).toHaveCount(2);
  await expect(cells(rows.nth(0))).toHaveText([
    'Outgoing22:23',
    'BTC',
    '-0.000513',
    /^(≈ \$[\d,]+\.\d{2}|—)$/,
    new RegExp(`^${accountName}`),
    'Hidden',
    'Blockchain',
  ]);
  await expect(cells(rows.nth(1))).toHaveText([
    'Buy22:13',
    'BTC',
    '+0.001',
    '$1,000.00',
    new RegExp(`^${accountName}`),
    'Recorded',
    'Blockchain',
  ]);
  await page.screenshot({ path: testInfo.outputPath('classified-list-1440-dark.png') });

  // CLS-RESYNC: the raw rows are fetched again; both answers stay, nothing is listed twice.
  bitcoinHistory({ address, count: 2 });
  await sync();
  expect(await mine()).toEqual([
    [txid(1), null, '0.000513', null, 'hidden'],
    [txid(0), 'buy', '0.001', '1000', 'recorded'],
  ]);

  // CLS-RECLASSIFY: the buy was income after all; the drawer starts from the saved answer.
  await page.reload();
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole('button', { name: 'Buy' }).click();
  const bought = page.getByRole('dialog', { name: 'Buy · BTC' });
  await expect(
    bought.getByText('Comment', { exact: true }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('From the exchange');
  await bought.getByRole('button', { name: 'Change classification' }).click();
  await expect(bought.getByRole('button', { name: 'Buy' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bought.getByLabel('You paid')).toHaveValue('1000');
  await bought.getByRole('button', { name: 'Income' }).click();
  await bought.getByLabel('Value at the time').fill('900');
  await bought.getByRole('button', { name: 'Save' }).click();
  const income = page.getByRole('dialog', { name: 'Income · BTC' });
  await expect(income.getByRole('status')).toHaveText('Saved as Income.');
  await page.keyboard.press('Escape');
  await expect(cells(rows.nth(1)).nth(3)).toHaveText('$900.00');
  expect(await mine()).toEqual([
    [txid(1), null, '0.000513', null, 'hidden'],
    [txid(0), 'income', '0.001', '900', 'recorded'],
  ]);

  // Phones: the same rows as two-line items, without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  const phoneList = main.getByRole('list', { name: 'Transactions', exact: true });
  await expect(phoneList.getByRole('button')).toHaveCount(2);
  await expect(phoneList.getByRole('button').nth(0)).toContainText('Hidden · ');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('classified-list-390-dark.png') });
  expect(errors).toEqual([]);
});
