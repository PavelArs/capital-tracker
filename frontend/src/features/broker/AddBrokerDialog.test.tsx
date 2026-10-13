import { accountingApi } from '@api/accounting.api';
import { type FxRatesReport, fxRatesApi } from '@api/fx-rates.api';
import { type HiddenAsset, hiddenAssetsApi } from '@api/hidden-assets.api';
import { manualPricesApi, type PriceReceipt } from '@api/manual-prices.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import { forgetReads } from '@api/read-cache';
import { type AvailableQuantity, type TradeReceipt, tradesApi } from '@api/trades.api';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import AddBrokerDialog from './AddBrokerDialog';

// Synthetic names, ids and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const created = (n: number, changes: Partial<PortfolioAsset>): PortfolioAsset => ({
  id: id(n),
  name: 'VWRA',
  symbol: 'VWRA',
  namespace: 'manual',
  assetType: 'manual',
  valuationCurrency: 'USD',
  priceSource: 'manual',
  createdAt: '2026-10-13T08:15:42.000Z',
  ...changes,
});
const rates = (usd: string | null): FxRatesReport => ({
  date: '2026-10-13',
  source: 'cbr',
  rates: [
    { currency: 'USD', rubPerUnit: usd, date: usd && '2026-10-13' },
    { currency: 'EUR', rubPerUnit: '100.5', date: '2026-10-13' },
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

let createAccount: Mock<typeof accountingApi.createAccount>;
let createAsset: Mock<typeof portfolioAssetsApi.create>;
let listAssets: Mock<typeof portfolioAssetsApi.listAll>;
let createTrade: Mock<typeof tradesApi.create>;
let setPrice: Mock<typeof manualPricesApi.set>;
let removeAccount: Mock<typeof accountingApi.removeAccount>;
let hideAsset: Mock<typeof hiddenAssetsApi.hide>;
let showAsset: Mock<typeof hiddenAssetsApi.show>;
beforeEach(() => {
  vi.restoreAllMocks();
  forgetReads();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T08:15:42Z'));
  vi.spyOn(fxRatesApi, 'get').mockResolvedValue(rates('90.12'));
  createAccount = vi.fn<typeof accountingApi.createAccount>(async (input) => ({
    id: id(2),
    name: input.name,
    kind: null,
    assetClass: 'broker',
    currentRevision: 0,
    createdAt: '2026-10-13T08:15:42Z',
  }));
  vi.spyOn(accountingApi, 'createAccount').mockImplementation(createAccount);
  let next = 10;
  createAsset = vi.fn<typeof portfolioAssetsApi.create>(async (input) =>
    created(next++, {
      name: input.name,
      symbol: input.symbol ?? null,
      assetType: input.assetType,
      valuationCurrency: input.valuationCurrency ?? 'USD',
      priceSource: input.assetType === 'fiat' ? 'fixed' : 'manual',
    }),
  );
  vi.spyOn(portfolioAssetsApi, 'create').mockImplementation(createAsset);
  listAssets = vi.fn<typeof portfolioAssetsApi.listAll>(async () => []);
  vi.spyOn(portfolioAssetsApi, 'listAll').mockImplementation(listAssets);
  let revision = 0;
  createTrade = vi.fn<typeof tradesApi.create>(
    async (_account, command) =>
      ({
        accountId: id(2),
        journalRevision: ++revision,
        trade: {
          quantity: command.quantity,
          grossUsd: 'grossUsd' in command ? command.grossUsd : '100',
          occurredAt: command.occurredAt,
        },
      }) as TradeReceipt,
  );
  vi.spyOn(tradesApi, 'create').mockImplementation(createTrade);
  vi.spyOn(tradesApi, 'available').mockRejectedValue(new Error('offline'));
  setPrice = vi.fn<typeof manualPricesApi.set>(async () => ({}) as PriceReceipt);
  vi.spyOn(manualPricesApi, 'set').mockImplementation(setPrice);
  removeAccount = vi.fn<typeof accountingApi.removeAccount>(async () => undefined);
  vi.spyOn(accountingApi, 'removeAccount').mockImplementation(removeAccount);
  hideAsset = vi.fn<typeof hiddenAssetsApi.hide>(async () => ({}) as HiddenAsset);
  vi.spyOn(hiddenAssetsApi, 'hide').mockImplementation(hideAsset);
  vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
  showAsset = vi.fn<typeof hiddenAssetsApi.show>(async () => undefined);
  vi.spyOn(hiddenAssetsApi, 'show').mockImplementation(showAsset);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function open() {
  const onAdded = vi.fn();
  const onClose = vi.fn();
  render(<AddBrokerDialog onAdded={onAdded} onClose={onClose} />);
  return { dialog: screen.getByRole('dialog', { name: 'Add broker account' }), onAdded, onClose };
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

describe('BROKER-ADD Add broker account', () => {
  it('saves the account, each position at its price and the cash, as money put in', async () => {
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    expect(within(dialog).getByRole('radio', { name: 'Regular' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'USD' })).toBeChecked();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add position' }));
    await fill(user, dialog, {
      'Ticker or name 2': 'Bond fund 2030',
      'Quantity 2': '4',
      'Price 2': '99.5',
      'Cash at the broker (optional)': '250',
    });
    await user.click(within(dialog).getByRole('radio', { name: 'Individual investment (IIS)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));

    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Sample Broker · IIS', assetClass: 'broker' }),
    );
    expect(createAsset.mock.calls.map(([input]) => [input.name, input.symbol])).toEqual([
      ['VWRA', 'VWRA'],
      ['Bond fund 2030', undefined],
      ['US dollar', 'USD'],
    ]);
    // Each buy expects the journal revision the previous one left; none spends cash.
    expect(
      createTrade.mock.calls.map(([, command]) => [
        command.quantity,
        'grossUsd' in command ? command.grossUsd : null,
        command.expectedJournalRevision,
        command.occurredAt,
        command.settlementCurrency,
      ]),
    ).toEqual([
      ['30', '4263', 0, '2026-10-13T08:15:00.000Z', undefined],
      ['4', '398', 1, '2026-10-13T08:15:00.000Z', undefined],
      ['250', '250', 2, '2026-10-13T08:15:00.000Z', undefined],
    ]);
    // Positions start at their entered price; cash has a fixed one.
    expect(setPrice.mock.calls.map(([asset, body]) => [asset, body.priceUsd])).toEqual([
      [id(10), '142.1'],
      [id(11), '99.5'],
    ]);
  });

  it('puts cash into the cash asset the owner already has', async () => {
    listAssets.mockResolvedValue([
      created(30, { name: 'US dollar', symbol: 'USD', assetType: 'fiat', priceSource: 'fixed' }),
    ]);
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    await fill(user, dialog, { Broker: 'Sample Broker', 'Cash at the broker (optional)': '250' });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(onAdded).toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
    expect(createTrade).toHaveBeenCalledWith(
      id(2),
      expect.objectContaining({ instrumentId: id(30), quantity: '250' }),
    );
  });

  it('shows a hidden cash asset again before putting the cash into it', async () => {
    // Codex P2: cash in a hidden asset would be left out of Brokers and net worth.
    listAssets.mockResolvedValue([
      created(30, { name: 'US dollar', symbol: 'USD', assetType: 'fiat', priceSource: 'fixed' }),
    ]);
    vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([
      { instrumentId: id(30), name: 'US dollar', symbol: 'USD', hiddenAt: '2026-10-01T00:00:00Z' },
    ]);
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    await fill(user, dialog, { Broker: 'Sample Broker', 'Cash at the broker (optional)': '250' });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(onAdded).toHaveBeenCalled();
    expect(showAsset).toHaveBeenCalledWith(id(30));
    expect(createTrade).toHaveBeenCalledWith(
      id(2),
      expect.objectContaining({ instrumentId: id(30) }),
    );
  });

  it('asks for the broker and something it holds, and flags a row filled in partly', async () => {
    const user = userEvent.setup();
    const { dialog } = open();
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(within(dialog).getByText('Enter the broker, on one line')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Add a position or the cash at the broker'),
    ).toBeInTheDocument();
    await fill(user, dialog, { Broker: 'Sample Broker', 'Ticker or name 1': 'VWRA' });
    expect(
      within(dialog).getByText(
        'Fill in the ticker, the quantity and the price of each position, or clear the row',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Quantity 1')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText('Ticker or name 1')).not.toHaveAttribute('aria-invalid');
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('saves nothing without today’s Bank of Russia rate for RUB prices', async () => {
    vi.spyOn(fxRatesApi, 'get').mockResolvedValue(rates(null));
    const user = userEvent.setup();
    const { dialog } = open();
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'SBER',
      'Quantity 1': '10',
      'Price 1': '300',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No recent Bank of Russia rate is stored, so RUB amounts cannot be converted. Nothing was saved',
    );
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('saves nothing with a stale rate, or while the rates cannot be read', async () => {
    // Codex P2: the server refuses a rate older than 15 days, and an unread report proves nothing.
    const get = vi.spyOn(fxRatesApi, 'get').mockResolvedValue({
      ...rates('90.12'),
      rates: [
        { currency: 'USD', rubPerUnit: '90.12', date: '2026-09-20' },
        { currency: 'EUR', rubPerUnit: '100.5', date: '2026-10-13' },
      ],
    });
    const user = userEvent.setup();
    const { dialog } = open();
    await user.click(within(dialog).getByRole('radio', { name: 'EUR' }));
    await fill(user, dialog, { Broker: 'Sample Broker', 'Cash at the broker (optional)': '250' });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No recent Bank of Russia rate is stored, so EUR amounts cannot be converted.',
    );
    forgetReads();
    get.mockRejectedValue(new Error('offline'));
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await vi.waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Could not check the Bank of Russia rate for EUR. Nothing was saved; try again.',
      ),
    );
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('checks the rate against the Moscow date, as the server does', async () => {
    // Codex P2: at 21:30 UTC it is already the 14th in Moscow, so a rate of Sep 28 is 16 days old.
    vi.setSystemTime(new Date('2026-10-13T21:30:00Z'));
    vi.spyOn(fxRatesApi, 'get').mockResolvedValue({
      ...rates('90.12'),
      rates: [
        { currency: 'USD', rubPerUnit: '90.12', date: '2026-09-28' },
        { currency: 'EUR', rubPerUnit: '100.5', date: '2026-09-28' },
      ],
    });
    const user = userEvent.setup();
    const { dialog } = open();
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    await fill(user, dialog, { Broker: 'Sample Broker', 'Cash at the broker (optional)': '250' });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No recent Bank of Russia rate is stored, so RUB amounts cannot be converted.',
    );
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('saves nothing when an amount would convert to zero dollars', async () => {
    // Codex P2: the server refuses a buy whose dollar amount rounds to zero.
    const user = userEvent.setup();
    const { dialog } = open();
    await user.click(within(dialog).getByRole('radio', { name: 'RUB' }));
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'SBER',
      'Quantity 1': '0.000000000000001',
      'Price 1': '0.000000000000001',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'An amount is too small or too large to convert to US dollars',
    );
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('retries only what is missing after a failure, under the same requests', async () => {
    createTrade.mockRejectedValueOnce(refused(503));
    const user = userEvent.setup();
    const { dialog, onAdded, onClose } = open();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The account was added, but not all it holds was saved.',
    );
    expect(within(dialog).getByLabelText('Quantity 1')).toBeDisabled();
    const firstTrade = createTrade.mock.calls[0][1].requestId;

    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(createAsset).toHaveBeenCalledTimes(1);
    expect(createTrade).toHaveBeenCalledTimes(2);
    expect(createTrade.mock.calls[1][1].requestId).toBe(firstTrade);
    expect(setPrice).toHaveBeenCalledTimes(1);
  });

  it('removes an account that holds nothing yet when closed after a failure', async () => {
    createAsset.mockRejectedValueOnce(refused(400));
    const user = userEvent.setup();
    const { dialog, onAdded, onClose } = open();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(removeAccount).toHaveBeenCalledWith(id(2));
    expect(onClose).toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    expect(hideAsset).not.toHaveBeenCalled();
  });

  it('leaves a position whose buy may have been saved when its account cannot be removed', async () => {
    // Codex P1: a lost answer or a server error does not prove the buy was not saved.
    createTrade.mockRejectedValueOnce(refused(503));
    removeAccount.mockRejectedValueOnce(refused(409));
    const user = userEvent.setup();
    const { dialog, onAdded, onClose } = open();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(hideAsset).not.toHaveBeenCalled();
  });

  it('hides a position whose buy got no answer once its account is removed', async () => {
    // Codex P2: the server removes only an account without buys, so none was saved.
    createTrade.mockRejectedValueOnce(refused(503));
    const user = userEvent.setup();
    const { dialog, onClose } = open();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(removeAccount).toHaveBeenCalledWith(id(2));
    expect(hideAsset.mock.calls).toEqual([[id(10)]]);
  });

  it('finds and hides a position asset whose answer was lost when closed', async () => {
    // Codex P2: the asset may have been made although no answer came back.
    createAsset.mockRejectedValueOnce(refused(503));
    const user = userEvent.setup();
    const { dialog, onClose } = open();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createAsset).toHaveBeenCalledTimes(2);
    expect(createAsset.mock.calls[1][0]).toEqual(createAsset.mock.calls[0][0]);
    expect(hideAsset.mock.calls).toEqual([[id(10)]]);
    expect(removeAccount).toHaveBeenCalledWith(id(2));
  });

  it('hides a hidden cash asset again after a lost answer to showing it', async () => {
    // Codex P2: showing it may have worked although no answer came back.
    listAssets.mockResolvedValue([
      created(30, { name: 'US dollar', symbol: 'USD', assetType: 'fiat', priceSource: 'fixed' }),
    ]);
    vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([
      { instrumentId: id(30), name: 'US dollar', symbol: 'USD', hiddenAt: '2026-10-01T00:00:00Z' },
    ]);
    showAsset.mockRejectedValueOnce(refused(503));
    const user = userEvent.setup();
    const { dialog, onClose } = open();
    await fill(user, dialog, { Broker: 'Sample Broker', 'Cash at the broker (optional)': '250' });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    // Retrying shows it again rather than taking it for one the owner keeps visible.
    vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([]);
    createTrade.mockRejectedValueOnce(refused(400));
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await vi.waitFor(() => expect(createTrade).toHaveBeenCalled());
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(showAsset.mock.calls).toEqual([[id(30)], [id(30)]]);
    expect(hideAsset.mock.calls).toEqual([[id(30)]]);
  });

  it('hides a position whose buy was not saved when closed', async () => {
    // Codex P2: an asset made without its buy would show in Portfolio as an empty asset.
    createTrade.mockRejectedValueOnce(refused(400));
    const user = userEvent.setup();
    const { dialog, onAdded, onClose } = open();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hideAsset.mock.calls).toEqual([[id(10)]]);
    expect(removeAccount).toHaveBeenCalledWith(id(2));
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('stays open to retry when hiding an empty asset fails', async () => {
    // Codex P2: closing anyway would leave the empty asset showing in Portfolio.
    createTrade.mockRejectedValueOnce(refused(400));
    hideAsset.mockRejectedValueOnce(refused(503));
    const user = userEvent.setup();
    const { dialog, onClose } = open();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Could not hide the empty assets this form added',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hideAsset.mock.calls).toEqual([[id(10)], [id(10)]]);
    expect(removeAccount).toHaveBeenCalledTimes(1);
    expect(createAccount).toHaveBeenCalledTimes(1);
  });

  it('keeps an account that holds something when closed after a later failure', async () => {
    setPrice.mockRejectedValueOnce(refused(503));
    const user = userEvent.setup();
    const { dialog, onAdded } = open();
    await fill(user, dialog, {
      Broker: 'Sample Broker',
      'Ticker or name 1': 'VWRA',
      'Quantity 1': '30',
      'Price 1': '142.10',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(
      within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement,
    );
    expect(removeAccount).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalled();
  });

  it('removes an account whose creation answer was lost when closed', async () => {
    // Codex P2: a lost answer or a server error does not prove the account was not made.
    createAccount.mockRejectedValueOnce(refused(503));
    const user = userEvent.setup();
    const { dialog, onAdded, onClose } = open();
    await fill(user, dialog, { Broker: 'Sample Broker', 'Cash at the broker (optional)': '250' });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createAccount).toHaveBeenCalledTimes(2);
    expect(createAccount.mock.calls[1][0].requestId).toBe(createAccount.mock.calls[0][0].requestId);
    expect(removeAccount).toHaveBeenCalledWith(id(2));
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('hides a hidden cash asset again when its buy was refused and the form is closed', async () => {
    // Codex P2: the form showed the cash asset, so it puts it back as it was.
    listAssets.mockResolvedValue([
      created(30, { name: 'US dollar', symbol: 'USD', assetType: 'fiat', priceSource: 'fixed' }),
    ]);
    vi.spyOn(hiddenAssetsApi, 'list').mockResolvedValue([
      { instrumentId: id(30), name: 'US dollar', symbol: 'USD', hiddenAt: '2026-10-01T00:00:00Z' },
    ]);
    createTrade.mockRejectedValueOnce(refused(400));
    const user = userEvent.setup();
    const { dialog, onClose } = open();
    await fill(user, dialog, { Broker: 'Sample Broker', 'Cash at the broker (optional)': '250' });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(showAsset).toHaveBeenCalledWith(id(30));
    expect(hideAsset.mock.calls).toEqual([[id(30)]]);
  });

  it('leaves an existing visible cash asset as it is when its buy was refused', async () => {
    listAssets.mockResolvedValue([
      created(30, { name: 'US dollar', symbol: 'USD', assetType: 'fiat', priceSource: 'fixed' }),
    ]);
    createTrade.mockRejectedValueOnce(refused(400));
    const user = userEvent.setup();
    const { dialog, onClose } = open();
    await fill(user, dialog, { Broker: 'Sample Broker', 'Cash at the broker (optional)': '250' });
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hideAsset).not.toHaveBeenCalled();
  });

  it('hides a later position whose buy got no answer once the account shows none of it', async () => {
    // Codex P2: the account holding none of the asset settles whether its buy was saved.
    const available = vi.spyOn(tradesApi, 'available');
    const twoPositions = async () => {
      createTrade.mockImplementationOnce(async (_account, command) => ({
        accountId: id(2),
        journalRevision: 1,
        trade: {
          quantity: command.quantity,
          grossUsd: '100',
          occurredAt: command.occurredAt,
        } as TradeReceipt['trade'],
      }));
      createTrade.mockRejectedValueOnce(refused(503));
      const user = userEvent.setup();
      const rendered = open();
      await user.click(within(rendered.dialog).getByRole('button', { name: 'Add position' }));
      await fill(user, rendered.dialog, {
        Broker: 'Sample Broker',
        'Ticker or name 1': 'VWRA',
        'Quantity 1': '30',
        'Price 1': '142.10',
        'Ticker or name 2': 'BOND',
        'Quantity 2': '5',
        'Price 2': '90',
      });
      await user.click(within(rendered.dialog).getByRole('button', { name: 'Add account' }));
      await within(rendered.dialog).findByRole('alert');
      await user.click(
        within(rendered.dialog).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement,
      );
      await vi.waitFor(() => expect(rendered.onAdded).toHaveBeenCalled());
    };
    available.mockResolvedValueOnce({ quantity: '0' } as AvailableQuantity);
    await twoPositions();
    expect(available).toHaveBeenCalledWith(
      id(2),
      expect.objectContaining({ instrumentId: id(11) }),
    );
    expect(hideAsset.mock.calls).toEqual([[id(11)]]);
    expect(removeAccount).not.toHaveBeenCalled();

    cleanup();
    hideAsset.mockClear();
    available.mockResolvedValueOnce({ quantity: '5' } as AvailableQuantity);
    await twoPositions();
    expect(hideAsset).not.toHaveBeenCalled();
  });
});
