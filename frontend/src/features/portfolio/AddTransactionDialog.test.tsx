import { accountingApi } from '@api/accounting.api';
import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
import type { Operation } from '@api/operations.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import { type JournalState, type TradeReceipt, tradesApi } from '@api/trades.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddTransactionDialog from './AddTransactionDialog';
import { bankRate, decimal, type TransactionEntry, tradeFromEntry } from './add-transaction';

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
      ...identity,
    });
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
});

describe('CUR-PAID-RUB the Add transaction window', () => {
  const create = vi.fn();
  const correct = vi.fn();
  const available = vi.fn();
  const rates = vi.fn();
  beforeEach(() => {
    vi.spyOn(portfolioAssetsApi, 'listAll').mockResolvedValue([bitcoin, ether, dollars]);
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
      requestId: expect.any(String),
      expectedJournalRevision: 7,
    });
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
    expect(await view.findByText(/Available in Hardware wallet: 0\.2 BTC/)).toBeInTheDocument();
    expect(available).toHaveBeenLastCalledWith(id(11), {
      instrumentId: id(1),
      at: '2026-04-01T00:00:00.000Z',
    });
    await user.type(view.getByLabelText('Amount'), '0.3');
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
    comment: 'First buy',
    account: { id: id(11), name: 'Hardware wallet' },
    counterAccount: null,
    wallet: null,
    chain: null,
    status: 'recorded',
    source: 'manual',
    version: 1,
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
      requestId: expect.any(String),
      expectedJournalRevision: 4,
    });
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
});
