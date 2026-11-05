import { accountingApi } from '@api/accounting.api';
import { fxRatesApi } from '@api/fx-rates.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import { type PortfolioValuation, portfolioValuationApi } from '@api/portfolio-valuation.api';
import { type JournalState, type TradeReceipt, tradesApi } from '@api/trades.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddTransactionDialog from './AddTransactionDialog';
import { type ConvertEntry, convertProblems, convertTrade, impliedRate, rateText } from './convert';

// Synthetic accounts, assets, dates and amounts only (CASH-CONVERT).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cash = (n: number, name: string, symbol: string): PortfolioAsset => ({
  id: id(n),
  name,
  symbol,
  namespace: 'manual',
  assetType: 'fiat',
  valuationCurrency: symbol as PortfolioAsset['valuationCurrency'],
  priceSource: 'fixed',
  createdAt: '2025-01-01T00:00:00.000Z',
});
const dollars = cash(3, 'US dollar', 'USD');
const rubles = cash(5, 'Russian ruble', 'RUB');
const euros = cash(6, 'Euro', 'EUR');
const bitcoin: PortfolioAsset = {
  ...cash(1, 'Bitcoin', 'BTC'),
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
};
const identity = { requestId: id(9), expectedJournalRevision: 4 };
const entry: ConvertEntry = {
  from: 'RUB',
  to: 'USD',
  amount: '72 000',
  received: '800',
  date: '2026-03-02',
  time: '',
  comment: '',
};

describe('CASH-CONVERT the entry becomes one sale of the cash given up', () => {
  it('settles a sale of rubles in the dollars received', () => {
    expect(convertTrade(entry, rubles.id, identity)).toEqual({
      instrumentId: rubles.id,
      side: 'sell',
      occurredAt: '2026-03-02T00:00:00.000Z',
      quantity: '72000',
      grossUsd: '800',
      feeUsd: '0',
      settlementCurrency: 'USD',
      ...identity,
    });
  });

  it('sends rubles received for dollars given as paid at the rate the amounts imply', () => {
    const sale = convertTrade(
      { ...entry, from: 'USD', to: 'RUB', amount: '1 000', received: '90 000' },
      dollars.id,
      identity,
      2,
    );
    expect(sale).toMatchObject({
      instrumentId: dollars.id,
      side: 'sell',
      quantity: '1000',
      paid: { currency: 'RUB', gross: '90000', fee: '0', perUsd: '90' },
      settlementCurrency: 'RUB',
      orderWithinTimestamp: 2,
    });
    expect(sale).not.toHaveProperty('grossUsd');
  });

  it('leaves euros and rubles to the Bank of Russia rate of the day', () => {
    const sale = convertTrade(
      { ...entry, from: 'EUR', to: 'RUB', amount: '500', received: '50 000', time: '09:30' },
      euros.id,
      identity,
    );
    expect(sale).toMatchObject({
      occurredAt: '2026-03-02T09:30:00.000Z',
      quantity: '500',
      paid: { currency: 'RUB', gross: '50000', fee: '0' },
      settlementCurrency: 'RUB',
    });
    expect('paid' in sale && sale.paid).not.toHaveProperty('perUsd');
  });

  it('keeps a trimmed comment and drops a blank one', () => {
    expect(
      convertTrade({ ...entry, comment: ' Bureau on Main St \n' }, rubles.id, identity),
    ).toMatchObject({
      comment: 'Bureau on Main St',
    });
    expect(convertTrade({ ...entry, comment: '  ' }, rubles.id, identity)).not.toHaveProperty(
      'comment',
    );
  });

  it('works out the rate from the two amounts, exactly when they divide', () => {
    expect(impliedRate({ amount: '72 000', received: '800' })).toBe('0.011111111111111111');
    expect(impliedRate({ amount: '800', received: '72000' })).toBe('90');
    expect(impliedRate({ amount: '3', received: '100' })).toBe('33.333333333333333333');
    expect(impliedRate({ amount: '', received: '100' })).toBeNull();
    expect(impliedRate({ amount: '0', received: '100' })).toBeNull();
  });

  it('shows no rate and refuses an amount finer than 18 places instead of failing on it', () => {
    const tiny = '0.0000000000000000001';
    expect(impliedRate({ amount: tiny, received: '100' })).toBeNull();
    expect(impliedRate({ amount: '100', received: tiny })).toBeNull();
    expect(rateText({ ...entry, amount: tiny })).toBeNull();
    expect(rateText({ ...entry, received: tiny })).toBeNull();
    expect([...convertProblems({ ...entry, amount: tiny }, '2026-03-02')]).toEqual(['amount']);
    expect([...convertProblems({ ...entry, received: tiny }, '2026-03-02')]).toEqual(['received']);
    expect(rateText(entry)).toBe('1 USD = 90 RUB');
  });

  it('refuses the same currency twice, empty amounts, a future date and a long comment', () => {
    expect(convertProblems(entry, '2026-03-02').size).toBe(0);
    expect([...convertProblems({ ...entry, to: 'RUB' }, '2026-03-02')]).toEqual(['currency']);
    expect(
      [...convertProblems({ ...entry, amount: '', received: '0' }, '2026-03-02')].sort(),
    ).toEqual(['amount', 'received']);
    expect([...convertProblems({ ...entry, date: '2026-03-03' }, '2026-03-02')]).toEqual(['date']);
    expect([...convertProblems({ ...entry, time: '9am' }, '2026-03-02')]).toEqual(['time']);
    expect([...convertProblems({ ...entry, comment: 'x'.repeat(501) }, '2026-03-02')]).toEqual([
      'comment',
    ]);
  });
});

describe('CASH-CONVERT the Convert type of the Add transaction window', () => {
  const create = vi.fn();
  const available = vi.fn();
  beforeEach(() => {
    vi.spyOn(portfolioAssetsApi, 'listAll').mockResolvedValue([bitcoin, dollars, rubles, euros]);
    vi.spyOn(walletAddressesApi, 'list').mockResolvedValue([]);
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [
        {
          id: id(11),
          name: 'Home safe',
          kind: null,
          currentRevision: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: id(13),
          name: 'Exchange',
          kind: null,
          currentRevision: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    vi.spyOn(tradesApi, 'state').mockImplementation(
      async (account) =>
        ({
          accountId: account,
          eligible: false,
          ineligibilityReason: 'already-initialized',
          journal: { journalRevision: account === id(11) ? 4 : 7 },
        }) as JournalState,
    );
    vi.spyOn(fxRatesApi, 'get').mockResolvedValue({
      date: '2026-03-02',
      source: 'cbr',
      rates: [
        { currency: 'USD', rubPerUnit: '90', date: '2026-03-02' },
        { currency: 'EUR', rubPerUnit: '100', date: '2026-03-02' },
      ],
      sync: null,
    });
    create.mockResolvedValue({} as TradeReceipt);
    vi.spyOn(tradesApi, 'create').mockImplementation(create);
    available.mockImplementation(async (accountId, query) => ({
      accountId,
      ...query,
      journalRevision: 4,
      quantity: query.instrumentId === rubles.id ? '80000' : '0',
    }));
    vi.spyOn(tradesApi, 'available').mockImplementation(available);
    vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({
      assets: [],
    } as unknown as PortfolioValuation);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    create.mockReset();
    available.mockReset();
  });

  const open = async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <AddTransactionDialog onClose={onClose} onSaved={onSaved} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add transaction' });
    await within(dialog).findByRole('group', { name: 'Asset' });
    const view = within(dialog);
    await user.click(view.getByRole('button', { name: 'More' }));
    await user.click(view.getByRole('radio', { name: 'Convert' }));
    return { user, view, onSaved, onClose };
  };
  // Both currency rows list the same three codes: the first radio of a code is "From", the second "To".
  const currency = (view: ReturnType<typeof within>, group: 'From' | 'To', code: string) =>
    view.getAllByRole('radio', { name: code })[group === 'From' ? 0 : 1];

  it('saves rubles handed over for dollars as one sale settled in dollars', async () => {
    const { user, view, onSaved } = await open();
    await user.click(currency(view, 'From', 'RUB'));
    await user.click(currency(view, 'To', 'USD'));
    await user.type(view.getByLabelText('Amount given'), '72000');
    await user.type(view.getByLabelText('Amount received'), '800');
    expect(await view.findByText(/Available in Home safe: 80,000 RUB/)).toBeInTheDocument();
    expect(view.getByText('1 USD = 90 RUB')).toBeInTheDocument();
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toBe(id(11));
    expect(create.mock.calls[0][1]).toMatchObject({
      instrumentId: rubles.id,
      side: 'sell',
      quantity: '72000',
      grossUsd: '800',
      feeUsd: '0',
      settlementCurrency: 'USD',
      expectedJournalRevision: 4,
    });
  });

  it('asks what the account holds only for a complete date', async () => {
    const { user, view } = await open();
    await user.click(currency(view, 'From', 'RUB'));
    await view.findByText(/Available in Home safe/);
    available.mockClear();
    await user.clear(view.getByLabelText('Date'));
    await user.tab();
    expect(available).not.toHaveBeenCalled();
  });

  it('moves the keyboard to the chosen type when the body is swapped', async () => {
    const { user, view } = await open();
    expect(view.getByRole('radio', { name: 'Convert' })).toHaveFocus();
    await user.click(view.getByRole('radio', { name: 'Fee' }));
    expect(view.getByRole('radio', { name: 'Fee' })).toHaveFocus();
  });

  it('turns the other currency around when the same one is picked twice', async () => {
    const { user, view } = await open();
    await user.click(currency(view, 'From', 'RUB'));
    await user.click(currency(view, 'To', 'USD'));
    await user.click(currency(view, 'To', 'RUB'));
    expect(currency(view, 'To', 'RUB')).toBeChecked();
    expect(currency(view, 'From', 'RUB')).not.toBeChecked();
  });

  it('OPS-OVERSPEND refuses more than the account holds and fills Use all', async () => {
    const { user, view } = await open();
    await user.click(currency(view, 'From', 'RUB'));
    await user.click(currency(view, 'To', 'USD'));
    await user.type(view.getByLabelText('Amount given'), '90000');
    await user.type(view.getByLabelText('Amount received'), '1000');
    await user.tab();
    expect(await view.findByRole('alert')).toHaveTextContent(
      'Only 80,000 RUB is available in Home safe on',
    );
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(create).not.toHaveBeenCalled();
    await user.click(view.getByRole('button', { name: 'Use all' }));
    expect(view.getByLabelText('Amount given')).toHaveValue('80000');
  });

  it('says so when no cash in the currency given up has been added yet', async () => {
    vi.mocked(portfolioAssetsApi.listAll).mockResolvedValue([bitcoin, dollars]);
    const { user, view } = await open();
    await user.click(currency(view, 'From', 'RUB'));
    await user.type(view.getByLabelText('Amount given'), '100');
    await user.type(view.getByLabelText('Amount received'), '1');
    expect(view.getByText(/You hold no RUB cash yet/)).toBeInTheDocument();
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the request id and the instant when a time-less save is retried a minute later', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-02T10:00:20.000Z') });
    try {
      create.mockRejectedValueOnce(new Error('offline'));
      const { user, view, onSaved } = await open();
      await user.click(currency(view, 'From', 'RUB'));
      await user.click(currency(view, 'To', 'USD'));
      await user.type(view.getByLabelText('Amount given'), '9000');
      await user.type(view.getByLabelText('Amount received'), '100');
      await user.click(view.getByRole('button', { name: 'Save transaction' }));
      expect(await view.findByText(/Could not reach the server/)).toBeInTheDocument();
      vi.setSystemTime(new Date('2026-03-02T10:01:20.000Z'));
      await user.click(view.getByRole('button', { name: 'Save transaction' }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(create.mock.calls[0][1].occurredAt).toBe('2026-03-02T10:00:00.000Z');
      expect(create.mock.calls[1][1].occurredAt).toBe('2026-03-02T10:00:00.000Z');
      expect(create.mock.calls[1][1].requestId).toBe(create.mock.calls[0][1].requestId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not close on Escape while a conversion is being saved', async () => {
    let finish: (receipt: TradeReceipt) => void = () => undefined;
    create.mockReturnValueOnce(new Promise<TradeReceipt>((resolve) => (finish = resolve)));
    const { user, view, onSaved, onClose } = await open();
    await user.click(currency(view, 'From', 'RUB'));
    await user.click(currency(view, 'To', 'USD'));
    await user.type(view.getByLabelText('Amount given'), '9000');
    await user.type(view.getByLabelText('Amount received'), '100');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    finish({} as TradeReceipt);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('keeps one request id when a failed save is tried again', async () => {
    create.mockRejectedValueOnce(new Error('offline'));
    const { user, view, onSaved } = await open();
    await user.click(currency(view, 'From', 'RUB'));
    await user.click(currency(view, 'To', 'USD'));
    await user.type(view.getByLabelText('Amount given'), '9000');
    await user.type(view.getByLabelText('Amount received'), '100');
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    expect(await view.findByText(/Could not reach the server/)).toBeInTheDocument();
    await user.click(view.getByRole('button', { name: 'Save transaction' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(create.mock.calls[1][1].requestId).toBe(create.mock.calls[0][1].requestId);
  });
});
