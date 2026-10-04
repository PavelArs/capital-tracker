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
  price: { priceUsd: string; status: string } | null;
  valueUsd: string | null;
  costBasisUsd: string | null;
  averageBuyPriceUsd: string | null;
  unrealizedPnlUsd: string | null;
  unrealizedReturnPercent: string | null;
  realizedPnlUsd: string | null;
  holdings: { accountId: string; quantity: string; valueUsd: string | null }[];
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
    price: { priceUsd: '80000', status: 'manual' },
    valueUsd: '96000',
    costBasisUsd: '66000',
    averageBuyPriceUsd: '55000',
    unrealizedPnlUsd: '30000',
    unrealizedReturnPercent: '45.45',
    realizedPnlUsd: '0',
    holdings: [{ accountId: account.id, quantity: '1.2', valueUsd: '96000' }],
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
  const holdings = main.getByRole('region', { name: 'Holdings' });
  await expect(holdings.getByRole('listitem')).toHaveText([`${accountName}1.2 PVUI$96,000.00`]);
  await expect(holdings.getByRole('link', { name: accountName })).toHaveAttribute(
    'href',
    `/manual-accounts/${account.id}`,
  );
  await page.screenshot({ path: testInfo.outputPath('asset-1440-dark.png'), fullPage: true });
  await main.getByRole('link', { name: '← Portfolio' }).click();
  await expect(page).toHaveURL(`${origin}/portfolio`);
  expect(errors).toEqual([]);
});
