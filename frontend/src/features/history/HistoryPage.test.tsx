import {
  type AuditEvent,
  type AuditHistory,
  type AuditValue,
  auditHistoryApi,
} from '@api/audit-history.api';
import { forgetReads } from '@api/read-cache';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      ['12:30', 'Changed', 'Buy BTCBybit', 'Amount: $30,000.00 → $31,000.00 +1 more', 'You'],
      ['09:15', 'Deleted', 'Sell BTCBybit', 'Quantity 0.25 BTC · Amount $15,000.00', 'You'],
      ['18:00', 'Created', 'Buy BTCBybit', 'Side Buy · Quantity 0.02 BTC', 'CSV import'],
      ['08:00', 'Created', 'Transfer BTCCold storage', 'Quantity 0.005 BTC', 'Automatic'],
    ]);
    expect(screen.getByText(/4 changes shown, newest first/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is overwritten/)).toBeInTheDocument();
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

  it('HIST-FILTER: chips, selects and dates ask the server and live in the address', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([correction, removal]));
    renderPage();
    await screen.findByRole('table', { name: 'Changes' });
    expect(list).toHaveBeenLastCalledWith({});
    list.mockResolvedValue(page([removal]));
    await user.click(screen.getByRole('button', { name: 'Deleted' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ change: 'deleted' }));
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
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({}));
    expect(screen.getByLabelText('Address').textContent).toBe('');
  });

  it('HIST-FILTER: filters in the address are applied on arrival; unknown values are ignored', async () => {
    const list = vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([removal]));
    renderPage('/history?change=deleted&entity=bogus&from=yesterday&actor=automatic');
    await screen.findByRole('table', { name: 'Changes' });
    expect(list).toHaveBeenCalledWith({ change: 'deleted', actor: 'automatic' });
    expect(screen.getByLabelText('Source')).toHaveValue('automatic');
  });

  it('HIST-PAGE: older changes are asked for with the cursor and join the list', async () => {
    const user = userEvent.setup();
    const list = vi
      .spyOn(auditHistoryApi, 'list')
      .mockResolvedValueOnce(page([correction], 'cursor-1'))
      .mockResolvedValueOnce(page([removal]));
    renderPage();
    await screen.findByRole('table', { name: 'Changes' });
    expect(bodyRows()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Show older changes' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(list).toHaveBeenLastCalledWith({}, 'cursor-1');
    expect(screen.queryByRole('button', { name: 'Show older changes' })).toBeNull();
    expect(screen.getByText(/2 changes shown/)).toBeInTheDocument();
  });

  it('HIST-PAGE: a failed page keeps what is shown and offers to try again', async () => {
    const user = userEvent.setup();
    const list = vi
      .spyOn(auditHistoryApi, 'list')
      .mockResolvedValueOnce(page([correction], 'cursor-1'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([removal]));
    renderPage();
    await screen.findByRole('table', { name: 'Changes' });
    await user.click(screen.getByRole('button', { name: 'Show older changes' }));
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
    vi.spyOn(auditHistoryApi, 'list').mockResolvedValue(page([correction, imported]));
    renderPage();
    const rows = await screen.findByRole('list', { name: 'Changes' });
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      within(rows)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Today', 'Yesterday']);
    const items = within(rows).getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual([
      'Buy BTCAmount: $30,000.00 → $31,000.00 +1 moreChanged12:30 · You',
      'Buy BTCSide Buy · Quantity 0.02 BTCCreated18:00 · CSV import',
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
