import { type Goal, goalsApi, type GoalInsights as Insights } from '@api/goals.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import GoalInsights from './GoalInsights';

const goal = {
  id: '00000000-0000-4000-8000-000000000001',
  currency: 'USD',
  expectedReturnPercent: '6',
  monthlyContribution: '100',
  targetAmount: '10000',
  deadline: null,
} as Goal;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forgetReads();
});
it('GOAL-WIDGETS shows completed-month contributions, averages, pace and growth from the server', async () => {
  vi.spyOn(goalsApi, 'insights').mockResolvedValue({
    currency: 'USD',
    asOf: '2026-10-18',
    complete: false,
    months: [
      { month: '2026-08', net: '120' },
      { month: '2026-09', net: '-20' },
    ],
    averages: { 3: '100', 6: '90', 12: null },
    paceStatus: 'projected',
    paceReachedOn: '2030-02-18',
    growth: { from: '2025-10-18T00:00:00Z', contributions: '1000', market: '-50', total: '950' },
  });
  render(<GoalInsights goal={goal} />);
  await screen.findByText('Last 6 months');
  const contributions = screen.getByRole('region', { name: 'Your contributions' });
  expect(within(contributions).getByText('Last 6 months').parentElement).toHaveTextContent(
    '$90.00',
  );
  expect(within(contributions).getByText('At your 6-month pace').parentElement).toHaveTextContent(
    'Feb 2030',
  );
  expect(screen.getByRole('region', { name: 'Where the growth came from' })).toHaveTextContent(
    '-$50.00',
  );
  expect(screen.getByText(/Priced assets only/)).toBeVisible();
  expect(screen.getByText(/Full months only/)).toBeVisible();
});

it('GOAL-WIDGETS marks retained figures stale when their refresh fails', async () => {
  const data: Insights = {
    currency: 'USD',
    asOf: '2026-10-18',
    complete: true,
    months: [],
    averages: { 3: '100', 6: '100', 12: '100' },
    paceStatus: 'projected',
    paceReachedOn: '2030-02-18',
    growth: { from: null, contributions: '1000', market: '50', total: '1050' },
  };
  const read = vi
    .spyOn(goalsApi, 'insights')
    .mockResolvedValueOnce(data)
    .mockRejectedValue(new Error('offline'));
  const first = render(<GoalInsights goal={goal} />);
  await screen.findByText('Last 6 months');
  first.unmount();
  render(<GoalInsights goal={goal} />);
  expect(
    await screen.findByText(
      'Could not refresh contributions and growth; showing the last loaded figures.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('region', { name: 'Where the growth came from' })).toHaveTextContent(
    '$1,050.00',
  );
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
});

it('GOAL-WIDGETS renders available growth with no full contribution months and high-precision amounts', async () => {
  vi.spyOn(goalsApi, 'insights').mockResolvedValue({
    currency: 'USD',
    asOf: '2026-10-22',
    complete: false,
    months: [],
    averages: { 3: null, 6: null, 12: null },
    paceStatus: 'insufficient-history',
    paceReachedOn: null,
    growth: {
      from: '2025-10-23T00:00:00.000Z',
      contributions: '1000.12345678901234567890123456789',
      market: '250.12345678901234567890123456789',
      total: '1250.24691357802469135780246913578',
    },
  });
  render(<GoalInsights goal={goal} />);
  await screen.findByText('Net worth grew by');
  const growth = screen.getByRole('region', { name: 'Where the growth came from' });
  expect(growth).toHaveTextContent('$1,250.24');
  expect(screen.getByText('No full month of tracked history yet.')).toBeVisible();
  expect(screen.getByText('Not enough history')).toBeVisible();
  expect(within(growth).getByRole('img', { name: /You put in.*Market/ })).toBeVisible();
});

const ready: Insights = {
  currency: 'USD',
  asOf: '2026-10-22',
  complete: true,
  months: [],
  averages: { 3: null, 6: '100', 12: null },
  paceStatus: 'projected',
  paceReachedOn: '2030-02-18',
  growth: { from: null, contributions: '1000', market: '250', total: '1250' },
};

it.each([
  ['2029-02-18', '1 year before the date'],
  ['2031-02-18', '1 year after the date'],
  ['2030-02-18', 'On the date'],
])('GOAL-PACE compares %s with the goal deadline', async (paceReachedOn, text) => {
  vi.spyOn(goalsApi, 'insights').mockResolvedValue({ ...ready, paceReachedOn });
  render(<GoalInsights goal={{ ...goal, deadline: '2030-02-18' }} />);
  expect(await screen.findByText(text)).toBeVisible();
});

it.each([
  ['-250', 'Segment widths show movement sizes. Withdrawals and market losses are shown in red.'],
  [null, 'Growth breakdown is unavailable.'],
  ['0', 'No contributions or market movement in this period.'],
])('GOAL-GROWTH keeps losses, unknown and zero distinct for %s', async (market, text) => {
  vi.spyOn(goalsApi, 'insights').mockResolvedValue({
    ...ready,
    growth: {
      ...ready.growth,
      contributions: market === '0' ? '0' : '1000',
      market,
      total: market === null ? null : market === '0' ? '0' : '750',
    },
  });
  render(<GoalInsights goal={goal} />);
  expect(await screen.findByText(text)).toBeVisible();
  const growth = screen.getByRole('region', { name: 'Where the growth came from' });
  if (market === '-250') {
    expect(growth.querySelector('[data-part="market"][data-negative]')).not.toBeNull();
    expect(growth).toHaveTextContent('-$250.00');
  } else expect(within(growth).queryByRole('img')).toBeNull();
});

it('GOAL-WIDGETS keeps both cards visible during loading and failure, then retries', async () => {
  const read = vi
    .spyOn(goalsApi, 'insights')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(ready);
  const user = userEvent.setup();
  render(<GoalInsights goal={goal} />);
  expect(screen.getByRole('region', { name: 'Your contributions' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  expect(screen.getByRole('region', { name: 'Where the growth came from' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  expect(await screen.findByText('Could not load contributions and growth.')).toBeVisible();
  expect(screen.getAllByText('Figures are unavailable. Retry to load them.')).toHaveLength(2);
  expect(screen.queryByText('$0.00')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Last 6 months')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Where the growth came from' })).toHaveTextContent(
    '+$1,250.00',
  );
  expect(read).toHaveBeenCalledTimes(2);
});
