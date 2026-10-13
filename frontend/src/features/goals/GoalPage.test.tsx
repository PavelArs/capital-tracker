import { type Goal, goalsApi } from '@api/goals.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GoalPage from './GoalPage';

// Synthetic goals and sums only.
const scenarios = (rates: [string, string, string]): Goal['scenarios'] =>
  (['pessimistic', 'base', 'optimistic'] as const).map((key, index) => ({
    key,
    returnPercent: rates[index],
    requiredMonthly: ['500000.00', '420000.00', '350000.00'][index],
    monthsToTarget: [90, 70, 55][index],
    reachedOn: ['2034-04-13', '2032-08-13', '2031-05-13'][index],
    projectedAtDeadline: ['13000000.00', '15000000.00', '23000000.00'][index],
    gap: ['9000000.00', '7000000.00', '-1000000.00'][index],
  }));

const dated: Goal = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Down payment A',
  currency: 'RUB',
  targetAmount: '22000000.00',
  deadline: '2999-12-01',
  expectedReturnPercent: '14.0000',
  monthlyContribution: '150000.00',
  createdAt: '2026-10-01T00:00:00.000Z',
  asOf: '2026-10-13',
  progress: {
    current: '5500000.00',
    complete: true,
    percent: '25.00',
    remaining: '16500000.00',
  },
  status: 'behind',
  scenarios: scenarios(['10', '14', '18']),
};
const open: Goal = {
  ...dated,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Reserve B',
  currency: 'USD',
  targetAmount: '100000.00',
  deadline: null,
  monthlyContribution: null,
  expectedReturnPercent: '7.5000',
  progress: { current: '40000.00', complete: true, percent: '40.00', remaining: '60000.00' },
  status: 'open',
  scenarios: scenarios(['3.5', '7.5', '11.5']).map((scenario) => ({
    ...scenario,
    requiredMonthly: null,
    projectedAtDeadline: null,
    gap: null,
  })),
};
const answers = (...items: Goal[]) =>
  vi.spyOn(goalsApi, 'get').mockImplementation(async (id) => {
    const found = items.find((item) => item.id === id);
    if (found) return found;
    throw new AxiosError('Not found', undefined, undefined, undefined, {
      status: 404,
      data: { message: 'Not found' },
      statusText: 'Not Found',
      headers: {},
      config: {} as never,
    });
  });

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
});
afterEach(cleanup);

function show(goal: Goal) {
  render(
    <MemoryRouter initialEntries={[`/goals/${goal.id}`]}>
      <Routes>
        <Route path="/goals" element={<p>Goal list</p>} />
        <Route path="/goals/:goalId" element={<GoalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GOAL-PAGE: one goal with its figures and the three return cases', () => {
  it('shows the figures, the verdict and the cases of a goal with a date', async () => {
    answers(dated, open);
    show(dated);
    expect(await screen.findByRole('heading', { name: 'Down payment A' })).toBeInTheDocument();
    expect(screen.getByText('Behind')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Behind by ₽270,000 a month. Reaching it by Dec 2999 needs ₽420,000 a month; at ₽150,000 it takes until Aug 2032.',
    );
    expect(screen.getByText('Portfolio now').nextSibling).toHaveTextContent('₽5,500,000');
    expect(screen.getByText('25% of the sum')).toBeInTheDocument();
    expect(screen.getByText('You put in a month').nextSibling).toHaveTextContent('₽150,000');
    expect(screen.getByText('Needed for the date: ₽420,000')).toBeInTheDocument();
    expect(screen.getByText('Forecast for Dec 2999').nextSibling).toHaveTextContent('₽15,000,000');
    expect(screen.getAllByText('₽7,000,000 short')).toHaveLength(2);

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByText('Pessimistic')).toBeInTheDocument();
    expect(within(rows[1]).getByText('10%')).toBeInTheDocument();
    expect(within(rows[1]).getByText('₽9,000,000 short')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Optimistic')).toBeInTheDocument();
    expect(within(rows[3]).getByText('₽1,000,000 more')).toBeInTheDocument();
    expect(within(rows[3]).getByText('₽350,000')).toBeInTheDocument();
    expect(within(rows[3]).getByText('May 2031')).toBeInTheDocument();
    expect(screen.getByText(/at 4 points less and more a year/i)).toBeInTheDocument();
  });

  it('shows when a goal without a date is reached, in each case', async () => {
    answers(dated, open);
    show(open);
    expect(await screen.findByRole('heading', { name: 'Reserve B' })).toBeInTheDocument();
    expect(screen.getByText('No date', { selector: '.goal-stat__value' })).toBeInTheDocument();
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    expect(
      screen.getByText('Reached', { selector: '.goal-stat__label' }).nextSibling,
    ).toHaveTextContent('Aug 2032');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(rows[0]).queryByText('Needed a month')).toBeNull();
    expect(within(rows[2]).getByText('Aug 2032')).toBeInTheDocument();
    expect(within(rows[2]).getByText('5 years 10 months')).toBeInTheDocument();
  });

  it('shows a goal that is already reached as reached in every case', async () => {
    answers({
      ...open,
      status: 'reached',
      progress: { current: '120000.00', complete: true, percent: '100.00', remaining: '0.00' },
      scenarios: open.scenarios.map((scenario) => ({
        ...scenario,
        monthsToTarget: 0,
        reachedOn: '2026-10-13',
      })),
    });
    show(open);
    expect(await screen.findByRole('heading', { name: 'Reserve B' })).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(rows[2]).getByText('Already')).toBeInTheDocument();
    expect(screen.queryByText('under a month')).toBeNull();
  });

  it('says so when the goal does not exist', async () => {
    answers(open);
    show(dated);
    expect(await screen.findByRole('alert')).toHaveTextContent('This goal does not exist');
    expect(screen.getByRole('link', { name: 'Back to goals' })).toHaveAttribute('href', '/goals');
  });

  it('changes the goal and shows the new entries', async () => {
    const user = userEvent.setup();
    answers(dated);
    const update = vi.spyOn(goalsApi, 'update').mockResolvedValue({ ...dated, name: 'Flat' });
    show(dated);
    await screen.findByRole('heading', { name: 'Down payment A' });
    await user.click(screen.getByRole('button', { name: 'Edit goal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Flat');
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Flat' })).toBeInTheDocument();
  });

  it('names the real offsets when the pessimistic case is held at 0%', async () => {
    answers({ ...dated, expectedReturnPercent: '2.0000', scenarios: scenarios(['0', '2', '6']) });
    show(dated);
    expect(await screen.findByText(/at 2 points less and 4 more a year/i)).toBeInTheDocument();
  });

  it('shows the real failure instead of a missing goal when the read fails', async () => {
    vi.spyOn(goalsApi, 'get').mockRejectedValue(new Error('offline'));
    show(dated);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the goal');
  });

  it('deletes the goal and goes back to the list', async () => {
    const user = userEvent.setup();
    answers(dated);
    const remove = vi.spyOn(goalsApi, 'remove').mockResolvedValue();
    show(dated);
    await screen.findByRole('heading', { name: 'Down payment A' });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete goal' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(dated.id));
    expect(await screen.findByText('Goal list')).toBeInTheDocument();
  });
});
