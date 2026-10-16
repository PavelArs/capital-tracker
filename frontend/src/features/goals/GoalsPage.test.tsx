import { type Goal, type GoalList, goalsApi } from '@api/goals.api';
import { forgetReads } from '@api/read-cache';
import { ToastProvider } from '@contexts/ToastContext';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ToastViewport from '@/components/Toast';
import GoalsPage from './GoalsPage';

// Synthetic goals and sums only.
const flat: Goal = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Down payment A',
  currency: 'RUB',
  targetAmount: '22000000.00',
  deadline: '2028-12-01',
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
  scenarios: [
    {
      key: 'base',
      returnPercent: '14',
      requiredMonthly: '420000.00',
      monthsToTarget: 70,
      reachedOn: '2032-08-13',
      projectedAtDeadline: '15000000.00',
      gap: '7000000.00',
    },
  ],
};
const reserve: Goal = {
  ...flat,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Reserve B',
  currency: 'USD',
  targetAmount: '10000.00',
  deadline: null,
  expectedReturnPercent: '7.5000',
  monthlyContribution: null,
  progress: {
    current: '12000.00',
    complete: true,
    percent: '100.00',
    remaining: '0.00',
    stalePrices: 0,
  },
  status: 'reached',
  scenarios: [],
};
const list = (items: Goal[]): GoalList => ({ asOf: '2026-10-13', items });

// What the server would show for the dialog's terms (GOAL-PREVIEW): the first goal, unsaved.
const { id: _id, name: _name, createdAt: _createdAt, ...planned } = flat;

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  vi.spyOn(goalsApi, 'preview').mockResolvedValue(planned);
});
afterEach(cleanup);

/** The goal page's place: it says which goal it opened and what it was told on arrival. */
function GoalOpened() {
  const { pathname, state } = useLocation();
  return (
    <p>
      Opened {pathname} {JSON.stringify(state)}
    </p>
  );
}

function open(state?: unknown) {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[{ pathname: '/goals', state }]}>
        <Routes>
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/goals/:goalId" element={<GoalOpened />} />
        </Routes>
      </MemoryRouter>
      <ToastViewport />
    </ToastProvider>,
  );
}

describe('GOAL-LIST: the goals and where the portfolio stands against them', () => {
  it('paints the goals it kept at once when the page is opened again', async () => {
    const answer = vi.spyOn(goalsApi, 'list').mockResolvedValue(list([flat]));
    open();
    await screen.findByText('Down payment A');
    cleanup();
    answer.mockReturnValue(new Promise(() => undefined));
    open();
    expect(screen.getByText('Down payment A')).toBeInTheDocument();
    expect(screen.queryByText('Loading goals')).toBeNull();
  });

  it('shows each goal with its figures, bar, status and the sentence under it', async () => {
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([reserve, flat]));
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    expect(within(card).getByText('By Dec 1, 2028 · 14% a year')).toBeInTheDocument();
    expect(within(card).getByText('₽5,500,000')).toBeInTheDocument();
    expect(within(card).getByText('of ₽22,000,000')).toBeInTheDocument();
    expect(within(card).getByText('25%')).toBeInTheDocument();
    expect(within(card).getByText('Behind')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(
      within(card).getByText(
        'Behind by ₽270,000 a month. Reaching it by Dec 2028 needs ₽420,000 a month; at ₽150,000 it takes until Aug 2032.',
      ),
    ).toBeInTheDocument();
    const done = screen.getByText('Reserve B').closest('li') as HTMLElement;
    expect(within(done).getByText('No date · 7.5% a year')).toBeInTheDocument();
    expect(within(done).getByText('Reached')).toBeInTheDocument();
    expect(
      within(done).getByText('Reached. Your net worth is $2,000 above it.'),
    ).toBeInTheDocument();
    // Open goals come before reached ones.
    const names = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.goal-card__name')?.textContent);
    expect(names).toEqual(['Down payment A', 'Reserve B']);
  });

  it('invites the first goal when there is none', async () => {
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([]));
    open();
    expect(await screen.findByRole('heading', { name: 'No goals yet' })).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    vi.spyOn(goalsApi, 'list').mockRejectedValue(new Error('down'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the goals');
  });
});

describe('GOAL-TERMS: adding, changing and deleting a goal', () => {
  it('goals-08 adds a goal from the entries and opens it, saying it was added', async () => {
    const user = userEvent.setup();
    const listed = vi.spyOn(goalsApi, 'list').mockResolvedValue(list([]));
    const create = vi.spyOn(goalsApi, 'create').mockResolvedValue(flat);
    open();
    await user.click(await screen.findByRole('button', { name: 'Add goal' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), '  Down payment A ');
    await user.click(within(dialog).getByLabelText('RUB'));
    await user.type(within(dialog).getByLabelText('Sum to reach'), '22000000');
    await user.type(within(dialog).getByLabelText(/^By/), '2099-12-01');
    await user.click(within(dialog).getByRole('button', { name: /^12%/ }));
    await user.type(within(dialog).getByLabelText(/^You put in a month/), '150000.50');
    listed.mockResolvedValue(list([flat]));
    await user.click(within(dialog).getByRole('button', { name: 'Add goal' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Down payment A',
      currency: 'RUB',
      targetAmount: '22000000',
      deadline: '2099-12-01',
      expectedReturnPercent: '12',
      monthlyContribution: '150000.50',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/^Opened/)).toHaveTextContent(
      `Opened /goals/${flat.id} {"notice":"added"}`,
    );
  });

  it('goals-05 marks every wrong entry at once, under its field, and puts the keyboard on the first', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([]));
    const create = vi.spyOn(goalsApi, 'create').mockResolvedValue(flat);
    open();
    await user.click(await screen.findByRole('button', { name: 'Add goal' }));
    const dialog = await screen.findByRole('dialog');
    const add = within(dialog).getByRole('button', { name: 'Add goal' });
    await user.type(within(dialog).getByLabelText(/^By/), '2020-01-01');
    await user.clear(within(dialog).getByLabelText('Expected return, % a year'));
    await user.click(add);
    const name = within(dialog).getByLabelText('Name');
    const target = within(dialog).getByLabelText('Sum to reach');
    const by = within(dialog).getByLabelText(/^By/);
    const rate = within(dialog).getByLabelText('Expected return, % a year');
    for (const field of [name, target, by, rate])
      expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name');
    expect(target).toHaveAccessibleDescription('Enter a sum above 0, with up to two decimals');
    expect(by).toHaveAccessibleDescription('Pick a date after today, or clear it');
    expect(rate).toHaveAccessibleDescription(
      'Enter a percent a year from 0 to 999.9999, with up to four decimals',
    );
    expect(within(dialog).getByLabelText(/^You put in a month/)).not.toHaveAttribute(
      'aria-invalid',
    );
    expect(name).toHaveFocus();
    await user.type(name, 'Goal');
    await user.click(add);
    expect(name).not.toHaveAttribute('aria-invalid');
    expect(target).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
  });

  it('goals-21 offers the name as an example, not a filled value', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([]));
    open();
    await user.click(await screen.findByRole('button', { name: 'Add goal' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute(
      'placeholder',
      'e.g. Apartment down payment',
    );
  });

  it('goals-02 does not say nothing was saved when a new goal gets no answer', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([]));
    const create = vi
      .spyOn(goalsApi, 'create')
      .mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK', { headers: {} } as never));
    open();
    await user.click(await screen.findByRole('button', { name: 'Add goal' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Goal');
    await user.type(within(dialog).getByLabelText('Sum to reach'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Add goal' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not reach the server. The goal may have been added; adding it again does not add it twice.',
    );
    expect(alert).not.toHaveTextContent('Nothing was saved');
    // The retry is the same request, so the server returns the goal it made.
    await user.click(within(dialog).getByRole('button', { name: 'Add goal' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0].requestId).toBe(create.mock.calls[0][0].requestId);
  });

  it('tells what the server refused and keeps the entries', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([]));
    vi.spyOn(goalsApi, 'create').mockRejectedValue(
      Object.assign(new Error('refused'), {
        isAxiosError: true,
        response: { status: 422, data: { message: 'At most 20 goals can be kept' } },
      }),
    );
    open();
    await user.click(await screen.findByRole('button', { name: 'Add goal' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Goal');
    await user.type(within(dialog).getByLabelText('Sum to reach'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Add goal' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('At most 20 goals');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Goal');
  });

  it('goals-20 changes a goal with its entries filled in as they were entered', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([flat]));
    const update = vi.spyOn(goalsApi, 'update').mockResolvedValue({ ...flat, name: 'Flat' });
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Down payment A');
    // goals-20: the sums as the owner entered them, without the padded cents.
    expect(within(dialog).getByLabelText('Sum to reach')).toHaveValue('22000000');
    expect(within(dialog).getByLabelText('Expected return, % a year')).toHaveValue('14');
    expect(within(dialog).getByLabelText(/^You put in a month/)).toHaveValue('150000');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Flat');
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(flat.id, {
        name: 'Flat',
        currency: 'RUB',
        targetAmount: '22000000',
        deadline: '2028-12-01',
        expectedReturnPercent: '14',
        monthlyContribution: '150000',
      }),
    );
  });

  it.each([
    ['10.0000', '10'],
    ['100', '100'],
    ['0.0000', '0'],
  ])('fills a whole-number return of %s without losing digits', async (stored, shown) => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(
      list([{ ...flat, expectedReturnPercent: stored }]),
    );
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    expect(within(dialog).getByLabelText('Expected return, % a year')).toHaveValue(shown);
  });

  it('keeps a stored zero contribution when a goal is changed', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([{ ...flat, monthlyContribution: '0.00' }]));
    const update = vi.spyOn(goalsApi, 'update').mockResolvedValue(flat);
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    expect(within(dialog).getByLabelText(/^You put in a month/)).toHaveValue('0');
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        flat.id,
        expect.objectContaining({ monthlyContribution: '0' }),
      ),
    );
  });

  it('goals-28 saves an overdue goal with its date kept, but asks for a later date when it is moved', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([{ ...flat, deadline: '2020-01-01' }]));
    const update = vi.spyOn(goalsApi, 'update').mockResolvedValue(flat);
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    let dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    await user.clear(within(dialog).getByLabelText(/^By/));
    await user.type(within(dialog).getByLabelText(/^By/), '2020-02-01');
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    expect(within(dialog).getByLabelText(/^By/)).toHaveAccessibleDescription(
      'Pick a date after today, or clear it',
    );
    expect(update).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        flat.id,
        expect.objectContaining({ deadline: '2020-01-01' }),
      ),
    );
  });

  it('goals-08 says a goal changed from the list was saved', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([flat]));
    vi.spyOn(goalsApi, 'update').mockResolvedValue({ ...flat, name: 'Flat' });
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    expect((await screen.findByText('Goal saved.')).closest('[role="status"]')).not.toBeNull();
  });

  it('deletes a goal after asking', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([flat]));
    const remove = vi.spyOn(goalsApi, 'remove').mockResolvedValue();
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this goal?' });
    expect(dialog).toHaveTextContent('Down payment A and its plan are removed');
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete goal' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(flat.id));
  });

  it('goals-09 says a goal from the list was deleted and puts the keyboard on the page heading', async () => {
    const user = userEvent.setup();
    const listed = vi.spyOn(goalsApi, 'list').mockResolvedValue(list([flat, reserve]));
    vi.spyOn(goalsApi, 'remove').mockResolvedValue();
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this goal?' });
    listed.mockResolvedValue(list([reserve]));
    await user.click(within(dialog).getByRole('button', { name: 'Delete goal' }));
    const said = await screen.findByText('Goal deleted.');
    expect(said.closest('[role="status"]')).not.toBeNull();
    const heading = screen.getByRole('heading', { level: 1, name: 'Goals' });
    await waitFor(() => expect(heading).toHaveFocus());
    await waitFor(() => expect(screen.queryByText('Down payment A')).toBeNull());
    expect(heading).toHaveFocus();
  });

  it('goals-09 says a goal deleted on its page was deleted, once, with the keyboard on the page heading', async () => {
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([reserve]));
    open({ notice: 'deleted' });
    const said = await screen.findByText('Goal deleted.');
    expect(said.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Goals' })).toHaveFocus();
  });

  it('goals-35 says when prices behind the figures are older than 2 hours', async () => {
    vi.spyOn(goalsApi, 'list').mockResolvedValue(
      list([{ ...flat, progress: { ...flat.progress, stalePrices: 1 } }, reserve]),
    );
    open();
    expect(
      await screen.findByText('1 price is older than 2 hours; the last stored price is used.'),
    ).toBeInTheDocument();
  });
});

describe('GOAL-PREVIEW: the plan in the dialog before the goal is saved', () => {
  async function adding() {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([]));
    open();
    await user.click(await screen.findByRole('button', { name: 'Add goal' }));
    return { user, dialog: await screen.findByRole('dialog') };
  }

  it('shows what the goal page would say once the sum and the return can be sent', async () => {
    const preview = vi.mocked(goalsApi.preview);
    const { user, dialog } = await adding();
    expect(within(dialog).getByText('Enter the sum and the return to see a plan.')).toBeVisible();
    await user.click(within(dialog).getByLabelText('RUB'));
    await user.type(within(dialog).getByLabelText('Sum to reach'), '22000000');
    await user.type(within(dialog).getByLabelText(/^By/), '2099-12-01');
    await user.type(within(dialog).getByLabelText(/^You put in a month/), '150000');
    const plan = await within(dialog).findByRole('status', { name: 'Plan' });
    expect(plan).toHaveTextContent(
      'Behind by ₽270,000 a month. Reaching it by Dec 2028 needs ₽420,000 a month; at ₽150,000 it takes until Aug 2032. A projection, not a promise.',
    );
    expect(plan.querySelector('.ui-banner--warn')).not.toBeNull();
    expect(within(dialog).getByText('Your portfolio now: ₽5,500,000')).toBeVisible();
    // Asked once the typing stopped, for the last terms, and never with the name.
    await waitFor(() =>
      expect(preview).toHaveBeenLastCalledWith(
        {
          currency: 'RUB',
          targetAmount: '22000000',
          deadline: '2099-12-01',
          expectedReturnPercent: '8',
          monthlyContribution: '150000',
        },
        expect.any(AbortSignal),
      ),
    );
    expect(preview.mock.calls.length).toBeLessThan(4);
  });

  it('goes back to the prompt when the sum is cleared', async () => {
    const { user, dialog } = await adding();
    await user.type(within(dialog).getByLabelText('Sum to reach'), '1000');
    await within(dialog).findByRole('status', { name: 'Plan' });
    await user.clear(within(dialog).getByLabelText('Sum to reach'));
    expect(within(dialog).getByText('Enter the sum and the return to see a plan.')).toBeVisible();
    expect(within(dialog).queryByRole('status', { name: 'Plan' })).toBeNull();
    expect(within(dialog).queryByText(/Your portfolio now/)).toBeNull();
  });

  it('passes on why the server would refuse the terms instead of offering to save them', async () => {
    vi.mocked(goalsApi.preview).mockRejectedValue(
      new AxiosError('Unprocessable', undefined, undefined, undefined, {
        status: 422,
        data: { message: 'The deadline must be after today' },
        statusText: 'Unprocessable Entity',
        headers: {},
        config: {} as never,
      }),
    );
    const { user, dialog } = await adding();
    await user.type(within(dialog).getByLabelText('Sum to reach'), '1000');
    expect(
      await within(dialog).findByText(
        'These terms cannot be saved: The deadline must be after today.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByText(/can still be saved/)).toBeNull();
  });

  it('asks for a date within the forecast before asking for a plan', async () => {
    const preview = vi.mocked(goalsApi.preview);
    const { user, dialog } = await adding();
    await user.type(within(dialog).getByLabelText('Name'), 'Far');
    await user.type(within(dialog).getByLabelText('Sum to reach'), '1000');
    await within(dialog).findByRole('status', { name: 'Plan' });
    preview.mockClear();
    await user.type(within(dialog).getByLabelText(/^By/), '2999-06-01');
    expect(within(dialog).getByText('Enter the sum and the return to see a plan.')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Add goal' }));
    expect(within(dialog).getByLabelText(/^By/)).toHaveAccessibleDescription(
      'Pick a date within 100 years, or clear it',
    );
    expect(preview).not.toHaveBeenCalled();
  });

  it('says the plan is not available when the server cannot work it out', async () => {
    vi.mocked(goalsApi.preview).mockRejectedValue(new Error('down'));
    const { user, dialog } = await adding();
    await user.type(within(dialog).getByLabelText('Sum to reach'), '1000');
    expect(
      await within(dialog).findByText(
        'Could not work out the plan right now. The goal can still be saved.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });
});
