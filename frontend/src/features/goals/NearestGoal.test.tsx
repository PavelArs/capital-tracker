import { type Goal, goalsApi } from '@api/goals.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NearestGoal from './NearestGoal';

// Synthetic goals and sums only.
const goal = (changes: Partial<Goal> & Pick<Goal, 'id' | 'name'>): Goal => ({
  currency: 'USD',
  targetAmount: '100000.00',
  deadline: null,
  expectedReturnPercent: '7.0000',
  monthlyContribution: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  asOf: '2026-10-13',
  progress: {
    current: '40000.00',
    complete: true,
    percent: '40.00',
    remaining: '60000.00',
    stalePrices: 0,
  },
  status: 'open',
  scenarios: [],
  ...changes,
});
const later = goal({ id: 'g-later', name: 'Car', deadline: '2999-06-01', status: 'on-track' });
const sooner = goal({ id: 'g-sooner', name: 'Flat', deadline: '2998-01-01', status: 'behind' });
const open = goal({ id: 'g-open', name: 'Reserve' });
const reached = goal({
  id: 'g-done',
  name: 'Laptop',
  deadline: '2020-01-01',
  status: 'reached',
  progress: {
    current: '120000.00',
    complete: true,
    percent: '100.00',
    remaining: '0.00',
    stalePrices: 0,
  },
});

const list = (...items: Goal[]) =>
  vi.spyOn(goalsApi, 'list').mockResolvedValue({ asOf: '2026-10-13', items });

function show() {
  render(
    <MemoryRouter>
      <NearestGoal />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
});
afterEach(cleanup);

describe('GOAL-DASH: the nearest goal on the dashboard', () => {
  it('shows the goal that is due first, with its progress and links', async () => {
    list(later, open, sooner);
    show();
    const card = await screen.findByRole('region', { name: 'Nearest goal' });
    expect(within(card).getByText('Nearest goal · by Jan 2998')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Flat' })).toHaveAttribute(
      'href',
      '/goals/g-sooner',
    );
    expect(within(card).getByText('$40,000')).toBeInTheDocument();
    expect(within(card).getByText('of $100,000')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(within(card).getByText('Behind')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Open goal' })).toHaveAttribute(
      'href',
      '/goals/g-sooner',
    );
    expect(within(card).getByRole('link', { name: 'All goals · 3' })).toHaveAttribute(
      'href',
      '/goals',
    );
  });

  it('dashboard-14 dashboard-15 styles its links as app links and gives the status badge a dot', async () => {
    list(sooner);
    show();
    const card = await screen.findByRole('region', { name: 'Nearest goal' });
    // The shared design-system link (accent colour, underline on hover), not the browser's default.
    expect(within(card).getByRole('link', { name: 'Open goal' })).toHaveClass('ui-link');
    expect(within(card).getByRole('link', { name: 'All goals · 1' })).toHaveClass('ui-link');
    expect(within(card).getByText('Behind')).toHaveClass('ui-badge', 'ui-badge--dot');
  });

  it('puts a goal without a date after the ones with a date and skips reached goals', async () => {
    list(reached, open);
    show();
    const card = await screen.findByRole('region', { name: 'Nearest goal' });
    expect(within(card).getByText('Nearest goal')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Reserve' })).toBeInTheDocument();
    expect(within(card).queryByText(/Laptop/)).toBeNull();
    expect(within(card).getByRole('link', { name: 'All goals · 2' })).toBeInTheDocument();
  });

  it('shows nothing without goals, with only reached goals or when the read fails', async () => {
    const read = list();
    show();
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Nearest goal' })).toBeNull();

    cleanup();
    forgetReads();
    read.mockResolvedValue({ asOf: '2026-10-13', items: [reached] });
    show();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Nearest goal' })).toBeNull();

    cleanup();
    forgetReads();
    read.mockRejectedValue(new Error('offline'));
    show();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('region', { name: 'Nearest goal' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
