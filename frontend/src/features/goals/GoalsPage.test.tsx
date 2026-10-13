import { type Goal, type GoalList, goalsApi } from '@api/goals.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
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
      .map((item) => item.querySelector('b')?.textContent);
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
    await user.type(within(dialog).getByLabelText(/^By/), '2999-12-01');
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
      deadline: '2999-12-01',
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
