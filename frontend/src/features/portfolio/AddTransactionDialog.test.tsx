import { accountingApi } from '@api/accounting.api';
import { assetRewardsApi, type RewardReceipt } from '@api/asset-rewards.api';
import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
import type { Operation } from '@api/operations.api';
import { ownedTransfersApi, type TransferReceipt } from '@api/owned-transfers.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import { type PortfolioValuation, portfolioValuationApi } from '@api/portfolio-valuation.api';
import { type JournalState, type TradeReceipt, tradesApi } from '@api/trades.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddTransactionDialog, { byAllocation, splitAssets } from './AddTransactionDialog';
import {
  addDecimal,
  bankRate,
  decimal,
  problems,
  purposeTradeFromEntry,
  rewardFromEntry,
  subtractDecimal,
  type TransactionEntry,
  tradeFromEntry,
  transferFromEntry,
} from './add-transaction';

// Synthetic accounts, assets, dates and rates only (CUR-PAID-RUB).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = (
  n: number,
  name: string,
  symbol: string | null,
  assetType: PortfolioAsset['assetType'],
) =>
  ({
    id: id(n),
    name,
    symbol,
    namespace: 'manual',
    assetType,
    valuationCurrency: 'USD',
    priceSource: 'market',
    createdAt: '2025-01-01T00:00:00.000Z',
  }) satisfies PortfolioAsset;
const bitcoin = asset(1, 'Bitcoin', 'BTC', 'crypto');
const ether = asset(2, 'Ether', 'ETH', 'crypto');
const dollars = asset(3, 'US dollar', 'USD', 'fiat');
const tether = asset(4, 'Tether', 'USDT', 'crypto');
const report = (date: string, usd: string | null, eur: string | null): FxRatesReport => ({
  date,
  source: 'cbr',
  rates: [
    { currency: 'USD', rubPerUnit: usd, date: usd ? date : null },
    { currency: 'EUR', rubPerUnit: eur, date: eur ? date : null },
  ],
  sync: null,
});
const journal = (accountId: string, journalRevision: number) =>
  ({
    accountId,
    eligible: false,
    ineligibilityReason: 'already-initialized',
    journal: { journalRevision } as JournalState['journal'],
  }) as JournalState;

const entry: TransactionEntry = {
  side: 'buy',
  instrumentId: id(1),
  amount: '0,01',
  date: '2025-06-02',
  time: '',
  total: '80 000',
  currency: 'RUB',
  rate: '80',
  rateEdited: false,
  fee: '',
  comment: '',
};
const identity = { requestId: id(9), expectedJournalRevision: 4 };

describe('PAID-ENTRY the transaction entry becomes a trade in the currency paid', () => {
  it('reads typed decimals and the Bank of Russia rate per USD', () => {
    expect(decimal('1 000,50')).toBe('1000.50');
    expect(decimal('1e3')).toBeNull();
    expect(bankRate('RUB', report('2025-06-02', '80.1234', '90'))).toBe('80.1234');
    expect(bankRate('EUR', report('2025-06-02', '78.5', '90'))).toBe('0.872222');
    expect(bankRate('EUR', report('2025-06-02', '78.5', null))).toBeNull();
    expect(bankRate('RUB', report('2025-06-02', null, null))).toBeNull();
  });

  it('sends rubles for the server to convert, with the rate only when the owner changed it', () => {
    expect(tradeFromEntry(entry, identity)).toEqual({
      instrumentId: id(1),
      side: 'buy',
      occurredAt: '2025-06-02T00:00:00.000Z',
      quantity: '0.01',
      paid: { currency: 'RUB', gross: '80000', fee: '0' },
      settlementCurrency: 'RUB',
      ...identity,
    });
    // Buying the cash itself is not settled in it.
    expect(tradeFromEntry(entry, identity, undefined, false)).not.toHaveProperty(
      'settlementCurrency',
    );
    expect(
      tradeFromEntry(
        { ...entry, rate: '79,5', rateEdited: true, time: '14:30', fee: '50' },
        identity,
      ),
    ).toMatchObject({
      occurredAt: '2025-06-02T14:30:00.000Z',
      paid: { currency: 'RUB', gross: '80000', fee: '50', perUsd: '79.5' },
    });
  });

  it('OPS-SAME-DAY leaves the order to the server unless an edit keeps its place', () => {
    expect(tradeFromEntry(entry, identity)).not.toHaveProperty('orderWithinTimestamp');
    expect(tradeFromEntry(entry, identity, 3)).toMatchObject({ orderWithinTimestamp: 3 });
  });

  it('OPS-COMMENT sends a trimmed comment and nothing for a blank one', () => {
    expect(tradeFromEntry({ ...entry, comment: '  From savings \n' }, identity)).toMatchObject({
      comment: 'From savings',
    });
    expect(tradeFromEntry({ ...entry, comment: '   ' }, identity)).not.toHaveProperty('comment');
  });

  it('counts USD, USDT and USDC as USD amounts', () => {
    for (const currency of ['USD', 'USDT', 'USDC'] as const) {
      const trade = tradeFromEntry({ ...entry, currency, total: '1000', fee: '1.5' }, identity);
      expect(trade).toMatchObject({ grossUsd: '1000', feeUsd: '1.5' });
      expect(trade).not.toHaveProperty('paid');
    }
  });
  it('PR-OPS-2 builds income, a fee, a reward and a transfer from the entry', () => {
    const usd = { ...entry, currency: 'USD' as const, total: '850', amount: '0.01' };
    expect(purposeTradeFromEntry(usd, 'income', identity)).toEqual({
      instrumentId: id(1),
      side: 'buy',
      occurredAt: '2025-06-02T00:00:00.000Z',
      quantity: '0.01',
      grossUsd: '850',
      feeUsd: '0',
      purpose: 'income',
      ...identity,
    });
    expect(purposeTradeFromEntry(usd, 'fee', identity, 1)).toMatchObject({
      side: 'sell',
      grossUsd: '850',
      feeUsd: '850',
      purpose: 'fee',
      orderWithinTimestamp: 1,
    });
    expect(rewardFromEntry({ ...usd, total: '' }, 'reward', identity)).toMatchObject({
      category: 'other',
      acquisitionBasisUsd: null,
      incomeValueUsd: null,
    });
    const moved = transferFromEntry(
      { ...usd, fee: '0,0001' },
      { requestId: id(9), expectedFromJournalRevision: 4, expectedToJournalRevision: 0 },
    );
    expect(moved).toMatchObject({ feeInstrumentId: id(1), feeQuantity: '0.0001' });
    expect(moved).not.toHaveProperty('orderWithinTimestamp');
    expect(
      transferFromEntry(usd, {
        requestId: id(9),
        expectedFromJournalRevision: 4,
        expectedToJournalRevision: 0,
      }),
    ).toMatchObject({ feeInstrumentId: null, feeQuantity: '0' });
    expect(addDecimal('0.4999', '0.0001')).toBe('0.5');
    expect(subtractDecimal('0.5', '0.0001')).toBe('0.4999');
    expect(subtractDecimal('0.0001', '0.5')).toBe('0');
    expect(problems({ ...usd, total: '' }, '2026-01-01', 'airdrop').has('total')).toBe(false);
    expect(problems({ ...usd, total: '' }, '2026-01-01', 'expense').has('total')).toBe(true);
    expect(problems({ ...usd, total: '' }, '2026-01-01', 'transfer').size).toBe(0);
  });
});

describe('CUR-PAID-RUB the Add transaction window', () => {
  const create = vi.fn();
  const correct = vi.fn();
  const available = vi.fn();
  const rates = vi.fn();
  beforeEach(() => {
    vi.spyOn(portfolioAssetsApi, 'listAll').mockResolvedValue([bitcoin, ether, dollars]);
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([]);
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        {
          id: id(11),
          name: 'Hardware wallet',
          currentRevision: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: id(12),
          name: 'No journal',
          currentRevision: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        { id: id(13), name: 'Exchange', currentRevision: 0, createdAt: '2025-01-01T00:00:00.000Z' },
      ],
      nextCursor: null,
    });
    vi.spyOn(tradesApi, 'state').mockImplementation(async (account) =>
      account === id(12)
        ? ({
            accountId: account,
            eligible: true,
            ineligibilityReason: null,
            journal: null,
          } as JournalState)
        : journal(account, account === id(11) ? 4 : 7),
    );
    rates.mockImplementation(async (date?: string) =>
      date === '2025-05-01' ? report(date, null, null) : report(date ?? '', '78.5', '90'),
    );
    vi.spyOn(fxRatesApi, 'get').mockImplementation(rates);
    create.mockResolvedValue({} as TradeReceipt);
    vi.spyOn(tradesApi, 'create').mockImplementation(create);
    correct.mockResolvedValue({} as TradeReceipt);
    vi.spyOn(tradesApi, 'correct').mockImplementation(correct);
    available.mockImplementation(async (accountId, query) => ({
      accountId,
      ...query,
      journalRevision: 4,
      quantity: '100',
    }));
    vi.spyOn(tradesApi, 'available').mockImplementation(available);
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
      assets: [
        { instrumentId: id(1), priceSource: 'market', price: { value: '85053.34' } },
        { instrumentId: id(3), priceSource: 'fixed', price: { value: '1' } },
      ],
    } as PortfolioValuation);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    create.mockReset();
    correct.mockReset();
    available.mockReset();
    rates.mockReset();
  });

  const open = async (editing?: Operation) => {
    const onSaved = vi.fn();
    render(
      <MemoryRouter>
        <AddTransactionDialog onClose={vi.fn()} onSaved={onSaved} editing={editing} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', {
      name: editing ? 'Edit transaction' : 'Add transaction',
    });
    await within(dialog).findByRole('group', { name: 'Asset' });
    return { dialog, onSaved };
  };

  it('DIALOG-CLOSE closes from the ✕ at the right of the title', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <AddTransactionDialog onClose={onClose} onSaved={vi.fn()} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add transaction' });
    await within(dialog).findByRole('group', { name: 'Asset' });
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fills the Bank of Russia rate of the date and saves rubles as paid', async () => {
    const user = userEvent.setup();
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    // Cash is not traded here; an account without a journal starts one with its first trade.
    expect(view.queryByRole('button', { name: /USD$/ })).not.toBeInTheDocument();
    expect(view.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Hardware wallet',
      'No journal',
      'Exchange',
    ]);
    await user.type(view.getByLabelText('Amount'), '0.01');
    await user.clear(view.getByLabelText('Date'));
    await user.type(view.getByLabelText('Date'), '2025-06-08');
    await user.click(view.getByRole('radio', { name: 'RUB' }));
    expect(await view.findByDisplayValue('78.5')).toBe(view.getByLabelText('Exchange rate'));
    expect(rates).toHaveBeenLastCalledWith('2025-06-08');
    expect(
      view.getByText(/Bank of Russia rate on the selected date, filled in automatically/),
    ).toBeInTheDocument();
    await user.type(view.getByLabelText('Total paid'), '78500');
    expect(view.getByLabelText('Price per BTC')).toHaveValue('7850000');
    expect(view.getByText('Cost $1,000.00')).toBeInTheDocument();
    await user.selectOptions(view.getByLabelText('Wallet or account'), 'Exchange');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(id(13), {
      instrumentId: id(1),
      side: 'buy',
      occurredAt: '2025-06-08T00:00:00.000Z',
      quantity: '0.01',
      paid: { currency: 'RUB', gross: '78500', fee: '0' },
      settlementCurrency: 'RUB',
      requestId: expect.any(String),
      expectedJournalRevision: 7,
    });
  });

  it('asks for the rate of a typed date only when the date field loses focus', async () => {
    const user = userEvent.setup();
    const { dialog } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('radio', { name: 'RUB' }));
    await waitFor(() => expect(rates).toHaveBeenCalled());
    rates.mockClear();
    await user.clear(view.getByLabelText('Date'));
    await user.type(view.getByLabelText('Date'), '2025-06-08');
    expect(rates).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => expect(rates).toHaveBeenCalledWith('2025-06-08'));
    expect(await view.findByDisplayValue('78.5')).toBe(view.getByLabelText('Exchange rate'));
  });

  it('shows a field problem when the field loses focus and clears it once fixed', async () => {
    const user = userEvent.setup();
    const { dialog } = await open();
    const view = within(dialog);
    const amount = view.getByLabelText('Amount');
    await user.click(amount);
    await user.type(amount, 'abc');
    expect(view.queryByText('Enter an amount greater than 0')).not.toBeInTheDocument();
    await user.tab();
    expect(view.getByText('Enter an amount greater than 0')).toBeInTheDocument();
    await user.click(amount);
    await user.clear(amount);
    await user.type(amount, '2');
    expect(view.queryByText('Enter an amount greater than 0')).not.toBeInTheDocument();
  });

  it('checks a typed date when the date field loses focus and clears the problem once fixed', async () => {
    const user = userEvent.setup();
    const { dialog } = await open();
    const view = within(dialog);
    const date = view.getByLabelText('Date');
    await user.clear(date);
    await user.type(date, '2999-01-01');
    expect(view.queryByText('Choose a date, today or earlier')).not.toBeInTheDocument();
    await user.tab();
    expect(view.getByText('Choose a date, today or earlier')).toBeInTheDocument();
    await user.clear(date);
    await user.type(date, '2025-06-08');
    expect(view.queryByText('Choose a date, today or earlier')).not.toBeInTheDocument();
  });

  it('sends the rate the owner typed, and asks for one when none is stored', async () => {
    const user = userEvent.setup();
    const { dialog } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('button', { name: /ETH$/ }));
    await user.click(view.getByRole('radio', { name: 'Sell' }));
    await user.type(view.getByLabelText('Amount'), '1');
    await user.clear(view.getByLabelText('Date'));
    await user.type(view.getByLabelText('Date'), '2025-05-01');
    await user.click(view.getByRole('radio', { name: 'EUR' }));
    expect(
      await view.findByText(
        /No Bank of Russia rate is stored for this date; enter the rate you paid/,
      ),
    ).toBeInTheDocument();
    await user.type(view.getByLabelText('Total received'), '1800');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(view.getByText('Enter the rate you paid')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await user.type(view.getByLabelText('Exchange rate'), '0,9');
    expect(view.getByText('Proceeds $2,000.00')).toBeInTheDocument();
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][1]).toMatchObject({
      instrumentId: id(2),
      side: 'sell',
      paid: { currency: 'EUR', gross: '1800', fee: '0', perUsd: '0.9' },
      expectedJournalRevision: 4,
    });
  });

  it('explains a refusal without closing, and a retry keeps the request id', async () => {
    const user = userEvent.setup();
    create.mockRejectedValueOnce(
      new AxiosError('conflict', '409', undefined, undefined, {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { message: 'Trade request conflicts with saved state' },
      }),
    );
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.type(view.getByLabelText('Amount'), '0.01');
    await user.type(view.getByLabelText('Total paid'), '1000');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/does not fit the saved history/);
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create.mock.calls[1][1].requestId).toBe(create.mock.calls[0][1].requestId);
    expect(create.mock.calls[0][1]).toMatchObject({ grossUsd: '1000', feeUsd: '0' });
  });

  it('OPS-ADD-BUY saves the first trade of an account without a journal', async () => {
    const user = userEvent.setup();
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.type(view.getByLabelText('Amount'), '0.00918359');
    await user.type(view.getByLabelText('Total paid'), '1000');
    await user.click(view.getByRole('radio', { name: 'USDT' }));
    await user.selectOptions(view.getByLabelText('Wallet or account'), 'No journal');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      id(12),
      expect.objectContaining({
        quantity: '0.00918359',
        grossUsd: '1000',
        feeUsd: '0',
        expectedJournalRevision: 0,
      }),
    );
  });

  it('PR-OPS-2 records income at its value as money added, without a settlement', async () => {
    const user = userEvent.setup();
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('radio', { name: 'Income' }));
    expect(view.queryByLabelText('Price per BTC')).not.toBeInTheDocument();
    expect(view.queryByRole('radiogroup', { name: 'Paid in' })).not.toBeInTheDocument();
    await user.type(view.getByLabelText('Amount'), '0.01');
    expect(view.getByText(/Counts as money added/)).toBeInTheDocument();
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(view.getByText('Enter what it was worth on that date')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    // Market today: 0.01 BTC at the latest price.
    await user.click(view.getByRole('button', { name: 'Use' }));
    expect(view.getByLabelText('Value')).toHaveValue('850.53');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(id(11), {
      instrumentId: id(1),
      side: 'buy',
      // Today without a time is the current minute (OPS-SAME-DAY).
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/),
      quantity: '0.01',
      grossUsd: '850.53',
      feeUsd: '0',
      purpose: 'income',
      requestId: expect.any(String),
      expectedJournalRevision: 4,
    });
  });

  it('PR-OPS-2 limits a gift sent and a fee to what the account holds', async () => {
    const user = userEvent.setup();
    available.mockImplementation(async (accountId, query) => ({
      accountId,
      ...query,
      journalRevision: 4,
      quantity: '0.2',
    }));
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('button', { name: 'More ▾' }));
    await user.click(view.getByRole('radio', { name: 'Gift' }));
    await user.click(view.getByRole('radio', { name: 'Sent' }));
    expect(view.queryByRole('button', { name: '+ Other asset' })).not.toBeInTheDocument();
    expect(await view.findByText(/Available in Hardware wallet: 0\.2 BTC/)).toBeInTheDocument();
    await user.type(view.getByLabelText('Amount'), '0.3');
    // The warning waits for the owner to leave the amount.
    expect(view.queryByRole('alert')).not.toBeInTheDocument();
    await user.tab();
    expect(view.getByRole('alert')).toHaveTextContent(/Only 0\.2 BTC is available/);
    await user.clear(view.getByLabelText('Amount'));
    await user.type(view.getByLabelText('Amount'), '0.1');
    await user.type(view.getByLabelText('Value'), '8000');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create.mock.calls[0][1]).toMatchObject({
      side: 'sell',
      quantity: '0.1',
      grossUsd: '8000',
      feeUsd: '0',
      purpose: 'gift-sent',
    });
    expect(create.mock.calls[0][1]).not.toHaveProperty('settlementCurrency');
  });

  it('PR-OPS-2 moves coins between two accounts with the fee in the same coin', async () => {
    const user = userEvent.setup();
    const transferCreate = vi
      .spyOn(ownedTransfersApi, 'create')
      .mockResolvedValue({} as TransferReceipt);
    available.mockImplementation(async (accountId, query) => ({
      accountId,
      ...query,
      journalRevision: 4,
      quantity: '0.5',
    }));
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('radio', { name: 'Transfer' }));
    expect(view.queryByLabelText('Wallet or account')).not.toBeInTheDocument();
    expect(view.getByLabelText('From')).toHaveValue(id(11));
    expect(view.getByLabelText('To')).toHaveValue(id(12));
    await user.click(view.getByText('More options: time, fee, comment'));
    await user.type(view.getByLabelText('Fee (optional)'), '0.0001');
    await user.click(await view.findByRole('button', { name: 'Use all' }));
    expect(view.getByLabelText('Amount')).toHaveValue('0.4999');
    await user.selectOptions(view.getByLabelText('To'), 'Hardware wallet');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(view.getByText('Choose a different wallet')).toBeInTheDocument();
    await user.selectOptions(view.getByLabelText('To'), 'Exchange');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(transferCreate).toHaveBeenCalledWith({
      requestId: expect.any(String),
      expectedFromJournalRevision: 4,
      expectedToJournalRevision: 7,
      assertInternal: true,
      instrumentId: id(1),
      occurredAt: expect.any(String),
      quantity: '0.4999',
      feeInstrumentId: id(1),
      feeQuantity: '0.0001',
      fromAccountId: id(11),
      toAccountId: id(13),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'XFER-REFUSED names the account a new transfer would leave short',
      {
        message: 'An account does not hold enough for this transfer',
        dependent: {
          operationId: `transfer:${id(41)}`,
          accountId: id(11),
          instrumentId: id(1),
          occurredAt: '2025-07-01T00:00:00.000Z',
        },
      },
      /Hardware wallet does not hold enough BTC on Jul 1, 2025 for this transfer/,
    ],
    [
      'XFER-REFUSED names the account whose records start after the date',
      {
        message: 'The records of an account start after this transfer',
        coverage: { accountId: id(13), coverageFrom: '2999-01-01T00:00:00.000Z' },
      },
      /The records of Exchange start on Jan 1, 2999, after this transfer on /,
    ],
    [
      'XFER-REFUSED names the account opened with balances whose records have not started',
      {
        message: 'The records of an account have not started',
        coverage: { accountId: id(13), coverageFrom: null },
      },
      /The records of Exchange have not started: it was opened with balances, so start them on Manual accounts first/,
    ],
  ])('%s', async (_name, data, expected) => {
    const user = userEvent.setup();
    vi.spyOn(ownedTransfersApi, 'create').mockRejectedValue(
      new AxiosError('conflict', '409', undefined, undefined, {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data,
      }),
    );
    available.mockImplementation(async (accountId, query) => ({
      accountId,
      ...query,
      journalRevision: 4,
      quantity: '5',
    }));
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('radio', { name: 'Transfer' }));
    await user.selectOptions(view.getByLabelText('To'), 'Exchange');
    await user.type(view.getByLabelText('Amount'), '0.1');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(await view.findByRole('alert')).toHaveTextContent(expected);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('PR-OPS-2 saves an airdrop of unknown value as a reward without a cost', async () => {
    const user = userEvent.setup();
    const rewardCreate = vi.spyOn(assetRewardsApi, 'create').mockResolvedValue({} as RewardReceipt);
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('button', { name: 'More ▾' }));
    await user.click(view.getByRole('radio', { name: 'Airdrop' }));
    await user.click(view.getByRole('button', { name: /ETH$/ }));
    await user.type(view.getByLabelText('Amount'), '5');
    expect(view.getByLabelText('Value (optional)')).toHaveValue('');
    await user.selectOptions(view.getByLabelText('Wallet or account'), 'No journal');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(rewardCreate).toHaveBeenCalledWith(id(12), {
      requestId: expect.any(String),
      expectedJournalRevision: 0,
      assertReward: true,
      instrumentId: id(2),
      category: 'airdrop',
      occurredAt: expect.any(String),
      quantity: '5',
      acquisitionBasisUsd: null,
      incomeValueUsd: null,
    });
  });

  it('OPS-OVERSPEND shows what the account holds on the date, refuses more and fills Use all', async () => {
    const user = userEvent.setup();
    available.mockImplementation(async (accountId, query) => ({
      accountId,
      ...query,
      journalRevision: 4,
      quantity: '0.2',
    }));
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('radio', { name: 'Sell' }));
    await user.clear(view.getByLabelText('Date'));
    await user.type(view.getByLabelText('Date'), '2026-04-01');
    await user.tab();
    expect(await view.findByText(/Available in Hardware wallet: 0\.2 BTC/)).toBeInTheDocument();
    expect(available).toHaveBeenLastCalledWith(id(11), {
      instrumentId: id(1),
      at: '2026-04-01T00:00:00.000Z',
    });
    await user.type(view.getByLabelText('Amount'), '0.3');
    await user.tab();
    expect(view.getByRole('alert')).toHaveTextContent(
      'Only 0.2 BTC is available in Hardware wallet on Apr 1, 2026 · Use all',
    );
    expect(view.getByLabelText('Amount')).toHaveAttribute('aria-invalid', 'true');
    await user.type(view.getByLabelText('Total received'), '16000');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(create).not.toHaveBeenCalled();
    await user.click(view.getByRole('button', { name: 'Use all' }));
    expect(view.getByLabelText('Amount')).toHaveValue('0.2');
    expect(view.queryByRole('alert')).toBeNull();
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create.mock.calls[0][1]).toMatchObject({ side: 'sell', quantity: '0.2' });
  });

  it('OPS-SAME-DAY a new sale dated today without a time stands for the current minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T15:59:30.000Z'));
    try {
      const user = userEvent.setup();
      available.mockImplementation(async (accountId, query) => ({
        accountId,
        ...query,
        journalRevision: 4,
        quantity: '1',
      }));
      const { dialog, onSaved } = await open();
      const view = within(dialog);
      await user.click(view.getByRole('radio', { name: 'Sell' }));
      expect(view.getByLabelText('Date')).toHaveValue('2026-10-07');
      expect(await view.findByText(/Available in Hardware wallet: 1 BTC/)).toBeInTheDocument();
      expect(available).toHaveBeenLastCalledWith(id(11), {
        instrumentId: id(1),
        at: '2026-10-07T15:59:00.000Z',
      });
      expect(view.getByLabelText('Time, UTC (optional)')).toHaveValue('');
      await user.type(view.getByLabelText('Amount'), '0.5');
      await user.type(view.getByLabelText('Total received'), '30000');
      await user.click(view.getByRole('button', { name: 'Save transaction' }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(create.mock.calls[0][1]).toMatchObject({
        side: 'sell',
        occurredAt: '2026-10-07T15:59:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  const recorded: Operation = {
    id: `trade:${id(30)}`,
    kind: 'trade',
    type: 'buy',
    direction: 'in',
    occurredAt: '2025-06-13T00:00:00.000Z',
    orderWithinTimestamp: 2,
    asset: { instrumentId: id(1), symbol: 'BTC', name: 'Bitcoin' },
    quantity: '0.01',
    counterAsset: null,
    counterQuantity: null,
    valueUsd: '1000',
    estimatedValueUsd: null,
    costBasisUsd: null,
    feeUsd: '0',
    fee: null,
    paid: null,
    settlement: null,
    comment: 'First buy',
    classification: null,
    account: { id: id(11), name: 'Hardware wallet' },
    counterAccount: null,
    wallet: null,
    counterWallet: null,
    chain: null,
    status: 'recorded',
    source: 'manual',
    version: 1,
    value: '1000',
    estimatedValue: null,
    costBasis: null,
    feeValue: '0',
  };

  it('OPS-EDIT corrects a recorded buy in place, keeping its moment and place in the day', async () => {
    const user = userEvent.setup();
    const { dialog, onSaved } = await open(recorded);
    const view = within(dialog);
    expect(view.getByLabelText('Amount')).toHaveValue('0.01');
    expect(view.getByLabelText('Total paid')).toHaveValue('1000');
    expect(view.getByLabelText('Price per BTC')).toHaveValue('100000');
    expect(view.getByLabelText('Date')).toHaveValue('2025-06-13');
    expect(view.getByLabelText('Comment')).toHaveValue('First buy');
    expect(view.getByLabelText('Wallet or account')).toBeDisabled();
    await user.clear(view.getByLabelText('Total paid'));
    await user.type(view.getByLabelText('Total paid'), '1010');
    await user.clear(view.getByLabelText('Comment'));
    await user.type(view.getByLabelText('Comment'), 'Corrected amount');
    await user.click(view.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
    expect(correct).toHaveBeenCalledWith(id(11), id(30), {
      instrumentId: id(1),
      side: 'buy',
      occurredAt: '2025-06-13T00:00:00.000Z',
      orderWithinTimestamp: 2,
      quantity: '0.01',
      grossUsd: '1010',
      feeUsd: '0',
      comment: 'Corrected amount',
      settlementCurrency: 'USD',
      requestId: expect.any(String),
      expectedJournalRevision: 4,
    });
  });

  it('PR-OPS-2 corrects a transfer in place; other kinds of record stay unavailable', async () => {
    const user = userEvent.setup();
    const correctTransfer = vi
      .spyOn(ownedTransfersApi, 'correct')
      .mockResolvedValue({} as TransferReceipt);
    const { dialog, onSaved } = await open({
      ...recorded,
      id: `transfer:${id(40)}`,
      kind: 'transfer',
      type: 'transfer',
      direction: 'internal',
      valueUsd: null,
      feeUsd: null,
      fee: { asset: recorded.asset, quantity: '0.0001' },
      comment: null,
      classification: null,
      counterAccount: { id: id(13), name: 'Exchange' },
      version: 3,
    });
    const view = within(dialog);
    expect(view.getByRole('radio', { name: 'Transfer' })).toBeChecked();
    expect(view.getByRole('radio', { name: 'Buy' })).toBeDisabled();
    expect(view.getByLabelText('From')).toBeDisabled();
    expect(view.getByLabelText('To')).toHaveValue(id(13));
    expect(view.getByLabelText('Fee (optional)')).toHaveValue('0.0001');
    await user.clear(view.getByLabelText('Amount'));
    await user.type(view.getByLabelText('Amount'), '0.02');
    await user.click(view.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(correctTransfer).toHaveBeenCalledWith(id(40), {
      requestId: expect.any(String),
      expectedFromJournalRevision: 4,
      expectedToJournalRevision: 7,
      expectedVersion: 3,
      assertInternal: true,
      instrumentId: id(1),
      occurredAt: '2025-06-13T00:00:00.000Z',
      orderWithinTimestamp: 2,
      quantity: '0.02',
      feeInstrumentId: id(1),
      feeQuantity: '0.0001',
    });
    expect(available).toHaveBeenCalledWith(
      id(11),
      expect.objectContaining({ exclude: `transfer:${id(40)}` }),
    );
  });

  it('OPS-EDIT moved to another date lets the server place it and names what it would break', async () => {
    const user = userEvent.setup();
    correct.mockRejectedValueOnce(
      new AxiosError('conflict', '409', undefined, undefined, {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
          message: 'A later operation depends on this trade',
          dependent: {
            operationId: `trade:${id(31)}`,
            accountId: id(11),
            instrumentId: id(1),
            occurredAt: '2025-07-01T00:00:00.000Z',
          },
        },
      }),
    );
    const { dialog, onSaved } = await open(recorded);
    const view = within(dialog);
    await user.clear(view.getByLabelText('Date'));
    await user.type(view.getByLabelText('Date'), '2025-08-01');
    await user.click(view.getByRole('button', { name: 'Save changes' }));
    expect(await view.findByRole('alert')).toHaveTextContent(
      'A later transaction on Jul 1, 2025 spends these coins',
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(correct.mock.calls[0][2]).toMatchObject({ occurredAt: '2025-08-01T00:00:00.000Z' });
    expect(correct.mock.calls[0][2]).not.toHaveProperty('orderWithinTimestamp');
  });

  it('X2 offers the market price of today and fills it in', async () => {
    const user = userEvent.setup();
    const { dialog } = await open();
    const view = within(dialog);
    await user.type(view.getByLabelText('Amount'), '0.5');
    const hint = await view.findByText(/Market today \$85,053\.34/);
    await user.click(within(hint).getByRole('button', { name: 'Use' }));
    expect(view.getByLabelText('Price per BTC')).toHaveValue('85053.34');
    expect(view.getByLabelText('Total paid')).toHaveValue('42526.67');
  });

  it('OPS-EDIT keeps the recorded total when only the amount changes', async () => {
    const user = userEvent.setup();
    const { dialog, onSaved } = await open({
      ...recorded,
      quantity: '50000',
      valueUsd: '6172.5',
      value: '6172.5',
    });
    const view = within(dialog);
    // The price the record implies, not rounded to cents.
    expect(view.getByLabelText('Price per BTC')).toHaveValue('0.12345');
    await user.clear(view.getByLabelText('Amount'));
    await user.type(view.getByLabelText('Amount'), '50001');
    expect(view.getByLabelText('Total paid')).toHaveValue('6172.5');
    await user.click(view.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(correct.mock.calls[0][2]).toMatchObject({ quantity: '50001', grossUsd: '6172.5' });
  });

  it('X2 shows a market price below a cent instead of 0', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
      assets: [{ instrumentId: id(1), priceSource: 'market', price: { value: '0.004' } }],
    } as PortfolioValuation);
    const user = userEvent.setup();
    const { dialog } = await open();
    const view = within(dialog);
    await user.type(view.getByLabelText('Amount'), '1000');
    const hint = await view.findByText(/Market today/);
    await user.click(within(hint).getByRole('button', { name: 'Use' }));
    expect(view.getByLabelText('Price per BTC')).toHaveValue('0.004');
    expect(view.getByLabelText('Total paid')).toHaveValue('4');
  });

  it('X3 adds a coin that is not among the assets together with its first buy', async () => {
    const user = userEvent.setup();
    const created = { ...asset(5, 'Toncoin', 'TON', 'crypto'), priceSource: 'manual' as const };
    const createAsset = vi.spyOn(portfolioAssetsApi, 'create').mockResolvedValue(created);
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('button', { name: '+ Other asset' }));
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(view.getByText('Enter the ticker: letters and digits, up to 32')).toBeInTheDocument();
    await user.type(view.getByLabelText('Ticker'), 'ton');
    await user.type(view.getByLabelText('Name (optional)'), 'Toncoin');
    await user.type(view.getByLabelText('Amount'), '10');
    await user.type(view.getByLabelText('Total paid'), '55');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createAsset).toHaveBeenCalledWith({
      requestId: expect.any(String),
      name: 'Toncoin',
      symbol: 'TON',
      assetType: 'crypto',
    });
    expect(create.mock.calls[0][1]).toMatchObject({ instrumentId: id(5), quantity: '10' });
  });

  it('OPS-SELL-CASH says the proceeds stay in the account as cash', async () => {
    const user = userEvent.setup();
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    await user.click(view.getByRole('radio', { name: 'Sell' }));
    await user.click(view.getByRole('radio', { name: 'USDT' }));
    expect(
      view.getByText('The USDT received stays in Hardware wallet as cash.'),
    ).toBeInTheDocument();
    await user.type(view.getByLabelText('Amount'), '0.5');
    await user.type(view.getByLabelText('Total received'), '30000');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create.mock.calls[0][1]).toMatchObject({
      side: 'sell',
      grossUsd: '30000',
      settlementCurrency: 'USDT',
    });
  });

  it('TOKEN-HIDE does not offer the coins of tokens the wallets leave out', async () => {
    const spam = asset(7, 'Spam Token', 'SPAM1A2B', 'crypto');
    const seen = asset(8, 'Seen Token', 'SEEN', 'crypto');
    vi.mocked(portfolioAssetsApi.listAll).mockResolvedValue([bitcoin, ether, spam, seen]);
    const address = (hidden: string[], shown: string[]) =>
      ({
        hiddenTokens: hidden.map((symbol) => ({
          symbol,
          name: symbol,
          quantity: '1',
          reason: 'dust',
        })),
        balances: shown.map((symbol) => ({ symbol, quantity: '1' })),
      }) as unknown as WalletAddress;
    // SEEN is left out by one address but held by another, so it stays an asset.
    vi.mocked(walletAddressesApi.list).mockResolvedValue([
      address(['SPAM1A2B', 'SEEN'], []),
      address([], ['SEEN']),
    ]);
    const { dialog } = await open();
    const assets = within(within(dialog).getByRole('group', { name: 'Asset' }));
    expect(assets.queryByText('SPAM1A2B')).not.toBeInTheDocument();
    expect(assets.getByText('SEEN')).toBeInTheDocument();
    expect(assets.getByText('ETH')).toBeInTheDocument();
  });

  const chips = (group: HTMLElement) =>
    within(group)
      .getAllByRole('button')
      .map((item) => item.textContent)
      .filter((text) => text !== '+ Other asset');

  it('ASSET-ORDER lists the assets by their share of the portfolio and starts with the largest', async () => {
    vi.mocked(portfolioAssetsApi.listAll).mockResolvedValue([bitcoin, ether, dollars, tether]);
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
      assets: [
        {
          instrumentId: id(1),
          priceSource: 'market',
          price: { value: '85053.34' },
          allocationPercent: '12.5',
        },
        {
          instrumentId: id(2),
          priceSource: 'market',
          price: { value: '3000' },
          allocationPercent: '80',
        },
        {
          instrumentId: id(4),
          priceSource: 'market',
          price: { value: '1' },
          allocationPercent: null,
        },
      ],
    } as PortfolioValuation);
    const { dialog } = await open();
    const group = within(dialog).getByRole('group', { name: 'Asset' });
    expect(chips(group)).toEqual(['ETH', 'BTC', 'USDT']);
    expect(within(group).getByRole('button', { name: 'ETH' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('ASSET-ORDER keeps the order given while the valuation cannot be read', async () => {
    vi.mocked(portfolioAssetsApi.listAll).mockResolvedValue([bitcoin, ether, tether]);
    vi.spyOn(portfolioValuationApi, 'get').mockRejectedValue(new Error('offline'));
    const { dialog } = await open();
    const group = within(dialog).getByRole('group', { name: 'Asset' });
    expect(chips(group)).toEqual(['BTC', 'ETH', 'USDT']);
  });

  it("OPS-BUY-CASH shows how much of a buy the account's cash pays", async () => {
    const user = userEvent.setup();
    vi.mocked(portfolioAssetsApi.listAll).mockResolvedValue([bitcoin, ether, dollars, tether]);
    available.mockImplementation(async (accountId, query) => ({
      accountId,
      ...query,
      journalRevision: 4,
      quantity: query.instrumentId === id(4) ? '30000' : '0',
    }));
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    // The stablecoin is an asset to buy as well, but not with itself.
    expect(view.getByRole('button', { name: 'USDT' })).toBeInTheDocument();
    await user.click(view.getByRole('radio', { name: 'USDT' }));
    await user.type(view.getByLabelText('Amount'), '0.4');
    await user.type(view.getByLabelText('Total paid'), '40000');
    expect(
      await view.findByText(
        '30,000 USDT comes from the cash in Hardware wallet; the other 10,000 USDT is new money.',
      ),
    ).toBeInTheDocument();
    expect(available).toHaveBeenCalledWith(id(11), {
      instrumentId: id(4),
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/),
    });
    await user.clear(view.getByLabelText('Total paid'));
    await user.type(view.getByLabelText('Total paid'), '20000');
    expect(
      await view.findByText('Paid from the USDT cash in Hardware wallet.'),
    ).toBeInTheDocument();
    // A new coin is paid from the cash too; a new asset typed as the cash itself is not.
    await user.click(view.getByRole('button', { name: '+ Other asset' }));
    await user.type(view.getByLabelText('Ticker'), 'usdt');
    expect(view.queryByText('Paid from the USDT cash in Hardware wallet.')).not.toBeInTheDocument();
    await user.clear(view.getByLabelText('Ticker'));
    await user.type(view.getByLabelText('Ticker'), 'TON');
    expect(
      await view.findByText('Paid from the USDT cash in Hardware wallet.'),
    ).toBeInTheDocument();
    await user.click(view.getByRole('button', { name: 'BTC' }));
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create.mock.calls[0][1]).toMatchObject({ settlementCurrency: 'USDT' });
  });
});

describe('ASSET-CHIPS which assets become chips', () => {
  const many = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => asset(n, `Coin ${n}`, `C${n}`, 'crypto'));

  it('shows every asset while there are few', () => {
    expect(splitAssets(many.slice(0, 6), many[0].id, new Map())).toEqual({
      shown: many.slice(0, 6),
      more: [],
    });
  });

  it('puts assets with a market price first and the unpriced ones behind the list', () => {
    const priced = new Map([[many[7].id, '1']]);
    const { shown, more } = splitAssets(many, many[7].id, priced);
    expect(shown.map((item) => item.symbol)).toEqual(['C8', 'C1', 'C2', 'C3', 'C4', 'C5']);
    expect(more.map((item) => item.symbol)).toEqual(['C6', 'C7']);
  });

  it('orders by allocation and keeps held assets among the chips', () => {
    const share = new Map([
      [many[5].id, 10],
      [many[7].id, 60],
    ]);
    const ordered = byAllocation(many, share);
    expect(ordered.map((item) => item.symbol).slice(0, 3)).toEqual(['C8', 'C6', 'C1']);
    const { shown, more } = splitAssets(ordered, ordered[0].id, new Map(), share);
    expect(shown.map((item) => item.symbol)).toEqual(['C8', 'C6', 'C1', 'C2', 'C3', 'C4']);
    expect(more.map((item) => item.symbol)).toEqual(['C5', 'C7']);
  });

  it('always shows the chosen asset', () => {
    const { shown, more } = splitAssets(many, many[6].id, new Map());
    expect(shown.map((item) => item.symbol)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C7']);
    expect(more.map((item) => item.symbol)).toEqual(['C6', 'C8']);
  });
});
