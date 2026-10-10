import { accountingApi } from '@api/accounting.api';
import {
  type DuplicateProposal,
  type Operation,
  type OperationList,
  operationsApi,
  type TransferProposal,
} from '@api/operations.api';
import { ownedTransfersApi, type TransferReceipt } from '@api/owned-transfers.api';
import { portfolioAssetsApi } from '@api/portfolio-assets.api';
import { type JournalState, type TradeReceipt, tradesApi } from '@api/trades.api';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { poolCandidates } from './ClassifyForm';
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
      priceObservedAt: '2025-06-20T08:00:00.000Z',
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
    ).toEqual(['Type', 'Asset', 'Amount', 'Value', 'Account', 'Status']);
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
      'To classifyBlockchain',
    ]);
    expect(rows[0]).toEqual([
      'Outgoing08:00',
      'BTC',
      '-0.0005',
      '—',
      'Bitcoin wallet bc1qsy…f3t4',
      'To classifyBlockchain',
    ]);
    // A transaction entered without a time says so instead of showing midnight.
    expect(rows[2]).toEqual([
      'TransferNo time',
      'BTC',
      '0.005',
      '—',
      'Bybit → Cold storage',
      'RecordedManual',
    ]);
    expect(rows[4]).toEqual(['Buy10:30', 'BTC', '+0.01', '$1,050.50', 'Bybit', 'RecordedCSV']);
    expect(rows[5]).toEqual([
      'BuyNo time',
      'BTC',
      '+0.00918359',
      '$1,000.00',
      'Bybit',
      'RecordedManual',
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
    expect(bodyRows().map((row) => cellTexts(row)[5])).toEqual(['RecordedCSV']);
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
    expect(fact('Transaction')).toBe(`${txid(1)}CopyView in explorer`);
    expect(fact('Block')).toBe('800,001');
    expect(fact('Network fee')).toBe('Paid by sender');
    // EST-AT-TIME: the estimate is at the price stored for the transaction's hour.
    expect(fact('Estimated value')).toBe('≈ $780.10 at the price stored Jun 20, 2025, 08:00 UTC');
    expect(fact('Status')).toBe('Needs classification');
    expect(fact('Source')).toBe('Blockchain');
    // CLS-COMPACT: what identifies the transaction stays up front; the technical facts are
    // folded away until asked for, so the question is not pushed down the drawer.
    const folded = within(facts).getByText('Details', { selector: 'summary' }).closest('details');
    expect(folded).not.toHaveAttribute('open');
    for (const label of ['Address', 'Transaction', 'Block', 'Network fee', 'Status', 'Source'])
      expect(folded).toContainElement(within(facts).getByText(label, { exact: true }));
    for (const label of ['Date', 'Network', 'Wallet'])
      expect(folded).not.toContainElement(within(facts).getByText(label, { exact: true }));
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

  it('XFER-REFUSED: an airdrop dated before the records of the account begin names the account', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([toClassify]));
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(
      new AxiosError('refused', '409', undefined, undefined, {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
          message: 'The records of an account start after this entry',
          coverage: { accountId: cold.id, coverageFrom: '2026-01-01T00:00:00.000Z' },
        },
      }),
    );
    const { user, drawer } = await openRow(0, 'Incoming transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Airdrop' }));
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      /The records of Cold storage start on Jan 1, 2026, after this transaction on Jun 20, 2025\. Hide the transaction/,
    );
  });

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
      'Swap',
      'Income',
      'Reward',
      'Staking reward',
      'Airdrop',
      'Gift received',
      'Pool reward',
      'Pool withdrawal',
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
    ).toEqual([
      'Transfer between my wallets',
      'Sell',
      'Swap',
      'Expense',
      'Gift sent',
      'Fee',
      'Pool deposit',
      'Other',
    ]);
    expect(within(next).getByText('0 left to classify')).toBeInTheDocument();
    // The classified row reads as the buy it recorded.
    expect(cellTexts(bodyRows()[0])).toEqual([
      'Buy08:05',
      'BTC',
      '+0.00918359',
      '$1,000.00',
      'Cold storage · bc1qsy…f3t4',
      'RecordedBlockchain',
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

  it('FEE-VALUE: a fee may be saved without a value; the stored price then counts', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([nextOne]));
    const noPrice = new AxiosError('unprocessable', '422', undefined, undefined, {
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { message: 'No stored price for this coin at that time' },
    });
    const classify = vi
      .spyOn(operationsApi, 'classify')
      .mockRejectedValueOnce(noPrice)
      .mockResolvedValue();
    const { user, drawer } = await openRow(0, 'Outgoing transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Fee' }));
    const value = within(drawer).getByLabelText('Value at the time (optional)');
    expect(
      within(drawer).getByText(
        /^Empty: USDT and USDC count 1:1, other coins at their stored price/,
      ),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2].classification).toEqual({ type: 'fee', valueUsd: null });
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'There is no stored price for this coin at that time. Enter the value in USD.',
    );
    await user.type(value, '1.25');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(2));
    expect(classify.mock.calls[1][2].classification).toEqual({ type: 'fee', valueUsd: '1.25' });
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
    expect(cellTexts(bodyRows()[0])).toContain('HiddenBlockchain');
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
        'DustBlockchain',
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
      "Worth less than your dust threshold, or a token no price source lists, so it doesn't ask to be classified. It still counts in your balance.",
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

  it('BYBIT-EARN: Earn yield Bybit paid is recorded as staking income by itself', async () => {
    const earned = chainOperation(5, {
      type: 'staking-reward',
      occurredAt: '2025-06-24T00:30:00.000Z',
      quantity: '0.0001',
      estimatedValueUsd: '6',
      account: bybit,
      wallet: { id: id(22), network: 'bybit', address: '123456789', label: 'Bybit' },
      chain: {
        txid: 'bybit-earn-flexible-1002096',
        blockHeight: 0,
        priceObservedAt: null,
        direction: 'in',
      },
      status: 'recorded',
      classification: {
        version: 1,
        hidden: false,
        value: { type: 'staking-reward', valueUsd: '6.00' },
        comment: null,
        automatic: true,
      },
    });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([earned]));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(cellTexts(bodyRows()[0]).at(-1)).toBe('Auto: Earn yieldBybit');
    await user.click(within(bodyRows()[0]).getByRole('button'));
    expect(within(screen.getByRole('dialog')).getByRole('note')).toHaveTextContent(
      "Recognised automatically from Bybit's Earn yield history: counts as staking income at the coin's price when Bybit paid it. Change the classification if it is wrong.",
    );
  });

  it('BYBIT-GAP-DELETE: a counted difference can be deleted, after asking', async () => {
    const counted = chainOperation(7, {
      type: null,
      occurredAt: '2025-06-24T08:00:00.000Z',
      quantity: '3',
      estimatedValueUsd: null,
      account: bybit,
      wallet: { id: id(22), network: 'bybit', address: '123456789', label: 'Bybit' },
      chain: {
        txid: `bybit-deposit-gap-${id(70)}`,
        blockHeight: 0,
        priceObservedAt: null,
        direction: 'in',
      },
      status: 'needs-classification',
      classification: null,
    });
    vi.spyOn(operationsApi, 'list')
      .mockResolvedValueOnce(list([counted]))
      .mockResolvedValue(list([]));
    const remove = vi.spyOn(operationsApi, 'removeCounted').mockResolvedValue();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    await user.click(within(bodyRows()[0]).getByRole('button'));
    const drawer = screen.getByRole('dialog');
    await user.click(within(drawer).getByText('Delete', { selector: 'button' }));
    expect(remove).not.toHaveBeenCalled();
    expect(within(drawer).getByText(/the difference shows again/)).toBeInTheDocument();
    await user.click(within(drawer).getByText('Keep'));
    expect(within(drawer).getByText('Delete', { selector: 'button' })).toBeInTheDocument();
    await user.click(within(drawer).getByText('Delete', { selector: 'button' }));
    await user.click(within(drawer).getByText('Delete record'));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove.mock.calls[0][1]).toBe(`bybit-deposit-gap-${id(70)}`);
    expect(remove.mock.calls[0][2]).toEqual({ requestId: expect.any(String), expectedVersion: 0 });
    expect(await screen.findByText(/Record deleted/)).toBeInTheDocument();
  });

  it('a Bybit record the exchange made cannot be deleted', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(
      list([
        chainOperation(8, {
          type: 'staking-reward',
          occurredAt: '2025-06-24T00:30:00.000Z',
          quantity: '0.0001',
          account: bybit,
          wallet: { id: id(22), network: 'bybit', address: '123456789', label: 'Bybit' },
          chain: {
            txid: 'bybit-earn-flexible-1002096',
            blockHeight: 0,
            priceObservedAt: null,
            direction: 'in',
          },
          status: 'recorded',
          classification: {
            version: 1,
            hidden: false,
            value: { type: 'staking-reward', valueUsd: '6.00' },
            comment: null,
            automatic: true,
          },
        }),
      ]),
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    await user.click(within(bodyRows()[0]).getByRole('button'));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(within(drawer).getByText(/can't be deleted/)).toBeInTheDocument();
  });

  it('BYBIT-CONVERT: a convert into USDT is a sale recognised from the convert history', async () => {
    const converted = chainOperation(6, {
      type: 'sell',
      direction: 'out',
      occurredAt: '2025-06-24T06:00:00.000Z',
      quantity: '0.01',
      valueUsd: '650',
      estimatedValueUsd: '650',
      account: bybit,
      wallet: { id: id(22), network: 'bybit', address: '123456789', label: 'Bybit' },
      chain: {
        txid: 'bybit-trade-convert-5100000000000000000000000001',
        blockHeight: 0,
        priceObservedAt: null,
        direction: 'out',
      },
      status: 'recorded',
      classification: {
        version: 1,
        hidden: false,
        value: { type: 'sell', currency: 'USDT', amount: '650' },
        comment: null,
        automatic: true,
      },
    });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([converted]));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    await user.click(within(bodyRows()[0]).getByRole('button'));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Convert 5100000000000000000000000001');
    expect(within(drawer).getAllByRole('note')[0]).toHaveTextContent(
      "Recognised automatically from Bybit's convert history: the coins sold were already in this account, so it counts as a sale, not a deposit. Change the classification if it is wrong.",
    );
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
      'Auto: own walletsBlockchain',
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

  it('ETH-STAKE-MOVE: ETH deposited into a staking pool needs no classification', async () => {
    const eth = { instrumentId: null, symbol: 'ETH', name: 'Ethereum' };
    const staked = chainOperation(10, {
      type: 'stake',
      direction: 'internal',
      status: 'recorded',
      asset: eth,
      account: bybit,
      wallet: { id: id(77), network: 'ethereum', address: `0x${'5e'.repeat(20)}`, label: null },
      quantity: '1',
      estimatedValueUsd: '2000',
      fee: { asset: eth, quantity: '0.0005' },
      chain: { txid: txid(10), blockHeight: 20000010, priceObservedAt: null, direction: 'out' },
    });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([staked]));
    const { drawer } = await openRow(0, 'Stake · ETH');
    expect(within(drawer).getByRole('note')).toHaveTextContent(
      'Moved into a staking pool of this wallet: the coins stay yours and keep their purchase price. Only the network fee is a cost.',
    );
    expect(within(drawer).queryByRole('button', { name: 'Classify' })).toBeNull();
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

  describe('XFER-ADDRESS: a wallet with several addresses in one transaction', () => {
    // Cold storage sends 0.2001 BTC; two addresses of Bybit took part, one received the transfer
    // and the other got a payment of its own in the same transaction.
    const second = {
      ...other,
      id: id(23),
      address: 'bc1qsyntheticsecondaddress000000000y7m5',
    };
    const receivedAt = (to: typeof other, n: number, quantity: string) =>
      chainOperation(4, {
        id: `chain:${to.id}:${txid(4)}`,
        direction: 'in',
        occurredAt: '2025-06-23T08:00:00.000Z',
        quantity,
        account: bybit,
        wallet: to,
        chain: { txid: txid(4), blockHeight: 800004 + n, priceObservedAt: null, direction: 'in' },
      });
    const legA = receivedAt(other, 0, '0.2');
    const legB = receivedAt(second, 1, '0.05');

    it('asks which address and sends it as the other side of the transfer', async () => {
      vi.spyOn(operationsApi, 'list').mockResolvedValue(list([sent, legA, legB]));
      const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
      const { user, drawer } = await openRow(0, 'Outgoing transaction · BTC');
      await user.click(within(drawer).getByRole('button', { name: 'Transfer between my wallets' }));
      await within(drawer).findByRole('option', { name: 'Bybit' });
      // One wallet at a time: nothing to choose before the wallet is.
      expect(within(drawer).queryByLabelText('Received at')).toBeNull();
      await user.selectOptions(within(drawer).getByLabelText('Sent to'), bybit.id);
      const picker = within(drawer).getByLabelText('Received at');
      expect(
        within(picker)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        'Choose the address',
        expect.stringContaining('+0.2 BTC'),
        expect.stringContaining('+0.05 BTC'),
      ]);
      await user.click(within(drawer).getByRole('button', { name: 'Save' }));
      expect(within(drawer).getByText('Choose the address of that wallet')).toBeInTheDocument();
      expect(classify).not.toHaveBeenCalled();
      await user.selectOptions(picker, other.id);
      await user.click(within(drawer).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
      expect(classify.mock.calls[0][2]).toEqual({
        requestId: expect.any(String),
        expectedVersion: 0,
        hidden: false,
        classification: {
          type: 'transfer',
          accountId: bybit.id,
          partner: { addressId: other.id, txid: txid(4) },
        },
      });
    });

    it('offers nothing when one address of the wallet took part', async () => {
      vi.spyOn(operationsApi, 'list').mockResolvedValue(list([sent, legA]));
      const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
      const { user, drawer } = await openRow(0, 'Outgoing transaction · BTC');
      await user.click(within(drawer).getByRole('button', { name: 'Transfer between my wallets' }));
      await within(drawer).findByRole('option', { name: 'Bybit' });
      await user.selectOptions(within(drawer).getByLabelText('Sent to'), bybit.id);
      expect(within(drawer).queryByLabelText('Received at')).toBeNull();
      await user.click(within(drawer).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
      expect(classify.mock.calls[0][2]).toMatchObject({
        classification: { type: 'transfer', accountId: bybit.id },
      });
      expect(classify.mock.calls[0][2].classification).not.toHaveProperty('partner');
    });

    it('asks again when the other wallet changes', async () => {
      vi.spyOn(operationsApi, 'list').mockResolvedValue(list([sent, legA, legB]));
      const { user, drawer } = await openRow(0, 'Outgoing transaction · BTC');
      await user.click(within(drawer).getByRole('button', { name: 'Transfer between my wallets' }));
      await within(drawer).findByRole('option', { name: 'Bybit' });
      await user.selectOptions(within(drawer).getByLabelText('Sent to'), bybit.id);
      await user.selectOptions(within(drawer).getByLabelText('Received at'), other.id);
      await user.selectOptions(within(drawer).getByLabelText('Sent to'), '');
      await user.selectOptions(within(drawer).getByLabelText('Sent to'), bybit.id);
      expect(within(drawer).getByLabelText('Received at')).toHaveValue('');
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
  it.each([
    [
      'names the account that does not hold the coins',
      {
        message: 'An account does not hold enough for this transfer',
        dependent: {
          operationId: `transfer:${id(41)}`,
          accountId: cold.id,
          instrumentId: id(1),
          occurredAt: '2025-06-23T08:00:00.000Z',
        },
      },
      /Cold storage does not hold enough BTC on Jun 23, 2025 for this transfer\. Classify the receipts/,
    ],
    [
      'names the account whose records start after the transaction',
      {
        message: 'The records of an account start after this entry',
        coverage: { accountId: bybit.id, coverageFrom: '2025-07-01T00:00:00.000Z' },
      },
      /The records of Bybit start on Jul 1, 2025, after this transaction on Jun 23, 2025\. Hide the transaction/,
    ],
    [
      'names the account opened with balances whose records have not started',
      {
        message: 'The records of an account have not started',
        coverage: { accountId: cold.id, coverageFrom: null },
      },
      /The records of Cold storage have not started: it was opened with balances, so start them on Manual accounts first\. Until then this transaction can only be hidden/,
    ],
  ])('XFER-REFUSED: %s', async (_name, data, expected) => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([sent]));
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(
      new AxiosError('refused', '409', undefined, undefined, {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data,
      }),
    );
    const { user, drawer } = await openRow(0, 'Outgoing transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Transfer between my wallets' }));
    await within(drawer).findByRole('option', { name: 'Bybit' });
    await user.selectOptions(within(drawer).getByLabelText('Sent to'), bybit.id);
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(expected);
  });
});

describe('swap-chain-coins (CLS-SWAP)', () => {
  // Trust Wallet pays 1000 USDT from its Ethereum address for 0.0125 BTC at its Bitcoin one.
  const trust = { id: id(12), name: 'Trust Wallet' };
  const ethWallet = {
    id: id(22),
    network: 'ethereum' as const,
    address: '0x00000000000000000000000000000000000000aa',
    label: null,
  };
  const chainUsdt = { instrumentId: null, symbol: 'USDT', name: 'Tether' };
  const bought = chainOperation(5, {
    occurredAt: '2026-09-01T10:40:00.000Z',
    quantity: '0.0125',
    estimatedValueUsd: '750',
    account: trust,
  });
  const usdtTxid = `${'d'.repeat(64)}-3`;
  const paid = operation({
    id: `chain:${ethWallet.id}:${usdtTxid}`,
    kind: 'chain',
    type: null,
    direction: 'out',
    occurredAt: '2026-09-01T10:00:00.000Z',
    asset: chainUsdt,
    quantity: '1000',
    account: trust,
    wallet: ethWallet,
    chain: { txid: usdtTxid, blockHeight: 20000003, priceObservedAt: null, direction: 'out' },
    status: 'needs-classification',
    source: 'chain',
    version: null,
  });
  // Not candidates: the same coin, and a payment a month earlier.
  const btcSent = chainOperation(6, {
    direction: 'out',
    occurredAt: '2026-09-01T09:00:00.000Z',
    quantity: '0.1',
    account: trust,
    chain: { txid: txid(6), blockHeight: 800006, priceObservedAt: null, direction: 'out' },
  });
  const earlier = {
    ...paid,
    id: `chain:${ethWallet.id}:${'f'.repeat(64)}-1`,
    occurredAt: '2026-08-01T10:00:00.000Z',
    chain: { ...paid.chain!, txid: `${'f'.repeat(64)}-1` },
  };
  const swapped = chainOperation(5, {
    type: 'swap',
    direction: 'internal',
    occurredAt: '2026-09-01T10:40:00.000Z',
    asset: chainUsdt,
    quantity: '1000',
    counterAsset: chainBtc,
    counterQuantity: '0.0125',
    valueUsd: '1000',
    costBasisUsd: '1000',
    account: trust,
    counterWallet: ethWallet,
    chain: {
      txid: txid(5),
      blockHeight: 800005,
      priceObservedAt: null,
      direction: 'in',
      pairedTxid: usdtTxid,
    },
    status: 'recorded',
    classification: {
      version: 1,
      hidden: false,
      value: { type: 'swap', with: { addressId: ethWallet.id, txid: usdtTxid }, valueUsd: null },
      comment: null,
      automatic: false,
    },
  });
  const openRow = async (
    operations: Operation[],
    index: number,
    name: string,
    dustThresholdUsd: string | null = null,
  ) => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list(operations, dustThresholdUsd));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(index));
    await user.click(within(bodyRows()[index]).getByRole('button'));
    return { user, drawer: screen.getByRole('dialog', { name }) };
  };

  it('CLS-SWAP-UI: a receipt is paid with a transaction from one of the wallets', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow(
      [bought, paid, btcSent, earlier],
      0,
      'Incoming transaction · BTC',
    );
    await user.click(within(drawer).getByRole('button', { name: 'Swap' }));
    const select = within(drawer).getByLabelText('Paid with');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Choose the transaction',
      'Sep 1, 2026, 10:00 · -1,000 USDT · Trust Wallet · Ethereum 0x0000…00aa',
    ]);
    expect(
      within(drawer).getByText(
        'Empty: USDT and USDC count 1:1, other coins at their stored price on Sep 1, 2026.',
      ),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(
      within(drawer).getByText('Choose the transaction on the other side'),
    ).toBeInTheDocument();
    expect(classify).not.toHaveBeenCalled();
    await user.selectOptions(select, `${ethWallet.id}|${usdtTxid}`);
    await user.type(within(drawer).getByLabelText('Value at the time (optional)'), '1012.5');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][1]).toBe(txid(5));
    expect(classify.mock.calls[0][2]).toEqual({
      requestId: expect.any(String),
      expectedVersion: 0,
      hidden: false,
      classification: {
        type: 'swap',
        with: { addressId: ethWallet.id, txid: usdtTxid },
        valueUsd: '1012.5',
      },
    });
  });

  it('CLS-SWAP-UI: an outgoing transaction names what it bought', async () => {
    const { user, drawer } = await openRow([bought, paid], 1, 'Outgoing transaction · USDT');
    await user.click(within(drawer).getByRole('button', { name: 'Swap' }));
    expect(
      within(within(drawer).getByLabelText('Received in exchange'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Choose the transaction',
      'Sep 1, 2026, 10:40 · +0.0125 BTC · Trust Wallet · Bitcoin bc1qsy…f3t4',
    ]);
  });

  it('CLS-SWAP-UI: a swap is one row USDT → BTC with both transactions in the drawer', async () => {
    const { user, drawer } = await openRow([swapped], 0, 'Swap · USDT → BTC');
    expect(cellTexts(bodyRows()[0])).toEqual([
      'Swap10:40',
      'USDT → BTC',
      '-1,000+0.0125 BTC',
      '$1,000.00',
      'Trust Wallet',
      'RecordedBlockchain',
    ]);
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(fact('Paid')).toBe('-1,000 USDT');
    expect(fact('Paid from')).toBe('Trust Wallet');
    expect(fact('Paying address')).toBe(`Ethereum · ${ethWallet.address}`);
    expect(fact('Paying transaction')).toBe(`0x${'d'.repeat(64)}CopyView in explorer`);
    expect(fact('Received')).toBe('+0.0125 BTC');
    expect(fact('Received in')).toBe('Trust Wallet');
    expect(fact('Address')).toBe(`Bitcoin · ${wallet.address}`);
    expect(fact('Value')).toBe('$1,000.00');
    expect(fact('Cost basis')).toBe('$1,000.00');
    await user.click(within(drawer).getByRole('button', { name: 'Change classification' }));
    expect(within(drawer).getByRole('button', { name: 'Swap' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The transaction paired now stays the choice, though the list shows it inside the swap.
    expect(within(drawer).getByLabelText('Paid with')).toHaveValue(`${ethWallet.id}|${usdtTxid}`);
  });

  it('CLS-SWAP-UI: says why a pair cannot be one swap', async () => {
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(
      new AxiosError('refused', '422', undefined, undefined, {
        status: 422,
        statusText: 'Unprocessable',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { message: 'Choose the account of the other wallet first' },
      }),
    );
    const { user, drawer } = await openRow([bought, paid], 0, 'Incoming transaction · BTC');
    await user.click(within(drawer).getByRole('button', { name: 'Swap' }));
    await user.selectOptions(
      within(drawer).getByLabelText('Paid with'),
      `${ethWallet.id}|${usdtTxid}`,
    );
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'The address on the other side is not in a wallet yet. Choose its wallet first.',
    );
  });

  it('CLS-SWAP-DUST: dust, hidden and too-small transactions are no other side', async () => {
    const other = (n: number, changes: Partial<Operation>) => ({
      ...paid,
      id: `chain:${ethWallet.id}:${'e'.repeat(63)}${n}-1`,
      chain: { ...paid.chain!, txid: `${'e'.repeat(63)}${n}-1` },
      ...changes,
    });
    const { user, drawer } = await openRow(
      [
        bought,
        paid,
        other(1, { quantity: '0.4', estimatedValueUsd: '0.4' }),
        other(2, { status: 'hidden' }),
        other(3, { status: 'dust', direction: 'in', estimatedValueUsd: '0.2' }),
        other(4, { quantity: '0' }),
      ],
      0,
      'Incoming transaction · BTC',
      '1',
    );
    await user.click(within(drawer).getByRole('button', { name: 'Swap' }));
    expect(
      within(within(drawer).getByLabelText('Paid with'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Choose the transaction',
      'Sep 1, 2026, 10:00 · -1,000 USDT · Trust Wallet · Ethereum 0x0000…00aa',
    ]);
  });

  describe('CLS-RECORDED-UI', () => {
    // The 1000 USDT sent paid for 0.0125 BTC the owner had already added by hand.
    const purchase = operation({
      id: `trade:${id(60)}`,
      occurredAt: '2026-09-01T09:30:00.000Z',
      quantity: '0.0125',
      asset: btc,
      account: trust,
      valueUsd: '1000',
      settlement: { asset: usdt, quantity: '1000' },
    });
    const imported = operation({
      ...purchase,
      id: `trade:${id(61)}`,
      occurredAt: '2026-09-02T00:00:00.000Z',
      settlement: null,
      source: 'csv',
    });
    // Not choices: another wallet's record and a sale of BTC.
    const elsewhere = operation({ ...purchase, id: `trade:${id(62)}`, account: cold });
    const sold = operation({ ...purchase, id: `trade:${id(63)}`, type: 'sell', direction: 'out' });
    const linked = operation({
      ...paid,
      type: 'buy',
      status: 'recorded',
      classification: {
        version: 1,
        hidden: false,
        value: { type: 'recorded', operation: { kind: 'trade', id: id(60) } },
        comment: null,
        automatic: false,
      },
    });

    it('an outgoing transaction can be the payment of a purchase added by hand', async () => {
      const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
      const { user, drawer } = await openRow(
        [imported, paid, purchase, elsewhere, sold],
        1,
        'Outgoing transaction · USDT',
      );
      await user.click(within(drawer).getByRole('button', { name: 'Swap' }));
      const select = within(drawer).getByLabelText('Received in exchange');
      const group = within(select).getByRole('group', { name: 'Added by you or from CSV' });
      expect(
        within(group)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Sep 1, 2026, 09:30 · Buy 0.0125 BTC for 1,000 USDT · Added by you']);
      await user.selectOptions(select, `trade:${id(60)}`);
      expect(within(drawer).queryByLabelText('Value at the time (optional)')).toBeNull();
      expect(
        within(drawer).getByText(
          'This transaction is that record: nothing new is added, and the coins are not counted twice.',
        ),
      ).toBeInTheDocument();
      await user.click(within(drawer).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
      expect(classify.mock.calls[0][2]).toEqual({
        requestId: expect.any(String),
        expectedVersion: 0,
        hidden: false,
        classification: { type: 'recorded', operation: { kind: 'trade', id: id(60) } },
      });
    });

    it('CLS-PAID-UI: USDT sent can pay for a purchase made by hand in another account', async () => {
      const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
      // 300 USDT, bought ZEC in an account of its own that held no USDT then.
      const zcash = { id: id(13), name: 'Zcash' };
      const zec = { instrumentId: id(3), symbol: 'ZEC', name: 'Zcash' };
      const owed = operation({
        id: `trade:${id(64)}`,
        occurredAt: '2026-09-01T09:00:00.000Z',
        quantity: '10',
        asset: zec,
        account: zcash,
        valueUsd: '300',
        feeUsd: '0',
        settlement: { asset: usdt, quantity: '0' },
      });
      // Not choices: paid from that account's cash in full, paid in RUB, and another coin's cash.
      const settled = operation({
        ...owed,
        id: `trade:${id(65)}`,
        settlement: { asset: usdt, quantity: '300' },
      });
      const inRub = operation({
        ...owed,
        id: `trade:${id(66)}`,
        paid: {
          currency: 'RUB',
          gross: '24000',
          fee: '0',
          rateDate: '2026-09-01',
          perUsd: '80',
          rateSource: 'bank-of-russia',
        },
      });
      const inUsdc = operation({
        ...owed,
        id: `trade:${id(67)}`,
        settlement: {
          asset: { instrumentId: id(4), symbol: 'USDC', name: 'USD Coin' },
          quantity: '120',
        },
      });
      const { user, drawer } = await openRow(
        [paid, owed, settled, inRub, inUsdc],
        0,
        'Outgoing transaction · USDT',
      );
      await user.click(within(drawer).getByRole('button', { name: 'Swap' }));
      const select = within(drawer).getByLabelText('Received in exchange');
      const group = within(select).getByRole('group', { name: 'Added by you or from CSV' });
      expect(
        within(group)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Sep 1, 2026, 09:00 · Buy 10 ZEC · Added by you · Zcash']);
      await user.selectOptions(select, `trade:${id(64)}`);
      expect(
        within(drawer).getByText(
          'The coins move to Zcash just before that purchase and pay for it there. Nothing is counted twice.',
        ),
      ).toBeInTheDocument();
      await user.click(within(drawer).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
      expect(classify.mock.calls[0][2]).toEqual({
        requestId: expect.any(String),
        expectedVersion: 0,
        hidden: false,
        classification: { type: 'recorded', operation: { kind: 'trade', id: id(64) } },
      });
    });

    it('CLS-PAID-UI: coins received never pay for a purchase in another account', async () => {
      const owed = operation({
        ...purchase,
        id: `trade:${id(68)}`,
        account: cold,
        settlement: { asset: usdt, quantity: '0' },
      });
      const { user, drawer } = await openRow(
        [owed, { ...paid, direction: 'in', chain: { ...paid.chain!, direction: 'in' } }],
        1,
        'Incoming transaction · USDT',
      );
      await user.click(within(drawer).getByRole('button', { name: 'Swap' }));
      expect(within(drawer).queryByRole('group', { name: 'Added by you or from CSV' })).toBeNull();
    });

    it('CLS-PAID-UI: a payment carried to another account reads as a transfer naming the purchase', async () => {
      const zcash = { id: id(13), name: 'Zcash' };
      const owed = operation({
        id: `trade:${id(64)}`,
        occurredAt: '2026-09-01T09:00:00.000Z',
        quantity: '10',
        asset: { instrumentId: id(3), symbol: 'ZEC', name: 'Zcash' },
        account: zcash,
        valueUsd: '300',
        settlement: { asset: usdt, quantity: '300' },
      });
      const carried = operation({
        ...paid,
        type: 'transfer',
        direction: 'internal',
        status: 'recorded',
        counterAccount: zcash,
        classification: {
          version: 1,
          hidden: false,
          value: { type: 'recorded', operation: { kind: 'trade', id: id(64) } },
          comment: null,
          automatic: false,
        },
      });
      const { user, drawer } = await openRow([carried, owed], 0, 'Transfer · USDT');
      expect(
        within(drawer).getByText(/These coins moved to Zcash and paid for the purchase/),
      ).toBeInTheDocument();
      expect(within(drawer).queryByText(/Already recorded by hand or from CSV/)).toBeNull();
      const facts = within(drawer).getByRole('region', { name: 'Details' });
      expect(
        within(facts).getByText('Recorded as', { exact: true }).nextElementSibling?.textContent,
      ).toBe('Sep 1, 2026, 09:00 · Buy 10 ZEC for 300 USDT · Added by you · Zcash');
      await user.click(within(drawer).getByRole('button', { name: 'Change classification' }));
      expect(within(drawer).getByLabelText('Received in exchange')).toHaveValue(`trade:${id(64)}`);
    });

    it('a receipt can be the coins of a purchase imported from CSV', async () => {
      const { user, drawer } = await openRow(
        [imported, bought, purchase],
        1,
        'Incoming transaction · BTC',
      );
      await user.click(within(drawer).getByRole('button', { name: 'Swap' }));
      const group = within(within(drawer).getByLabelText('Paid with')).getByRole('group', {
        name: 'Added by you or from CSV',
      });
      expect(
        within(group)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        'Sep 1, 2026, 09:30 · Buy 0.0125 BTC for 1,000 USDT · Added by you',
        'Sep 2, 2026, No time · Buy 0.0125 BTC · From CSV',
      ]);
    });

    it('a recorded transaction names its record and opens on it to change', async () => {
      const { user, drawer } = await openRow([linked, purchase], 0, 'Buy · USDT');
      expect(within(drawer).getByText(/Already recorded by hand or from CSV/)).toBeInTheDocument();
      const facts = within(drawer).getByRole('region', { name: 'Details' });
      const fact = (label: string) =>
        within(facts).queryByText(label, { exact: true })?.nextElementSibling?.textContent;
      expect(fact('Recorded as')).toBe(
        'Sep 1, 2026, 09:30 · Buy 0.0125 BTC for 1,000 USDT · Added by you',
      );
      expect(fact('Value')).toBeUndefined();
      await user.click(within(drawer).getByRole('button', { name: 'Change classification' }));
      expect(within(drawer).getByRole('button', { name: 'Swap' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(within(drawer).getByLabelText('Received in exchange')).toHaveValue(`trade:${id(60)}`);
    });
  });
});

describe('token blockchain (TOKEN-CHAIN)', () => {
  // The same ticker on two blockchains: each row names its own.
  const ethWallet = {
    id: id(23),
    network: 'ethereum' as const,
    address: '0x00000000000000000000000000000000000000bb',
    label: null,
  };
  const solWallet = {
    id: id(24),
    network: 'solana' as const,
    address: 'So1Synthetic1111111111111111111111111111111',
    label: null,
  };
  const leg = (wallet: typeof ethWallet | typeof solWallet, n: number, at: string) =>
    operation({
      id: `chain:${wallet.id}:${txid(n)}`,
      kind: 'chain',
      type: null,
      direction: 'in',
      occurredAt: at,
      asset: { instrumentId: null, symbol: 'USDT', name: 'Tether', network: wallet.network },
      quantity: '250',
      wallet,
      chain: { txid: txid(n), blockHeight: n, priceObservedAt: null, direction: 'in' },
      status: 'needs-classification',
      source: 'chain',
      version: null,
    });
  const onEthereum = leg(ethWallet, 31, '2026-09-02T10:00:00.000Z');
  const onSolana = leg(solWallet, 32, '2026-09-01T10:00:00.000Z');

  it('TOKEN-CHAIN-UI: a token row and its drawer name the blockchain', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([onEthereum, onSolana]));
    const user = userEvent.setup();
    const { container } = renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(bodyRows().map((row) => cellTexts(row)[1])).toEqual([
      'USDT (Ethereum)',
      'USDT (Solana)',
    ]);
    expect(
      [...container.querySelectorAll('tbody .asset-icon__chain')].map((icon) =>
        icon.getAttribute('data-chain'),
      ),
    ).toEqual(['Ξ', 'S']);
    await user.click(within(bodyRows()[1]).getByRole('button'));
    expect(
      screen.getByRole('dialog', { name: 'Incoming transaction · USDT (Solana)' }),
    ).toBeInTheDocument();
  });

  it('TOKEN-CHAIN-UI: a swap of tokens names the blockchain of each', async () => {
    const swapped = operation({
      ...onSolana,
      id: `chain:${solWallet.id}:${txid(33)}`,
      type: 'swap',
      direction: 'internal',
      asset: { instrumentId: null, symbol: 'USDT', name: 'Tether', network: 'ethereum' },
      quantity: '250',
      counterAsset: { instrumentId: null, symbol: 'USDC', name: 'USD Coin', network: 'solana' },
      counterQuantity: '249.5',
      counterWallet: ethWallet,
      status: 'recorded',
    });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([swapped]));
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(cellTexts(bodyRows()[0]).slice(1, 3)).toEqual([
      'USDT (Ethereum) → USDC (Solana)',
      '-250+249.5 USDC (Solana)',
    ]);
  });
});

describe('swap in one transaction (SWAP-ONE-TX)', () => {
  // A DEX swap: 0.5 ETH went to a contract that sent 1,500 USDC back in the same transaction.
  const trust = { id: id(12), name: 'Trust Wallet' };
  const ethWallet = {
    id: id(26),
    network: 'ethereum' as const,
    address: '0x00000000000000000000000000000000000000cc',
    label: null,
  };
  const hash = 'e'.repeat(64);
  const call = { method: 'swapExactETHForTokens' };
  const leg = (txid: string, changes: Partial<Operation>) =>
    operation({
      id: `chain:${ethWallet.id}:${txid}`,
      kind: 'chain',
      type: null,
      occurredAt: '2026-09-03T10:00:00.000Z',
      account: trust,
      wallet: ethWallet,
      status: 'needs-classification',
      source: 'chain',
      version: null,
      ...changes,
    });
  const ether = leg(hash, {
    direction: 'out',
    asset: { instrumentId: null, symbol: 'ETH', name: 'Ethereum' },
    quantity: '0.5',
    fee: { asset: { instrumentId: null, symbol: 'ETH', name: 'Ethereum' }, quantity: '0.002' },
    chain: {
      txid: hash,
      blockHeight: 21000014,
      priceObservedAt: null,
      direction: 'out',
      call,
      swapWith: { addressId: ethWallet.id, txid: `${hash}-7` },
    },
  });
  const usdc = leg(`${hash}-7`, {
    direction: 'in',
    asset: { instrumentId: null, symbol: 'USDC', name: 'USD Coin', network: 'ethereum' },
    quantity: '1500',
    chain: {
      txid: `${hash}-7`,
      blockHeight: 21000014,
      priceObservedAt: null,
      direction: 'in',
      call,
      swapWith: { addressId: ethWallet.id, txid: hash },
    },
  });

  it('SWAP-ONE-TX-UI: the token back is suggested as a swap paid with the contract call', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([usdc, ether]));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await user.click(within(bodyRows()[0]).getByRole('button'));
    const drawer = screen.getByRole('dialog', {
      name: 'Incoming transaction · USDC (Ethereum)',
    });
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    expect(
      within(facts).getByText('Contract call', { exact: true }).nextElementSibling?.textContent,
    ).toBe('swapExactETHForTokens');
    expect(within(drawer).getByRole('button', { name: 'Swap' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const paidWith = within(drawer).getByLabelText('Paid with');
    expect(paidWith).toHaveValue(`${ethWallet.id}|${hash}`);
    expect(within(paidWith).getByRole('option', { selected: true }).textContent).toBe(
      'Same transaction · -0.5 ETH · Trust Wallet · Ethereum 0x0000…00cc',
    );
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2]).toMatchObject({
      classification: {
        type: 'swap',
        with: { addressId: ethWallet.id, txid: hash },
        valueUsd: null,
      },
    });
  });

  it('SWAP-ONE-TX-UI: the contract call is suggested as a swap for what came back', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list([usdc, ether]));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await user.click(within(bodyRows()[1]).getByRole('button'));
    const drawer = screen.getByRole('dialog', { name: 'Outgoing transaction · ETH' });
    expect(within(drawer).getByLabelText('Received in exchange')).toHaveValue(
      `${ethWallet.id}|${hash}-7`,
    );
  });
});

// Owner's notes of 2026-10-09: the list stays put while it changes, the open row is marked,
// chip counts follow the other filters, and a transaction hash copies and opens its explorer.
describe('transactions-page-polish', () => {
  const nextOne = chainOperation(2, {
    account: cold,
    direction: 'out',
    occurredAt: '2025-06-19T08:00:00.000Z',
    quantity: '0.0005',
    chain: { txid: txid(2), blockHeight: 800002, priceObservedAt: null, direction: 'out' },
  });
  const first = chainOperation(1, {
    account: cold,
    occurredAt: '2025-06-20T08:05:00.000Z',
    quantity: '0.00918359',
  });
  const bought = operation({
    ...first,
    type: 'buy',
    status: 'recorded',
    valueUsd: '1000',
    costBasisUsd: '1000',
    feeUsd: '0',
    classification: {
      version: 1,
      hidden: false,
      value: { type: 'buy', currency: 'USDT', amount: '1000' },
      comment: null,
      automatic: false,
    },
  });
  const chipCounts = () =>
    within(screen.getByRole('group', { name: 'Filter transactions' }))
      .getAllByRole('button')
      .map((chip) => chip.textContent);

  it('OPS-COUNTS: chip counts follow the asset, account and search filters', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(chipCounts()).toEqual([
      'All 6',
      'Needs classification 2',
      'Hidden 0',
      'Blockchain 2',
      'Manual 3',
      'CSV 1',
    ]);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), bybit.id);
    expect(bodyRows()).toHaveLength(4);
    expect(chipCounts()).toEqual([
      'All 4',
      'Needs classification 0',
      'Hidden 0',
      'Blockchain 0',
      'Manual 3',
      'CSV 1',
    ]);
    await user.type(screen.getByRole('searchbox', { name: 'Search transactions' }), 'tether');
    expect(chipCounts()).toEqual([
      'All 1',
      'Needs classification 0',
      'Hidden 0',
      'Blockchain 0',
      'Manual 1',
      'CSV 0',
    ]);
  });

  it('OPS-COMPACT: status and source share one column, the source under the status', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Type', 'Asset', 'Amount', 'Value', 'Account', 'Status']);
    const status = within(bodyRows()[1]).getAllByRole('cell')[5];
    expect(within(status).getByText('To classify')).toBeInTheDocument();
    expect(within(status).getByText('Blockchain')).toBeInTheDocument();
    // Fixed column widths: a chip that shows other rows never moves the columns.
    expect(table().querySelectorAll('colgroup col')).toHaveLength(6);
  });

  it('OPS-DELETE keeps the rows on screen while the list reloads', async () => {
    const user = userEvent.setup();
    let reloaded: (value: OperationList) => void = () => undefined;
    vi.spyOn(operationsApi, 'list')
      .mockResolvedValueOnce(list([tether, manual]))
      .mockReturnValueOnce(new Promise((resolve) => (reloaded = resolve)));
    vi.spyOn(tradesApi, 'versions').mockResolvedValue({
      tradeId: id(30),
      items: [],
      nextBeforeVersion: null,
    });
    vi.spyOn(tradesApi, 'state').mockResolvedValue({
      journal: { journalRevision: 2 },
    } as JournalState);
    vi.spyOn(tradesApi, 'void').mockResolvedValue({} as TradeReceipt);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await user.click(within(bodyRows()[1]).getByRole('button', { name: 'Buy' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Loading transactions…')).toBeNull();
    expect(bodyRows()).toHaveLength(2);
    await act(async () => reloaded(list([tether])));
    expect(bodyRows()).toHaveLength(1);
  });

  it('OPS-RETURN: coming back to the page shows the last list at once and refreshes it', async () => {
    vi.spyOn(operationsApi, 'list')
      .mockResolvedValueOnce(all)
      .mockReturnValueOnce(new Promise(() => undefined));
    const page = renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    page.unmount();
    renderPage();
    expect(screen.queryByText('Loading transactions…')).toBeNull();
    expect(bodyRows()).toHaveLength(6);
    expect(operationsApi.list).toHaveBeenCalledTimes(2);
  });

  it('CLS-NEXT: the next transaction to classify is marked in the list and scrolled into view', async () => {
    const user = userEvent.setup();
    const scrolled: Element[] = [];
    // jsdom has no scrollIntoView; record which element asked to be shown.
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original;
    });
    vi.spyOn(operationsApi, 'list')
      .mockResolvedValueOnce(list([first, nextOne]))
      .mockResolvedValue(list([bought, nextOne]));
    vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await user.click(within(bodyRows()[0]).getByRole('button', { name: 'Incoming' }));
    expect(bodyRows()[0]).toHaveAttribute('aria-current', 'true');
    const drawer = screen.getByRole('dialog', { name: 'Incoming transaction · BTC' });
    await user.click(within(drawer).getByRole('button', { name: 'Buy' }));
    await user.type(within(drawer).getByLabelText('You paid'), '1000');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await screen.findByRole('dialog', { name: 'Outgoing transaction · BTC' });
    expect(bodyRows()[0]).not.toHaveAttribute('aria-current');
    expect(bodyRows()[1]).toHaveAttribute('aria-current', 'true');
    // jsdom lays nothing out, so every row counts as off screen and is scrolled to.
    expect(scrolled.at(-1)).toBe(bodyRows()[1]);
    // Closing the drawer leaves the keyboard on the row it showed.
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(within(bodyRows()[1]).getByRole('button', { name: 'Outgoing' })).toHaveFocus(),
    );
    expect(bodyRows()[1]).not.toHaveAttribute('aria-current');
  });

  it('TX-HASH: copies a transaction hash in one click and opens it in the explorer', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    await user.click(within(bodyRows()[1]).getByRole('button', { name: 'Incoming' }));
    const drawer = screen.getByRole('dialog', { name: 'Incoming transaction · BTC' });
    await user.click(within(drawer).getByRole('button', { name: 'Copy transaction hash' }));
    expect(writeText).toHaveBeenCalledWith(txid(1));
    expect(within(drawer).getByRole('button', { name: 'Copy transaction hash' })).toHaveTextContent(
      'Copied',
    );
    const explorer = within(drawer).getByRole('link', { name: 'View in explorer' });
    expect(explorer).toHaveAttribute('href', `https://mempool.space/tx/${txid(1)}`);
    expect(explorer).toHaveAttribute('target', '_blank');
    expect(explorer).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('liquidity-pool-chain-legs (POOL-*)', () => {
  // Trust Wallet's Ethereum address put 3000 USDC into a pool and got 3400 USDC back.
  const trust = { id: id(12), name: 'Trust Wallet' };
  const ethWallet = {
    id: id(23),
    network: 'ethereum' as const,
    address: '0x00000000000000000000000000000000000000bb',
    label: null,
  };
  const chainUsdc = { instrumentId: null, symbol: 'USDC', name: 'USD Coin' };
  const chainEth = { instrumentId: null, symbol: 'ETH', name: 'Ethereum' };
  const depositTxid = `${'f'.repeat(64)}-4`;
  const backTxid = `${'e'.repeat(64)}-3`;
  const leg = (txid: string, changes: Partial<Operation>) =>
    operation({
      id: `chain:${ethWallet.id}:${txid}`,
      kind: 'chain',
      type: null,
      asset: chainUsdc,
      account: trust,
      wallet: ethWallet,
      chain: {
        txid,
        blockHeight: 20000000,
        priceObservedAt: null,
        direction: changes.direction ?? 'in',
      },
      status: 'needs-classification',
      source: 'chain',
      version: null,
      ...changes,
    });
  const unanswered = leg(depositTxid, {
    direction: 'out',
    occurredAt: '2026-08-10T10:00:00.000Z',
    quantity: '3000',
  });
  const deposited = leg(depositTxid, {
    type: 'pool-deposit',
    direction: 'internal',
    occurredAt: '2026-08-10T10:00:00.000Z',
    quantity: '3000',
    status: 'recorded',
    chain: { txid: depositTxid, blockHeight: 20000000, priceObservedAt: null, direction: 'out' },
    classification: {
      version: 1,
      hidden: false,
      value: { type: 'pool-deposit' },
      comment: null,
      automatic: false,
    },
  });
  const back = leg(backTxid, { occurredAt: '2026-09-01T10:00:00.000Z', quantity: '3400' });
  // Not candidates: a deposit of another coin, and one made after the withdrawal.
  const etherIn = leg(`${'f'.repeat(64)}`, {
    ...deposited,
    id: `chain:${ethWallet.id}:${'f'.repeat(64)}`,
    asset: chainEth,
    quantity: '1',
    chain: { ...deposited.chain!, txid: 'f'.repeat(64) },
  });
  const later = {
    ...deposited,
    id: `chain:${ethWallet.id}:${'c'.repeat(64)}-1`,
    occurredAt: '2026-09-20T10:00:00.000Z',
    chain: { ...deposited.chain!, txid: `${'c'.repeat(64)}-1` },
  };
  const returned = leg(backTxid, {
    type: 'pool-withdrawal',
    direction: 'internal',
    occurredAt: '2026-09-01T10:00:00.000Z',
    quantity: '3400',
    valueUsd: '400',
    costBasisUsd: '400',
    status: 'recorded',
    chain: {
      txid: backTxid,
      blockHeight: 20000001,
      priceObservedAt: null,
      direction: 'in',
      pairedTxid: depositTxid,
    },
    pool: { deposited: '3000', difference: '400' },
    classification: {
      version: 1,
      hidden: false,
      value: {
        type: 'pool-withdrawal',
        deposit: { addressId: ethWallet.id, txid: depositTxid },
        valueUsd: null,
      },
      comment: null,
      automatic: false,
    },
  });
  const openRow = async (operations: Operation[], index: number, name: string) => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(list(operations));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(index));
    await user.click(within(bodyRows()[index]).getByRole('button'));
    return { user, drawer: screen.getByRole('dialog', { name }) };
  };

  it('POOL-DEPOSIT-UI: an outgoing transaction is a pool deposit with nothing to enter', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow([unanswered], 0, 'Outgoing transaction · USDC');
    await user.click(within(drawer).getByRole('button', { name: 'Pool deposit' }));
    expect(
      within(drawer).getByText(/The coins stay yours while they are in the pool/),
    ).toBeInTheDocument();
    expect(within(drawer).queryByLabelText(/Value/)).not.toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2]).toEqual({
      requestId: expect.any(String),
      expectedVersion: 0,
      hidden: false,
      classification: { type: 'pool-deposit' },
    });
  });

  it('POOL-WITHDRAW-UI: a receipt names the deposit it returns, of its coin, made before it', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow(
      [later, back, deposited, etherIn],
      1,
      'Incoming transaction · USDC',
    );
    await user.click(within(drawer).getByRole('button', { name: 'Pool withdrawal' }));
    const select = within(drawer).getByLabelText('Returns the deposit');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Choose the pool deposit',
      'Aug 10, 2026, 10:00 · 3,000 USDC · Ethereum 0x0000…00bb',
    ]);
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(
      within(drawer).getByText('Choose the pool deposit this withdrawal returns'),
    ).toBeInTheDocument();
    expect(classify).not.toHaveBeenCalled();
    await user.selectOptions(select, `${ethWallet.id}|${depositTxid}`);
    await user.type(within(drawer).getByLabelText('Value of the gain (optional)'), '410');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2]).toEqual({
      requestId: expect.any(String),
      expectedVersion: 0,
      hidden: false,
      classification: {
        type: 'pool-withdrawal',
        deposit: { addressId: ethWallet.id, txid: depositTxid },
        valueUsd: '410',
      },
    });
  });

  it('POOL-WITHDRAW-UI: a withdrawal shows its deposit and the pool income; a returned deposit is no choice', async () => {
    const { user, drawer } = await openRow([returned, deposited], 0, 'Pool withdrawal · USDC');
    expect(
      within(drawer).getByText(
        'Returned from a liquidity pool: the deposit comes back as your own coins, not income and not a deposit. The 400 USDC above it is pool income.',
      ),
    ).toBeInTheDocument();
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(fact('Deposited')).toBe('3,000 USDC');
    expect(fact('Pool income')).toBe('+400 USDC');
    expect(fact('Deposit transaction')).toBe(`0x${'f'.repeat(64)}`);
    expect(fact('Value')).toBe('$400.00');
    await user.click(within(drawer).getByRole('button', { name: 'Change classification' }));
    expect(within(drawer).getByLabelText('Returns the deposit')).toHaveValue(
      `${ethWallet.id}|${depositTxid}`,
    );
    // Another receipt cannot return the same deposit again.
    const other = leg(`${'b'.repeat(64)}-1`, { occurredAt: '2026-09-02T10:00:00.000Z' });
    expect(poolCandidates(other, [returned, deposited, other]).map(([key]) => key)).toEqual([]);
  });

  // POOL-PARTIAL: the pool paid 1,000 of the 3,000 back and keeps 2,000 for now.
  const partTxid = `${'e'.repeat(64)}-3`;
  const part = leg(partTxid, {
    type: 'pool-withdrawal',
    direction: 'internal',
    occurredAt: '2026-08-20T10:00:00.000Z',
    quantity: '1000',
    status: 'recorded',
    chain: {
      txid: partTxid,
      blockHeight: 20000001,
      priceObservedAt: null,
      direction: 'in',
      pairedTxid: depositTxid,
    },
    pool: { deposited: '3000', difference: '0', partial: true, remaining: '2000' },
    classification: {
      version: 1,
      hidden: false,
      value: {
        type: 'pool-withdrawal',
        deposit: { addressId: ethWallet.id, txid: depositTxid },
        valueUsd: null,
        partial: true,
      },
      comment: null,
      automatic: false,
    },
  });

  it('POOL-PARTIAL-UI: a withdrawal can be marked as a part of its deposit', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow([back, deposited], 0, 'Incoming transaction · USDC');
    await user.click(within(drawer).getByRole('button', { name: 'Pool withdrawal' }));
    expect(
      within(drawer).getByText(/The last or only withdrawal of this deposit: what is missing/),
    ).toBeInTheDocument();
    await user.selectOptions(
      within(drawer).getByLabelText('Returns the deposit'),
      `${ethWallet.id}|${depositTxid}`,
    );
    await user.click(within(drawer).getByLabelText('Part of the deposit'));
    expect(within(drawer).getByText(/The rest is still in the pool/)).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2]).toEqual({
      requestId: expect.any(String),
      expectedVersion: 0,
      hidden: false,
      classification: {
        type: 'pool-withdrawal',
        deposit: { addressId: ethWallet.id, txid: depositTxid },
        valueUsd: null,
        partial: true,
      },
    });
  });

  it('POOL-PARTIAL-UI: a part shows what is left in the pool and keeps the choice on edit', async () => {
    const { user, drawer } = await openRow([part, deposited], 0, 'Pool withdrawal · USDC');
    expect(
      within(drawer).getByText(
        'Returned from a liquidity pool: a part of the deposit comes back as your own coins, not income and not a deposit. The 2,000 USDC left in the pool stay yours, with their purchase price.',
      ),
    ).toBeInTheDocument();
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    const fact = (label: string) =>
      within(facts).getByText(label, { exact: true }).nextElementSibling?.textContent;
    expect(fact('Deposited')).toBe('3,000 USDC');
    expect(fact('Left in the pool')).toBe('2,000 USDC');
    await user.click(within(drawer).getByRole('button', { name: 'Change classification' }));
    expect(within(drawer).getByLabelText('Part of the deposit')).toBeChecked();
  });

  it('POOL-PARTIAL-UI: a deposit stays a choice while parts leave coins in the pool', () => {
    const other = leg(`${'b'.repeat(64)}-1`, { occurredAt: '2026-09-02T10:00:00.000Z' });
    const keys = (operations: Operation[]) =>
      poolCandidates(other, operations).map(([key, label]) => [key, label]);
    expect(keys([part, deposited, other])).toEqual([
      [
        `${ethWallet.id}|${depositTxid}`,
        'Aug 10, 2026, 10:00 · 3,000 USDC · Ethereum 0x0000…00bb · 2,000 USDC left in the pool',
      ],
    ]);
    // Returned in full by the parts, or closed by a withdrawal that is not a part: no choice.
    const empty = { ...part, pool: { ...part.pool!, remaining: '0' } };
    expect(keys([empty, deposited, other])).toEqual([]);
    expect(keys([part, returned, deposited, other])).toEqual([]);
  });

  it('POOL-UNDO-UI: explains why a deposit a withdrawal returns cannot be hidden', async () => {
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(
      new AxiosError('refused', '422', undefined, undefined, {
        status: 422,
        statusText: 'Unprocessable',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { message: 'A pool withdrawal names this deposit; change the withdrawal first' },
      }),
    );
    const { user, drawer } = await openRow([deposited], 0, 'Pool deposit · USDC');
    expect(
      within(drawer).getByText(
        'Moved into a liquidity pool: the coins stay yours and keep their purchase price until a pool withdrawal returns them. Only the network fee is a cost.',
      ),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Hide from calculations' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'A pool withdrawal returns this deposit, so it cannot be hidden. Change that withdrawal first.',
    );
  });

  it('POOL-REWARD-UI: a receipt can be a pool reward with an optional value', async () => {
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    const { user, drawer } = await openRow([back], 0, 'Incoming transaction · USDC');
    await user.click(within(drawer).getByRole('button', { name: 'Pool reward' }));
    await user.type(within(drawer).getByLabelText('Value at the time (optional)'), '25');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify.mock.calls[0][2]).toMatchObject({
      classification: { type: 'pool-reward', valueUsd: '25' },
    });
  });
});

// Owner's note of 2026-10-09 15:34Z: after a classification the drawer moves to the
// transaction next to the one just answered, not back to the newest one.
describe('CLS-ADJACENT: the next transaction is the neighbour in time', () => {
  const waitingAt = (n: number, occurredAt: string) =>
    chainOperation(n, {
      account: cold,
      occurredAt,
      quantity: `0.00${n}`,
      chain: { txid: txid(n), blockHeight: 800000 + n, priceObservedAt: null, direction: 'in' },
    });
  const newest = waitingAt(1, '2025-06-22T08:00:00.000Z');
  const middle = waitingAt(2, '2025-06-21T08:00:00.000Z');
  const oldest = waitingAt(3, '2025-06-20T08:00:00.000Z');
  const answered = (row: Operation) =>
    operation({
      ...row,
      type: 'buy',
      status: 'recorded',
      valueUsd: '10',
      costBasisUsd: '10',
      feeUsd: '0',
      classification: {
        version: 1,
        hidden: false,
        value: { type: 'buy', currency: 'USDT', amount: '10' },
        comment: null,
        automatic: false,
      },
    });
  const classifyRow = async (index: number, after: Operation[]) => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list')
      .mockResolvedValueOnce(list([newest, middle, oldest]))
      .mockResolvedValue(list(after));
    vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await user.click(within(bodyRows()[index]).getByRole('button', { name: 'Incoming' }));
    const drawer = screen.getByRole('dialog', { name: 'Incoming transaction · BTC' });
    await user.click(within(drawer).getByRole('button', { name: 'Buy' }));
    await user.type(within(drawer).getByLabelText('You paid'), '10');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByText('Saved as Buy. Here is the next one.')).toBeVisible(),
    );
    return screen.getByRole('dialog', { name: 'Incoming transaction · BTC' });
  };

  it('opens the next older transaction below the one just classified', async () => {
    const next = await classifyRow(1, [newest, answered(middle), oldest]);
    expect(within(next).getByText('+0.003 BTC')).toBeInTheDocument();
    expect(bodyRows()[2]).toHaveAttribute('aria-current', 'true');
  });

  it('at the oldest one, opens the newer neighbour above it', async () => {
    const next = await classifyRow(2, [newest, middle, answered(oldest)]);
    expect(within(next).getByText('+0.002 BTC')).toBeInTheDocument();
    expect(bodyRows()[1]).toHaveAttribute('aria-current', 'true');
  });
});

describe('XFER-PROPOSED-UI: a withdrawal and a receipt of two hashes', () => {
  const leg = (n: number, accountName: string, at: string, label: string | null = null) => ({
    addressId: id(60 + n),
    txid: txid(80 + n),
    version: 0,
    accountId: id(70 + n),
    accountName,
    wallet: { network: 'ethereum' as const, address: `0x${String(n).repeat(40)}`, label },
    occurredAt: at,
  });
  const proposal: TransferProposal = {
    coin: 'USDT',
    sent: '100.5',
    arrived: '100',
    fee: '0.5',
    outgoing: leg(1, 'Exchange', '2026-10-01T10:00:00.000Z', 'Main'),
    incoming: leg(2, 'Hardware', '2026-10-01T10:12:00.000Z'),
  };
  const found = (proposals: TransferProposal[]) => ({ windowHours: 24, feePercent: 2, proposals });

  it('XFER-PROPOSED: lists the pair with the fee and joins it with one tap', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    vi.spyOn(operationsApi, 'transferProposals')
      .mockResolvedValueOnce(found([proposal]))
      .mockResolvedValue(found([]));
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    renderPage();
    const card = await screen.findByRole('region', {
      name: 'One possible transfer between your accounts',
    });
    expect(within(card).getByText(/100 USDT/)).toBeInTheDocument();
    expect(card).toHaveTextContent('from Exchange to Hardware');
    expect(card).toHaveTextContent('Left Main Oct 1, 2026, 10:00 UTC');
    expect(card).toHaveTextContent('100.5 USDT left, so 0.5 USDT is the fee');
    expect(card).toHaveTextContent('within 24 hours');
    await user.click(within(card).getByRole('button', { name: 'Join as one transfer' }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify).toHaveBeenCalledWith(
      { id: proposal.outgoing.addressId },
      proposal.outgoing.txid,
      expect.objectContaining({
        expectedVersion: 0,
        hidden: false,
        classification: {
          type: 'transfer',
          accountId: proposal.incoming.accountId,
          partner: { addressId: proposal.incoming.addressId, txid: proposal.incoming.txid },
        },
      }),
    );
    expect(await screen.findByText(/Joined as one transfer: 100 USDT/)).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /possible transfer/ })).toBeNull(),
    );
  });

  it('says why a pair could not be joined and keeps the offer', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    vi.spyOn(operationsApi, 'transferProposals').mockResolvedValue(found([proposal]));
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(
      new AxiosError('Unprocessable', '422', undefined, undefined, {
        status: 422,
        statusText: 'Unprocessable',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
          message: 'The other wallet did not receive what this one sent, less the network fee',
        },
      }),
    );
    renderPage();
    const card = await screen.findByRole('region', {
      name: 'One possible transfer between your accounts',
    });
    await user.click(within(card).getByRole('button', { name: 'Join as one transfer' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'These cannot be joined: the other wallet did not receive what this one sent, less the network fee.',
    );
    expect(within(card).getByRole('button', { name: 'Join as one transfer' })).toBeEnabled();
  });

  it('shows nothing without a proposal, and three of many until asked', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    const many = [1, 2, 3, 4].map((n) => ({
      ...proposal,
      outgoing: { ...proposal.outgoing, txid: txid(90 + n) },
    }));
    vi.spyOn(operationsApi, 'transferProposals')
      .mockResolvedValueOnce(found([]))
      .mockResolvedValue(found(many));
    renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(screen.queryByRole('region', { name: /possible transfer/ })).toBeNull();
    cleanup();
    renderPage();
    const card = await screen.findByRole('region', {
      name: '4 possible transfers between your accounts',
    });
    expect(within(card).getAllByRole('button', { name: 'Join as one transfer' })).toHaveLength(3);
    await user.click(within(card).getByRole('button', { name: 'Show all 4' }));
    expect(within(card).getAllByRole('button', { name: 'Join as one transfer' })).toHaveLength(4);
  });
});

describe('CLS-DUPLICATE-UI: a record you added and the wallet that repeats it', () => {
  const proposal: DuplicateProposal = {
    coin: 'ETH',
    direction: 'in',
    transaction: {
      addressId: id(61),
      txid: txid(81),
      version: 0,
      accountId: id(71),
      accountName: 'Trust Wallet',
      wallet: { network: 'ethereum', address: `0x${'1'.repeat(40)}`, label: 'Main' },
      occurredAt: '2026-10-01T10:20:00.000Z',
      quantity: '0.4',
    },
    record: {
      kind: 'trade',
      id: id(95),
      version: 2,
      type: 'buy',
      quantity: '0.4',
      valueUsd: '1200',
      occurredAt: '2026-10-01T10:00:00.000Z',
    },
    classification: { type: 'buy', currency: 'USD', amount: '1200' },
    comment: 'first purchase',
  };
  const found = (proposals: DuplicateProposal[]) => ({
    windowHours: 48,
    amountPercent: 1,
    proposals,
  });

  it("CLS-DUPLICATE: lists both records and replaces yours with the wallet's in one tap", async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    vi.spyOn(operationsApi, 'duplicateProposals')
      .mockResolvedValueOnce(found([proposal]))
      .mockResolvedValue(found([]));
    const classify = vi.spyOn(operationsApi, 'classify').mockResolvedValue();
    renderPage();
    const card = await screen.findByRole('region', { name: 'One possible duplicate' });
    expect(card).toHaveTextContent('0.4 ETH in Trust Wallet');
    expect(card).toHaveTextContent(
      'You added: Buy 0.4 ETH worth $1,200.00, Oct 1, 2026, 10:00 UTC',
    );
    expect(card).toHaveTextContent('Main received 0.4 ETH, Oct 1, 2026, 10:20 UTC');
    expect(card).toHaveTextContent('within 48 hours');
    await user.click(within(card).getByRole('button', { name: "Replace with the wallet's" }));
    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify).toHaveBeenCalledWith(
      { id: proposal.transaction.addressId },
      proposal.transaction.txid,
      expect.objectContaining({
        expectedVersion: 0,
        hidden: false,
        classification: proposal.classification,
        comment: 'first purchase',
        replaces: { kind: 'trade', id: proposal.record.id, version: 2 },
      }),
    );
    expect(
      await screen.findByText(/Replaced your record with the wallet's: 0.4 ETH/),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /possible duplicate/ })).toBeNull(),
    );
  });

  it('says why it could not be replaced and keeps the offer', async () => {
    const user = userEvent.setup();
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    vi.spyOn(operationsApi, 'duplicateProposals').mockResolvedValue(found([proposal]));
    vi.spyOn(operationsApi, 'classify').mockRejectedValue(
      new AxiosError('Conflict', '409', undefined, undefined, {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { message: 'That record changed; reload and try again' },
      }),
    );
    renderPage();
    const card = await screen.findByRole('region', { name: 'One possible duplicate' });
    await user.click(within(card).getByRole('button', { name: "Replace with the wallet's" }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'This cannot be replaced: that record changed; reload and try again.',
    );
    expect(within(card).getByRole('button', { name: "Replace with the wallet's" })).toBeEnabled();
  });

  it('a sent coin reads as sent, and a record without a value leaves out its worth', async () => {
    vi.spyOn(operationsApi, 'list').mockResolvedValue(all);
    vi.spyOn(operationsApi, 'duplicateProposals').mockResolvedValue(
      found([
        {
          ...proposal,
          direction: 'out',
          record: { ...proposal.record, type: 'sell', valueUsd: null },
        },
      ]),
    );
    renderPage();
    const card = await screen.findByRole('region', { name: 'One possible duplicate' });
    expect(card).toHaveTextContent('You added: Sell 0.4 ETH, Oct 1, 2026, 10:00 UTC');
    expect(card).toHaveTextContent('Main sent 0.4 ETH');
  });
});
