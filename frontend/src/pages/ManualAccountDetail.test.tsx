import { accountingApi, type Instrument } from '@api/accounting.api';
import { CsvMapping, emptyCsvMapping } from '@features/accounting/CsvMapping';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ManualAccountDetail from './ManualAccountDetail';

vi.mock('@features/accounting/TradeJournal', () => ({
  TradeJournal: (props: {
    instruments: Instrument[];
    instrumentCatalog: {
      hasMore: boolean;
      loading: boolean;
      error: string | null;
      onLoadMore: () => void;
    };
  }) => (
    <CsvMapping
      {...{
        document: {
          batchId: '11111111-1111-4111-8111-111111111111',
          valid: true as const,
          headers: ['instrument'],
          rows: [{ ordinal: 1, startLine: 2, cells: ['TOKEN'] }],
          error: null,
        },
        draft: { ...emptyCsvMapping(), columns: { ...emptyCsvMapping().columns, instrument: '0' } },
        onChange: vi.fn(),
        disabled: false,
        ...props,
      }}
    />
  ),
}));

const cursor = '00000000-0000-4000-8000-000000001050';
const firstPage: Instrument[] = Array.from({ length: 50 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(1001 + index).padStart(12, '0')}`,
  namespace: 'manual',
  name: `Инструмент ${index + 1}`,
  symbol: 'SAME',
  createdAt: '2025-01-01T00:00:00.000Z',
}));
const target = {
  ...firstPage[0],
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  name: 'Точный целевой актив',
};

beforeEach(() => {
  vi.spyOn(accountingApi, 'getAccount').mockResolvedValue({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Ручной счет',
    currentRevision: 0,
    currentOpening: null,
    createdAt: '2025-01-01T00:00:00.000Z',
  });
  vi.spyOn(accountingApi, 'listOpenings').mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function showAccount() {
  render(
    <MemoryRouter initialEntries={['/manual-accounts/22222222-2222-4222-8222-222222222222']}>
      <Routes>
        <Route path="/manual-accounts/:id" element={<ManualAccountDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

it('CSV-PAGE-001-A first delegated click requests the existing cursor and adds the exact later UUID', async () => {
  const list = vi
    .spyOn(accountingApi, 'listInstruments')
    .mockResolvedValueOnce({ items: firstPage, nextCursor: cursor })
    .mockResolvedValueOnce({ items: [target], nextCursor: null });
  showAccount();
  const more = await screen.findByRole('button', { name: 'Загрузить ещё инструменты для CSV' });
  expect(
    screen.getByRole('combobox', { name: 'Инструмент для TOKEN' }).querySelectorAll('option'),
  ).toHaveLength(51);
  fireEvent.click(more);
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(cursor));
  await waitFor(() =>
    expect(screen.getByRole('option', { name: /Точный целевой актив/ })).toHaveValue(target.id),
  );
  expect(list).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole('button', { name: 'Загрузить ещё инструменты для CSV' }),
  ).not.toBeInTheDocument();
});

it('CSV-PAGE-002-A failed next-page loading retains choices and retries the same cursor', async () => {
  const list = vi
    .spyOn(accountingApi, 'listInstruments')
    .mockResolvedValueOnce({ items: firstPage, nextCursor: cursor })
    .mockRejectedValueOnce(new Error('synthetic catalog unavailable'))
    .mockResolvedValueOnce({ items: [target], nextCursor: null });
  showAccount();
  fireEvent.click(await screen.findByRole('button', { name: 'Загрузить ещё инструменты для CSV' }));
  await screen.findByRole('alert');
  expect(
    screen.getByRole('combobox', { name: 'Инструмент для TOKEN' }).querySelectorAll('option'),
  ).toHaveLength(51);
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё инструменты для CSV' }));
  await waitFor(() => expect(list.mock.calls).toEqual([[undefined], [cursor], [cursor]]));
  await screen.findByRole('option', { name: /Точный целевой актив/ });
});
