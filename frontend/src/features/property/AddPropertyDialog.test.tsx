import { accountingApi } from '@api/accounting.api';
import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
import { manualPricesApi, type PriceReceipt } from '@api/manual-prices.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import { forgetReads } from '@api/read-cache';
import { type TradeReceipt, tradesApi } from '@api/trades.api';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import AddPropertyDialog from './AddPropertyDialog';

// Synthetic names, ids and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset: PortfolioAsset = {
  id: id(1),
  name: 'Studio',
  symbol: null,
  namespace: 'manual',
  assetType: 'manual',
  valuationCurrency: 'RUB',
  priceSource: 'manual',
  createdAt: '2026-10-12T15:42:31.000Z',
};
const rates = (usd: string | null): FxRatesReport => ({
  date: '2026-10-12',
  source: 'cbr',
  rates: [
    { currency: 'USD', rubPerUnit: usd, date: usd && '2026-10-12' },
    { currency: 'EUR', rubPerUnit: '100.5', date: '2026-10-12' },
  ],
  sync: null,
});
const refused = (status: number) =>
  new AxiosError('refused', String(status), undefined, undefined, {
    status,
    statusText: 'refused',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
// The server's receipt keeps a ruble or euro purchase as paid next to its USD amount.
const receipt = (
  quantity: string,
  grossUsd: string,
  occurredAt: string,
  paid?: { currency: 'RUB' | 'EUR'; gross: string; fee: string },
) =>
  ({
    accountId: id(2),
    journalRevision: 1,
    trade: {
      quantity,
      grossUsd,
      occurredAt,
      ...(paid
        ? {
            paid: {
              ...paid,
              rateDate: occurredAt.slice(0, 10),
              perUsd: '90.12',
              rateSource: 'bank-of-russia',
            },
          }
        : {}),
    },
  }) as TradeReceipt;

let createAccount: Mock<typeof accountingApi.createAccount>;
let createAsset: Mock<typeof portfolioAssetsApi.create>;
let createTrade: Mock<typeof tradesApi.create>;
let setPrice: Mock<typeof manualPricesApi.set>;
let removeAccount: Mock<typeof accountingApi.removeAccount>;
beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T15:42:31Z'));
  vi.spyOn(fxRatesApi, 'get').mockResolvedValue(rates('90.12'));
  createAccount = vi.fn<typeof accountingApi.createAccount>(async (input) => ({
    id: id(2),
    name: input.name,
    kind: null,
    assetClass: 'property',
    currentRevision: 0,
    createdAt: '2026-10-12T15:42:31Z',
  }));
  vi.spyOn(accountingApi, 'createAccount').mockImplementation(createAccount);
  // The server keeps the currency the asset is valued in, as asked.
  createAsset = vi.fn<typeof portfolioAssetsApi.create>(async (input) => ({
    ...asset,
    valuationCurrency: input.valuationCurrency ?? 'USD',
  }));
  vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(createAsset);
  createTrade = vi.fn<typeof tradesApi.create>(async (_account, command) =>
    receipt(
      command.quantity,
      '47159.34',
      command.occurredAt,
      'paid' in command ? command.paid : undefined,
    ),
  );
  vi.spyOn(tradesApi, 'create').mockImplementation(createTrade);
  setPrice = vi.fn<typeof manualPricesApi.set>(async () => ({}) as PriceReceipt);
  vi.spyOn(manualPricesApi, 'set').mockImplementation(setPrice);
  removeAccount = vi.fn<typeof accountingApi.removeAccount>(async () => undefined);
  vi.spyOn(accountingApi, 'removeAccount').mockImplementation(removeAccount);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function open() {
  const onAdded = vi.fn();
  const onClose = vi.fn();
  render(<AddPropertyDialog onAdded={onAdded} onClose={onClose} />);
  return { dialog: screen.getByRole('dialog', { name: 'Add property' }), onAdded, onClose };
}
const fill = async (
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  fields: Record<string, string>,
) => {
  for (const [label, value] of Object.entries(fields)) {
    const input = within(dialog).getByLabelText(label);
    await user.clear(input);
    if (value) await user.type(input, value);
  }
};

describe('PROPERTY-ADD Add property', () => {
  it('saves a half share of a past purchase as money put in, then today’s estimate', async () => {
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).value),
    ).toEqual(['Apartment', 'House', 'Land', 'Parking', 'Commercial', 'USD', 'EUR', 'RUB']);
    expect(within(dialog).getByRole('radio', { name: 'Apartment' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'RUB' })).toBeChecked();
    expect(within(dialog).getByLabelText('Bought on')).toHaveValue('2026-10-12');
    await fill(user, dialog, {
      'Name (optional)': 'Studio',
      'Purchase price': '8500000',
      'Bought on': '2025-09-01',
      'What it is worth now (optional)': '9200000',
      'Your share': '50',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));

    expect(createAccount).toHaveBeenCalledWith({
      requestId: expect.any(String),
      name: 'Studio',
      assetClass: 'property',
    });
    expect(createAsset).toHaveBeenCalledWith({
      requestId: expect.any(String),
      name: 'Studio',
      assetType: 'manual',
      valuationCurrency: 'RUB',
    });
    expect(createTrade).toHaveBeenCalledWith(id(2), {
      requestId: expect.any(String),
      expectedJournalRevision: 0,
      instrumentId: id(1),
      side: 'buy',
      occurredAt: '2025-09-01T00:00:00.000Z',
      quantity: '0.5',
      paid: { currency: 'RUB', gross: '4250000', fee: '0' },
    });
    // AST-MANUAL-VALUE: the whole property's price in rubles, as entered: what it cost on that
    // day, then the estimate. No dollar rate turns it into a figure that drifts.
    expect(setPrice.mock.calls).toEqual([
      [
        id(1),
        {
          requestId: expect.any(String),
          expectedRevision: 0,
          observedAt: '2025-09-01T00:00:00.000Z',
          price: '8500000',
          currency: 'RUB',
          assertReviewed: true,
        },
      ],
      [
        id(1),
        {
          requestId: expect.any(String),
          expectedRevision: 1,
          observedAt: '2026-10-12T15:42:31Z',
          price: '9200000',
          currency: 'RUB',
          assertReviewed: true,
        },
      ],
    ]);
    expect(onAdded).toHaveBeenCalledWith(asset);
  });

  it('names a property bought today after its kind and starts it at the estimate', async () => {
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    await user.click(within(dialog).getByRole('radio', { name: 'Parking' }));
    await user.click(within(dialog).getByRole('radio', { name: 'USD' }));
    await fill(user, dialog, {
      'Purchase price': '30000',
      'What it is worth now (optional)': '31000',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));
    expect(createAccount.mock.calls[0][0]).toMatchObject({ name: 'Parking' });
    expect(createTrade.mock.calls[0][1]).toMatchObject({
      occurredAt: '2026-10-12T15:42:00.000Z',
      quantity: '1',
      grossUsd: '30000',
    });
    expect(setPrice).toHaveBeenCalledTimes(1);
    expect(setPrice.mock.calls[0][1]).toMatchObject({
      expectedRevision: 0,
      observedAt: '2026-10-12T15:42:00.000Z',
      price: '31000',
      currency: 'USD',
    });
    expect(onAdded).toHaveBeenCalled();
  });

  it('shows what is missing and saves nothing', async () => {
    const user = userEvent.setup();
    const { dialog } = open();
    await fill(user, dialog, { 'Your share': '0', 'Bought on': '2026-10-13' });
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));
    expect(within(dialog).getByText('Enter what you paid')).toBeInTheDocument();
    expect(within(dialog).getByText('A share from 0.01 to 100%')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a date that is not in the future')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Purchase price')).toHaveAttribute('aria-invalid', 'true');
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('AST-MANUAL-VALUE keeps a ruble estimate in rubles, with no rate of the day needed', async () => {
    vi.mocked(fxRatesApi.get).mockResolvedValue(rates(null));
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    await fill(user, dialog, {
      'Purchase price': '8500000',
      'What it is worth now (optional)': '9200000',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));
    expect(setPrice.mock.calls.map(([, command]) => [command.price, command.currency])).toEqual([
      ['9200000', 'RUB'],
    ]);
    expect(fxRatesApi.get).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalledWith(asset);
  });

  it('retries only what is missing, under the same requests', async () => {
    setPrice.mockRejectedValueOnce(refused(500));
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    await fill(user, dialog, { 'Purchase price': '8500000', 'Bought on': '2025-09-01' });
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The property and its purchase were saved, but its value was not. Try again.',
    );
    expect(within(dialog).getByLabelText('Purchase price')).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(createAsset).toHaveBeenCalledTimes(1);
    expect(createTrade).toHaveBeenCalledTimes(1);
    expect(setPrice).toHaveBeenCalledTimes(2);
    expect(setPrice.mock.calls[1][1].requestId).toBe(setPrice.mock.calls[0][1].requestId);
    expect(onAdded).toHaveBeenCalledWith(asset);
  });

  it('leaves no empty account behind when closed before the purchase is saved', async () => {
    // Codex P2: the account is made first; closing after a later step failed must not strand it.
    createAsset.mockRejectedValueOnce(refused(500));
    const user = userEvent.setup();
    const { dialog, onAdded, onClose } = open();
    await fill(user, dialog, { 'Purchase price': '8500000' });
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nothing was saved.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(removeAccount).toHaveBeenCalledWith(id(2));
    expect(onClose).toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('keeps the property and opens it when its purchase is refused', async () => {
    // As Add asset does: the property is saved and cannot be taken back, so its page opens.
    createTrade.mockRejectedValueOnce(refused(400));
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    await fill(user, dialog, { 'Purchase price': '8500000' });
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The property was added, but its purchase was not saved. Check the fields and try again.',
    );
    const [, footer] = within(dialog).getAllByRole('button', { name: 'Close' });
    await user.click(footer);
    expect(removeAccount).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalledWith(asset);
  });

  it('keeps everything once the purchase is saved, even if the value is not', async () => {
    setPrice.mockRejectedValueOnce(refused(500));
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    await fill(user, dialog, { 'Purchase price': '8500000' });
    await user.click(within(dialog).getByRole('button', { name: 'Add property' }));
    await within(dialog).findByRole('alert');
    // The footer's Cancel became Close: what is saved is kept.
    const [, footer] = within(dialog).getAllByRole('button', { name: 'Close' });
    await user.click(footer);
    expect(removeAccount).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalledWith(asset);
  });
});
