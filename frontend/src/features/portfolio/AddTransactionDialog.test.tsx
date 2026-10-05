import { accountingApi } from '@api/accounting.api';
import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
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
      orderWithinTimestamp: 0,
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
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    create.mockReset();
    rates.mockReset();
  });

  const open = async () => {
    const onSaved = vi.fn();
    render(
      <MemoryRouter>
        <AddTransactionDialog onClose={vi.fn()} onSaved={onSaved} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add transaction' });
    await within(dialog).findByRole('group', { name: 'Asset' });
    return { dialog, onSaved };
  };

  it('fills the Bank of Russia rate of the date and saves rubles as paid', async () => {
    const user = userEvent.setup();
    const { dialog, onSaved } = await open();
    const view = within(dialog);
    // Cash is not traded here; accounts without a trade journal are not offered.
    expect(view.queryByRole('button', { name: /USD$/ })).not.toBeInTheDocument();
    expect(view.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Hardware wallet',
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
      orderWithinTimestamp: 0,
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
});
