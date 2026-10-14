import { type Goal, type GoalList, goalsApi } from '@api/goals.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  progress: { current: '12000.00', complete: true, percent: '100.00', remaining: '0.00' },
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

function open() {
  render(
    <MemoryRouter initialEntries={['/goals']}>
      <Routes>
        <Route path="/goals" element={<GoalsPage />} />
      </Routes>
    </MemoryRouter>,
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
  it('adds a goal from the entries and shows the list again', async () => {
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
    expect(await screen.findByText('Down payment A')).toBeInTheDocument();
  });

  it('names the first entry that is wrong and sends nothing', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([]));
    const create = vi.spyOn(goalsApi, 'create').mockResolvedValue(flat);
    open();
    await user.click(await screen.findByRole('button', { name: 'Add goal' }));
    const dialog = await screen.findByRole('dialog');
    const add = within(dialog).getByRole('button', { name: 'Add goal' });
    await user.click(add);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Name: give the goal a name');
    await user.type(within(dialog).getByLabelText('Name'), 'Goal');
    await user.click(add);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Sum to reach');
    await user.type(within(dialog).getByLabelText('Sum to reach'), '100');
    await user.type(within(dialog).getByLabelText(/^By/), '2020-01-01');
    await user.click(add);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('By: pick a date after today');
    await user.clear(within(dialog).getByLabelText(/^By/));
    await user.clear(within(dialog).getByLabelText('Expected return, % a year'));
    await user.click(add);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Expected return');
    expect(create).not.toHaveBeenCalled();
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

  it('changes a goal with its entries filled in', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([flat]));
    const update = vi.spyOn(goalsApi, 'update').mockResolvedValue({ ...flat, name: 'Flat' });
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Down payment A');
    expect(within(dialog).getByLabelText('Sum to reach')).toHaveValue('22000000.00');
    expect(within(dialog).getByLabelText('Expected return, % a year')).toHaveValue('14');
    expect(within(dialog).getByLabelText(/^You put in a month/)).toHaveValue('150000.00');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Flat');
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(flat.id, {
        name: 'Flat',
        currency: 'RUB',
        targetAmount: '22000000.00',
        deadline: '2028-12-01',
        expectedReturnPercent: '14',
        monthlyContribution: '150000.00',
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
    expect(within(dialog).getByLabelText(/^You put in a month/)).toHaveValue('0.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        flat.id,
        expect.objectContaining({ monthlyContribution: '0.00' }),
      ),
    );
  });

  it('asks for a later date or none when an overdue goal is changed', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([{ ...flat, deadline: '2020-01-01' }]));
    const update = vi.spyOn(goalsApi, 'update').mockResolvedValue(flat);
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' });
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'By: pick a date after today, or clear it',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('deletes a goal after asking', async () => {
    const user = userEvent.setup();
    vi.spyOn(goalsApi, 'list').mockResolvedValue(list([flat]));
    const remove = vi.spyOn(goalsApi, 'remove').mockResolvedValue();
    open();
    const card = (await screen.findByText('Down payment A')).closest('li') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete goal' });
    expect(dialog).toHaveTextContent('Down payment A will be removed');
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(flat.id));
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
    expect(plan).toHaveClass('ui-banner--warn');
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
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'By: pick a date within 100 years, or clear it',
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
