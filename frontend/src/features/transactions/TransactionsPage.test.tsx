import { accountingApi } from '@api/accounting.api';
import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import { portfolioAssetsApi } from '@api/portfolio-assets.api';
import { type JournalState, type TradeReceipt, tradesApi } from '@api/trades.api';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionsPage from './TransactionsPage';

// Synthetic ids, names and amounts only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const btc = { instrumentId: id(1), symbol: 'BTC', name: 'Bitcoin' };
const chainBtc = { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' };
const usdt = { instrumentId: id(2), symbol: 'USDT', name: 'Tether' };
const bybit = { id: id(10), name: 'Bybit' };
const cold = { id: id(11), name: 'Cold storage' };
const wallet = {
  id: id(20),
  network: 'bitcoin' as const,
  address: 'bc1qsyntheticwalletaddress000000000f3t4',
};
const txid = (n: number) => String(n).padStart(64, 'a');

const operation = (changes: Partial<Operation> & Pick<Operation, 'id'>): Operation => {
  const recorded = { ...recordedDefaults, ...changes };
  // In USD the list's quote-currency amounts are the recorded USD amounts.
  return {
    value: recorded.valueUsd,
    estimatedValue: recorded.estimatedValueUsd,
    costBasis: recorded.costBasisUsd,
    feeValue: recorded.feeUsd,
    ...recorded,
  };
};
const recordedDefaults: Omit<
  Operation,
  'id' | 'value' | 'estimatedValue' | 'costBasis' | 'feeValue'
> = {
  kind: 'trade',
  type: 'buy',
  direction: 'in',
  occurredAt: '2025-06-13T00:00:00.000Z',
  orderWithinTimestamp: 0,
  asset: btc,
  quantity: '1',
  counterAsset: null,
  counterQuantity: null,
  valueUsd: null,
  estimatedValueUsd: null,
  costBasisUsd: null,
  feeUsd: null,
  fee: null,
  paid: null,
  comment: null,
  account: bybit,
  counterAccount: null,
  wallet: null,
  chain: null,
  status: 'recorded',
  source: 'manual',
  version: 1,
};
const chainOperation = (n: number, changes: Partial<Operation>): Operation =>
  operation({
    id: `chain:${wallet.id}:${txid(n)}`,
    kind: 'chain',
    type: null,
    asset: chainBtc,
    account: null,
    wallet,
    chain: { txid: txid(n), blockHeight: 800000 + n, priceObservedAt: '2026-10-04T11:00:00.000Z' },
    status: 'needs-classification',
    source: 'chain',
    version: null,
    ...changes,
  });

// OPS-LIST: a manual buy, a CSV-imported buy and a chain receipt, plus rows for OPS-FILTER.
const outgoing = chainOperation(2, {
  direction: 'out',
  occurredAt: '2025-06-21T08:00:00.000Z',
  quantity: '0.0005',
  fee: { asset: chainBtc, quantity: '0.000003' },
  chain: { txid: txid(2), blockHeight: 800002, priceObservedAt: null },
});
const receipt = chainOperation(1, {
  occurredAt: '2025-06-20T08:05:00.000Z',
  quantity: '0.00918359',
  estimatedValueUsd: '780.10005255',
});
const transfer = operation({
  id: `transfer:${id(40)}`,
  kind: 'transfer',
  type: 'transfer',
  direction: 'internal',
  occurredAt: '2025-06-18T00:00:00.000Z',
  quantity: '0.005',
  fee: { asset: btc, quantity: '0.0001' },
  counterAccount: cold,
  version: 2,
});
const tether = operation({
  id: `trade:${id(32)}`,
  occurredAt: '2025-06-16T00:00:00.000Z',
  asset: usdt,
  quantity: '1000',
  valueUsd: '1000',
  feeUsd: '0',
});
const imported = operation({
  id: `trade:${id(31)}`,
  occurredAt: '2025-06-14T10:30:00.000Z',
  quantity: '0.01',
  valueUsd: '1050.5',
  feeUsd: '1.25',
  source: 'csv',
});
const manual = operation({
  id: `trade:${id(30)}`,
  quantity: '0.00918359',
  valueUsd: '1000',
  feeUsd: '0',
});
const list = (operations: Operation[]): OperationList => ({
  at: '2026-10-04T12:00:00.000Z',
  quoteCurrency: 'USD',
  needsClassificationCount: operations.filter((item) => item.status === 'needs-classification')
    .length,
  operations,
});
const all = list([outgoing, receipt, transfer, tether, imported, manual]);

function renderPage(path = '/transactions') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TransactionsPage />
    </MemoryRouter>,
  );
}
const table = () => screen.getByRole('table', { name: 'Transactions' });
// Day headings are rows of their own; operations are the rows with cells.
const bodyRows = () =>
  within(table())
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('cell').length > 0);
const dayHeadings = () =>
  within(table())
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent);
const typeOf = (row: HTMLElement) => within(row).getByRole('button').textContent;
const cellTexts = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(cleanup);

describe('TransactionsPage (list-all-operations)', () => {
  it('OPS-LIST: lists manual, CSV and blockchain operations with every column, newest first', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Transactions' })).toBeInTheDocument();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Type', 'Asset', 'Amount', 'Value', 'Account', 'Status', 'Source']);
    // Grouped under day headings as in the prototype; the time sits under the type.
    expect(dayHeadings()).toEqual([
      'Jun 21, 2025',
      'Jun 20, 2025',
      'Jun 18, 2025',
      'Jun 16, 2025',
      'Jun 14, 2025',
      'Jun 13, 2025',
    ]);
    const rows = bodyRows().map(cellTexts);
    expect(rows[1]).toEqual([
      'Incoming08:05',
      'BTC',
      '+0.00918359',
      '≈ $780.10',
      'Bitcoin wallet bc1qsy…f3t4',
      'Needs classification',
      'Blockchain',
    ]);
    expect(rows[0]).toEqual([
      'Outgoing08:00',
      'BTC',
      '-0.0005',
      '—',
      'Bitcoin wallet bc1qsy…f3t4',
      'Needs classification',
      'Blockchain',
    ]);
    // A transaction entered without a time says so instead of showing midnight.
    expect(rows[2]).toEqual([
      'TransferNo time',
      'BTC',
      '0.005',
      '—',
      'Bybit → Cold storage',
      'Recorded',
      'Manual',
    ]);
    expect(rows[4]).toEqual(['Buy10:30', 'BTC', '+0.01', '$1,050.50', 'Bybit', 'Recorded', 'CSV']);
    expect(rows[5]).toEqual([
      'BuyNo time',
      'BTC',
      '+0.00918359',
      '$1,000.00',
      'Bybit',
      'Recorded',
      'Manual',
    ]);
    expect(screen.getByRole('button', { name: /Needs classification\s*2/ })).toBeInTheDocument();
  });

  it('OPS-FILTER: asset BTC and status "Needs classification" leave only matching rows', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Asset' }), 'BTC');
    expect(bodyRows()).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: /^Needs classification/ }));
    expect(screen.getByRole('button', { name: /^Needs classification/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(bodyRows().map(typeOf)).toEqual(['Outgoing', 'Incoming']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Asset' }), 'USDT');
    expect(screen.queryByRole('table', { name: 'Transactions' })).toBeNull();
    expect(screen.getByText('No transactions match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(bodyRows()).toHaveLength(6);
  });

  it('filters by source, account and search text', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    expect(bodyRows().map((row) => cellTexts(row)[6])).toEqual(['CSV']);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    // A transfer belongs to both of its accounts.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), cold.id);
    expect(bodyRows().map(typeOf)).toEqual(['Transfer']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), '');
    await user.type(screen.getByRole('searchbox', { name: 'Search transactions' }), 'tether');
    expect(bodyRows().map((row) => cellTexts(row)[1])).toEqual(['USDT']);
  });

  it('keeps every filter change when a second one comes before the address updates', async () => {
    // The router applies an address change later, in a transition (OPS-UI on a fast runner).
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    expect(bodyRows()).toHaveLength(1);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^All/ }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Account' }), {
        target: { value: cold.id },
      });
    });
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
    expect(bodyRows().map(typeOf)).toEqual(['Transfer']);
  });

  it('OPS-DAYS: names today and yesterday and keeps one heading per day', async () => {
    const at = (iso: string, n: number) =>
      operation({ id: `trade:${id(70 + n)}`, occurredAt: iso, valueUsd: '10', feeUsd: '0' });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(
      list([
        at('2026-10-04T09:15:00.000Z', 1),
        at('2026-10-04T08:00:00.000Z', 2),
        at('2026-10-03T23:59:00.000Z', 3),
        at('2026-09-30T00:00:00.000Z', 4),
      ]),
    );
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(4));
    expect(dayHeadings()).toEqual(['Today', 'Yesterday', 'Sep 30, 2026']);
  });

  it('OPS-PAID: a purchase paid in RUB shows what was paid under its value', async () => {
    const paid = operation({
      ...imported,
      paid: {
        currency: 'RUB',
        gross: '83000',
        fee: '0',
        rateDate: '2025-06-14',
        perUsd: '79.0076',
        rateSource: 'bank-of-russia',
      },
    });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([paid, manual]));
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(cellTexts(bodyRows()[0])[3]).toBe('$1,050.50paid 83,000 RUB');
    expect(cellTexts(bodyRows()[1])[3]).toBe('$1,000.00');
  });

  it('OPS-CURRENCY: switches the list to EUR or RUB and keeps the filters', async () => {
    const user = userEvent.setup();
    const paid = operation({
      ...imported,
      paid: {
        currency: 'RUB',
        gross: '83000',
        fee: '98.76',
        rateDate: '2025-06-14',
        perUsd: '79.0076',
        rateSource: 'bank-of-russia',
      },
    });
    const inRub: OperationList = {
      ...list([
        { ...receipt, estimatedValue: '74109.50499225' },
        // No Bank of Russia rate stored for that date: unknown, never zero.
        { ...tether, value: null, feeValue: null },
        { ...paid, value: '83000', feeValue: '98.76' },
        { ...manual, value: '80000', feeValue: '0' },
      ]),
      quoteCurrency: 'RUB',
    };
    const read = vi
      .spyOn(operationsApi, 'list')
      .mockImplementation(async (currency) =>
        currency === 'RUB' ? inRub : list([receipt, tether, paid, manual]),
      );
    renderPage('/transactions?source=manual');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(read).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole('radio', { name: 'USD' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'RUB' }));
    await waitFor(() => expect(read).toHaveBeenLastCalledWith('RUB'));
    await waitFor(() => expect(cellTexts(bodyRows()[0])[3]).toBe('—No rate'));
    expect(screen.getByRole('radio', { name: 'RUB' })).toBeChecked();
    // The Manual filter stays; the paid line is not repeated in its own currency.
    expect(bodyRows().map((row) => cellTexts(row)[3])).toEqual(['—No rate', '₽80,000.00']);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(bodyRows().map((row) => cellTexts(row)[3])).toEqual([
      '≈ ₽74,109.50',
      '—No rate',
      '₽83,000.00',
      '₽80,000.00',
    ]);
    await user.click(within(bodyRows()[2]).getByRole('button', { name: 'Buy' }));
    const drawer = screen.getByRole('dialog', { name: 'Buy · BTC' });
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(fact('Value')).toBe('₽83,000.00');
    expect(fact('Price')).toBe('₽8,300,000.00 per BTC');
    expect(fact('Fee')).toBe('₽98.76');
  });

  it('reads the status filter from the address so other screens can link to it', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage('/transactions?status=needs-classification');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
  });

  it('opens a side drawer with the raw chain facts and closes it with Escape', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    const opener = within(bodyRows()[1]).getByRole('button', { name: 'Incoming' });
    await user.click(opener);
    const drawer = screen.getByRole('dialog', { name: 'Incoming transaction · BTC' });
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(within(drawer).getByText('+0.00918359 BTC')).toBeInTheDocument();
    expect(fact('Date')).toBe('Jun 20, 2025, 08:05 UTC');
    expect(fact('Network')).toBe('Bitcoin');
    expect(fact('Wallet')).toBe(wallet.address);
    expect(fact('Transaction')).toBe(txid(1));
    expect(fact('Block')).toBe('800,001');
    expect(fact('Network fee')).toBe('Paid by sender');
    expect(fact('Status')).toBe('Needs classification');
    expect(fact('Source')).toBe('Blockchain');
    expect(within(drawer).getByText(/never edited/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('shows a recorded trade with its fee, version and comment, and Edit and Delete', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    vi.spyOn(tradesApi, 'versions').mockResolvedValue({
      tradeId: id(31),
      items: [],
      nextBeforeVersion: null,
    });
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    await user.click(within(bodyRows()[4]).getByRole('button', { name: 'Buy' }));
    const drawer = screen.getByRole('dialog', { name: 'Buy · BTC' });
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(fact('Value')).toBe('$1,050.50');
    expect(fact('Price')).toBe('$105,050.00 per BTC');
    expect(fact('Fee')).toBe('$1.25');
    expect(fact('Account')).toBe('Bybit');
    expect(fact('Comment')).toBe('None');
    expect(fact('Source')).toBe('Imported from CSV');
    expect(fact('Version')).toBe('1');
    expect(within(drawer).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('link')).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('links other recorded operations to the screen where they are changed today', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    await user.click(within(bodyRows()[2]).getByRole('button', { name: 'Transfer' }));
    const drawer = screen.getByRole('dialog', { name: 'Transfer · BTC' });
    expect(within(drawer).getByRole('link', { name: 'Open transfers' })).toHaveAttribute(
      'href',
      '/owned-transfers',
    );
    expect(within(drawer).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('says so when there are no operations yet', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([]));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'No transactions yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open manual accounts' })).toHaveAttribute(
      'href',
      '/manual-accounts',
    );
  });

  it('offers a retry when loading fails and never shows numbers it does not have', async () => {
    const user = userEvent.setup();
    const read = vi
      .spyOn(operationsApi, 'list')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(all);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your transactions');
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('TransactionsPage manual operations (M9)', () => {
  const later = operation({
    id: `trade:${id(33)}`,
    type: 'sell',
    direction: 'out',
    occurredAt: '2025-07-01T00:00:00.000Z',
    quantity: '0.005',
    valueUsd: '600',
    feeUsd: '0',
  });
  const commented = operation({
    ...manual,
    comment: 'From savings',
    version: 2,
  });
  const history = list([later, commented]);
  const conflict = (data: object) =>
    new AxiosError('conflict', '409', undefined, undefined, {
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data,
    });
  const voidTrade = vi.fn();

  beforeEach(() => {
    vi.spyOn(tradesApi, 'versions').mockResolvedValue({
      tradeId: id(30),
      items: [
        {
          tradeId: id(30),
          version: 2,
          journalRevision: 3,
          requestId: id(91),
          kind: 'correct',
          createdAt: '2025-06-14T09:00:00.000Z',
          instrumentId: id(1),
          instrumentName: 'Bitcoin',
          instrumentSymbol: 'BTC',
          side: 'buy',
          occurredAt: '2025-06-13T00:00:00.000Z',
          orderWithinTimestamp: 0,
          quantity: '0.00918359',
          grossUsd: '1000',
          feeUsd: '0',
          comment: 'From savings',
        },
        {
          tradeId: id(30),
          version: 1,
          journalRevision: 2,
          requestId: id(90),
          kind: 'create',
          createdAt: '2025-06-13T09:00:00.000Z',
          instrumentId: id(1),
          instrumentName: 'Bitcoin',
          instrumentSymbol: 'BTC',
          side: 'buy',
          occurredAt: '2025-06-13T00:00:00.000Z',
          orderWithinTimestamp: 0,
          quantity: '0.00918359',
          grossUsd: '990',
          feeUsd: '0',
        },
      ],
      nextBeforeVersion: null,
    });
    vi.spyOn(tradesApi, 'state').mockResolvedValue({
      accountId: bybit.id,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      journal: { journalRevision: 5 } as JournalState['journal'],
    });
    voidTrade.mockReset();
    vi.spyOn(tradesApi, 'void').mockImplementation(voidTrade);
    vi.spyOn(portfolioAssetsApi, 'listAll').mockResolvedValue([]);
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({ items: [], nextCursor: null });
  });

  const openBuy = async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await user.click(within(bodyRows()[1]).getByRole('button', { name: 'Buy' }));
    return { user, drawer: screen.getByRole('dialog', { name: 'Buy · BTC' }) };
  };

  it('OPS-EDIT shows the comment and the history of the original and the correction', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(history);
    const { drawer } = await openBuy();
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    expect(within(facts).getByText('Comment').nextElementSibling).toHaveTextContent('From savings');
    const versions = await within(drawer).findByRole('region', { name: 'History' });
    expect(
      within(versions)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Changed Jun 14, 2025, 09:00 UTCBuy 0.00918359 BTC for $1,000.00 · From savings',
      'Added Jun 13, 2025, 09:00 UTCBuy 0.00918359 BTC for $990.00',
    ]);
  });

  it('opens the one Add/Edit window from the drawer and from the page header', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(history);
    const { user, drawer } = await openBuy();
    await user.click(within(drawer).getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('dialog', { name: 'Buy · BTC' })).toBeNull();
    const edit = screen.getByRole('dialog', { name: 'Edit transaction' });
    await user.click(within(edit).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(screen.getByRole('dialog', { name: 'Add transaction' })).toBeInTheDocument();
  });

  it('OPS-DELETE asks first, voids the trade at the current journal revision and reloads', async () => {
    const read = vi
      .spyOn(operationsApi, 'list')
      .mockResolvedValueOnce(history)
      .mockResolvedValueOnce(list([later]));
    voidTrade.mockResolvedValue({} as TradeReceipt);
    const { user, drawer } = await openBuy();
    await user.click(within(drawer).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this transaction?' });
    expect(confirm).toHaveTextContent(
      'Buy of 0.00918359 BTC on Jun 13, 2025 in Bybit will be removed. Balances, cost basis and the portfolio history will be recalculated without it.',
    );
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(voidTrade).not.toHaveBeenCalled();
    expect(within(drawer).getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.click(within(drawer).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(voidTrade).toHaveBeenCalledWith(bybit.id, id(30), {
      requestId: expect.any(String),
      expectedJournalRevision: 5,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('OPS-DELETE-GUARD refuses and names the sale that depends on the purchase', async () => {
    const read = vi.spyOn(operationsApi, 'list').mockResolvedValue(history);
    voidTrade.mockRejectedValue(
      conflict({
        message: 'A later operation depends on this trade',
        dependent: {
          operationId: later.id,
          accountId: bybit.id,
          instrumentId: id(1),
          occurredAt: later.occurredAt,
        },
      }),
    );
    const { user, drawer } = await openBuy();
    await user.click(within(drawer).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
    const refusal = await screen.findByRole('alertdialog', {
      name: "This purchase can't be deleted",
    });
    expect(refusal).toHaveTextContent(
      'Sell of 0.005 BTC on Jul 1, 2025 in Bybit spends these BTC. Without this purchase Bybit would not hold enough. Delete or change that transaction first.',
    );
    await user.click(within(refusal).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Buy · BTC' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps the drawer open and explains a failed delete', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(history);
    voidTrade.mockRejectedValue(new AxiosError('offline'));
    const { user, drawer } = await openBuy();
    await user.click(within(drawer).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was deleted');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Delete this transaction?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Buy · BTC' })).toBeInTheDocument();
  });
});
