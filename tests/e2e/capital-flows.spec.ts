import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { origin, test } from './mfa-fixtures';
import { tradeApi, tradeInput } from './usd-trades-fixtures';

// All names, amounts and prices are synthetic. The shared acceptance database holds other
// cases' operations too, so this case checks what its own buy and sale add to the month's
// flows and that the dashboard shows exactly the split the backend returned.
type Point = { at: string; value: string | null; complete: boolean; invested: string | null };
type History = {
  period: string;
  currency: string;
  at: string;
  value: string | null;
  change: string | null;
  invested: string | null;
  profit: string | null;
  profitPercent: string | null;
  deposits: string | null;
  withdrawals: string | null;
  netFlow: string | null;
  marketEffect: string | null;
  marketReturnPercent: string | null;
  points: Point[];
};

const DAY = 86_400_000;

// The dashboard's own display rule: two decimals, a currency symbol, a dash when unknown.
function money(value: string | null, signed = false): string {
  if (value === null) return '—';
  const amount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(Number(value)));
  const negative = value.startsWith('-') && Number(value) !== 0;
  return `${negative ? '-' : signed && Number(value) > 0 ? '+' : ''}$${amount}`;
}

// Exact decimal arithmetic (no floating point).
const SCALE = 30;
function scaled(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const digits = BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -digits : digits;
}
function decimal(atoms: bigint): string {
  const sign = atoms < 0n ? '-' : '';
  const digits = (atoms < 0n ? -atoms : atoms).toString().padStart(SCALE + 1, '0');
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return `${sign}${digits.slice(0, -SCALE)}${fraction ? `.${fraction}` : ''}`;
}
const minus = (left: string, right: string) => decimal(scaled(left) - scaled(right));

const midnight = (ms: number) => Math.floor(ms / DAY) * DAY;
const iso = (ms: number) => new Date(ms).toISOString();

test('FLOW-SPLIT-UI: dashboard splits the change into market and net deposits with a net invested line', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });

  const api = await tradeApi(page);
  const history = async (query: string) =>
    (await api.result('GET', `/portfolio/history?${query}`, 200)) as History;
  const before = await history('period=1M&currency=USD');

  // A buy paid from outside 10 days ago deposits gross plus fee; a sale 5 days ago withdraws
  // its proceeds net of fee (section 2, until cash positions arrive with M9).
  const today = midnight(Date.now());
  const bought = today - 10 * DAY + 10 * 3_600_000;
  const sold = today - 5 * DAY + 10 * 3_600_000;
  const suffix = randomUUID().slice(0, 8);
  const account = await api.account(`FLOW-SPLIT account ${suffix}`);
  await api.initialize(account.id);
  const coin = (await api.result('POST', '/instruments', 201, {
    requestId: randomUUID(),
    name: `FLOW-SPLIT coin ${suffix}`,
    symbol: 'FLWS',
    assetType: 'crypto',
  })) as { id: string };
  await api.result('POST', `/instruments/${coin.id}/usd-prices`, 201, {
    requestId: randomUUID(),
    expectedRevision: 0,
    observedAt: iso(today - 12 * DAY),
    priceUsd: '1000',
    assertReviewed: true,
  });
  await api.create(
    account.id,
    tradeInput(coin.id, 0, {
      occurredAt: iso(bought),
      quantity: '1',
      grossUsd: '800',
      feeUsd: '2',
    }),
  );
  await api.create(
    account.id,
    tradeInput(coin.id, 1, {
      side: 'sell',
      occurredAt: iso(sold),
      quantity: '0.25',
      grossUsd: '300',
      feeUsd: '0',
    }),
  );

  const after = await history('period=1M&currency=USD');
  expect(minus(after.deposits ?? '0', before.deposits ?? '0')).toBe('802');
  expect(minus(after.withdrawals ?? '0', before.withdrawals ?? '0')).toBe('300');
  expect(minus(after.netFlow ?? '0', before.netFlow ?? '0')).toBe('502');
  // marketEffect = V1 − V0 − netFlow and the two parts add up to the change.
  const start = after.points.find((point) => point.value !== null);
  expect(after.marketEffect).toBe(
    minus(minus(after.value ?? '0', start?.value ?? '0'), after.netFlow ?? '0'),
  );
  expect(decimal(scaled(after.marketEffect ?? '0') + scaled(after.netFlow ?? '0'))).toBe(
    after.change,
  );
  // Profit or loss to date is net worth minus all-time net invested, the same in every period.
  expect(after.profit).toBe(minus(after.value ?? '0', after.invested ?? '0'));
  const year = await history('period=1Y&currency=USD');
  expect(year.invested).toBe(after.invested);
  expect(year.profit).toBe(minus(year.value ?? '0', year.invested ?? '0'));
  // Net invested steps up by the deposit after the buy and down by the sale after it.
  const invested = (body: History, at: number) =>
    body.points.find((point) => point.at === iso(at))?.invested ?? null;
  for (const [at, added] of [
    [today - 11 * DAY, '0'],
    [today - 9 * DAY, '802'],
    [today - 4 * DAY, '502'],
  ] as const) {
    const was = invested(before, at);
    const now = invested(after, at);
    expect(was, `${iso(at)} had net invested`).not.toBeNull();
    expect(minus(now ?? '0', was ?? '0'), iso(at)).toBe(added);
  }

  const first = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/accounting/portfolio/history' &&
      url.searchParams.get('period') === '1M'
    );
  });
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/dashboard`);
  const shown = (await (await first).json()) as History;
  const main = page.getByRole('main');
  const hero = main.getByRole('region', { name: 'Net worth' });
  const profit = hero.getByLabel('Profit or loss to date');
  await expect(profit).toContainText(money(shown.profit, true));
  if (shown.profitPercent !== null)
    await expect(profit).toContainText(
      `${Number(shown.profitPercent) > 0 ? '+' : ''}${shown.profitPercent}%`,
    );
  await expect(profit).toContainText(`on ${money(shown.invested)} net invested`);
  const split = hero.getByLabel('What changed');
  await expect(split).toContainText('Past month');
  await expect(split).toContainText(`Market${money(shown.marketEffect, true)}`);
  if (shown.marketReturnPercent !== null)
    await expect(split).toContainText(
      `${Number(shown.marketReturnPercent) > 0 ? '+' : ''}${shown.marketReturnPercent}%`,
    );
  await expect(split).toContainText(`Net deposits${money(shown.netFlow, true)}`);

  const chart = main.getByRole('region', { name: 'Portfolio value over time' });
  await expect(chart.getByLabel('Chart legend')).toHaveText('Portfolio valueNet investedDeposit');
  const plot = chart.getByRole('group');
  await plot.focus();
  await page.keyboard.press('End');
  const tip = chart.getByRole('status');
  await expect(tip).toContainText('Now');
  await expect(tip).toContainText(`Net invested${money(shown.invested)}`);
  await page.screenshot({
    path: testInfo.outputPath('dashboard-flows-1440-dark.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
