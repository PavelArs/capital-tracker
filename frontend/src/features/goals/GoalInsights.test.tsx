import { type Goal, goalsApi, type GoalInsights as Insights } from '@api/goals.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, within } from '@testing-library/react';
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
  const contributions = await screen.findByRole('region', { name: 'Your contributions' });
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
  await screen.findByRole('region', { name: 'Your contributions' });
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
