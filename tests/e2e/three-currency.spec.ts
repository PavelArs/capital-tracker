import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { loginWithMfa, origin, query, test } from './mfa-fixtures';
import { tradeApi, tradeInput } from './usd-trades-fixtures';

// All names, amounts and rates are synthetic. Bank of Russia rates are the external
// provider's data, so they are stored as the collector would store them; everything else
// goes through the real backend, PostgreSQL and the browser.
type AssetRow = {
  instrumentId: string;
  value: string | null;
  costBasis: string | null;
  unrealizedPnl: string | null;
  price: { value: string } | null;
};
type Report = { currency: string; mainCurrency: string; assets: AssetRow[] };

const rates = [
  // Cost date: 80 RUB per USD, 100 RUB per EUR. Today: 92 and 100, so 0.92 EUR per USD.
  ['USD', '2025-01-01', '80'],
  ['EUR', '2025-01-01', '100'],
  ['USD', '2026-01-01', '92'],
  ['EUR', '2026-01-01', '100'],
] as const;

test('CURRENCY-UI: main currency EUR persists after logout and values come from Bank of Russia rates', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  expect((await request.get('/api/owner-settings')).status()).toBe(401);
  expect((await request.get('/api/fx-rates')).status()).toBe(401);

  query(`INSERT INTO fx_rates (currency, source, "rateDate", "rubPerUnit") VALUES
    ${rates.map(([currency, date, rate]) => `('${currency}', 'cbr', '${date}', ${rate})`).join(', ')}
    ON CONFLICT DO NOTHING`);
  expect(
    query(`SELECT string_agg(currency || ' ' || "rateDate" || ' ' || "rubPerUnit"::numeric(10,2), ', '
      ORDER BY "rateDate", currency) FROM fx_rates WHERE source = 'cbr'`),
    'Only this case stores rates in the acceptance database',
  ).toBe(
    'EUR 2025-01-01 100.00, USD 2025-01-01 80.00, EUR 2026-01-01 100.00, USD 2026-01-01 92.00',
  );

  const api = await tradeApi(page);
  const headers = { Origin: origin, 'X-CSRF-Token': api.csrfToken };
  const settings = page.context().request;
  try {
    expect(await (await settings.get('/api/owner-settings')).json()).toEqual({ mainCurrency: 'USD' });
    expect(
      (await settings.put('/api/owner-settings', { data: { mainCurrency: 'GBP' }, headers })).status(),
    ).toBe(400);
    expect(
      (await settings.put('/api/owner-settings', { data: { mainCurrency: 'EUR' } })).status(),
      'A setting change needs the CSRF token',
    ).toBe(403);

    const suffix = randomUUID().slice(0, 8);
    const accountName = `CURRENCY-UI account ${suffix}`;
    const assetName = `CURRENCY-UI coin ${suffix}`;
    const account = await api.account(accountName);
    await api.initialize(account.id);
    const created = (await api.result('POST', '/instruments', 201, {
      requestId: randomUUID(),
      name: assetName,
      symbol: 'CRUI',
      assetType: 'crypto',
    })) as { id: string };
    await api.create(
      account.id,
      tradeInput(created.id, 0, {
        occurredAt: '2025-01-02T00:00:00.000Z',
        quantity: '1',
        grossUsd: '800',
      }),
    );
    await api.result('POST', `/instruments/${created.id}/usd-prices`, 201, {
      requestId: randomUUID(),
      expectedRevision: 0,
      observedAt: '2025-01-03T00:00:00.000Z',
      priceUsd: '1000',
      assertReviewed: true,
    });
    const asset = async (currency: string) => {
      const report = (await api.result('GET', `/portfolio?currency=${currency}`, 200)) as Report;
      expect(report.currency).toBe(currency);
      return report.assets.find((item) => item.instrumentId === created.id);
    };
    // CUR-PNL-RUB style: cost at the purchase date's rate, value at today's.
    expect(await asset('USD')).toMatchObject({ value: '1000', costBasis: '800', unrealizedPnl: '200' });
    expect(await asset('EUR')).toMatchObject({
      price: { value: '920' },
      value: '920',
      costBasis: '640',
      unrealizedPnl: '280',
    });
    expect(await asset('RUB')).toMatchObject({ value: '92000', costBasis: '64000', unrealizedPnl: '28000' });
    expect((await api.send('GET', '/portfolio?currency=GBP')).status()).toBe(400);

    // CUR-SWITCH: choose EUR in Settings.
    await page.goto('/preferences');
    const main = page.getByRole('main');
    const currency = main.getByRole('radiogroup', { name: 'Main currency' });
    await expect(currency.getByRole('radio', { name: 'USD' })).toBeChecked();
    await expect(
      main.getByText('Bank of Russia: 1 USD = 92.00 RUB (Jan 1, 2026), 1 EUR = 100.00 RUB (Jan 1, 2026).'),
    ).toBeVisible();
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/owner-settings' &&
        response.request().method() === 'PUT',
    );
    await currency.getByRole('radio', { name: 'EUR' }).check();
    expect((await saved).status()).toBe(200);
    await expect(currency.getByRole('radio', { name: 'EUR' })).toBeChecked();

    // The choice belongs to the owner, not the browser session.
    await page.getByRole('navigation').getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/login`);
    expect((await request.get('/api/owner-settings')).status()).toBe(401);
    await loginWithMfa(page);
    await page.goto('/portfolio');
    await expect(main.getByRole('heading', { level: 1, name: 'Portfolio', exact: true })).toBeVisible();
    const switcher = main.getByRole('radiogroup', { name: 'Currency' });
    await expect(switcher.getByRole('radio', { name: 'EUR' })).toBeChecked();
    const row = main.getByRole('row', { name: new RegExp(`^${assetName}`) });
    const cells = row.getByRole('cell');
    await expect(cells.nth(2)).toHaveText('€920.00Manual');
    await expect(cells.nth(3)).toHaveText('€920.00');
    await expect(cells.nth(5)).toHaveText('€640.00');
    await expect(cells.nth(6)).toHaveText('+€280.00+43.75%');
    await expect(main.getByText(/1 USD = 92\.00 RUB \(Jan 1, 2026\), 1 EUR = 100\.00 RUB/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('portfolio-eur-1440-dark.png'), fullPage: true });

    // The other two currencies stay one click away.
    await switcher.getByRole('radio', { name: 'RUB' }).check();
    await expect(page).toHaveURL(`${origin}/portfolio?currency=RUB`);
    await expect(cells.nth(3)).toHaveText('₽92,000.00');
    await expect(cells.nth(6)).toHaveText('+₽28,000.00+43.75%');
    await row.getByRole('link', { name: assetName, exact: true }).click();
    await expect(page).toHaveURL(`${origin}/portfolio/${created.id}?currency=RUB`);
    const position = main.getByRole('region', { name: 'Position' });
    for (const [label, value] of [
      ['Current value', '₽92,000.00'],
      ['Cost basis', '₽64,000.00'],
      ['Unrealized P&L', '+₽28,000.00+43.75%'],
    ] as const) {
      await expect(
        position.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]'),
      ).toHaveText(value);
    }
    await page.screenshot({ path: testInfo.outputPath('asset-rub-1440-dark.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    // Later cases expect the default main currency.
    const reset = await page.context().request.put('/api/owner-settings', {
      data: { mainCurrency: 'USD' },
      headers: { Origin: origin, 'X-CSRF-Token': await csrf(page) },
    });
    expect(reset.status()).toBe(200);
  }
});

async function csrf(page: import('@playwright/test').Page): Promise<string> {
  const response = await page.context().request.get('/api/auth/csrf');
  expect(response.status()).toBe(200);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}
