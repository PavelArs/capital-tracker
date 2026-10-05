import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { origin, test } from './mfa-fixtures';
import { tradeApi, tradeInput } from './usd-trades-fixtures';

// All names, amounts and prices are synthetic. The shared acceptance database holds other
// cases' assets too, so this case asserts its own uniquely named asset and account.
type AssetRow = {
  instrumentId: string;
  name: string;
  quantity: string;
  price: { value: string; status: string } | null;
  value: string | null;
  costBasis: string | null;
  averageBuyPrice: string | null;
  unrealizedPnl: string | null;
  unrealizedReturnPercent: string | null;
  realizedPnl: string | null;
  holdings: { accountId: string; quantity: string; value: string | null }[];
};

test('PORTFOLIO-UI: whole-portfolio value, cost basis and P&L of one asset across real accounts', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  expect((await request.get('/api/accounting/portfolio')).status()).toBe(401);

  const api = await tradeApi(page);
  const suffix = randomUUID().slice(0, 8);
  const accountName = `PORTFOLIO-UI account ${suffix}`;
  const assetName = `PORTFOLIO-UI coin ${suffix}`;
  const account = await api.account(accountName);
  await api.initialize(account.id);
  // A crypto ticker outside the market catalog is priced manually (asset-classification).
  const created = (await api.result('POST', '/instruments', 201, {
    requestId: randomUUID(),
    name: assetName,
    symbol: 'PVUI',
    assetType: 'crypto',
  })) as { id: string; priceSource: string };
  expect(created.priceSource).toBe('manual');
  // PV-BR11: buys totalling 1.2 for 66000 USD and a price of 80000.
  await api.create(account.id, tradeInput(created.id, 0, { quantity: '1', grossUsd: '50000' }));
  await api.create(
    account.id,
    tradeInput(created.id, 1, {
      occurredAt: '2025-01-03T00:00:00.000Z',
      quantity: '0.2',
      grossUsd: '16000',
    }),
  );
  await api.result('POST', `/instruments/${created.id}/usd-prices`, 201, {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: '2025-01-04T00:00:00.000Z',
    priceUsd: '80000',
    assertReviewed: true,
  });

  const valuation = (await api.result('GET', '/portfolio', 200)) as { assets: AssetRow[] };
  const asset = valuation.assets.find((item) => item.instrumentId === created.id);
  expect(asset).toMatchObject({
    name: assetName,
    quantity: '1.2',
    price: { value: '80000', status: 'manual' },
    value: '96000',
    costBasis: '66000',
    averageBuyPrice: '55000',
    unrealizedPnl: '30000',
    unrealizedReturnPercent: '45.45',
    realizedPnl: '0',
    holdings: [{ accountId: account.id, quantity: '1.2', value: '96000' }],
  });
  expect((await api.send('GET', '/portfolio?at=2025-01-01T00:00:00.000Z')).status()).toBe(400);

  await page.goto('/portfolio');
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { level: 1, name: 'Portfolio', exact: true }),
  ).toBeVisible();
  await expect(main.getByRole('region', { name: 'Portfolio summary' })).toContainText(
    'Current value',
  );
  const row = main.getByRole('row', { name: new RegExp(`^${assetName}`) });
  const cells = row.getByRole('cell');
  await expect(cells.nth(0)).toHaveText(`${assetName}PVUI · Crypto · USD`);
  await expect(cells.nth(1)).toHaveText('1.2');
  await expect(cells.nth(2)).toHaveText('$80,000.00Manual');
  await expect(cells.nth(3)).toHaveText('$96,000.00');
  await expect(cells.nth(5)).toHaveText('$55,000.00');
  await expect(cells.nth(6)).toHaveText('+$30,000.00+45.45%');
  // The manual price is the same as 24 hours ago (PV-24H).
  await expect(cells.nth(7)).toHaveText('0.00%');
  // SEARCH: the box next to the type filter finds the asset by its ticker.
  const search = main.getByRole('searchbox', { name: 'Search assets' });
  await search.fill('pvui');
  await expect(main.getByRole('row', { name: new RegExp(`^${assetName}`) })).toHaveCount(1);
  // Only the header row lacks the ticker while the search is on.
  await expect(main.getByRole('row').filter({ hasNotText: 'PVUI' })).toHaveCount(1);
  await search.fill('');

  const allocation = main.getByRole('region', { name: 'Allocation' });
  const grouping = allocation.getByRole('radiogroup', { name: 'Group allocation by' });
  await expect(allocation.getByRole('listitem').filter({ hasText: assetName })).toHaveCount(1);
  await grouping.getByRole('radio', { name: 'Type', exact: true }).check();
  await expect(
    allocation.getByRole('listitem').filter({ has: page.getByText('Crypto', { exact: true }) }),
  ).toHaveCount(1);
  await grouping.getByRole('radio', { name: 'Account', exact: true }).check();
  await expect(allocation.getByRole('listitem').filter({ hasText: accountName })).toContainText(
    '$96,000.00',
  );
  await page.screenshot({ path: testInfo.outputPath('portfolio-1440-dark.png'), fullPage: true });

  await row.getByRole('link', { name: assetName, exact: true }).click();
  await expect(page).toHaveURL(`${origin}/portfolio/${created.id}`);
  await expect(main.getByRole('heading', { level: 1, name: assetName })).toBeVisible();
  const position = main.getByRole('region', { name: 'Position' });
  for (const [label, value] of [
    ['Amount', '1.2 PVUI'],
    ['Current value', '$96,000.00'],
    ['Average buy price', '$55,000.00'],
    ['Cost basis', '$66,000.00'],
    ['Unrealized P&L', '+$30,000.00+45.45%'],
    ['Realized P&L', '$0.00'],
  ] as const) {
    await expect(
      position.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText(value);
  }
  await expect(main.getByText('Manual price set for Jan 4, 2025')).toBeVisible();
  await expect(main.locator('.portfolio-head__change')).toHaveText('0.00% today');
  // ASSET-CHART: value against cost basis from stored prices, with the asset's purchases.
  const chart = main.getByRole('region', { name: 'Position value over time' });
  await expect(
    chart.getByRole('img', {
      name: `${assetName} position value and cost basis, past month, in USD`,
    }),
  ).toBeVisible();
  await chart.getByRole('tab', { name: 'ALL', exact: true }).click();
  await expect(
    chart.getByRole('img', {
      name: `${assetName} position value and cost basis, since Jan 1, 2025, in USD`,
    }),
  ).toBeVisible();
  await expect(chart.locator('.dashboard-chart__deposit')).toHaveCount(2);
  const transactions = main.getByRole('region', { name: 'Transactions' });
  await expect(transactions.getByRole('listitem').filter({ hasText: accountName })).toHaveText([
    `BuyJan 3, 2025 · ${accountName}+0.2 PVUI$16,000.00`,
    `BuyJan 2, 2025 · ${accountName}+1 PVUI$50,000.00`,
  ]);
  await expect(transactions.getByRole('link', { name: 'Open in Transactions' })).toHaveAttribute(
    'href',
    '/transactions?asset=PVUI',
  );
  const holdings = main.getByRole('region', { name: 'Holdings' });
  await expect(holdings.getByRole('listitem')).toHaveText([`${accountName}1.2 PVUI$96,000.00`]);
  await expect(holdings.getByRole('link', { name: accountName })).toHaveAttribute(
    'href',
    `/manual-accounts/${account.id}`,
  );
  await page.screenshot({ path: testInfo.outputPath('asset-1440-dark.png'), fullPage: true });
  await main.getByRole('link', { name: '← Portfolio' }).click();
  await expect(page).toHaveURL(`${origin}/portfolio`);

  // ADD-ASSET-BALANCE: a deposit added with an amount and value holds that balance at once.
  const depositName = `PORTFOLIO-UI deposit ${suffix}`;
  await main.getByRole('button', { name: 'Add asset', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add asset' });
  await dialog.getByRole('radio', { name: 'Deposit', exact: true }).check();
  await dialog.getByLabel('Name', { exact: true }).fill(depositName);
  await dialog.getByLabel('Amount', { exact: true }).fill('2500');
  await dialog.getByLabel('Current value', { exact: true }).fill('3000');
  await dialog.getByLabel('Wallet or account').selectOption({ label: accountName });
  await dialog.getByLabel('Notes (optional)').fill('Synthetic opening balance');
  const saved = (path: RegExp) =>
    page.waitForResponse(
      (response) =>
        path.test(new URL(response.url()).pathname) && response.request().method() === 'POST',
    );
  const [assetSaved, trade, priced] = await Promise.all([
    saved(/^\/api\/accounting\/instruments$/),
    saved(/^\/api\/accounting\/accounts\/[^/]+\/trades$/),
    saved(/^\/api\/accounting\/instruments\/[^/]+\/usd-prices$/),
    dialog.getByRole('button', { name: 'Add asset', exact: true }).click(),
  ]);
  expect([assetSaved.status(), trade.status(), priced.status()]).toEqual([201, 201, 201]);
  expect(await trade.json()).toMatchObject({
    accountId: account.id,
    trade: {
      side: 'buy',
      quantity: '2500',
      grossUsd: '3000',
      comment: 'Synthetic opening balance',
    },
  });
  expect(await priced.json()).toMatchObject({ kind: 'set', priceUsd: '1.2' });
  await expect(dialog).toHaveCount(0);
  const depositCells = main
    .getByRole('row', { name: new RegExp(`^${depositName}`) })
    .getByRole('cell');
  await expect(depositCells.nth(0)).toHaveText(`${depositName}Manual · USD`);
  await expect(depositCells.nth(1)).toHaveText('2,500');
  await expect(depositCells.nth(2)).toHaveText('$1.20Manual');
  await expect(depositCells.nth(3)).toHaveText('$3,000.00');
  await expect(depositCells.nth(5)).toHaveText('$1.20');
  await page.screenshot({
    path: testInfo.outputPath('portfolio-added-1440-dark.png'),
    fullPage: true,
  });

  // PHONE-LIST: on a phone the table becomes two-line rows and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(main.getByRole('table')).toHaveCount(0);
  await main.getByRole('searchbox', { name: 'Search assets' }).fill(suffix);
  const phoneRow = main.getByRole('link', { name: new RegExp(`^${assetName}`) });
  await expect(phoneRow).toHaveText(`${assetName}$96,000.001.2 PVUI+$30,000.00 · +45.45%`);
  await main.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Name' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('portfolio-390-dark.png'), fullPage: true });
  await phoneRow.click();
  await expect(page).toHaveURL(`${origin}/portfolio/${created.id}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
