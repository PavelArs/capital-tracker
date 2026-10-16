import { type Goal, goalsApi } from '@api/goals.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Icon } from '../shell/icons';
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
  deadline: '2099-12-01',
  expectedReturnPercent: '14.0000',
  monthlyContribution: '150000.00',
  createdAt: '2026-10-01T00:00:00.000Z',
  asOf: '2026-10-13',
  progress: {
    current: '5500000.00',
    complete: true,
    percent: '25.00',
    remaining: '16500000.00',
    stalePrices: 0,
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
  progress: {
    current: '40000.00',
    complete: true,
    percent: '40.00',
    remaining: '60000.00',
    stalePrices: 0,
  },
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
  // The edit dialog asks for its plan; the page tests do not look at it.
  vi.spyOn(goalsApi, 'preview').mockResolvedValue(dated);
});
afterEach(cleanup);

/** The list route says what it was told on arrival, so a test can read the history state. */
function GoalList() {
  const { state } = useLocation();
  return <p>Goal list {JSON.stringify(state)}</p>;
}

function show(goal: Goal, state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: `/goals/${goal.id}`, state }]}>
      <Routes>
        <Route path="/goals" element={<GoalList />} />
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
      'Behind by ₽270,000 a month. Reaching it by Dec 2099 needs ₽420,000 a month; at ₽150,000 it takes until Aug 2032.',
    );
    expect(screen.getByText('Portfolio now').nextSibling).toHaveTextContent('₽5,500,000');
    expect(screen.getByText('25% of the target')).toBeInTheDocument();
    expect(screen.getByText('You put in a month').nextSibling).toHaveTextContent('₽150,000');
    expect(screen.getByText('Needed for the date: ₽420,000')).toBeInTheDocument();
    expect(screen.getByText('Forecast for Dec 2099').nextSibling).toHaveTextContent('₽15,000,000');
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
    expect(screen.getByText(/the first a month from Oct 13, 2026/)).toBeInTheDocument();
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
      progress: {
        current: '120000.00',
        complete: true,
        percent: '100.00',
        remaining: '0.00',
        stalePrices: 0,
      },
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

  it('works out no sums or dates while some assets have no price', async () => {
    answers({
      ...dated,
      status: 'unknown',
      progress: {
        current: '5500000.00',
        complete: false,
        percent: '25.00',
        remaining: null,
        stalePrices: 0,
      },
    });
    show(dated);
    expect(await screen.findByRole('heading', { name: 'Down payment A' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/need every asset priced/i)).toBeInTheDocument();
    expect(screen.getByText('Forecast for Dec 2099').nextSibling).toHaveTextContent('—');
    expect(screen.queryByText(/Needed for the date/)).toBeNull();
  });

  it('shows no projections for a reached goal while assets are unpriced', async () => {
    answers({
      ...open,
      status: 'reached',
      progress: {
        current: '120000.00',
        complete: false,
        percent: '100.00',
        remaining: '0.00',
        stalePrices: 0,
      },
    });
    show(open);
    expect(await screen.findByRole('heading', { name: 'Reserve B' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/need every asset priced/i)).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Delete goal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this goal?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete goal' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(dated.id));
    // goals-09: the list is told, so it can say so and take the keyboard.
    expect(await screen.findByText(/Goal list/)).toHaveTextContent('"notice":"deleted"');
  });

  it('goals-03 shows the real share of a reached goal, with the bar full', async () => {
    answers({
      ...open,
      status: 'reached',
      progress: {
        current: '147000.00',
        complete: true,
        percent: '147.00',
        remaining: '0.00',
        stalePrices: 0,
      },
    });
    show(open);
    expect(await screen.findByText('147% of the target')).toBeInTheDocument();
    expect(screen.getByText('147%', { selector: '.goal-figures__share' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('goals-35 says when prices behind the figures are older than 2 hours', async () => {
    answers({ ...dated, progress: { ...dated.progress, stalePrices: 2 } });
    show(dated);
    expect(
      await screen.findByText('2 prices are older than 2 hours; the last stored prices are used.'),
    ).toBeInTheDocument();
  });

  it('goals-35 says nothing of old prices when there are none', async () => {
    answers(dated);
    show(dated);
    await screen.findByRole('heading', { name: 'Down payment A' });
    expect(screen.queryByText(/older than 2 hours/)).toBeNull();
  });

  it('goals-28 keeps the deadline day open: due today, and editable with the date kept', async () => {
    const user = userEvent.setup();
    const due: Goal = {
      ...dated,
      deadline: '2026-10-13',
      status: 'behind',
      scenarios: dated.scenarios.map((scenario) => ({ ...scenario, requiredMonthly: null })),
    };
    answers(due);
    const update = vi.spyOn(goalsApi, 'update').mockResolvedValue({ ...due, name: 'Flat' });
    show(due);
    await screen.findByRole('heading', { name: 'Down payment A' });
    expect(screen.getByText('Time left').nextSibling).toHaveTextContent('Due today');
    expect(screen.getByText('Due today. ₽16,500,000 to go.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit goal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    await waitFor(() =>
      expect(goalsApi.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ deadline: '2026-10-13', goalId: due.id }),
        expect.any(AbortSignal),
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        due.id,
        expect.objectContaining({ deadline: '2026-10-13' }),
      ),
    );
  });

  it('goals-23 says a goal with a malformed id does not exist', async () => {
    vi.spyOn(goalsApi, 'get').mockRejectedValue(
      new AxiosError('Bad request', undefined, undefined, undefined, {
        status: 400,
        data: { message: 'Invalid accounting input' },
        statusText: 'Bad Request',
        headers: {},
        config: {} as never,
      }),
    );
    show({ ...dated, id: 'not-a-uuid' });
    expect(await screen.findByRole('alert')).toHaveTextContent('This goal does not exist');
  });

  it('goals-25 gives the Moscow day the goal was set, also late in the UTC evening', async () => {
    answers({ ...dated, createdAt: '2026-10-14T21:30:00.000Z' });
    show(dated);
    expect(await screen.findByText(/set Oct 15, 2026/)).toBeInTheDocument();
  });

  it('goals-17 gives the verdict a spaced, tinted icon that fits the status', async () => {
    const markup = (name: 'check' | 'alert' | 'info') =>
      renderToStaticMarkup(<Icon name={name} />).replace(/^<svg[^>]*>|<\/svg>$/g, '');
    answers({ ...dated, status: 'on-track' }, { ...open, status: 'reached' });
    show(dated);
    const verdict = (await screen.findByText(/^On track\./)).closest('p') as HTMLElement;
    expect(verdict).toHaveClass('ui-banner--action', 'goal-verdict');
    expect(verdict.querySelector('svg')?.innerHTML).toBe(markup('check'));
    cleanup();
    show(open);
    const reached = (await screen.findByText(/^Reached\./)).closest('p') as HTMLElement;
    expect(reached.querySelector('svg')?.innerHTML).toBe(markup('check'));
  });

  it('goals-18 dashboard-15 styles the way back as a link and the status with a dot', async () => {
    answers(dated);
    show(dated);
    await screen.findByRole('heading', { name: 'Down payment A' });
    expect(screen.getByRole('link', { name: '← Goals' })).toHaveClass('shell-link');
    expect(screen.getByText('Behind', { selector: '.ui-badge' })).toHaveClass('ui-badge--dot');
  });

  it('goals-19 names the target, compares against it and labels the delete control', async () => {
    answers(dated);
    show(dated);
    await screen.findByRole('heading', { name: 'Down payment A' });
    expect(
      screen.getByText('Target', { selector: '.goal-stat__label' }).nextSibling,
    ).toHaveTextContent('₽22,000,000');
    expect(screen.getByRole('columnheader', { name: 'Against the target' })).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'Delete goal' });
    expect(remove).not.toHaveTextContent('Delete');
  });

  it('goals-06 states the model: monthly compounding and deposits at the same rate', async () => {
    answers(dated);
    show(dated);
    expect(await screen.findByText(/interest compounded monthly/)).toHaveTextContent(
      'Bank deposits count at the same rate for now.',
    );
  });

  it('goals-07 shows each case after ten years for a goal without a date', async () => {
    answers({
      ...open,
      scenarios: open.scenarios.map((scenario, index) => ({
        ...scenario,
        projectedIn10Years: ['60000.00', '82000.00', '120000.40'][index],
      })),
    });
    show(open);
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'In 10 years' })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(within(rows[3]).getByText('$120,000')).toHaveAttribute('data-label', 'In 10 years');
  });

  it('goals-08 says a new goal was added once, on arrival, and an edit that it was saved', async () => {
    const user = userEvent.setup();
    answers(dated);
    vi.spyOn(goalsApi, 'update').mockResolvedValue({ ...dated, name: 'Flat' });
    show(dated, { notice: 'added' });
    expect(await screen.findByText('Goal added.')).toHaveAttribute('role', 'status');
    await user.click(screen.getByRole('button', { name: 'Edit goal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    expect(await screen.findByText('Goal saved.')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('Goal added.')).toBeNull();
  });

  it('goals-22 asks before deleting, with a danger button and what stays', async () => {
    const user = userEvent.setup();
    answers(dated);
    show(dated);
    await screen.findByRole('heading', { name: 'Down payment A' });
    await user.click(screen.getByRole('button', { name: 'Delete goal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this goal?' });
    expect(dialog).toHaveTextContent(
      'Down payment A and its plan are removed; this cannot be undone. Your portfolio and transactions stay as they are.',
    );
    expect(within(dialog).getByRole('button', { name: 'Delete goal' })).toHaveClass(
      'shell-button--danger',
    );
  });

  it('goals-02 does not say nothing was saved when an edit gets no answer', async () => {
    const user = userEvent.setup();
    answers(dated);
    vi.spyOn(goalsApi, 'update').mockRejectedValue(
      new AxiosError('Network Error', 'ERR_NETWORK', { headers: {} } as never),
    );
    show(dated);
    await screen.findByRole('heading', { name: 'Down payment A' });
    await user.click(screen.getByRole('button', { name: 'Edit goal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not reach the server. The change may have been saved; saving it again is safe.',
    );
    expect(alert).not.toHaveTextContent('Nothing was saved');
  });
});
