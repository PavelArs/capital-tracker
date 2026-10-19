import {
  type Deposit,
  type DepositChartPoint,
  type DepositDetail,
  type DepositList,
  depositsApi,
} from '@api/deposits.api';
import { type PortfolioValuation, portfolioValuationApi } from '@api/portfolio-valuation.api';
import { forgetReads } from '@api/read-cache';
import { ToastProvider } from '@contexts/ToastContext';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import ToastViewport from '../../components/Toast';
import { setInflationBasis } from '../shell/inflation-basis';
import { setValueView } from '../shell/value-view';
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
  rates:
    deposit.ratePercent === null
      ? []
      : [{ effectiveFrom: '2026-07-01', ratePercent: deposit.ratePercent }],
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
  // The list asks for net worth for the share of it; unanswered unless a test answers it.
  vi.spyOn(portfolioValuationApi, 'get').mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Net worth as GET /accounting/portfolio states it, in RUB. */
const netWorth = (totalValue: string | null): PortfolioValuation => ({
  at: '2026-10-11T12:00:00.000Z',
  currency: 'RUB',
  mainCurrency: 'RUB',
  rates: [],
  completeness: totalValue === null ? 'incomplete' : 'complete',
  totalValue,
  pricedSubtotal: '5550150.70',
  missingPriceCount: totalValue === null ? 1 : 0,
  stalePriceCount: 0,
  unavailableAccountCount: 0,
  depositsValue: '555015.07',
  unratedDepositCount: 0,
  costBasis: null,
  knownCostSubtotal: '0',
  unknownCostCount: 0,
  missingRateCount: 0,
  unrealizedPnl: null,
  unrealizedReturnPercent: null,
  knownUnrealizedPnl: null,
  knownUnrealizedReturnPercent: null,
  realizedPnl: null,
  knownRealizedSubtotal: '0',
  unknownRealizedCount: 0,
  assets: [],
  allocation: { complete: totalValue !== null, byAsset: [], byType: [], byAccount: [] },
  accounts: [],
});

/** Below 640 px, as a phone is. */
const phone = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 639.98px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

function open(path: string) {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/deposits" element={<DepositsPage />} />
          <Route path="/deposits/:depositId" element={<DepositPage />} />
        </Routes>
      </MemoryRouter>
      <ToastViewport />
    </ToastProvider>,
  );
}

describe('RUB-PRINCIPAL: entered and capitalized money', () => {
  it.each([
    [true, '1019.18', '101019.18', '₽101,019'],
    [true, '0.00', '100000.75', '₽100,000.75'],
    [false, '1019.18', '100000.75', '₽100,000.75'],
  ] as const)(
    'RUB-PRINCIPAL capitalized=%s posted=%s',
    async (capitalized, interestPosted, principal, shown) => {
      vi.spyOn(depositsApi, 'get').mockResolvedValue(
        detail({ ...savings, capitalized, principal }, { interestPosted }),
      );
      open(`/deposits/${savings.id}`);
      await screen.findByRole('heading', { level: 2, name: 'Savings A' });
      const value = screen.getByText('In the deposit').nextElementSibling;
      expect(value).toHaveTextContent(shown);
      if (capitalized && interestPosted !== '0.00')
        expect(value).not.toHaveTextContent('101,019.18');
    },
  );
});

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
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).getByText('₽100,328')).toBeInTheDocument();
    expect(
      within(card).getByText('12% · interest paid monthly · until Dec 1, 2026'),
    ).toBeInTheDocument();
    expect(within(card).getAllByText(/₽1,019 on Nov 1, 2026/)[0]).toBeInTheDocument();
    expect(within(card).getByText('Not checked against the bank yet')).toBeInTheDocument();
    const usd = screen.getByRole('link', { name: /Dollar B/ }).closest('li') as HTMLElement;
    expect(within(usd).getByText('₽454,686')).toBeInTheDocument();
    expect(within(usd).getByText('$5,052.07')).toBeInTheDocument();
    expect(within(usd).getByText(/differs by \$0\.03/)).toBeInTheDocument();
    const total = screen.getByRole('region', { name: 'Total in deposits' });
    expect(within(total).getByText('₽555,015')).toBeInTheDocument();
    expect(within(card).getByRole('link')).toHaveAttribute(
      'href',
      `/deposits/${savings.id}?currency=RUB`,
    );
  });

  it('BANK-PROTOTYPE shows bank product rows and the account-aware add action', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings]));
    open('/deposits');
    expect(await screen.findByRole('heading', { level: 1, name: 'Banks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add deposit or account' })).toBeInTheDocument();
    const product = await screen.findByRole('link', { name: /Savings A/ });
    expect(product).toHaveClass('deposit-product__row');
    expect(product.querySelector('.ui-card')).toBeNull();
    const details = product.closest('li')?.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await userEvent.click(within(details).getByText('Interest and balance details'));
    expect(details.open).toBe(true);
    expect(within(details).getByText('Next interest')).toBeVisible();
  });

  it('invites the first deposit when there is none', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    open('/deposits');
    expect(await screen.findByRole('heading', { name: 'No deposits yet' })).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    vi.spyOn(depositsApi, 'list').mockRejectedValue(new Error('down'));
    open('/deposits');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your deposits");
  });

  it('adds a deposit from the dialog and opens it', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    vi.spyOn(depositsApi, 'preview').mockReturnValue(new Promise(() => undefined));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(savings));
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add bank deposit' });
    expect(within(dialog).getByLabelText('Bank')).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    expect(within(dialog).getByLabelText('Bank')).toHaveAccessibleDescription('Enter the bank');
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Name (optional)'), 'Savings A');
    await user.type(within(dialog).getByLabelText('Amount put in'), '100000');
    await user.type(within(dialog).getByLabelText('Rate, % a year'), '12');
    await user.clear(within(dialog).getByLabelText('Opened on'));
    await user.type(within(dialog).getByLabelText('Opened on'), '2026-07-01');
    await user.type(within(dialog).getByLabelText('Ends on (optional)'), '2026-12-01');
    await user.click(within(dialog).getByLabelText('Interest is added to the deposit'));
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({
      requestId: expect.any(String),
      kind: 'term-deposit',
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Savings A' })).toBeInTheDocument();
  });

  it.each(['term-deposit', 'account'] as const)(
    "DEP-OPENING-RATE asks for the opening rate of a %s rather than applying today's rate to past days",
    async (kind) => {
      const user = userEvent.setup();
      vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
      open('/deposits');
      await user.click(
        (await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0],
      );
      if (kind === 'account')
        await user.click(screen.getByRole('radio', { name: 'Savings or current account' }));
      const dialog = screen.getByRole('dialog');
      const rate = within(dialog).getByLabelText(/^Rate, % a year/);
      expect(rate).toHaveAccessibleDescription(/rate from the opening date/i);
      expect(rate).toHaveAccessibleDescription(/date each took effect/i);
      expect(rate).not.toHaveAccessibleDescription(/pays now/i);
      if (kind === 'account')
        expect(rate).toHaveAccessibleDescription(/Leave it blank if unknown/i);
    },
  );

  it('DEP-ACCOUNT adds a savings or current account with no end date and no rate, sent as the owner entered it', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    const preview = vi.spyOn(depositsApi, 'preview').mockReturnValue(new Promise(() => undefined));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(savings));
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0]);
    const kind = within(screen.getByRole('dialog', { name: 'Add bank deposit' })).getByRole(
      'radiogroup',
      { name: 'Kind' },
    );
    await user.click(within(kind).getByRole('radio', { name: 'Savings or current account' }));
    const dialog = screen.getByRole('dialog', { name: 'Add savings or current account' });
    expect(within(dialog).queryByLabelText('Ends on (optional)')).not.toBeInTheDocument();
    await user.click(within(dialog).getByText('More options'));
    expect(within(dialog).queryByLabelText('If closed early')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Days in a year')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Rate, % a year (optional)')).not.toBeRequired();
    expect(
      within(within(dialog).getByLabelText('Interest comes'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Every day', 'Every month']);
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Amount put in'), '50000');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({
      requestId: expect.any(String),
      kind: 'account',
      name: 'Account',
      bank: 'Synthetic Bank',
      currency: 'RUB',
      startDate: expect.any(String),
      endDate: null,
      payout: 'monthly',
      capitalized: true,
      dayBasis: 'actual-365',
      earlyClose: 'keeps-interest',
      ratePercent: null,
      amount: '50000',
    });
    // Without a rate there is nothing to preview: no figures are invented for it.
    expect(preview).not.toHaveBeenCalled();
  });

  it('DEP-ACCOUNT sends a rate the owner gives for an account, and moves an at-the-end payout to every month', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    vi.spyOn(depositsApi, 'preview').mockReturnValue(new Promise(() => undefined));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(savings));
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0]);
    const term = screen.getByRole('dialog', { name: 'Add bank deposit' });
    await user.selectOptions(within(term).getByLabelText('Interest comes'), 'at-end');
    await user.click(within(term).getByRole('radio', { name: 'Savings or current account' }));
    const dialog = screen.getByRole('dialog', { name: 'Add savings or current account' });
    expect(within(dialog).getByLabelText('Interest comes')).toHaveValue('monthly');
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Amount put in'), '50000');
    await user.type(within(dialog).getByLabelText('Rate, % a year (optional)'), '5.25');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'account',
        ratePercent: '5.25',
        endDate: null,
        payout: 'monthly',
      }),
    );
  });

  it('classes-07 asks for the bank first, an optional name, the currency as a choice and the terms as the prototype words them', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings, dollars]));
    vi.spyOn(depositsApi, 'preview').mockReturnValue(new Promise(() => undefined));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(dollars));
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(dollars));
    open('/deposits');
    await user.click(await screen.findByRole('button', { name: 'Add deposit or account' }));
    const dialog = screen.getByRole('dialog', { name: 'Add bank deposit' });
    const bank = within(dialog).getByLabelText('Bank');
    expect(bank).toHaveFocus();
    // The banks already used are one tap away, each once.
    const chip = within(dialog).getByRole('button', { name: 'Synthetic Bank' });
    await user.click(chip);
    expect(bank).toHaveValue('Synthetic Bank');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    const currency = within(dialog).getByRole('radiogroup', { name: 'Currency' });
    expect(
      within(currency)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).value),
    ).toEqual(['RUB', 'USD', 'EUR']);
    expect(within(currency).getByRole('radio', { name: 'RUB' })).toBeChecked();
    await user.click(within(currency).getByRole('radio', { name: 'USD' }));
    const amount = within(dialog).getByLabelText('Amount put in');
    expect(amount.closest('.ui-affix')).toHaveTextContent('USD');
    const rate = within(dialog).getByLabelText('Rate, % a year');
    expect(rate.closest('.ui-affix')).toHaveTextContent('%');
    expect(rate).toHaveAttribute('placeholder', '16');
    expect(within(dialog).getByLabelText('Opened on')).toHaveAttribute('type', 'date');
    expect(within(dialog).getByLabelText('Ends on (optional)')).toHaveAttribute('type', 'date');
    expect(within(dialog).getByLabelText('Interest comes')).toHaveValue('monthly');
    expect(within(dialog).getByLabelText('Interest is added to the deposit')).toBeChecked();
    // The name may stay empty: the deposit is then called Deposit.
    expect(within(dialog).getByLabelText('Name (optional)')).toHaveAttribute(
      'placeholder',
      'Deposit',
    );
    await user.type(amount, '5000');
    await user.type(rate, '4');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Deposit',
      bank: 'Synthetic Bank',
      currency: 'USD',
      capitalized: true,
    });
  });

  it('classes-04 marks every problem under its field and puts the keyboard on the first one', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(savings));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add bank deposit' });
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Rate, % a year'), '12.34567');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    const amount = within(dialog).getByLabelText('Amount put in');
    const rate = within(dialog).getByLabelText('Rate, % a year');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAccessibleDescription('Enter the amount put in');
    expect(rate).toHaveAttribute('aria-invalid', 'true');
    expect(rate).toHaveAccessibleDescription('Percent a year, up to four decimals');
    expect(within(dialog).getByLabelText('Bank')).not.toHaveAttribute('aria-invalid');
    // Said once: the focus takes each problem with its field, so the messages are no alerts.
    expect(within(dialog).queryAllByRole('alert')).toHaveLength(0);
    expect(within(dialog).getByText('Enter the amount put in')).toBeVisible();
    await waitFor(() => expect(amount).toHaveFocus());
    // Fixing a field clears its message at once.
    await user.type(amount, '1000');
    expect(amount).not.toHaveAttribute('aria-invalid');
    expect(within(dialog).queryByText('Enter the amount put in')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  describe('classes-05: the figures of the deposit being entered', () => {
    const terms = {
      kind: 'term-deposit',
      name: 'Deposit',
      bank: 'Synthetic Bank',
      currency: 'RUB',
      startDate: '2026-07-01',
      endDate: null,
      payout: 'monthly',
      capitalized: false,
      dayBasis: 'actual-365',
      earlyClose: 'forfeits-interest',
      ratePercent: '12',
      amount: '100000',
    };
    const enter = async (user: ReturnType<typeof userEvent.setup>, end?: string) => {
      vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
      open('/deposits');
      await user.click(
        (await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0],
      );
      const dialog = screen.getByRole('dialog', { name: 'Add bank deposit' });
      await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
      await user.type(within(dialog).getByLabelText('Amount put in'), '100000');
      await user.type(within(dialog).getByLabelText('Rate, % a year'), '12');
      await user.clear(within(dialog).getByLabelText('Opened on'));
      await user.type(within(dialog).getByLabelText('Opened on'), '2026-07-01');
      if (end) await user.type(within(dialog).getByLabelText('Ends on (optional)'), end);
      await user.click(within(dialog).getByLabelText('Interest is added to the deposit'));
      return dialog;
    };

    it('classes-05 says when the first interest comes, from the server, and drops it once an entry changes', async () => {
      const user = userEvent.setup();
      const preview = vi.spyOn(depositsApi, 'preview').mockResolvedValue({
        atMaturity: null,
        firstPayout: { date: '2026-08-01', interest: '1019.18', treatment: 'payable' },
      });
      const dialog = await enter(user);
      expect(
        await within(dialog).findByText('The first interest, ₽1,019, comes on Aug 1, 2026.'),
      ).toBeInTheDocument();
      expect(preview).toHaveBeenLastCalledWith(terms, expect.any(AbortSignal));
      preview.mockReturnValue(new Promise(() => undefined));
      await user.type(within(dialog).getByLabelText('Amount put in'), '0');
      expect(within(dialog).queryByText(/The first interest/)).toBeNull();
    });

    it('classes-05 gives the balance at the end of the term and the interest in it', async () => {
      const user = userEvent.setup();
      vi.spyOn(depositsApi, 'preview').mockResolvedValue({
        atMaturity: { date: '2026-12-01', balance: '105030.14', interest: '5030.14' },
        firstPayout: { date: '2026-08-01', interest: '1019.18', treatment: 'payable' },
      });
      const dialog = await enter(user, '2026-12-01');
      const note = await within(dialog).findByRole('note');
      expect(note).toHaveTextContent(
        'At this rate, at the end of the term, on Dec 1, 2026: ₽105,030, of which ₽5,030 interest. The first interest, ₽1,019, comes on Aug 1, 2026.',
      );
    });

    it('deposits-preview stops the earlier preview when the terms change and when the dialog closes', async () => {
      const user = userEvent.setup();
      const preview = vi
        .spyOn(depositsApi, 'preview')
        .mockReturnValue(new Promise(() => undefined));
      const dialog = await enter(user);
      await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
      const signal = (call: number) => preview.mock.calls[call][1] as AbortSignal;
      expect(signal(0).aborted).toBe(false);
      await user.type(within(dialog).getByLabelText('Amount put in'), '0');
      expect(signal(0).aborted).toBe(true);
      await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
      expect(signal(1).aborted).toBe(false);
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(signal(1).aborted).toBe(true);
    });

    it('classes-05 shows no figure, and no zero, when the preview cannot be computed', async () => {
      const user = userEvent.setup();
      const preview = vi.spyOn(depositsApi, 'preview').mockRejectedValue(new Error('down'));
      const dialog = await enter(user);
      await waitFor(() => expect(preview).toHaveBeenCalled());
      expect(within(dialog).queryByRole('note')).toBeNull();
      expect(within(dialog).queryByText(/(?<![\d,.])₽0/)).toBeNull();
    });
  });

  it('offers daily interest and no longer quarterly', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add bank deposit' });
    const interest = within(dialog).getByLabelText('Interest comes');
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
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add bank deposit' });
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Amount put in'), '1000');
    await user.type(within(dialog).getByLabelText('Rate, % a year'), '12');
    await user.clear(within(dialog).getByLabelText('Opened on'));
    await user.type(within(dialog).getByLabelText('Opened on'), '2026-07-01');
    await user.type(within(dialog).getByLabelText('Ends on (optional)'), '2999-01-01');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Ends on (optional)')).toHaveFocus());
    expect(within(dialog).getByLabelText('Ends on (optional)')).toHaveAccessibleDescription(
      /at most 30 years/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an amount the server would not accept before sending it', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    const create = vi.spyOn(depositsApi, 'create').mockResolvedValue(detail(savings));
    open('/deposits');
    await user.click((await screen.findAllByRole('button', { name: 'Add deposit or account' }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add bank deposit' });
    await user.type(within(dialog).getByLabelText('Bank'), 'Synthetic Bank');
    await user.type(within(dialog).getByLabelText('Amount put in'), '1000000000000');
    await user.type(within(dialog).getByLabelText('Rate, % a year'), '12');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Amount put in')).toHaveFocus());
    expect(within(dialog).getByLabelText('Amount put in')).toHaveAccessibleDescription(
      /up to 12 digits/,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

// An account with no rate entered: its interest is unknown, so none is stated (DEP-ACCOUNT).
const unrated: Deposit = {
  ...savings,
  id: '00000000-0000-4000-8000-000000000003',
  kind: 'account',
  name: 'Current C',
  currency: 'RUB',
  endDate: null,
  payout: 'monthly',
  capitalized: true,
  ratePercent: null,
  interestMissing: true,
  accrued: null,
  due: null,
  interestEarned: null,
  nextPayout: null,
  atMaturity: null,
  principal: '50000.00',
  balance: '50000.00',
  values: { USD: '555.55', EUR: '500.00', RUB: '50000.00' },
};

describe('DEP-ACCOUNT: an account with no rate shows its interest as missing, not as 0.00', () => {
  it.each([null, '6'])(
    'DEP-ACCOUNT-PERIODS explains hidden periods when the current rate is %s',
    async (ratePercent) => {
      vi.spyOn(depositsApi, 'get').mockResolvedValue(
        detail(
          { ...unrated, ratePercent },
          {
            periods: [],
            rates: ratePercent === null ? [] : [{ effectiveFrom: '2026-10-01', ratePercent }],
          },
        ),
      );
      open(`/deposits/${unrated.id}?currency=RUB`);
      const periods = await screen.findByRole('region', { name: 'Interest by period' });
      expect(periods).toHaveTextContent(
        'Interest periods are unavailable for days with no rate entered.',
      );
      expect(periods).not.toHaveTextContent('No interest has been posted yet.');
    },
  );

  it('DEP-ACCOUNT-PERIODS keeps the unposted message when the rate history is complete', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings, { periods: [] }));
    open(`/deposits/${savings.id}?currency=RUB`);
    const periods = await screen.findByRole('region', { name: 'Interest by period' });
    expect(periods).toHaveTextContent('No interest has been posted yet.');
    expect(periods).not.toHaveTextContent('no rate entered');
  });

  it('says on its card that the interest is not counted, and what the list total leaves out', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue({
      ...list([unrated]),
      interestMissingCount: 1,
    });
    open('/deposits?currency=RUB');
    const card = (await screen.findByRole('link', { name: /Current C/ })).closest(
      'li',
    ) as HTMLElement;
    expect(card).toHaveTextContent('Interest');
    expect(card).toHaveTextContent('Not counted, no rate entered');
    expect(card).not.toHaveTextContent('Interest earned');
    expect(card).not.toHaveTextContent(/₽0\.00/);
    expect(card).not.toHaveTextContent('Next interest');
    expect(
      screen.getByText(
        /1 account has days with no rate entered; the interest of those days is not counted\./,
      ),
    ).toBeInTheDocument();
  });

  it.each([null, '6'])(
    'DEP-ACCOUNT-GAP hides dependent capitalized interest at rate %s',
    async (ratePercent) => {
      vi.spyOn(depositsApi, 'get').mockResolvedValue(
        detail(
          { ...unrated, ratePercent, capitalized: true, interestMissing: true },
          {
            periods: [],
            rates: ratePercent === null ? [] : [{ effectiveFrom: '2026-08-01', ratePercent }],
          },
        ),
      );
      open(`/deposits/${unrated.id}?currency=RUB`);
      await screen.findByRole('heading', { level: 2, name: 'Current C' });
      expect(screen.queryByText('Interest added so far')).toBeNull();
      if (ratePercent !== null)
        expect(
          screen.getByText(/Later interest also depends on those missing amounts/),
        ).toBeInTheDocument();
      else
        expect(
          screen.getByText(/No rate entered, so the interest is not counted/),
        ).toBeInTheDocument();
    },
  );

  it('says it once on the page, with no interest figures and no periods', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(unrated, { periods: [] }));
    open(`/deposits/${unrated.id}?currency=RUB`);
    expect(await screen.findByRole('heading', { level: 2, name: 'Current C' })).toBeInTheDocument();
    expect(screen.getByText(/No rate entered, so the interest is not counted/)).toBeInTheDocument();
    expect(screen.queryByText('Interest earned')).toBeNull();
    expect(screen.queryByText('Earned, not posted yet')).toBeNull();
    expect(screen.queryByText('Interest to be paid out')).toBeNull();
    expect(screen.getByText('In the deposit').parentElement).toHaveTextContent('₽50,000');
  });

  it('a noncapitalizing account states covered later interest and names the earlier missing days', async () => {
    const later: Deposit = {
      ...unrated,
      capitalized: false,
      ratePercent: '6',
      accrued: '12.34',
      due: null,
      interestEarned: null,
      nextPayout: { date: '2026-11-01', interest: '25.00', treatment: 'payable' },
    };
    vi.spyOn(depositsApi, 'list').mockResolvedValue({ ...list([later]), interestMissingCount: 1 });
    open('/deposits?currency=RUB');
    const card = (await screen.findByRole('link', { name: /Current C/ })).closest(
      'li',
    ) as HTMLElement;
    expect(card).toHaveTextContent('Not counted before the first rate');
    expect(card).not.toHaveTextContent('Interest earned');
    cleanup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(later, {
        rates: [{ effectiveFrom: '2026-08-01', ratePercent: '6' }],
        periods: [
          {
            from: '2026-08-01',
            to: '2026-09-01',
            interest: '25.00',
            treatment: 'payable',
            afterInflation: { official: null, personal: null },
          },
        ],
      }),
    );
    open(`/deposits/${later.id}?currency=RUB`);
    expect(
      await screen.findByText(
        /Interest before Aug 1, 2026 is not counted: no rate was entered for those days\. Enter the rate from Jul 1, 2026/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Earned, not posted yet').parentElement).toHaveTextContent('₽12');
    expect(
      screen.getByText(/After-inflation figures are unavailable while earlier interest is missing/),
    ).toBeInTheDocument();
  });

  it.each([false, true])(
    'DEP-ACCOUNT-REAL-GAP names missing interest in Real periods (phone %s)',
    async (narrow) => {
      if (narrow) phone();
      setValueView('real');
      onTestFinished(() => setValueView('nominal'));
      vi.spyOn(depositsApi, 'get').mockResolvedValue(
        detail(
          {
            ...unrated,
            capitalized: false,
            ratePercent: '6',
            real: { official: null, personal: null },
          },
          {
            rates: [{ effectiveFrom: '2026-08-01', ratePercent: '6' }],
            periods: [
              {
                from: '2026-08-01',
                to: '2026-09-01',
                interest: '25.00',
                treatment: 'payable',
                afterInflation: { official: null, personal: null },
              },
            ],
          },
        ),
      );
      open(`/deposits/${unrated.id}?currency=RUB`);
      const periods = await screen.findByRole('region', { name: 'Interest by period' });
      expect(periods).toHaveTextContent('Earlier interest is missing');
      expect(periods).not.toHaveTextContent('No inflation figures for this period');
      setValueView('nominal');
    },
  );

  it('does not compare a bank check with a balance that leaves the interest out', async () => {
    const check = {
      id: 'c1',
      checkedOn: '2026-10-05',
      bankBalance: '50123.00',
      calculated: null,
      difference: null,
    };
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(unrated, { periods: [], checks: [check], lastCheck: check }),
    );
    open(`/deposits/${unrated.id}?currency=RUB`);
    await screen.findByRole('heading', { level: 2, name: 'Current C' });
    const checks = await screen.findByRole('region', { name: 'Checks against the bank' });
    expect(within(checks).getByText('Not compared')).toBeInTheDocument();
    expect(checks).not.toHaveTextContent(/₽0\.00/);
    expect(screen.queryByText('Matches')).toBeNull();
  });

  it('TOAST-CHECK does not say a saved check agrees with the app while the interest is missing', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(unrated, { periods: [] }));
    const check = {
      id: 'c1',
      checkedOn: '2026-10-05',
      bankBalance: '50123.00',
      calculated: null,
      difference: null,
    };
    vi.spyOn(depositsApi, 'addCheck').mockResolvedValue(
      detail(unrated, { periods: [], checks: [check], lastCheck: check }),
    );
    open(`/deposits/${unrated.id}?currency=RUB`);
    await user.click(await screen.findByRole('button', { name: 'Check balance' }));
    const dialog = screen.getByRole('dialog', { name: 'Check against the bank' });
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.type(within(dialog).getByLabelText('Date'), '2026-10-05');
    await user.type(within(dialog).getByLabelText('Balance in the bank, RUB'), '50123');
    await user.click(within(dialog).getByRole('button', { name: 'Save check' }));
    const messages = await screen.findByRole('region', { name: 'Messages' });
    await waitFor(() => expect(messages).toHaveTextContent('Balance check saved'));
    expect(messages).toHaveTextContent('Not compared: the interest is missing');
    expect(messages).not.toHaveTextContent('agree');
  });

  it('keeps the interest figures of an account once a rate is in force', async () => {
    const rated: Deposit = {
      ...unrated,
      ratePercent: '6',
      interestMissing: false,
      accrued: '12.34',
      due: '0.00',
      interestEarned: '12.34',
    };
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(rated));
    open(`/deposits/${rated.id}?currency=RUB`);
    await screen.findByRole('heading', { level: 2, name: 'Current C' });
    expect(screen.getByText('Earned, not posted yet').parentElement).toHaveTextContent('₽12');
    expect(
      screen.queryByText(
        /After-inflation figures are unavailable while earlier interest is missing/,
      ),
    ).toBeNull();
    expect(screen.queryByText(/No rate entered, so the interest is not counted/)).toBeNull();
  });
});

describe('DEP-DETAIL: one deposit', () => {
  it('shows the computed figures, the periods, the movements and the terms', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open(`/deposits/${savings.id}?currency=RUB`);
    expect(await screen.findByRole('heading', { level: 2, name: 'Savings A' })).toBeInTheDocument();
    expect(screen.getByText('Earned, not posted yet').parentElement).toHaveTextContent('₽328');
    expect(screen.getByText('At the end of the term').parentElement).toHaveTextContent('₽104,000');
    const periods = screen.getByRole('region', { name: 'Interest by period' });
    expect(within(periods).getByText('₽1,019')).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Dollar B' })).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Dollar B' })).toBeInTheDocument();
    expect(screen.getByText('Interest added so far').parentElement).toHaveTextContent('$50.41');
    expect(screen.getByText('Interest to be paid out').parentElement).toHaveTextContent('$12.30');
  });

  it('DEP-ACCOUNT tells a withdrawal from an account that it stays open, and a term deposit that it closes', async () => {
    const user = userEvent.setup();
    const account: Deposit = { ...dollars, kind: 'account', currency: 'RUB' };
    for (const [deposit, note] of [
      [account, 'Money you took out of the account. The account stays open when it reaches zero.'],
      [savings, 'Money you took out of the deposit. Taking all of it closes the deposit.'],
    ] as const) {
      vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(deposit));
      open(`/deposits/${deposit.id}?currency=RUB`);
      await user.click(await screen.findByRole('button', { name: 'Record movement' }));
      const dialog = screen.getByRole('dialog', { name: 'Record a movement' });
      await user.selectOptions(within(dialog).getByLabelText('What happened'), 'withdrawal');
      expect(within(dialog).getByText(note)).toBeInTheDocument();
      cleanup();
    }
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
    expect(screen.getByText('In the deposit').parentElement).toHaveTextContent('₽110,000');
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

  it('classes-04 marks each problem of a movement under its field and puts the keyboard on the first', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    const add = vi.spyOn(depositsApi, 'addMovement').mockResolvedValue(detail(savings));
    open(`/deposits/${savings.id}`);
    await user.click(await screen.findByRole('button', { name: 'Record movement' }));
    const dialog = screen.getByRole('dialog', { name: 'Record a movement' });
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    const date = within(dialog).getByLabelText('Date');
    const amount = within(dialog).getByLabelText('Amount, RUB');
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(date).toHaveAccessibleDescription('Pick a date');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAccessibleDescription('Enter the amount');
    await waitFor(() => expect(date).toHaveFocus());
    expect(add).not.toHaveBeenCalled();
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
    expect(within(checks).getByText('+₽1')).toBeInTheDocument();
    // TOAST-CHECK: the toast says what the check found, as the prototype's does.
    expect(screen.getByRole('region', { name: 'Messages' })).toHaveTextContent(
      'Balance check savedDiffers by +₽1',
    );
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
    expect((await screen.findAllByText('-₽2')).length).toBeGreaterThan(0);
    expect(screen.queryByText('--₽2')).not.toBeInTheDocument();
  });

  it.each([
    ['1.23', '+₽1', '₽1'],
    ['-1.23', '-₽2', '-₽2'],
  ])(
    'RUB-CHECK rounds computed %s differences in details, summary and list',
    async (difference, signed, unsigned) => {
      const check = {
        id: 'rounding-check',
        checkedOn: '2026-10-11',
        bankBalance: '100330.45',
        calculated: difference.startsWith('-') ? '100331.68' : '100329.22',
        difference,
      };
      vi.spyOn(depositsApi, 'get').mockResolvedValue(
        detail(savings, { checks: [check], lastCheck: check }),
      );
      open(`/deposits/${savings.id}`);
      const checks = await screen.findByRole('region', { name: 'Checks against the bank' });
      expect(within(checks).getByText(signed)).toBeInTheDocument();
      expect(screen.getByText('Last check').parentElement).toHaveTextContent(signed);
      expect(checks).toHaveTextContent('₽100,330.45');
      cleanup();
      vi.spyOn(depositsApi, 'list').mockResolvedValue(list([{ ...savings, lastCheck: check }]));
      open('/deposits');
      expect(
        (await screen.findByRole('link', { name: /Savings A/ })).closest('li'),
      ).toHaveTextContent(`differs by ${unsigned}`);
    },
  );

  it('asks before deleting and goes back to the list', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([]));
    const remove = vi.spyOn(depositsApi, 'remove').mockResolvedValue();
    open(`/deposits/${savings.id}`);
    await user.click(await screen.findByRole('button', { name: 'Delete deposit' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this deposit?' });
    expect(dialog).toHaveTextContent('this cannot be undone');
    const confirm = within(dialog).getByRole('button', { name: 'Delete deposit' });
    // deposits-delete: the destructive confirmation is the danger button, as for goals.
    expect(confirm).toHaveClass('ui-btn--danger');
    expect(remove).not.toHaveBeenCalled();
    await user.click(confirm);
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

  afterEach(() => {
    setInflationBasis('official');
    setValueView('nominal');
  });

  it('DEP-ONE-NOMINAL-LIST shows the bank figures only and carries the switch', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([inflated]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).getByText('₽3,328')).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/inflation|\breal\b/i);
    expect(screen.getByRole('radio', { name: 'Nominal' })).toBeChecked();
  });

  it('DEP-ONE-REAL-LIST shows the real rate and the interest after inflation, not the nominal interest', async () => {
    setValueView('real');
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([inflated]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).getByText('Real +2.84% a year after 8.90% inflation')).toBeInTheDocument();
    expect(within(card).getByText('Interest after inflation')).toBeInTheDocument();
    expect(within(card).getByText('+₽2,450')).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/3,328|nominal/i);
  });

  it('DEP-ONE-REAL-LIST-END gives the end balance in today money, not the bank balance, under Real', async () => {
    setValueView('real');
    const ending: Deposit = {
      ...inflated,
      atMaturity: {
        date: '2026-12-01',
        balance: '104000.00',
        interest: '4000.00',
        inTodaysMoney: {
          official: { amount: '98000.00', estimated: false },
          personal: null,
        },
      },
    };
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([ending]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(card).toHaveTextContent("At the end, in today's money");
    expect(card).toHaveTextContent('₽98,000');
    expect(card).not.toHaveTextContent('104,000');
  });

  it('DEP-ONE-REAL-LIST-ESTIMATED marks an estimated end balance and estimated interest on the card', async () => {
    setValueView('real');
    const estimated: Deposit = {
      ...inflated,
      atMaturity: {
        date: '2026-12-01',
        balance: '104000.00',
        interest: '4000.00',
        inTodaysMoney: {
          official: { amount: '98000.00', estimated: true },
          personal: null,
        },
      },
      real: { official: { ...official, estimated: true }, personal: own },
    };
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([estimated]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    const end = within(card)
      .getByText("At the end, in today's money")
      .closest('div') as HTMLElement;
    const interest = within(card)
      .getByText('Interest after inflation')
      .closest('div') as HTMLElement;
    expect(end).toHaveTextContent('₽98,000');
    expect(end).toHaveTextContent('estimated');
    expect(interest).toHaveTextContent('estimated');
  });

  it('DEP-ONE-REAL-LIST-FINAL leaves a settled figure without the estimate marker', async () => {
    setValueView('real');
    const settled: Deposit = {
      ...inflated,
      atMaturity: {
        date: '2026-12-01',
        balance: '104000.00',
        interest: '4000.00',
        inTodaysMoney: {
          official: { amount: '98000.00', estimated: false },
          personal: null,
        },
      },
      real: { official: { ...official, estimated: false }, personal: own },
    };
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([settled]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(card).not.toHaveTextContent('estimated');
  });

  it('DEP-ONE-REAL-LIST-END-UNKNOWN shows a dash for an end balance with no figure in today money', async () => {
    setValueView('real');
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([inflated]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    const end = within(card)
      .getByText("At the end, in today's money")
      .closest('div') as HTMLElement;
    expect(end).toHaveTextContent('—');
    expect(card).not.toHaveTextContent('104,000');
  });

  it('DEP-ONE-REAL-LIST-REASONS gives a reason beside every dash on the card', async () => {
    setValueView('real');
    const unknown = { ...official, inflationPercent: null, ratePercent: null, gain: null };
    const ending: Deposit = {
      ...inflated,
      atMaturity: {
        date: '2999-01-01',
        balance: '104000.00',
        interest: '4000.00',
        inTodaysMoney: { official: null, personal: null },
      },
      real: { official: unknown, personal: unknown },
    };
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([ending]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    const interest = within(card)
      .getByText('Interest after inflation')
      .closest('div') as HTMLElement;
    const end = within(card)
      .getByText("At the end, in today's money")
      .closest('div') as HTMLElement;
    expect(interest).toHaveTextContent('no inflation figures yet');
    expect(end).toHaveTextContent('no inflation figures for the term yet');
  });

  it.each([
    ['list', '2026-12-02', '2026-11-30', 'the term has ended'],
    ['detail', '2026-12-02', '2026-11-30', 'The term has ended'],
    ['list', '2026-11-30', '2026-12-02', 'no inflation figures for the term yet'],
    ['detail', '2026-11-30', '2026-12-02', 'No inflation figures for the term yet'],
  ])(
    'DEP-REAL-ASOF uses the %s response day %s despite browser day %s',
    async (view, asOf, browserDay, reason) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(`${browserDay}T12:00:00Z`));
      try {
        setValueView('real');
        const ending: Deposit = {
          ...inflated,
          endDate: '2026-12-01',
          status: asOf > '2026-12-01' ? 'matured' : 'active',
          atMaturity: {
            date: '2026-12-01',
            balance: '104000.00',
            interest: '4000.00',
            inTodaysMoney: { official: null, personal: null },
          },
        };
        vi.spyOn(depositsApi, 'list').mockResolvedValue({ ...list([ending]), asOf });
        vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(ending, { asOf }));
        open(view === 'list' ? '/deposits' : `/deposits/${ending.id}`);
        const end = (await screen.findByText("At the end, in today's money")).closest('div');
        expect(end).toHaveTextContent(reason);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('DEP-ONE-REAL-LIST-ENDED says the term has ended instead of promising a figure', async () => {
    setValueView('real');
    const ended: Deposit = {
      ...inflated,
      atMaturity: {
        date: '2020-01-01',
        balance: '104000.00',
        interest: '4000.00',
        inTodaysMoney: { official: null, personal: null },
      },
    };
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([ended]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    const end = within(card)
      .getByText("At the end, in today's money")
      .closest('div') as HTMLElement;
    expect(end).toHaveTextContent('the term has ended');
    expect(card).not.toHaveTextContent('for the term yet');
  });

  it('DEP-ONE-REAL-DETAIL-ENDED says the term has ended instead of promising a figure', async () => {
    setValueView('real');
    const ended: Deposit = {
      ...inflated,
      atMaturity: {
        date: '2020-01-01',
        balance: '104000.00',
        interest: '4000.00',
        inTodaysMoney: { official: null, personal: null },
      },
    };
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(ended));
    open(`/deposits/${savings.id}`);
    const end = (await screen.findByText("At the end, in today's money")).closest(
      'div',
    ) as HTMLElement;
    expect(end).toHaveTextContent('The term has ended');
    expect(end).not.toHaveTextContent(/yet/);
  });

  it.each(['official', 'personal'] as const)(
    'DEP-ONE-REAL-DETAIL-REASON names missing inflation for a future term under %s',
    async (basis) => {
      setValueView('real');
      setInflationBasis(basis);
      const ending: Deposit = {
        ...inflated,
        atMaturity: {
          date: '2999-01-01',
          balance: '104000.00',
          interest: '4000.00',
          inTodaysMoney: { official: null, personal: null },
        },
      };
      vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(ending));
      open(`/deposits/${savings.id}`);
      const end = (await screen.findByText("At the end, in today's money")).closest('div');
      expect(end).toHaveTextContent('No inflation figures for the term yet');
      expect(end).toHaveTextContent('—');
      expect(end).not.toHaveTextContent('104,000');
    },
  );

  it('DEP-ONE-SWITCH-LIST changes the list from one reading to the other', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([inflated]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(card).not.toHaveTextContent(/inflation/i);
    await user.click(screen.getByRole('radio', { name: 'Real' }));
    expect(card).toHaveTextContent('Real +2.84% a year after 8.90% inflation');
    expect(card).not.toHaveTextContent('3,328');
  });

  it('INFL-DEPOSIT-OWN-RATE follows the rate the owner chose in Settings', async () => {
    setValueView('real');
    setInflationBasis('personal');
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([inflated]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).getByText('Real +1.82% a year after 10.00% inflation')).toBeInTheDocument();
    expect(within(card).getByText('-₽121')).toBeInTheDocument();
  });

  it('INFL-DEPOSIT-LIST-UNKNOWN under Real shows a dash for the interest it cannot read, not the nominal interest', async () => {
    setValueView('real');
    const unknown = { ...official, inflationPercent: null, ratePercent: null, gain: null };
    vi.spyOn(depositsApi, 'list').mockResolvedValue(
      list([{ ...inflated, real: { official: unknown, personal: unknown } }]),
    );
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).getAllByText('—').length).toBeGreaterThan(0);
    expect(card).not.toHaveTextContent('3,328');
    expect(card).not.toHaveTextContent(/Real [+-]/);
  });

  it('INFL-DEPOSIT-KEPT-ANSWER shows a list the browser saved before these figures existed', async () => {
    setValueView('real');
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings]));
    open('/deposits');
    const card = (await screen.findByRole('link', { name: /Savings A/ })).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).queryByText(/inflation/)).toBeNull();
    expect(within(card).queryByText('Interest earned')).toBeNull();
  });

  it('DEP-ONE-NOMINAL-DETAIL shows the bank figures only', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(inflated, { periods }));
    open(`/deposits/${savings.id}`);
    const earned = (await screen.findByText('Interest earned')).closest('div') as HTMLElement;
    expect(within(earned).getByText('₽3,328')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /inflation/i })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Interest' })).toBeInTheDocument();
    const page = screen
      .getByRole('heading', { level: 2, name: 'Savings A' })
      .closest('.shell-page');
    expect(page).not.toHaveTextContent(/inflation|today.s money|\breal\b/i);
  });

  it('DEP-ONE-REAL-DETAIL shows the real rate, the interest and each period after inflation only', async () => {
    setValueView('real');
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(inflated, { periods }));
    open(`/deposits/${savings.id}`);
    expect(
      await screen.findByText(/Real \+2\.84% a year after 8\.90% inflation/),
    ).toBeInTheDocument();
    expect(screen.getByText(/at the official rate, latest months estimated/)).toBeInTheDocument();
    const earned = screen.getByText('Interest after inflation').closest('div') as HTMLElement;
    expect(within(earned).getByText('+₽2,450')).toBeInTheDocument();
    expect(screen.queryByText('Interest earned')).toBeNull();
    expect(screen.queryByText('₽3,328')).toBeNull();
    const table = screen.getByRole('columnheader', { name: 'After inflation' }).closest('table');
    expect(within(table as HTMLElement).getByText('+₽52')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Interest' })).toBeNull();
    expect(within(table as HTMLElement).queryByText('₽1,019')).toBeNull();
  });

  it('DEP-ONE-REAL-DETAIL-OLD-PERIODS shows dashes, not the bank interest, for periods saved without the figure', async () => {
    setValueView('real');
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(inflated));
    open(`/deposits/${savings.id}`);
    const table = (await screen.findByRole('columnheader', { name: 'After inflation' })).closest(
      'table',
    ) as HTMLElement;
    expect(within(table).queryByText('₽1,019')).toBeNull();
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('DEP-ONE-REAL-DETAIL-UNKNOWN shows a dash and the reason for the interest it cannot read', async () => {
    setValueView('real');
    const unknown = { ...official, inflationPercent: null, ratePercent: null, gain: null };
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail({ ...inflated, real: { official: unknown, personal: unknown } }),
    );
    open(`/deposits/${savings.id}`);
    const earned = (await screen.findByText('Interest after inflation')).closest(
      'div',
    ) as HTMLElement;
    expect(earned).toHaveTextContent('—');
    expect(earned).toHaveTextContent('No RUB inflation figures for the whole time yet');
    expect(screen.queryByText('₽3,328')).toBeNull();
  });

  it('INFL-DEPOSIT-DETAIL-OWN-RATE names the rate the figures rest on', async () => {
    setValueView('real');
    setInflationBasis('personal');
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(inflated, { periods }));
    open(`/deposits/${savings.id}`);
    expect(
      await screen.findByText(/Real \+1\.82% a year after 10\.00% inflation/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/at your own rate/).length).toBeGreaterThan(0);
    expect(screen.getByText('-₽32')).toBeInTheDocument();
  });

  it('INFL-DEPOSIT-DETAIL-KEPT-ANSWER leaves out the column an older saved answer has no figures for', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open(`/deposits/${savings.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Savings A' });
    expect(screen.queryByRole('columnheader', { name: 'After inflation' })).toBeNull();
    expect(screen.queryByText(/inflation/)).toBeNull();
  });
});

describe('INFL-DEPOSIT-CHART: the value of a deposit over its life', () => {
  const chart: DepositChartPoint[] = [
    {
      date: '2026-07-01',
      balance: '100000.00',
      invested: '100000.00',
      real: {
        official: { balance: '100000.00', invested: '100000.00', estimated: false },
        personal: { balance: '110000.00', invested: '110000.00', estimated: true },
      },
    },
    {
      date: '2026-08-01',
      balance: '101019.18',
      invested: '100000.00',
      real: {
        // The latest published month is behind this day: the official figure is an estimate.
        official: { balance: '101000.00', invested: '100000.00', estimated: true },
        personal: null,
      },
    },
    {
      date: '2026-10-11',
      balance: '102000.00',
      invested: '100000.00',
      real: { official: null, personal: null },
    },
  ];
  const withChart = (change: Partial<DepositDetail> = {}) =>
    detail({ ...savings, real: { official: null, personal: null } }, { chart, ...change });
  /** Focuses the chart and returns it; the arrow keys then read each month. */
  const focusChart = async () => {
    const group = await screen.findByRole('group', { name: /Use the arrow keys/ });
    act(() => group.focus());
    return within(group);
  };

  afterEach(() => {
    setValueView('nominal');
    setInflationBasis('official');
  });

  it('draws the value and the money put in by month, nominal by default', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(withChart());
    open(`/deposits/${savings.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Savings A' });
    const legend = screen.getByLabelText('Chart legend');
    expect(within(legend).getByText('Value')).toBeInTheDocument();
    expect(within(legend).getByText('Money put in')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Value and money put in over the life of the deposit/ }),
    ).toBeInTheDocument();
  });

  it('reads each month with the arrow keys', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(withChart());
    open(`/deposits/${savings.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Savings A' });
    const user = userEvent.setup();
    const plot = await focusChart();
    await user.keyboard('{ArrowLeft}');
    expect(plot.getByText('₽101,019')).toBeInTheDocument();
    expect(plot.getByText('Money put in')).toBeInTheDocument();
  });

  it('shows today’s money by each reading when the real view is chosen', async () => {
    setValueView('real');
    setInflationBasis('official');
    vi.spyOn(depositsApi, 'get').mockResolvedValue(withChart());
    open(`/deposits/${savings.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Savings A' });
    const legend = screen.getByLabelText('Chart legend');
    expect(within(legend).getByText("Value in today's money")).toBeInTheDocument();
    expect(within(legend).getByText('Money put in, grown by inflation')).toBeInTheDocument();
    expect(
      screen.getByText(/Estimated after the latest published inflation month/),
    ).toBeInTheDocument();
  });

  it('keeps a net money put in below zero on the scale', async () => {
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      withChart({
        chart: [
          { ...chart[0], invested: '100.00', balance: '0.00' },
          { ...chart[1], invested: '-10.00', balance: '0.00' },
        ],
      }),
    );
    open(`/deposits/${savings.id}`);
    await screen.findByRole('group', { name: /Use the arrow keys/ });
    const ticks = Array.from(document.querySelectorAll('.dashboard-chart__tick')).map(
      (tick) => tick.textContent ?? '',
    );
    expect(ticks.some((text) => text.includes('-'))).toBe(true);
  });

  it('says the inflation figures do not reach the life of the deposit when none are known', async () => {
    setValueView('real');
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      withChart({
        chart: chart.map((point) => ({ ...point, real: { official: null, personal: null } })),
      }),
    );
    open(`/deposits/${savings.id}`);
    expect(
      await screen.findByText('Inflation figures do not reach the whole life of this deposit yet.'),
    ).toBeInTheDocument();
  });

  it('follows the rate the owner chose in Settings in the real view', async () => {
    setValueView('real');
    setInflationBasis('personal');
    vi.spyOn(depositsApi, 'get').mockResolvedValue(withChart());
    open(`/deposits/${savings.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Savings A' });
    const user = userEvent.setup();
    const plot = await focusChart();
    // Only the first month has an own-rate figure, so one step back lands on it.
    await user.keyboard('{ArrowLeft}');
    expect(plot.getByRole('status')).toHaveTextContent('₽110,000');
  });

  it('gives the end balance in today’s money by the chosen reading, under Real only', async () => {
    setValueView('real');
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      withChart({
        real: { official: null, personal: null },
        atMaturity: {
          date: '2026-12-01',
          balance: '104000.00',
          interest: '4000.00',
          inTodaysMoney: {
            official: { amount: '98000.00', estimated: false },
            personal: { amount: '99000.00', estimated: true },
          },
        },
      }),
    );
    open(`/deposits/${savings.id}`);
    const end = (await screen.findByText("At the end, in today's money")).closest(
      'div',
    ) as HTMLElement;
    expect(within(end).getByText('₽98,000')).toBeInTheDocument();
    expect(end).not.toHaveTextContent(/104,000|4,000|nominal/i);
    cleanup();
    setInflationBasis('personal');
    open(`/deposits/${savings.id}`);
    const own = (await screen.findByText("At the end, in today's money")).closest(
      'div',
    ) as HTMLElement;
    expect(within(own).getByText('₽99,000')).toBeInTheDocument();
    expect(own).toHaveTextContent('estimated');
    cleanup();
    setValueView('nominal');
    open(`/deposits/${savings.id}`);
    const bank = (await screen.findByText('At the end of the term')).closest('div') as HTMLElement;
    expect(within(bank).getByText('₽104,000')).toBeInTheDocument();
    expect(bank).not.toHaveTextContent(/today.s money/i);
  });
});

describe('classes-19: deposits grouped by bank', () => {
  const other: Deposit = {
    ...savings,
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Other C',
    bank: 'Other Synthetic Bank',
    values: { USD: '10.00', EUR: '9.00', RUB: '900.00' },
  };

  it('classes-19 shows one card per bank with how many deposits it holds and their exact total', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings, dollars, other]));
    open('/deposits?currency=RUB');
    const bank = await screen.findByRole('region', { name: 'Synthetic Bank' });
    expect(within(bank).getByText('2 products')).toBeInTheDocument();
    // 100,328.77 + 454,686.30, summed as decimals.
    expect(within(bank).getByText('₽555,015')).toBeInTheDocument();
    expect(
      within(bank)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([expect.stringContaining('Savings A'), expect.stringContaining('Dollar B')]);
    const second = screen.getByRole('region', { name: 'Other Synthetic Bank' });
    expect(within(second).getByText('1 product')).toBeInTheDocument();
    expect(within(second).getAllByText('₽900').length).toBeGreaterThan(0);
  });

  it('classes-19 marks a bank total incomplete when a deposit has no value in the currency shown', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(
      list([
        savings,
        { ...dollars, bank: 'Synthetic Bank', values: { ...dollars.values, RUB: null } },
      ]),
    );
    open('/deposits?currency=RUB');
    const bank = await screen.findByRole('region', { name: 'Synthetic Bank' });
    const total = bank.querySelector('.deposit-bank__total') as HTMLElement;
    expect(within(total).getByText('₽100,328')).toBeInTheDocument();
    expect(total).toHaveTextContent('Incomplete: 1 deposit has no current exchange rate to RUB');
  });

  it('classes-19 gives the share of net worth only while net worth is known', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings, dollars]));
    const worth = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(netWorth('5550150.70'));
    open('/deposits?currency=RUB');
    const summary = await screen.findByRole('region', { name: 'Total in deposits' });
    // 555,015.07 of 5,550,150.70.
    expect(await within(summary).findByText('10.0%')).toBeInTheDocument();
    expect(within(summary).getByText('Share of net worth')).toBeInTheDocument();
    cleanup();
    forgetReads();
    worth.mockResolvedValue(netWorth(null));
    open('/deposits?currency=RUB');
    await screen.findByRole('region', { name: 'Total in deposits' });
    await waitFor(() => expect(worth).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('10.0%')).toBeNull();
  });

  it('deposits-share says why the share of net worth is missing', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings, dollars]));
    const worth = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue(netWorth(null));
    open('/deposits?currency=RUB');
    const summary = await screen.findByRole('region', { name: 'Total in deposits' });
    const share = (await within(summary).findByText('Share of net worth'))
      .parentElement as HTMLElement;
    expect(share).toHaveTextContent(
      'Share of net worth—Net worth unknown: 1 asset without a price or exchange rate.',
    );
    cleanup();
    forgetReads();
    worth.mockResolvedValue(netWorth('-1250.00'));
    open('/deposits?currency=RUB');
    const below = await screen.findByRole('region', { name: 'Total in deposits' });
    expect((await within(below).findByText('Share of net worth')).parentElement).toHaveTextContent(
      'Share of net worth—Net worth is below zero.',
    );
  });

  it('DEP-ACCOUNT-SHARE gives no share of a net worth that is a floor for want of an account rate', async () => {
    vi.spyOn(depositsApi, 'list').mockResolvedValue(list([savings, dollars]));
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
      ...netWorth('5550150.70'),
      completeness: 'incomplete',
      interestMissingDepositCount: 2,
    });
    open('/deposits?currency=RUB');
    const summary = await screen.findByRole('region', { name: 'Total in deposits' });
    const share = (await within(summary).findByText('Share of net worth'))
      .parentElement as HTMLElement;
    expect(share).toHaveTextContent(
      'Share of net worth—Net worth is a floor: 2 accounts without an interest rate.',
    );
    expect(summary).not.toHaveTextContent('%');
  });

  it('deposits-bank-total a bank whose deposits are all closed and settled holds 0.00, not a dash', async () => {
    const closed = (deposit: Deposit): Deposit => ({
      ...deposit,
      status: 'closed',
      closedOn: '2026-10-05',
      due: '0.00',
      accrued: '0.00',
      balance: '0.00',
      values: { USD: '0.00', EUR: '0.00', RUB: '0.00' },
      nextPayout: null,
    });
    vi.spyOn(depositsApi, 'list').mockResolvedValue({
      ...list([closed(savings), closed(dollars)]),
      totals: { USD: '0.00', EUR: '0.00', RUB: '0.00' },
    });
    open('/deposits?currency=RUB');
    const bank = await screen.findByRole('region', { name: 'Synthetic Bank' });
    const total = bank.querySelector('.deposit-bank__total') as HTMLElement;
    expect(total.querySelector('strong')).toHaveTextContent(/^₽0$/);
  });
});

describe('classes-20: the real rate on a deposit card', () => {
  const reading = (ratePercent: string) => ({
    inflationPercent: '8.90',
    ratePercent,
    gain: null,
    estimated: false,
  });

  afterEach(() => setValueView('nominal'));

  it('classes-20 tints a positive real rate green and a negative one red, over the grey of the terms', async () => {
    setValueView('real');
    vi.spyOn(depositsApi, 'list').mockResolvedValue(
      list([
        { ...savings, real: { official: reading('2.84'), personal: null } },
        { ...dollars, real: { official: reading('-4.62'), personal: null } },
      ]),
    );
    open('/deposits');
    const up = await screen.findByText('Real +2.84% a year after 8.90% inflation');
    const down = screen.getByText('Real -4.62% a year after 8.90% inflation');
    // The terms paragraph sets its own grey; the tint must sit on an element of its own.
    expect(up).toHaveClass('ui-pos');
    expect(up).not.toHaveClass('deposit-card__terms');
    expect(down).toHaveClass('ui-neg');
    expect(down).not.toHaveClass('deposit-card__terms');
  });
});

describe('the deposit page', () => {
  afterEach(() => setValueView('nominal'));

  it('classes-16 carries the Nominal/Real switch its chart follows', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(
        { ...savings, real: { official: null, personal: null } },
        {
          chart: [
            {
              date: '2026-07-01',
              balance: '100000.00',
              invested: '100000.00',
              real: {
                official: { balance: '100000.00', invested: '100000.00', estimated: false },
                personal: null,
              },
            },
          ],
        },
      ),
    );
    open(`/deposits/${savings.id}`);
    // The deposit is the page head (h2); the top bar names the section and holds the switch.
    await screen.findByRole('heading', { level: 2, name: 'Savings A' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Banks' });
    const header = heading.closest('header') as HTMLElement;
    const values = within(header).getByRole('radiogroup', { name: 'Values' });
    await user.click(within(values).getByRole('radio', { name: 'Real' }));
    expect(
      within(screen.getByLabelText('Chart legend')).getByText("Value in today's money"),
    ).toBeInTheDocument();
  });

  it('classes-21 shows the terms with the rate and its change and what closing early does', async () => {
    const user = userEvent.setup();
    vi.spyOn(depositsApi, 'get').mockResolvedValue(detail(savings));
    open(`/deposits/${savings.id}`);
    const terms = await screen.findByRole('region', { name: 'Terms' });
    const value = (term: string) =>
      within(terms).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;
    expect(value('Bank')).toHaveTextContent('Synthetic Bank');
    expect(value('Currency')).toHaveTextContent('RUB');
    expect(value('Rate')).toHaveTextContent('12% a year from Jul 1, 2026');
    expect(value('Interest')).toHaveTextContent('Every month, paid out');
    expect(value('Term')).toHaveTextContent('Jul 1, 2026 to Dec 1, 2026');
    expect(value('Closing early')).toHaveTextContent('Loses the interest not yet posted');
    await user.click(within(value('Rate')).getByRole('button', { name: 'Change the rate' }));
    expect(screen.getByRole('dialog', { name: 'Change the rate' })).toBeInTheDocument();
  });

  it.each(['phone', 'desktop'])(
    'REAL-PERIOD-MISSING explains absent inflation history on %s',
    async (layout) => {
      const user = userEvent.setup();
      if (layout === 'phone') phone();
      vi.spyOn(depositsApi, 'get').mockResolvedValue(
        detail({ ...savings, real: { official: null, personal: null } }),
      );
      open(`/deposits/${savings.id}`);
      await screen.findByRole('heading', { level: 2, name: 'Savings A' });
      await user.click(screen.getByRole('radio', { name: 'Real' }));
      const periods = screen.getByRole('region', { name: 'Interest by period' });
      expect(periods).toHaveTextContent('No inflation figures for this period');
      expect(periods).not.toHaveTextContent('1,019');
    },
  );

  it('classes-15 lists the periods, movements and checks as rows on a phone, without a table', async () => {
    phone();
    setValueView('real');
    const check = {
      id: 'c1',
      checkedOn: '2026-10-11',
      bankBalance: '100330.00',
      calculated: '100328.77',
      difference: '1.23',
    };
    vi.spyOn(depositsApi, 'get').mockResolvedValue(
      detail(
        { ...savings, real: { official: null, personal: null } },
        {
          checks: [check],
          lastCheck: check,
          periods: [
            {
              from: '2026-07-01',
              to: '2026-08-01',
              interest: '1019.18',
              treatment: 'payable',
              afterInflation: { official: '52.01', personal: null },
            },
          ],
        },
      ),
    );
    open(`/deposits/${savings.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Savings A' });
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    const periods = screen.getByRole('list', { name: 'Interest by period' });
    expect(periods).toHaveTextContent('Jul 1, 2026 – Aug 1, 2026');
    expect(periods).toHaveTextContent('Payable');
    expect(periods).not.toHaveTextContent('1,019');
    expect(within(periods).getByText('+₽52')).toHaveClass('ui-pos');
    const movements = screen.getByRole('list', { name: 'Movements' });
    expect(within(movements).getAllByRole('listitem')).toHaveLength(2);
    expect(movements).toHaveTextContent('To card');
    expect(
      within(movements).getByRole('button', {
        name: 'Remove the interest paid out of Aug 1, 2026',
      }),
    ).toBeInTheDocument();
    const checks = screen.getByRole('list', { name: 'Checks against the bank' });
    expect(checks).toHaveTextContent('Bank ₽100,330 · App ₽100,328');
    expect(checks).toHaveTextContent('+₽1');
  });
});
