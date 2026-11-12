import type { AssetHistoryPoint } from '@api/asset-history.api';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import AssetChart from './AssetChart';

// Synthetic points only: three days of a position in USD.
const point = (at: string, changes: Partial<AssetHistoryPoint> = {}): AssetHistoryPoint => ({
  at,
  quantity: '1',
  value: '80000',
  complete: true,
  cost: '60000',
  costComplete: true,
  ...changes,
});

const points = [
  point('2026-03-01T00:00:00.000Z', { complete: false }),
  point('2026-03-02T00:00:00.000Z', {
    quantity: '1.5',
    value: '120000',
    cost: '90000',
    costComplete: false,
  }),
  point('2026-03-03T00:00:00.000Z', { quantity: '1.5', value: '126000', cost: '90000' }),
];

const draw = (shown: AssetHistoryPoint[]) =>
  render(
    <AssetChart
      points={shown}
      period="1M"
      currency="USD"
      symbol="BTC"
      purchases={[{ at: '2026-03-02T00:00:00.000Z', quantity: '0.5' }]}
      label="Bitcoin value"
    />,
  );

describe('ASSET-CHART-TIP the chart reads each point from the keyboard', () => {
  afterEach(cleanup);

  it('ASSET-CHART-TIP shows the value, amount, cost and purchases of the point in focus', async () => {
    const user = userEvent.setup();
    draw(points);
    const chart = screen.getByRole('group', { name: /^Bitcoin value\./ });
    chart.focus();
    await user.keyboard('{End}');
    const last = screen.getByRole('status');
    expect(last).toHaveTextContent('Now$126,000.00Amount1.5 BTCCost basis$90,000.00');
    // A tip near the right edge opens to the left of its point.
    expect(Number.parseFloat(last.style.left)).toBeLessThan(800 - 200);
    await user.keyboard('{ArrowLeft}');
    const bought = screen.getByRole('status');
    expect(within(bought).getByText('Purchase').parentElement).toHaveTextContent(
      'Purchase+0.5 BTC',
    );
    expect(bought).toHaveTextContent('Cost basis$90,000.00 known');
    await user.keyboard('{Home}');
    const first = screen.getByRole('status');
    expect(first).toHaveStyle({ left: '18px' });
    expect(first).toHaveTextContent('Incomplete: no price, rate or full history');
    await user.keyboard('a');
    expect(screen.getByRole('status')).toBe(first);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ASSET-CHART-TIP says the cost is unknown when no purchase price is known at all', async () => {
    const user = userEvent.setup();
    draw(points.map((entry) => ({ ...entry, cost: '0', costComplete: false })));
    screen.getByRole('group', { name: /^Bitcoin value\./ }).focus();
    await user.keyboard('{End}');
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('Cost basisunknown');
    expect(tip).not.toHaveTextContent('known Purchase');
    expect(within(tip).queryByText('Purchase')).toBeNull();
  });
});
