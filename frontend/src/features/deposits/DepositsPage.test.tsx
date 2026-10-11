import { type Deposit, type DepositDetail, type DepositList, depositsApi } from '@api/deposits.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DepositPage from './DepositPage';
import DepositsPage from './DepositsPage';

// Synthetic banks, names and amounts only.
const savings: Deposit = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Savings A',
  bank: 'Synthetic Bank',
  currency: 'RUB',
  startDate: '2026-07-01',
  endDate: '2026-12-01',
  payout: 'monthly',
  capitalized: false,
  dayBasis: 'actual-365',
  earlyClose: 'forfeits-interest',
  ratePercent: '12',
  status: 'active',
  closedOn: null,
  principal: '100000.00',
  accrued: '328.77',
  due: '0.00',
  balance: '100328.77',
  values: { USD: '1114.76', EUR: '1003.29', RUB: '100328.77' },
  nextPayout: { date: '2026-11-01', interest: '1019.18', treatment: 'payable' },
  atMaturity: { date: '2026-12-01', balance: '104000.00', interest: '4000.00' },
  lastCheck: null,
};
const dollars: Deposit = {
  ...savings,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Dollar B',
  currency: 'USD',
  endDate: null,
  capitalized: true,
  payout: 'quarterly',
  ratePercent: '4',
  principal: '5050.41',
  accrued: '1.66',
  balance: '5052.07',
  values: { USD: '5052.07', EUR: '4546.86', RUB: '454686.30' },
  nextPayout: { date: '2027-01-01', interest: '51.00', treatment: 'capitalized' },
  atMaturity: null,
  lastCheck: {
    checkedOn: '2026-10-04',
    bankBalance: '5050.44',
    calculated: '5050.41',
    difference: '0.03',
  },
};
const list = (items: Deposit[]): DepositList => ({
  asOf: '2026-10-11',
  items,
  totals: { USD: '6166.83', EUR: '5550.15', RUB: '555015.07' },
});
const detail = (deposit: Deposit, change: Partial<DepositDetail> = {}): DepositDetail => ({
  ...deposit,
  asOf: '2026-10-11',
  rates: [{ effectiveFrom: '2026-07-01', ratePercent: deposit.ratePercent }],
  movements: [
    { id: 'm1', date: '2026-07-01', kind: 'topup', amount: '100000.00', comment: null },
    {
      id: 'm2',
      date: '2026-08-01',
      kind: 'interest-payout',
      amount: '1019.18',
      comment: 'To card',
    },
  ],
  periods: [{ from: '2026-07-01', to: '2026-08-01', interest: '1019.18', treatment: 'payable' }],
  interestPosted: '1019.18',
  interestPaidOut: '1019.18',
  interestForfeited: '0.00',
  checks: [],
  ...change,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/deposits" element={<DepositsPage />} />
        <Route path="/deposits/:depositId" element={<DepositPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DEP-LIST: the deposits and what they are worth', () => {
  it('shows each deposit with its terms, value in the chosen currency and what needs a look', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings, dollars]));
    open('/deposits?currency=RUB');
    const card = (await screen.findByRole('link', { name: /Savings A/ })) as HTMLElement;
    expect(within(card).getByText('₽100,328.77')).toBeInTheDocument();
    expect(
      within(card).getByText('12% · interest paid monthly · until Dec 1, 2026'),
    ).toBeInTheDocument();
    expect(within(card).getByText(/₽1,019\.18 on Nov 1, 2026/)).toBeInTheDocument();
    expect(within(card).getByText('Not checked against the bank yet')).toBeInTheDocument();
    const usd = screen.getByRole('link', { name: /Dollar B/ });
    expect(within(usd).getByText('₽454,686.30')).toBeInTheDocument();
    expect(within(usd).getByText('$5,052.07')).toBeInTheDocument();
    expect(within(usd).getByText(/differs by \$0\.03/)).toBeInTheDocument();
    expect(screen.getByText('₽555,015.07')).toBeInTheDocument();
    expect(card).toHaveAttribute('href', `/deposits/${savings.id}?currency=RUB`);
  });

  it('invites the first deposit when there is none', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    open('/deposits');
    expect(await screen.findByRole('heading', { name: 'No deposits yet' })).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    vi.spyOn(depositsApi, 'list').mockRejectedValue(new Error('down'));
    open('/deposits');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the deposits');
  });

  it('adds a deposit from the dialog and opens it', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(savings));
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add deposit' });
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Name');
    await user.type(within(dialog).getByLabelText('Name'), 'Savings A');
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Amount put in'), '100000');
    await user.type(within(dialog).getByLabelText('Rate, % a year'), '12');
    await user.clear(within(dialog).getByLabelText('Start date'));
    await user.type(within(dialog).getByLabelText('Start date'), '2026-07-01');
    await user.type(within(dialog).getByLabelText('End date (optional)'), '2026-12-01');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({
      requestId: expect.any(String),
      name: 'Savings A',
      bank: 'Synthetic Bank',
      currency: 'RUB',
      startDate: '2026-07-01',
      endDate: '2026-12-01',
      payout: 'monthly',
      capitalized: false,
      dayBasis: 'actual-365',
      earlyClose: 'forfeits-interest',
      ratePercent: '12',
      amount: '100000',
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Savings A' })).toBeInTheDocument();
  });

  it('refuses a term longer than the server accepts before sending it', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(savings));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add deposit' });
    await user.type(within(dialog).getByLabelText('Name'), 'Savings A');
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Amount put in'), '1000');
    await user.type(within(dialog).getByLabelText('Rate, % a year'), '12');
    await user.clear(within(dialog).getByLabelText('Start date'));
    await user.type(within(dialog).getByLabelText('Start date'), '2026-07-01');
    await user.type(within(dialog).getByLabelText('End date (optional)'), '2999-01-01');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at most 30 years');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an amount the server would not accept before sending it', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(savings));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add deposit' });
    await user.type(within(dialog).getByLabelText('Name'), 'Savings A');
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Amount put in'), '1000000000000');
    await user.type(within(dialog).getByLabelText('Rate, % a year'), '12');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Amount put in');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('DEP-DETAIL: one deposit', () => {
  it('shows the computed figures, the periods, the movements and the terms', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open(`/deposits/${savings.id}?currency=RUB`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Savings A' })).toBeInTheDocument();
    expect(screen.getByText('Earned, not posted yet').parentElement).toHaveTextContent('₽328.77');
    expect(screen.getByText('At the end of the term').parentElement).toHaveTextContent(
      '₽104,000.00',
    );
    const periods = screen.getByRole('region', { name: 'Interest by period' });
    expect(within(periods).getByText('₽1,019.18')).toBeInTheDocument();
    const movements = screen.getByRole('region', { name: 'Movements' });
    expect(within(movements).getByText('Interest paid out')).toBeInTheDocument();
    expect(within(movements).getByText('To card')).toBeInTheDocument();
    // The first top-up is the deposit itself; it is deleted with the deposit, not on its own.
    expect(within(movements).getAllByRole('button', { name: /^Remove/ })).toHaveLength(1);
  });

  it('shows what a capitalizing deposit has added instead of interest to be paid out', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(dollars, { interestPosted: '50.41' }));
    open(`/deposits/${dollars.id}?currency=USD`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dollar B' })).toBeInTheDocument();
    expect(screen.getByText('Interest added so far').parentElement).toHaveTextContent('$50.41');
    expect(screen.queryByText('Interest to be paid out')).not.toBeInTheDocument();
  });

  it('tells a capitalizing deposit that the bank balance leaves out the interest not yet added', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(dollars));
    open(`/deposits/${dollars.id}?currency=USD`);
    await user.click(await screen.findByRole('button', { name: 'Check balance' }));
    expect(screen.getByRole('dialog', { name: 'Check against the bank' })).toHaveTextContent(
      'without the interest earned since the last interest date',
    );
  });

  it('keeps the interest a capitalizing deposit owes after an early closure visible', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(
        { ...dollars, status: 'closed', closedOn: '2026-10-05', due: '12.30', nextPayout: null },
        { interestPosted: '62.71' },
      ),
    );
    open(`/deposits/${dollars.id}?currency=USD`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dollar B' })).toBeInTheDocument();
    expect(screen.getByText('Interest added so far').parentElement).toHaveTextContent('$62.71');
    expect(screen.getByText('Interest to be paid out').parentElement).toHaveTextContent('$12.30');
  });

  it('records a movement and shows the new figures', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    const add = vi
      .spyOn(depositsApi, 'addMovement')
      .mockResolvedValue(detail(savings, { principal: '110000.00' }));
    open(`/deposits/${savings.id}?currency=RUB`);
    await user.click(await screen.findByRole('button', { name: 'Record movement' }));
    const dialog = screen.getByRole('dialog', { name: 'Record a movement' });
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.type(within(dialog).getByLabelText('Date'), '2026-10-10');
    await user.type(within(dialog).getByLabelText('Amount, RUB'), '10000');
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(savings.id, {
        requestId: expect.any(String),
        date: '2026-10-10',
        kind: 'topup',
        amount: '10000',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('In the deposit').parentElement).toHaveTextContent('₽110,000.00');
  });

  it('sends the same request id when the same movement is retried and a new one when it changed', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    const add = vi
      .spyOn(depositsApi, 'addMovement')
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue(detail(savings));
    open(`/deposits/${savings.id}?currency=RUB`);
    await user.click(await screen.findByRole('button', { name: 'Record movement' }));
    const dialog = screen.getByRole('dialog', { name: 'Record a movement' });
    await user.type(within(dialog).getByLabelText('Amount, RUB'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[1][1].requestId).toBe(add.mock.calls[0][1].requestId);
    await user.type(within(dialog).getByLabelText('Amount, RUB'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(3));
    expect(add.mock.calls[2][1].requestId).not.toBe(add.mock.calls[0][1].requestId);
  });

  it('shows the explanation the server gives for a movement the deposit could not have had', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    const refusal = Object.assign(new Error('refused'), {
      isAxiosError: true,
      response: { status: 422, data: { message: 'The deposit could not have had this movement' } },
    });
    vi.spyOn(depositsApi, 'addMovement').mockRejectedValue(refusal);
    open(`/deposits/${savings.id}`);
    await user.click(await screen.findByRole('button', { name: 'Record movement' }));
    const dialog = screen.getByRole('dialog', { name: 'Record a movement' });
    await user.type(within(dialog).getByLabelText('Amount, RUB'), '999999');
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The deposit could not have had this movement',
    );
  });

  it('saves a balance check and shows the difference', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    const check = {
      id: 'c1',
      checkedOn: '2026-10-11',
      bankBalance: '100330.00',
      calculated: '100328.77',
      difference: '1.23',
    };
    const addCheck = vi
      .spyOn(depositsApi, 'addCheck')
      .mockResolvedValue(detail(savings, { checks: [check], lastCheck: check }));
    open(`/deposits/${savings.id}`);
    await user.click(await screen.findByRole('button', { name: 'Check balance' }));
    const dialog = screen.getByRole('dialog', { name: 'Check against the bank' });
    expect(dialog).toHaveTextContent('and all the interest earned so far');
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.type(within(dialog).getByLabelText('Date'), '2026-10-11');
    await user.type(within(dialog).getByLabelText('Balance in the bank, RUB'), '100330');
    await user.click(within(dialog).getByRole('button', { name: 'Save check' }));
    await waitFor(() =>
      expect(addCheck).toHaveBeenCalledWith(savings.id, {
        requestId: expect.any(String),
        checkedOn: '2026-10-11',
        bankBalance: '100330',
      }),
    );
    const checks = await screen.findByRole('region', { name: 'Checks against the bank' });
    expect(within(checks).getByText('+₽1.23')).toBeInTheDocument();
  });

  it('shows a bank balance below the calculated one with a single minus', async () => {
    const check = {
      id: 'c2',
      checkedOn: '2026-10-11',
      bankBalance: '100327.54',
      calculated: '100328.77',
      difference: '-1.23',
    };
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(savings, { checks: [check], lastCheck: check }),
    );
    open(`/deposits/${savings.id}`);
    expect((await screen.findAllByText('-₽1.23')).length).toBeGreaterThan(0);
    expect(screen.queryByText('--₽1.23')).not.toBeInTheDocument();
  });

  it('asks before deleting and goes back to the list', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    const remove = vi.spyOn(depositsApi, 'remove').mockResolvedValue();
    open(`/deposits/${savings.id}`);
    await user.click(await screen.findByRole('button', { name: 'Delete deposit' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete deposit' });
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(savings.id));
    expect(await screen.findByRole('heading', { name: 'No deposits yet' })).toBeInTheDocument();
  });
});
