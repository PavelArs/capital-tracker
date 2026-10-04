import { accountingApi, type Instrument } from '@api/accounting.api';
import type { CsvDocument } from '@api/csv-imports.api';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsvMapping, type CsvMappingDraft, emptyCsvMapping } from './CsvMapping';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const first: Instrument = {
  id: '00000000-0000-4000-8000-000000001050',
  namespace: 'manual',
  name: 'Первый актив',
  symbol: 'SAME',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const target: Instrument = {
  ...first,
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  name: 'Другой актив',
};
const document: CsvDocument = {
  batchId: '11111111-1111-4111-8111-111111111111',
  valid: true,
  headers: ['instrument', 'quantity'],
  rows: [{ ordinal: 1, startLine: 2, cells: ['TOKEN', '0.000000000000000001'] }],
  error: null,
};
const initialDraft: CsvMappingDraft = {
  ...emptyCsvMapping(),
  columns: { ...emptyCsvMapping().columns, instrument: '0', quantity: '1' },
  instruments: [{ source: 'TOKEN', instrumentId: first.id }],
};

function Mapping({
  instruments = [first],
  hasMore = true,
  loading = false,
  error = null,
  onLoadMore = vi.fn(),
}: {
  instruments?: Instrument[];
  hasMore?: boolean;
  loading?: boolean;
  error?: string | null;
  onLoadMore?: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return (
    <CsvMapping
      {...{
        document,
        draft,
        onChange: setDraft,
        instruments,
        disabled: false,
        instrumentCatalog: { hasMore, loading, error, onLoadMore },
      }}
    />
  );
}

describe('CSV-PAGE instrument catalog controls', () => {
  it('CSV-PAGE-001-A delegates first load-more and renders the exact new UUID from its parent', () => {
    const read = vi
      .spyOn(accountingApi, 'listInstruments')
      .mockResolvedValue({ items: [], nextCursor: null });
    const onLoadMore = vi.fn();
    const view = render(<Mapping onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё инструменты для CSV' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    view.rerender(
      <Mapping instruments={[first, target]} hasMore={false} onLoadMore={onLoadMore} />,
    );
    const picker = screen.getByRole('combobox', { name: 'Инструмент для TOKEN' });
    expect(picker.querySelectorAll('option')).toHaveLength(3);
    fireEvent.change(picker, { target: { value: target.id } });
    expect(picker).toHaveValue(target.id);
  });

  it('CSV-PAGE-001-B hides load-more after authoritative exhaustion', () => {
    render(<Mapping hasMore={false} />);
    expect(
      screen.queryByRole('button', { name: 'Загрузить ещё инструменты для CSV' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Инструмент для TOKEN' })).toHaveValue(first.id);
  });

  it('CSV-PAGE-002-A retains the same mapped controls during loading, error and explicit retry', () => {
    const onLoadMore = vi.fn();
    const view = render(<Mapping onLoadMore={onLoadMore} />);
    const picker = screen.getByRole('combobox', { name: 'Инструмент для TOKEN' });
    const quantity = screen.getByRole('combobox', { name: 'Колонка: Количество' });
    view.rerender(<Mapping loading onLoadMore={onLoadMore} />);
    const pending = screen.getByRole('button', { name: 'Загрузка инструментов…' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(onLoadMore).not.toHaveBeenCalled();
    view.rerender(<Mapping error="Не удалось загрузить инструменты." onLoadMore={onLoadMore} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить инструменты.');
    expect(screen.getByRole('combobox', { name: 'Инструмент для TOKEN' })).toBe(picker);
    expect(picker).toHaveValue(first.id);
    expect(quantity).toHaveValue('1');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё инструменты для CSV' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('CSV-PAGE-002-B exposes explicit retry when the initial catalog failed', () => {
    const onLoadMore = vi.fn();
    render(
      <Mapping
        instruments={[]}
        hasMore={false}
        error="Не удалось загрузить инструменты."
        onLoadMore={onLoadMore}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Повторить загрузку инструментов для CSV' }),
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: 'Колонка: Количество' })).toHaveValue('1');
  });
});
