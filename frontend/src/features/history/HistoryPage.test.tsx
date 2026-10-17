import {
  type AuditEvent,
  type AuditHistory,
  type AuditValue,
  auditHistoryApi,
} from '@api/audit-history.api';
import { forgetReads } from '@api/read-cache';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import HistoryPage from './HistoryPage';

// Synthetic accounts, assets and amounts only.
const usd = (value: string): AuditValue => ({ kind: 'usd', value, unit: null });
const btc = (value: string): AuditValue => ({ kind: 'quantity', value, unit: 'BTC' });
const text = (value: string): AuditValue => ({ kind: 'text', value, unit: null });

const correction: AuditEvent = {
  id: 'trade:t1:000002',
  at: '2026-10-09T12:30:00.000Z',
  entity: 'trade',
  entityId: 't1',
  version: 2,
  change: 'changed',
  actor: 'owner',
  title: 'Buy BTC',
  asset: 'BTC',
  account: 'Bybit',
  occurredAt: '2026-10-01T00:00:00.000Z',
  fields: [
    { label: 'Amount', before: usd('30000'), after: usd('31000') },
    { label: 'Comment', before: null, after: text('Fixed the price') },
  ],
};
const removal: AuditEvent = {
  id: 'trade:t2:000002',
  at: '2026-10-09T09:15:00.000Z',
  entity: 'trade',
  entityId: 't2',
  version: 2,
  change: 'deleted',
  actor: 'owner',
  title: 'Sell BTC',
  asset: 'BTC',
  account: 'Bybit',
  occurredAt: '2026-09-20T00:00:00.000Z',
  fields: [
    { label: 'Quantity', before: btc('0.25'), after: null },
    { label: 'Amount', before: usd('15000'), after: null },
  ],
};
const imported: AuditEvent = {
  id: 'trade:t3:000001',
  at: '2026-10-08T18:00:00.000Z',
  entity: 'trade',
  entityId: 't3',
  version: 1,
  change: 'created',
  actor: 'csv',
  title: 'Buy BTC',
  asset: 'BTC',
  account: 'Bybit',
  occurredAt: '2026-06-14T10:30:00.000Z',
  fields: [
    { label: 'Side', before: null, after: text('Buy') },
    { label: 'Quantity', before: null, after: btc('0.02') },
    { label: 'Amount', before: null, after: usd('2100') },
  ],
};
const linked: AuditEvent = {
  id: 'transfer:x1:000001',
  at: '2026-10-07T08:00:00.000Z',
  entity: 'transfer',
  entityId: 'x1',
  version: 1,
  change: 'created',
  actor: 'automatic',
  title: 'Transfer BTC',
  asset: 'BTC',
  account: 'Cold storage',
  occurredAt: '2026-10-06T00:00:00.000Z',
  fields: [{ label: 'Quantity', before: null, after: btc('0.005') }],
};
const quiet: AuditEvent = {
  ...linked,
  id: 'classification:w1:000002',
  entity: 'classification',
  change: 'changed',
  title: 'Incoming BTC',
  account: null,
  fields: [],
};

const rub = (value: string): AuditValue => ({ kind: 'quantity', value, unit: 'RUB' });
const topup: AuditEvent = {
  id: 'deposit:d1:000002',
  at: '2026-10-09T10:10:00.000Z',
  entity: 'deposit',
  entityId: 'd1',
  version: 2,
  change: 'changed',
  actor: 'owner',
  title: 'Savings account',
  asset: null,
  account: 'Example Bank',
  occurredAt: '2026-10-09T00:00:00.000Z',
  fields: [
    { label: 'Action', before: null, after: text('Top-up added') },
    { label: 'Amount', before: null, after: rub('5000.5') },
    { label: 'Date', before: null, after: text('2026-10-09') },
  ],
};

const page = (events: AuditEvent[], next: string | null = null): AuditHistory => ({
  at: '2026-10-09T20:00:00.000Z',
  events,
  next,
});

function Address() {
  const { search } = useLocation();
  return <output aria-label="Address">{search}</output>;
}
function renderPage(path = '/history') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HistoryPage />
      <Address />
    </MemoryRouter>,
  );
}
const table = () => screen.getByRole('table', { name: 'Changes' });
const bodyRows = () =>
  within(table())
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('cell').length > 0);
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('audit history screen (BR 14)', () => {
  it('HIST-LIST: lists each stored version newest first under its day, with what changed', async () => {
    vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(
      page([correction, removal, imported, linked]),
    );
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
    expect(
      within(table())
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Today', 'Yesterday', 'Oct 7, 2026']);
    expect(bodyRows().map(cells)).toEqual([
      // Moscow times (UTC+3): 12:30, 09:15, 18:00 and 08:00 UTC; the days are the same.
      ['15:30', 'Changed', 'Buy BTCBybit', 'Amount: $30,000.00 → $31,000.00 +1 more', 'You'],
      ['12:15', 'Deleted', 'Sell BTCBybit', 'Quantity 0.25 BTC · Amount $15,000.00', 'You'],
      ['21:00', 'Created', 'Buy BTCBybit', 'Side Buy · Quantity 0.02 BTC', 'CSV import'],
      ['11:00', 'Created', 'Transfer BTCCold storage', 'Quantity 0.005 BTC', 'Automatic'],
    ]);
    expect(screen.getByText(/4 changes shown, newest first/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is overwritten/)).toBeInTheDocument();
  });

  it('HIST-MSK-DAY: groups the changes by Moscow day and shows Moscow times, also between 21:00 and 24:00 UTC', async () => {
    const late = { ...correction, id: 'trade:t1:000003', at: '2026-10-16T21:14:00.000Z' };
    const before = { ...removal, id: 'trade:t2:000002', at: '2026-10-16T20:52:00.000Z' };
    vi.spyOn(auditHistoryApi, 'list').mockResolvedValue({
      ...page([late, before]),
      at: '2026-10-16T21:20:00.000Z',
    });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'History' });
    // 21:14 UTC is already 17 Oct in Moscow; 20:52 UTC is still 16 Oct there.
    expect(
      within(table())
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Today', 'Yesterday']);
    expect(bodyRows().map((row) => cells(row)[0])).toEqual(['00:14', '23:52']);
    expect(within(table()).getByRole('columnheader', { name: 'Time, MSK' })).toBeInTheDocument();
  });

  it('HIST-NO-SWITCH: shows recorded amounts as recorded, so it offers no currency or value switch', async () => {
    vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([correction]));
    renderPage();
    const heading = await screen.findByRole('heading', { level: 1, name: 'History' });
    // Neither the switch nor the room held for it while the main currency loads.
    expect(heading.closest('header')?.querySelector('.ui-seg')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Currency' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Values' })).toBeNull();
  });

  it('HIST-DRAWER: opening a row shows every value before and after, and Escape closes it', async () => {
    const user = userEvent.setup();
    vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([correction, quiet]));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Buy BTC' }));
    const drawer = screen.getByRole('dialog', { name: 'Buy BTC' });
    expect(within(drawer).getByText('Changed')).toBeInTheDocument();
    const fields = within(drawer).getByRole('region', { name: 'What changed' });
    expect(
      within(fields)
        .getAllByText(/\$|Fixed/)
        .map((node) => node.textContent),
    ).toEqual(['$30,000.00', '$31,000.00', 'Fixed the price']);
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    expect(within(facts).getByText('Version').nextSibling).toHaveTextContent('2');
    expect(within(facts).getByText('Account').nextSibling).toHaveTextContent('Bybit');
    expect(within(facts).getByText('Operation date').nextSibling).toHaveTextContent(
      'Oct 1, 2026, 00:00 UTC',
    );
    expect(within(drawer).getByText(/never overwritten/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // A version that differs in nothing the screen shows says so instead of an empty list.
    await user.click(screen.getByRole('button', { name: 'Incoming BTC' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Incoming BTC' })).getByText(
        /without a visible difference/,
      ),
    ).toBeInTheDocument();
  });

  it('HIST-DEPOSIT: a bank deposit event names its action, amount and bank and opens with its facts', async () => {
    const user = userEvent.setup();
    vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([topup]));
    renderPage();
    await screen.findByRole('button', { name: 'Savings account' });
    expect(bodyRows().map(cells)).toEqual([
      ['13:10', 'Changed', 'Savings accountExample Bank', 'Top-up added · 5,000.5 RUB', 'You'],
    ]);
    await user.click(screen.getByRole('button', { name: 'Savings account' }));
    const drawer = screen.getByRole('dialog', { name: 'Savings account' });
    const fields = within(drawer).getByRole('region', { name: 'What happened' });
    expect(within(fields).getByText('Top-up added')).toBeInTheDocument();
    expect(within(fields).getByText('5,000.5 RUB')).toBeInTheDocument();
    expect(within(fields).getByText('2026-10-09')).toBeInTheDocument();
    const facts = within(drawer).getByRole('region', { name: 'Details' });
    expect(within(facts).getByText('Bank').nextSibling).toHaveTextContent('Example Bank');
    expect(within(facts).queryByText('Operation date')).toBeNull();
  });

  it('HIST-FILTER: chips, selects and dates ask the server and live in the address', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([correction, removal]));
    renderPage();
    await screen.findByRole('table', { name: 'Changes' });
    expect(list).toHaveBeenLastCalledWith({ limit: 20 });
    list.mockResolvedValue(page([removal]));
    await user.click(screen.getByRole('button', { name: 'Deleted' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ change: 'deleted', limit: 20 }));
    expect(screen.getByRole('button', { name: 'Deleted' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    await user.selectOptions(screen.getByLabelText('Type'), 'trade');
    await user.selectOptions(screen.getByLabelText('Source'), 'csv');
    fireDate(screen.getByLabelText('From'), '2026-10-01');
    fireDate(screen.getByLabelText('To'), '2026-10-09');
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        change: 'deleted',
        entity: 'trade',
        actor: 'csv',
        from: '2026-10-01',
        to: '2026-10-09',
        limit: 20,
      }),
    );
    expect(screen.getByLabelText('Address').textContent).toBe(
      '?change=deleted&entity=trade&actor=csv&from=2026-10-01&to=2026-10-09',
    );
    // Nothing matches: say so and offer to clear every filter.
    list.mockResolvedValue(page([]));
    await user.selectOptions(screen.getByLabelText('Type'), 'swap');
    expect(await screen.findByText('No changes match')).toBeInTheDocument();
    list.mockResolvedValue(page([correction]));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ limit: 20 }));
    expect(screen.getByLabelText('Address').textContent).toBe('');
  });

  it('HIST-FILTER: filters in the address are applied on arrival; unknown values are ignored', async () => {
    const list = vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([removal]));
    renderPage('/history?change=deleted&entity=bogus&from=yesterday&actor=automatic');
    await screen.findByRole('table', { name: 'Changes' });
    expect(list).toHaveBeenCalledWith({ change: 'deleted', actor: 'automatic', limit: 20 });
    expect(screen.getByLabelText('Source')).toHaveValue('automatic');
  });

  it('HIST-PAGE: twenty changes first; older ones are asked for with the cursor and join the list', async () => {
    const user = userEvent.setup();
    const list = vi
      .spyOn(auditHistoryApi, 'list')
      .mockResolvedValueOnce(page([correction], 'cursor-1'))
      .mockResolvedValueOnce(page([removal], 'cursor-2'))
      .mockResolvedValueOnce(page([imported]));
    renderPage();
    await screen.findByRole('table', { name: 'Changes' });
    expect(list).toHaveBeenLastCalledWith({ limit: 20 });
    expect(bodyRows()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(list).toHaveBeenLastCalledWith({ limit: 20 }, 'cursor-1');
    expect(screen.getByText('Showing 2 changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    expect(list).toHaveBeenLastCalledWith({ limit: 20 }, 'cursor-2');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(screen.getByText(/3 changes shown/)).toBeInTheDocument();
  });

  it('HIST-PAGE: reaching the end of the list asks for the older changes', async () => {
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    vi.spyOn(auditHistoryApi, 'list')
      .mockResolvedValueOnce(page([correction], 'cursor-1'))
      .mockResolvedValueOnce(page([removal]));
    renderPage();
    await screen.findByRole('table', { name: 'Changes' });
    await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));
    act(() => {
      callbacks.at(-1)?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as never);
    });
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
  });

  it('HIST-PAGE: a failed batch keeps what is shown and offers to try again', async () => {
    const user = userEvent.setup();
    const list = vi
      .spyOn(auditHistoryApi, 'list')
      .mockResolvedValueOnce(page([correction], 'cursor-1'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([removal]));
    renderPage();
    await screen.findByRole('table', { name: 'Changes' });
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load older changes.');
    expect(bodyRows()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('HIST-STATES: loading, failure with a way to retry, and an empty history', async () => {
    const user = userEvent.setup();
    const list = vi
      .spyOn(auditHistoryApi, 'list')
      .mockReturnValueOnce(new Promise(() => {}))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([]));
    const first = renderPage();
    expect(screen.getByRole('status', { name: 'Loading the change history' })).toBeInTheDocument();
    first.unmount();
    // A change by the owner drops the stalled request, so the next visit asks again.
    forgetReads();
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the change history');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing has changed yet')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('HIST-PHONE: below 640 px two-line rows replace the table and open the same drawer', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 639.98px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const list = vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([correction, imported]));
    renderPage();
    const rows = await screen.findByRole('list', { name: 'Changes' });
    expect(screen.queryByRole('table')).toBeNull();
    // The type, source and dates wait in a sheet behind the Filters button.
    expect(screen.queryByLabelText('Source')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    await user.selectOptions(within(sheet).getByLabelText('Source'), 'csv');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ actor: 'csv', limit: 20 }));
    await user.click(within(sheet).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ limit: 20 }));
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      within(rows)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Today', 'Yesterday']);
    const items = within(rows).getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual([
      'Buy BTCAmount: $30,000.00 → $31,000.00 +1 moreChanged15:30 MSK · You',
      'Buy BTCSide Buy · Quantity 0.02 BTCCreated21:00 MSK · CSV import',
    ]);
    await user.click(items[0]);
    expect(screen.getByRole('dialog', { name: 'Buy BTC' })).toBeInTheDocument();
  });
});

// A date input takes one value per event; typing "2026-10-01" is not how a browser fires it.
function fireDate(input: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
