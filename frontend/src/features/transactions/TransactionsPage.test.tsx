import { accountingApi } from '@api/accounting.api';
import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import { ownedTransfersApi, type TransferReceipt } from '@api/owned-transfers.api';
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
  label: null,
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
  settlement: null,
  comment: null,
  classification: null,
  account: bybit,
  counterAccount: null,
  wallet: null,
  counterWallet: null,
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
    chain: {
      txid: txid(n),
      blockHeight: 800000 + n,
      priceObservedAt: '2026-10-04T11:00:00.000Z',
      direction: changes.direction ?? 'in',
    },
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
  chain: { txid: txid(2), blockHeight: 800002, priceObservedAt: null, direction: 'out' },
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
const list = (operations: Operation[], dustThresholdUsd: string | null = null): OperationList => ({
  at: '2026-10-04T12:00:00.000Z',
  quoteCurrency: 'USD',
  needsClassificationCount: operations.filter((item) => item.status === 'needs-classification')
    .length,
  dustThresholdUsd,
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

  it('WAL-ACCOUNT: a chain row of an address in a wallet shows and filters by that wallet', async () => {
    const user = userEvent.setup();
    const bound = { ...wallet, label: 'Savings' };
    vi.spyOn(operationsApi, 'list').mockResolvedValue(
      list([
        chainOperation(3, { account: cold, wallet: bound, occurredAt: '2025-06-22T08:00:00.000Z' }),
        transfer,
        manual,
      ]),
    );
    renderPage(`/transactions?account=${cold.id}`);
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(bodyRows().map((row) => cellTexts(row)[4])).toEqual([
      'Cold storage · Savings',
      'Bybit → Cold storage',
    ]);
    await user.click(within(bodyRows()[0]).getByRole('button', { name: 'Incoming' }));
    const drawer = screen.getByRole('dialog', { name: 'Incoming transaction · BTC' });
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(fact('Wallet')).toBe('Cold storage');
    expect(fact('Address')).toBe(`Savings · ${wallet.address}`);
    // The wallet's name opens its page (M10); classifying happens right here (M12).
    expect(within(drawer).getByRole('link', { name: 'Cold storage' })).toHaveAttribute(
      'href',
      `/wallets/${cold.id}`,
    );
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

  it('OPS-PHONE: below 640 px shows two-line rows under day headings instead of the table', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 639.98px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
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
      vi.spyOn(operationsApi, 'list').mockResolvedValue(
        list([outgoing, receipt, transfer, paid, manual]),
      );
      renderPage();
      const rows = await screen.findByRole('list', { name: 'Transactions' });
      expect(screen.queryByRole('table')).toBeNull();
      expect(
        within(rows)
          .getAllByRole('heading', { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(['Jun 21, 2025', 'Jun 20, 2025', 'Jun 18, 2025', 'Jun 14, 2025', 'Jun 13, 2025']);
      // Type and ticker / place and time, or "To classify"; amount / value, paid amount.
      const items = within(rows).getAllByRole('button');
      expect(items.map((item) => item.textContent)).toEqual([
        'Outgoing BTCTo classify-0.0005—',
        'Incoming BTCTo classify+0.00918359≈ $780.10',
        'Transfer BTCBybit → Cold storage0.005—',
        'Buy BTCBybit · 10:30+0.01$1,050.50 · 83,000 RUB',
        'Buy BTCBybit+0.00918359$1,000.00',
      ]);
      // The whole row opens the same drawer as on a wide screen.
      await user.click(items[1]);
      expect(
        screen.getByRole('dialog', { name: 'Incoming transaction · BTC' }),
      ).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(items[1]).toHaveFocus();
    } finally {
      vi.unstubAllGlobals();
    }
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
    expect(fact('Wallet')).toBe('Not in a wallet yet');
    expect(fact('Address')).toBe(wallet.address);
    expect(within(drawer).getByRole('link', { name: 'Open Wallets' })).toHaveAttribute(
      'href',
      '/wallets',
    );
    expect(fact('Transaction')).toBe(txid(1));
    expect(fact('Block')).toBe('800,001');
    expect(fact('Network fee')).toBe('Paid by sender');
    expect(fact('Status')).toBe('Needs classification');
    expect(fact('Source')).toBe('Blockchain');
    expect(within(drawer).getByRole('group', { name: 'What was this transaction?' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('shows a recorded trade with its fee and comment, and Edit and Delete', async () => {
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
    // The version is an internal detail the prototype's card does not show (T4).
    expect(within(drawer).queryByText('Version')).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('link')).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('PR-OPS-2 edits and deletes a transfer here; staking rewards keep their screen', async () => {
    const user = userEvent.setup();
    const staking = operation({
      id: `reward:${id(41)}`,
      kind: 'reward',
      type: 'staking-reward',
      quantity: '0.001',
      version: 1,
    });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([transfer, staking]));
    vi.spyOn(tradesApi, 'state').mockImplementation(
      async (accountId) =>
        ({
          accountId,
          journal: { journalRevision: accountId === cold.id ? 3 : 7 },
        }) as JournalState,
    );
    const voidTransfer = vi
      .spyOn(ownedTransfersApi, 'void')
      .mockResolvedValue({} as TransferReceipt);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await user.click(within(bodyRows()[1]).getByRole('button', { name: 'Staking reward' }));
    let drawer = screen.getByRole('dialog', { name: 'Staking reward · BTC' });
    expect(within(drawer).getByRole('link', { name: 'Open in Bybit' })).toHaveAttribute(
      'href',
      `/manual-accounts/${bybit.id}`,
    );
    expect(within(drawer).queryByRole('button', { name: 'Delete' })).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));

    await user.click(within(bodyRows()[0]).getByRole('button', { name: 'Transfer' }));
    drawer = screen.getByRole('dialog', { name: 'Transfer · BTC' });
    expect(within(drawer).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('link')).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await waitFor(() =>
      expect(voidTransfer).toHaveBeenCalledWith(id(40), {
        requestId: expect.any(String),
        expectedVersion: 2,
        expectedFromJournalRevision: 7,
        expectedToJournalRevision: 3,
      }),
    );
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

  it('OPS-SELL-CASH and OPS-BUY-CASH show where the money stayed or came from', async () => {
    const user = userEvent.setup();
    const kept = operation({
      ...later,
      settlement: { asset: usdt, quantity: '600' },
    });
    const spent = operation({
      ...manual,
      settlement: { asset: usdt, quantity: '400' },
    });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([kept, spent]));
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await user.click(within(bodyRows()[0]).getByRole('button', { name: 'Sell' }));
    const sale = screen.getByRole('dialog', { name: 'Sell · BTC' });
    const fact = (drawer: HTMLElement, label: string) =>
      within(within(drawer).getByRole('region', { name: 'Details' })).getByText(label, {
        exact: true,
      }).nextElementSibling?.textContent;
    expect(fact(sale, 'Kept as cash')).toBe('+600 USDT');
    await user.keyboard('{Escape}');
    await user.click(within(bodyRows()[1]).getByRole('button', { name: 'Buy' }));
    const buy = screen.getByRole('dialog', { name: 'Buy · BTC' });
    expect(fact(buy, 'Paid from cash')).toBe('400 USDT');
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

describe('classify-chain-transactions (M12)', () => {
  const inCold = { account: cold };
  const toClassify = chainOperation(1, {
    ...inCold,
    occurredAt: '2025-06-20T08:05:00.000Z',
    quantity: '0.00918359',
  });
  const nextOne = chainOperation(2, {
    ...inCold,
    direction: 'out',
    occurredAt: '2025-06-19T08:00:00.000Z',
    quantity: '0.0005',
    chain: { txid: txid(2), blockHeight: 800002, priceObservedAt: null, direction: 'out' },
  });
  const bought = chainOperation(1, {
    ...inCold,
    occurredAt: '2025-06-20T08:05:00.000Z',
    quantity: '0.00918359',
    type: 'buy',
    status: 'recorded',
    valueUsd: '1000',
    costBasisUsd: '1000',
    feeUsd: '0',
    comment: 'From the exchange',
    classification: {
      version: 1,
      hidden: false,
      value: { type: 'buy', currency: 'USDT', amount: '1000' },
      comment: 'From the exchange',
      automatic: false,
    },
  });
  const httpError = (status: number, data: object) =>
    new AxiosError('refused', String(status), undefined, undefined, {
      status,
      statusText: 'Refused',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data,
    });
  const openRow = async (index: number, name: string) => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(index));
    await user.click(within(bodyRows()[index]).getByRole('button'));
    return { user, drawer: screen.getByRole('dialog', { name }) };
  };

  it('CLS-BUY: classifies a receipt as a buy and opens the next one to classify', async () => {
    vi.spyOn(operationsApi, 'list')
      .mockResolvedValueOnce(list([toClassify, nextOne]))
      .mockResolvedValue(list([bought, nextOne]));
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow(0, 'Incoming transaction · BTC');
    const question = within(drawer).getByRole('group', { name: 'What was this transaction?' });
    expect(
      within(question)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Transfer between my wallets',
      'Buy',
      'Income',
      'Reward',
      'Staking reward',
      'Airdrop',
      'Gift received',
      'Other',
    ]);
    expect(within(drawer).getByText('1 left to classify')).toBeInTheDocument();
    const save = within(drawer).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.click(within(question).getByRole('button', { name: 'Buy' }));
    await user.click(save);
    expect(within(drawer).getByText('Enter the amount you paid')).toBeInTheDocument();
    expect(classify).not.toHaveBeenCalled();
    await user.type(within(drawer).getByLabelText('You paid'), '1000');
    await user.click(within(drawer).getByText('More options'));
    await user.type(within(drawer).getByLabelText('Comment'), 'From the exchange');
    await user.click(save);
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][0]).toEqual(wallet);
    expect(classify.mock.calls[0][1]).toBe(txid(1));
    expect(classify.mock.calls[0][2]).toEqual({
      requestId: expect.any(String),
      expectedVersion: 0,
      hidden: false,
      classification: { type: 'buy', currency: 'USDT', amount: '1000' },
      comment: 'From the exchange',
    });
    const next = await screen.findByRole('dialog', { name: 'Outgoing transaction · BTC' });
    expect(within(next).getByRole('status')).toHaveTextContent(
      'Saved as Buy. Here is the next one.',
    );
    expect(
      within(within(next).getByRole('group', { name: 'What was this transaction?' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Transfer between my wallets', 'Sell', 'Expense', 'Gift sent', 'Fee', 'Other']);
    expect(within(next).getByText('0 left to classify')).toBeInTheDocument();
    // The classified row reads as the buy it recorded.
    expect(cellTexts(bodyRows()[0])).toEqual([
      'Buy08:05',
      'BTC',
      '+0.00918359',
      '$1,000.00',
      'Cold storage · bc1qsy…f3t4',
      'Recorded',
      'Blockchain',
    ]);
  });

  it('CLS-BUY: a purchase paid in rubles may carry the rate actually paid', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([toClassify]));
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow(0, 'Incoming transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Buy' }));
    await user.click(within(drawer).getByRole('radio', { name: 'RUB' }));
    await user.type(within(drawer).getByLabelText('You paid'), '83000');
    expect(within(drawer).getByText(/Empty means the Bank of Russia rate/)).toBeInTheDocument();
    await user.type(within(drawer).getByLabelText('Exchange rate'), '79');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2].classification).toEqual({
      type: 'buy',
      currency: 'RUB',
      amount: '83000',
      perUsd: '79',
    });
  });

  it('CLS-OTHER: a receipt nobody can name asks only for a comment and saves as Other', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([toClassify]));
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow(0, 'Incoming transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Other' }));
    expect(
      within(drawer).getByText(
        'The amount stays in your balance without a purchase price. Add a comment so you remember what it was.',
      ),
    ).toBeInTheDocument();
    expect(within(drawer).queryByLabelText(/Value at the time/)).not.toBeInTheDocument();
    // The comment is up front, not under "More options".
    await user.type(within(drawer).getByLabelText('Comment'), 'Unknown origin');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2]).toEqual({
      requestId: expect.any(String),
      expectedVersion: 0,
      hidden: false,
      classification: { type: 'other' },
      comment: 'Unknown origin',
    });
  });

  it('CLS-OTHER: a payment nobody can name leaves the balance without a withdrawal', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([nextOne]));
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow(0, 'Outgoing transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Other' }));
    expect(
      within(drawer).getByText(
        'The amount leaves your balance without a sale price and is not a withdrawal. Add a comment so you remember what it was.',
      ),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2].classification).toEqual({ type: 'other' });
  });

  it('CLS-RECLASSIFY, CLS-HIDE: a classified row can be changed or hidden, keeping its answer', async () => {
    const hidden = { ...bought, type: null, status: 'hidden' as const };
    vi.spyOn(operationsApi, 'list')
      .mockResolvedValueOnce(list([bought]))
      .mockResolvedValue(
        list([{ ...hidden, classification: { ...bought.classification!, version: 2 } }]),
      );
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow(0, 'Buy · BTC');
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(fact('Value')).toBe('$1,000.00');
    expect(fact('Comment')).toBe('From the exchange');
    expect(within(drawer).getByText(/can't be deleted/)).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Change classification' }));
    expect(within(drawer).getByRole('button', { name: 'Buy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(drawer).getByLabelText('You paid')).toHaveValue('1000');
    await user.click(within(drawer).getByRole('button', { name: 'Later' }));
    await user.click(within(drawer).getByRole('button', { name: 'Hide from calculations' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2]).toEqual({
      requestId: expect.any(String),
      expectedVersion: 1,
      hidden: true,
      classification: { type: 'buy', currency: 'USDT', amount: '1000' },
      comment: 'From the exchange',
    });
    const again = await screen.findByRole('dialog', { name: 'Incoming transaction · BTC' });
    expect(within(again).getByRole('status')).toHaveTextContent('Hidden from calculations.');
    expect(
      within(again).getByRole('button', { name: 'Include in calculations' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(cellTexts(bodyRows()[0])).toContain('Hidden');
    await user.click(screen.getByRole('button', { name: /^Hidden\s*1/ }));
    expect(bodyRows()).toHaveLength(1);
  });

  it('says what to do when the wallet has no account or the server refuses', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([{ ...toClassify, account: null }]));
    const classify = vi
      .spyOn(operationsApi, 'classify')
      .mockRejectedValueOnce(httpError(422, { message: 'Choose the account of this wallet first' }))
      .mockRejectedValueOnce(new AxiosError('offline'));
    const { user, drawer } = await openRow(0, 'Incoming transaction · BTC');
    expect(within(drawer).getByRole('note')).toHaveTextContent('not in a wallet yet');
    await user.click(within(drawer).getByRole('button', { name: 'Income' }));
    await user.type(within(drawer).getByLabelText('Value at the time'), '700');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'This wallet is not in an account yet.',
    );
    expect(within(drawer).getByRole('link', { name: 'Choose its account' })).toHaveAttribute(
      'href',
      '/wallets',
    );
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(drawer).getByRole('alert')).toHaveTextContent('Nothing was saved'),
    );
    // A retry of one answer reuses its request id, so it is recorded at most once.
    expect(classify.mock.calls[1][2].requestId).toBe(classify.mock.calls[0][2].requestId);
  });
});

describe('chain dust threshold (CLS-DUST)', () => {
  const dust = chainOperation(3, {
    occurredAt: '2025-06-22T09:00:00.000Z',
    quantity: '0.00000546',
    estimatedValueUsd: '0.546',
    status: 'dust',
  });

  it('keeps dust out of every view but its own, which says why and links to Settings', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([dust, receipt, manual], '1'));
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(screen.getByRole('button', { name: /^Dust\s*1/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Blockchain/ }));
    expect(bodyRows().map(typeOf)).toEqual(['Incoming']);
    await user.click(screen.getByRole('button', { name: /^Dust/ }));
    expect(bodyRows().map(cellTexts)).toEqual([
      [
        'Incoming09:00',
        'BTC',
        '+0.00000546',
        '≈ $0.55',
        'Bitcoin wallet bc1qsy…f3t4',
        'Dust',
        'Blockchain',
      ],
    ]);
    expect(
      screen.getByText(/Incoming wallet transactions worth less than \$1\.00 at the latest price/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change the threshold in Settings' })).toHaveAttribute(
      'href',
      '/preferences',
    );
  });

  it('reads the Dust filter from the address and hides the chip while nothing is dust', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([receipt, manual]));
    const { unmount } = renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /^Dust/ })).toBeNull();
    unmount();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([dust, receipt], '1'));
    renderPage('/transactions?status=dust');
    await waitFor(() => expect(bodyRows().map(typeOf)).toEqual(['Incoming']));
    expect(screen.getByRole('button', { name: /^Dust/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens a dust receipt with a note and lets the owner classify or hide it', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([dust], '1'));
    renderPage('/transactions?status=dust');
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    await user.click(within(bodyRows()[0]).getByRole('button', { name: 'Incoming' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('note')).toHaveTextContent(
      "Worth less than your dust threshold, so it doesn't ask to be classified. It still counts in your balance.",
    );
    expect(within(drawer).getByRole('button', { name: 'Classify' })).toBeInTheDocument();
    expect(
      within(drawer).getByRole('button', { name: 'Hide from calculations' }),
    ).toBeInTheDocument();
  });
});

describe('link-own-transfers (M13)', () => {
  // XFER-AUTO: Cold storage sends 0.5 BTC to the owner's Bybit address, fee 0.0001 BTC.
  const other = {
    ...wallet,
    id: id(21),
    address: 'bc1qsyntheticotheraddress0000000000x9k2',
    label: null,
  };
  const linked = chainOperation(3, {
    type: 'transfer',
    direction: 'internal',
    occurredAt: '2025-06-22T08:00:00.000Z',
    quantity: '0.5',
    estimatedValueUsd: '30000',
    fee: { asset: chainBtc, quantity: '0.0001' },
    account: cold,
    counterAccount: bybit,
    counterWallet: other,
    chain: { txid: txid(3), blockHeight: 800003, priceObservedAt: null, direction: 'out' },
    status: 'recorded',
    classification: {
      version: 1,
      hidden: false,
      value: { type: 'transfer', accountId: bybit.id },
      comment: null,
      automatic: true,
    },
  });
  const sent = chainOperation(4, {
    direction: 'out',
    occurredAt: '2025-06-23T08:00:00.000Z',
    quantity: '0.2001',
    fee: { asset: chainBtc, quantity: '0.0001' },
    account: cold,
  });
  const openRow = async (index: number, name: string) => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(index));
    await user.click(within(bodyRows()[index]).getByRole('button'));
    return { user, drawer: screen.getByRole('dialog', { name }) };
  };

  beforeEach(() => {
    vi.spyOn(accountingApi, 'listAccounts').mockResolvedValue({
      items: [cold, bybit].map((account) => ({
        ...account,
        currentRevision: 0,
        createdAt: '2025-01-01T00:00:00.000Z',
      })),
      nextCursor: null,
    });
    vi.spyOn(tradesApi, 'state').mockResolvedValue({
      accountId: bybit.id,
      eligible: false,
      ineligibilityReason: 'already-initialized',
      journal: { journalRevision: 5 } as JournalState['journal'],
    });
  });

  it('XFER-AUTO: a pair between own wallets is one transfer A → B, recognised automatically', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([linked]));
    const { drawer } = await openRow(0, 'Transfer · BTC');
    expect(cellTexts(bodyRows()[0])).toEqual([
      'Transfer08:00',
      'BTC',
      '0.5',
      '≈ $30,000.00',
      'Cold storage → Bybit',
      'Auto: own wallets',
      'Blockchain',
    ]);
    expect(within(drawer).getByRole('note')).toHaveTextContent(
      'Recognised automatically: both addresses belong to your wallets and Bybit received the same amount minus the network fee. Counts as a transfer, not a sale or a deposit.',
    );
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(fact('From')).toBe('Cold storage');
    expect(fact('To')).toBe('Bybit');
    expect(fact('Other address')).toBe(other.address);
    expect(fact('Network fee')).toBe('0.0001 BTC');
    expect(fact('Status')).toBe('Auto: own wallets');
    expect(within(facts).queryByText('Value', { exact: true })).toBeNull();
  });

  it('SOL-STAKE-MOVE: SOL moved into an own stake account needs no classification', async () => {
    const sol = { instrumentId: null, symbol: 'SOL', name: 'Solana' };
    const staked = chainOperation(9, {
      type: 'stake',
      direction: 'internal',
      status: 'recorded',
      asset: sol,
      account: bybit,
      quantity: '10',
      estimatedValueUsd: '1500',
      fee: { asset: sol, quantity: '0.000005' },
      chain: { txid: txid(9), blockHeight: 300000009, priceObservedAt: null, direction: 'out' },
    });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([staked]));
    const { drawer } = await openRow(0, 'Stake · SOL');
    expect(within(drawer).getByRole('note')).toHaveTextContent(
      'Moved into a stake account of this wallet: the coins stay yours and keep their purchase price. Only the network fee is a cost.',
    );
    expect(within(drawer).queryByRole('button', { name: 'Classify' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Change classification' })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Hide from calculations' })).toBeEnabled();
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    expect(
      within(facts).getByText('Network fee', { exact: true }).nextElementSibling,
    ).toHaveTextContent('0.000005 SOL');
    expect(within(facts).queryByText('Value', { exact: true })).toBeNull();
  });

  it('XFER-AUTO: the owner can still reclassify an automatic transfer', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([linked]));
    const { user, drawer } = await openRow(0, 'Transfer · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Change classification' }));
    const question = within(drawer).getByRole('group', { name: 'What was this transaction?' });
    expect(
      within(question).getByRole('button', { name: 'Transfer between my wallets' }),
    ).toHaveAttribute('aria-pressed', 'true');
    // The address's own direction decides the choices, not the internal transfer row.
    expect(within(question).getByRole('button', { name: 'Sell' })).toBeInTheDocument();
    expect(await within(drawer).findByRole('option', { name: 'Bybit' })).toBeInTheDocument();
    expect(within(drawer).getByLabelText('Sent to')).toHaveValue(bybit.id);
    expect(within(drawer).queryByRole('option', { name: 'Cold storage' })).toBeNull();
  });

  it('XFER-MANUAL: an outgoing transaction is linked by hand to another wallet', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([sent]));
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow(0, 'Outgoing transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Transfer between my wallets' }));
    expect(
      within(drawer).getByText(
        "Transfers between your wallets don't change your capital. Only the network fee of 0.0001 BTC is counted as a cost.",
      ),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(within(drawer).getByText('Choose the other wallet')).toBeInTheDocument();
    expect(classify).not.toHaveBeenCalled();
    await within(drawer).findByRole('option', { name: 'Bybit' });
    // Its own wallet is not a destination.
    expect(within(drawer).queryByRole('option', { name: 'Cold storage' })).toBeNull();
    await user.selectOptions(within(drawer).getByLabelText('Sent to'), bybit.id);
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2]).toEqual({
      requestId: expect.any(String),
      expectedVersion: 0,
      hidden: false,
      classification: { type: 'transfer', accountId: bybit.id },
    });
  });

  it('XFER-AUTO: an unanswered leg with an own address on the other side suggests the transfer', async () => {
    const suggested = { ...sent, counterAccount: bybit, counterWallet: other };
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([suggested]));
    const { drawer } = await openRow(0, 'Outgoing transaction · BTC');
    expect(
      within(drawer).getByRole('button', { name: 'Transfer between my wallets' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(within(drawer).getByLabelText('Sent to')).toHaveValue(bybit.id);
    // The suggestion is not a place: the row stays in its own wallet.
    expect(cellTexts(bodyRows()[0])).toContain('Cold storage · bc1qsy…f3t4');
  });

  it('XFER-MANUAL: explains a transfer the other wallet did not receive in full', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([sent]));
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(
      new AxiosError('refused', '422', undefined, undefined, {
        status: 422,
        statusText: 'Unprocessable',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
          message: 'The other wallet did not receive what this one sent, less the network fee',
        },
      }),
    );
    const { user, drawer } = await openRow(0, 'Outgoing transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Transfer between my wallets' }));
    await within(drawer).findByRole('option', { name: 'Bybit' });
    await user.selectOptions(within(drawer).getByLabelText('Sent to'), bybit.id);
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'Choose another wallet or another type.',
    );
  });
});
