import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { origin, test } from './mfa-fixtures';
import { tradeApi, tradeInput } from './usd-trades-fixtures';

// All names, amounts and prices are synthetic. The shared acceptance database holds other
// cases' holdings too, so this case checks what its own backdated buy adds to the history
// and that the dashboard shows exactly what the backend returned.
type Point = { at: string; value: string | null; complete: boolean };
type History = {
  period: string;
  currency: string;
  mainCurrency: string;
  from: string;
  at: string;
  value: string | null;
  complete: boolean;
  change: string | null;
  changePercent: string | null;
  profit: string | null;
  points: Point[];
};

const periods = ['24H', '7D', '1M', '3M', '1Y', 'ALL'] as const;
const symbols: Record<string, string> = { USD: '$', EUR: '€', RUB: '₽' };
const DAY = 86_400_000;

// The dashboard's own display rule: two decimals, a currency symbol, a dash when unknown.
function money(value: string | null, currency: string): string {
  if (value === null) return '—';
  const amount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(Number(value)));
  return `${value.startsWith('-') && Number(value) !== 0 ? '-' : ''}${symbols[currency]}${amount}`;
}

// Exact difference of two decimal strings (no floating point).
function difference(after: string, before: string): string {
  const scale = 30;
  const scaled = (value: string) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = value.replace('-', '').split('.');
    const digits = BigInt(whole + fraction.padEnd(scale, '0').slice(0, scale));
    return negative ? -digits : digits;
  };
  const delta = scaled(after) - scaled(before);
  const sign = delta < 0n ? '-' : '';
  const digits = (delta < 0n ? -delta : delta).toString().padStart(scale + 1, '0');
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return `${sign}${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ''}`;
}

function historyResponse(page: Page, period: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/accounting/portfolio/history' &&
      url.searchParams.get('period') === period
    );
  });
}

test('CHART-PERIODS: dashboard net worth and capital chart from snapshots rebuilt after a backdated buy', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  expect((await request.get('/api/accounting/portfolio/history')).status()).toBe(401);

  const api = await tradeApi(page);
  const history = async (query: string) =>
    (await api.result('GET', `/portfolio/history?${query}`, 200)) as History;
  expect((await api.send('GET', '/portfolio/history?period=5Y')).status()).toBe(400);
  expect((await api.send('GET', '/portfolio/history?currency=GBP')).status()).toBe(400);
  expect((await api.send('GET', '/portfolio/history?period=1M&owner=x')).status()).toBe(400);

  // SNAP-BACKFILL: ALL is daily from Jan 1, 2025, and the default period is one month.
  const before = await history('period=ALL&currency=USD');
  expect(before.points[0].at).toBe('2025-01-01T00:00:00.000Z');
  const day = (at: string) => before.points.findIndex((point) => point.at === at);
  const probe = day('2025-01-05T00:00:00.000Z');
  expect(probe).toBe(4);
  expect(before.points.at(-1)?.at).toBe(before.at);
  expect((await history('currency=USD')).period).toBe('1M');

  // SNAP-REBUILD: a buy dated 2025-01-02 and a price from 2025-01-03 rebuild later snapshots.
  const suffix = randomUUID().slice(0, 8);
  const account = await api.account(`CHART-PERIODS account ${suffix}`);
  await api.initialize(account.id);
  const created = (await api.result('POST', '/instruments', 201, {
    requestId: randomUUID(),
    name: `CHART-PERIODS coin ${suffix}`,
    symbol: 'CHPD',
    assetType: 'crypto',
  })) as { id: string };
  await api.create(account.id, tradeInput(created.id, 0, { quantity: '1', grossUsd: '800' }));
  await api.result('POST', `/instruments/${created.id}/usd-prices`, 201, {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: '2025-01-03T00:00:00.000Z',
    priceUsd: '1000',
    assertReviewed: true,
  });
  const after = await history('period=ALL&currency=USD');
  for (const [at, added] of [
    ['2025-01-01T00:00:00.000Z', '0'],
    ['2025-01-05T00:00:00.000Z', '1000'],
  ] as const) {
    const was = before.points.find((point) => point.at === at)?.value;
    const now = after.points.find((point) => point.at === at)?.value;
    expect(was, `${at} had a value`).not.toBeNull();
    expect(difference(now ?? '0', was ?? '0'), `${at} rebuilt`).toBe(added);
  }

  // DASH-MAIN: the dashboard opens on one month and shows exactly what the backend returned.
  const first = historyResponse(page, '1M');
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/dashboard`);
  const shown = (await (await first).json()) as History;
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  const hero = main.getByRole('region', { name: 'Net worth' });
  await expect(hero.getByText('Total net worth · USD')).toBeVisible();
  await expect(hero.getByText(money(shown.value, 'USD'), { exact: true })).toBeVisible();
  // Profit or loss to date sits under the net worth; the period's split below names the month.
  await expect(hero.getByLabel('Profit or loss to date')).toContainText(
    money(shown.profit, 'USD').replace(/^(?=[$])/, Number(shown.profit) > 0 ? '+' : ''),
  );
  await expect(hero.getByLabel('What changed')).toContainText('Past month');
  await expect(page.getByText(/not built yet/i)).toHaveCount(0);
  const chart = main.getByRole('region', { name: 'Portfolio value over time' });
  const tabs = chart.getByRole('tablist', { name: 'Chart period' });
  await expect(tabs.getByRole('tab', { name: '1M' })).toHaveAttribute('aria-selected', 'true');
  expect(Date.parse(shown.at) - Date.parse(shown.from)).toBe(30 * DAY);
  await page.screenshot({
    path: testInfo.outputPath('dashboard-1m-1440-dark.png'),
    fullPage: true,
  });

  // CHART-PERIODS: each period asks the backend once and keeps its points inside the period.
  for (const period of periods) {
    const reply = historyResponse(page, period);
    await tabs.getByRole('tab', { name: period }).click();
    const body = (await (await reply).json()) as History;
    expect(body.period).toBe(period);
    expect(body.currency).toBe('USD');
    await expect(tabs.getByRole('tab', { name: period })).toHaveAttribute('aria-selected', 'true');
    expect(body.points.length).toBeGreaterThan(0);
    for (const point of body.points)
      expect(Date.parse(point.at)).toBeGreaterThanOrEqual(Date.parse(body.from));
    expect(body.points.at(-1)?.at).toBe(body.at);
    await expect(hero.getByText(money(body.value, 'USD'), { exact: true })).toBeVisible();
  }

  // ALL starts on Jan 1, 2025 and the keyboard reads each point with its date and value.
  const all = (await history('period=ALL&currency=USD')).points;
  const plot = chart.getByRole('group');
  await plot.focus();
  await page.keyboard.press('Home');
  const firstValued = all.find((point) => point.value !== null);
  const tip = chart.getByRole('status');
  await expect(tip).toContainText(
    new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(firstValued?.at ?? '')),
  );
  await expect(tip).toContainText(money(firstValued?.value ?? null, 'USD'));
  await page.keyboard.press('End');
  await expect(tip).toContainText('Now');
  await page.screenshot({ path: testInfo.outputPath('dashboard-all-tooltip-1440-dark.png') });
  await page.keyboard.press('Escape');
  await expect(chart.getByRole('status')).toHaveCount(0);

  // The currency choice stays in the address and asks the backend for that currency.
  const euro = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounting/portfolio/history' &&
      new URL(response.url()).searchParams.get('currency') === 'EUR',
  );
  await main
    .getByRole('radiogroup', { name: 'Currency' })
    .getByRole('radio', { name: 'EUR' })
    .check();
  expect(((await (await euro).json()) as History).currency).toBe('EUR');
  await expect(page).toHaveURL(`${origin}/dashboard?currency=EUR`);
  await expect(hero.getByText('Total net worth · EUR')).toBeVisible();
  expect(errors).toEqual([]);
});
