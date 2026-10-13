import { type Deposit, type DepositDetail, type DepositList, depositsApi } from '@api/deposits.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInflationBasis } from '../shell/inflation-basis';
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

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
});
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
  it('paints the deposits it kept at once when the page is opened again', async () => {
    const answer = vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings]));
    open('/deposits');
    await screen.findByRole('link', { name: /Savings A/ });
    cleanup();
    answer.mockReturnValue(new Promise(() => undefined));
    open('/deposits');
    expect(screen.getByRole('link', { name: /Savings A/ })).toBeTruthy();
    expect(screen.queryByText('Loading deposits')).toBeNull();
  });

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

  it('offers daily interest and no longer quarterly', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add deposit' });
    const interest = within(dialog).getByLabelText('Interest');
    expect(
      within(interest)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Every day', 'Every month', 'At the end of the term']);
    expect(interest).toHaveValue('monthly');
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
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(dollars, {
        interestPosted: '50.41',
        periods: [
          { from: '2026-07-01', to: '2026-10-01', interest: '50.41', treatment: 'capitalized' },
        ],
      }),
    );
    open(`/deposits/${dollars.id}?currency=USD`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dollar B' })).toBeInTheDocument();
    expect(screen.getByText('Interest added so far').parentElement).toHaveTextContent('$50.41');
    expect(screen.queryByText('Interest to be paid out')).not.toBeInTheDocument();
  });

  it('lists the interest of a deposit that posts every day five periods a page, newest first', async () => {
    const user = userEvent.setup();
    const day = (index: number) =>
      new Date(Date.UTC(2026, 6, 2 + index)).toISOString().slice(0, 10);
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(dollars, {
        periods: Array.from({ length: 45 }, (_unused, index) => ({
          from: day(index - 1),
          to: day(index),
          interest: '0.55',
          treatment: 'capitalized' as const,
        })),
      }),
    );
    open(`/deposits/${dollars.id}?currency=USD`);
    const periods = (await screen.findByRole('heading', { name: 'Interest by period' })).closest(
      'section',
    ) as HTMLElement;
    // A header row and five periods: the page no longer grows as it scrolls.
    expect(within(periods).getAllByRole('row')).toHaveLength(6);
    expect(within(periods).getAllByRole('row')[1]).toHaveTextContent('Aug 15, 2026');
    expect(within(periods).getByRole('status')).toHaveTextContent('1–5 of 45 periods');
    await user.click(within(periods).getByRole('button', { name: 'Next' }));
    expect(within(periods).getAllByRole('row')).toHaveLength(6);
    expect(within(periods).getAllByRole('row')[1]).toHaveTextContent('Aug 10, 2026');
    expect(within(periods).getByRole('status')).toHaveTextContent('6–10 of 45 periods');
  });

  it('lists many payouts five a page and keeps the deposit’s own top-up unremovable', async () => {
    const user = userEvent.setup();
    const payouts = Array.from({ length: 7 }, (_unused, index) => ({
      id: `p${index + 1}`,
      date: `2026-0${7 + Math.floor((index + 1) / 4)}-${String(1 + ((index + 1) % 4) * 7).padStart(2, '0')}`,
      kind: 'interest-payout' as const,
      amount: '10.00',
      comment: null,
    }));
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(savings, {
        movements: [
          { id: 'm1', date: '2026-07-01', kind: 'topup', amount: '100000.00', comment: null },
          ...payouts,
        ],
      }),
    );
    open(`/deposits/${savings.id}?currency=RUB`);
    const movements = (await screen.findByRole('heading', { name: 'Movements' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(movements).getAllByRole('row')).toHaveLength(6);
    expect(within(movements).getByRole('status')).toHaveTextContent('1–5 of 8 movements');
    expect(within(movements).getAllByRole('button', { name: /^Remove/ })).toHaveLength(5);
    await user.click(within(movements).getByRole('button', { name: 'Next' }));
    // The last page ends with the top-up that opened the deposit, which has no Remove.
    expect(within(movements).getAllByRole('row')).toHaveLength(4);
    expect(within(movements).getAllByRole('button', { name: /^Remove/ })).toHaveLength(2);
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
        {
          interestPosted: '62.71',
          periods: [
            { from: '2026-07-01', to: '2026-10-01', interest: '50.41', treatment: 'capitalized' },
            { from: '2026-10-01', to: '2026-10-05', interest: '12.30', treatment: 'payable' },
          ],
        },
      ),
    );
    open(`/deposits/${dollars.id}?currency=USD`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dollar B' })).toBeInTheDocument();
    expect(screen.getByText('Interest added so far').parentElement).toHaveTextContent('$50.41');
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

describe('INFL-DEPOSIT: a deposit after inflation', () => {
  const official = {
    inflationPercent: '8.90',
    ratePercent: '2.84',
    gain: '2450.10',
    estimated: true,
  };
  const own = {
    ...official,
    inflationPercent: '10.00',
    ratePercent: '1.82',
    gain: '-120.50',
    ownRate: true,
  };
  const inflated: Deposit = {
    ...savings,
    interestEarned: '3328.77',
    real: { official, personal: own },
  };
  const periods: DepositDetail['periods'] = [
    {
      from: '2026-07-01',
      to: '2026-08-01',
      interest: '1019.18',
      treatment: 'payable',
      afterInflation: { official: '52.01', personal: '-31.40' },
    },
  ];

  afterEach(() => setInflationBasis('official'));

  it('INFL-DEPOSIT-LIST shows the real rate and the interest after inflation beside the nominal ones', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([inflated]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })) as HTMLElement;
    expect(within(card).getByText('Real +2.84% a year after 8.90% inflation')).toBeInTheDocument();
    expect(within(card).getByText('₽3,328.77')).toBeInTheDocument();
    expect(within(card).getByText(/\+₽2,450\.10 after inflation/)).toBeInTheDocument();
  });

  it('INFL-DEPOSIT-OWN-RATE follows the rate the owner chose in Settings', async () => {
    setInflationBasis('personal');
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([inflated]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })) as HTMLElement;
    expect(within(card).getByText('Real +1.82% a year after 10.00% inflation')).toBeInTheDocument();
    expect(within(card).getByText(/-₽120\.50 after inflation/)).toBeInTheDocument();
  });

  it('INFL-DEPOSIT-LIST-UNKNOWN states no rate it does not have and keeps the nominal interest', async () => {
    const unknown = { ...official, inflationPercent: null, ratePercent: null, gain: null };
    vi.spyOn(depositsApi, 'list').mockResolvedValue(
      list([{ ...inflated, real: { official: unknown, personal: unknown } }]),
    );
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })) as HTMLElement;
    expect(within(card).getByText('₽3,328.77')).toBeInTheDocument();
    expect(within(card).queryByText(/inflation/)).toBeNull();
  });

  it('INFL-DEPOSIT-KEPT-ANSWER shows a list the browser saved before these figures existed', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })) as HTMLElement;
    expect(within(card).queryByText(/inflation/)).toBeNull();
    expect(within(card).queryByText('Interest earned')).toBeNull();
  });

  it('INFL-DEPOSIT-DETAIL shows the real rate, the interest after inflation and each period after it', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(inflated, { periods }));
    open(`/deposits/${savings.id}`);
    expect(
      await screen.findByText(/Real \+2\.84% a year after 8\.90% inflation/),
    ).toBeInTheDocument();
    expect(screen.getByText(/at the official rate, latest months estimated/)).toBeInTheDocument();
    const earned = screen.getByText('Interest earned').closest('div') as HTMLElement;
    expect(within(earned).getByText('₽3,328.77')).toBeInTheDocument();
    expect(within(earned).getByText(/\+₽2,450\.10 after RUB inflation/)).toBeInTheDocument();
    const table = screen.getByRole('columnheader', { name: 'After inflation' }).closest('table');
    expect(within(table as HTMLElement).getByText('+₽52.01')).toBeInTheDocument();
  });

  it('INFL-DEPOSIT-DETAIL-OWN-RATE names the rate the figures rest on', async () => {
    setInflationBasis('personal');
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(inflated, { periods }));
    open(`/deposits/${savings.id}`);
    expect(
      await screen.findByText(/Real \+1\.82% a year after 10\.00% inflation/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/at your own rate/).length).toBeGreaterThan(0);
    expect(screen.getByText('-₽31.40')).toBeInTheDocument();
  });

  it('INFL-DEPOSIT-DETAIL-KEPT-ANSWER leaves out the column an older saved answer has no figures for', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open(`/deposits/${savings.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Savings A' });
    expect(screen.queryByRole('columnheader', { name: 'After inflation' })).toBeNull();
    expect(screen.queryByText(/inflation/)).toBeNull();
  });
});
