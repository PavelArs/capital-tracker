import type { Instrument } from '@api/accounting.api';
import { type CsvDetail, csvImportsApi } from '@api/csv-imports.api';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CsvImports } from './CsvImports';

const instrument: Instrument = {
  id: '00000000-0000-4000-8000-000000001050',
  namespace: 'manual',
  name: 'Точный актив',
  symbol: 'SAME',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const summary = {
  grossBuysUsd: '0',
  buyFeesUsd: '0',
  grossSalesUsd: '0',
  sellFeesUsd: '0',
  netSalesUsd: '0',
  consumedCostUsd: '0',
  realizedUsd: '0',
  remainingCostUsd: '0',
};
const detail: CsvDetail = {
  batch: {
    accountId: '22222222-2222-4222-8222-222222222222',
    batchId: '11111111-1111-4111-8111-111111111111',
    filename: 'Сделки.csv',
    state: 'draft',
    sha256: 'a'.repeat(64),
    byteLength: 37,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  acceptedSettings: null,
  confirmReceipt: null,
  rollbackReceipt: null,
  rollbackReview: {
    journalRevision: 0,
    eligible: false,
    reason: 'not-committed',
    removedTradeCount: 0,
    additionalVersionCount: 0,
    summaryBefore: summary,
    summaryAfter: null,
  },
};

beforeEach(() => {
  vi.spyOn(csvImportsApi, 'list').mockResolvedValue({ items: [detail.batch], nextCursor: null });
  vi.spyOn(csvImportsApi, 'detail').mockResolvedValue(detail);
  vi.spyOn(csvImportsApi, 'inspect').mockResolvedValue({
    batchId: detail.batch.batchId,
    valid: true,
    headers: ['instrument', 'quantity'],
    rows: [{ ordinal: 1, startLine: 2, cells: ['TOKEN', '0.000000000000000001'] }],
    error: null,
  });
  vi.spyOn(csvImportsApi, 'upload');
  vi.spyOn(csvImportsApi, 'confirm');
  vi.spyOn(csvImportsApi, 'rollback');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function props(): Parameters<typeof CsvImports>[0] {
  return {
    accountId: detail.batch.accountId,
    journalRevision: 0,
    instruments: [instrument],
    instrumentCatalog: { hasMore: true, loading: false, error: null, onLoadMore: vi.fn() },
    parentBusy: false,
    parentBlocked: false,
    onBlocked: vi.fn(),
    onJournalRefresh: vi.fn().mockResolvedValue(true),
  };
}

it('CSV-PAGE-002-A catalog loading/error/retry preserve the original File and mounted CSV mapping without commands', async () => {
  const initial = props();
  const view = render(<CsvImports {...initial} />);
  const batches = await screen.findByRole('option', { name: /Сделки.csv/ });
  const fileInput = screen.getByLabelText('Файл CSV') as HTMLInputElement;
  const file = new File(['instrument,quantity\nTOKEN,1'], 'Выбранный.csv', { type: 'text/csv' });
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Сохранённая партия CSV' }), {
    target: { value: batches.getAttribute('value') },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Просмотреть исходные строки' }));
  const column = await screen.findByRole('combobox', { name: 'Колонка: Инструмент' });
  fireEvent.change(column, { target: { value: '0' } });
  const mapped = screen.getByRole('combobox', { name: 'Инструмент для TOKEN' });
  fireEvent.change(mapped, { target: { value: instrument.id } });
  for (const state of [
    { loading: true, error: null },
    { loading: false, error: 'Не удалось загрузить инструменты.' },
  ]) {
    view.rerender(
      <CsvImports {...initial} instrumentCatalog={{ ...initial.instrumentCatalog, ...state }} />,
    );
    expect(screen.getByRole('combobox', { name: 'Колонка: Инструмент' })).toBe(column);
    expect(column).toHaveValue('0');
    expect(mapped).toHaveValue(instrument.id);
    expect(screen.getByLabelText('Файл CSV')).toBe(fileInput);
    expect(fileInput.files?.[0]).toBe(file);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё инструменты для CSV' }));
  expect(initial.instrumentCatalog.onLoadMore).toHaveBeenCalledTimes(1);
  expect(csvImportsApi.upload).not.toHaveBeenCalled();
  expect(csvImportsApi.confirm).not.toHaveBeenCalled();
  expect(csvImportsApi.rollback).not.toHaveBeenCalled();
  expect(csvImportsApi.inspect).toHaveBeenCalledTimes(1);
});

it('CSV-PAGE-002-A changing catalog controls preserves a retained receipt and does not retry its command', async () => {
  const receipt = {
    accountId: detail.batch.accountId,
    batchId: detail.batch.batchId,
    requestId: '33333333-3333-4333-8333-333333333333',
    kind: 'confirm' as const,
    rowCount: 1,
    firstJournalRevision: 1,
    lastJournalRevision: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
  vi.mocked(csvImportsApi.detail).mockResolvedValue({
    ...detail,
    batch: { ...detail.batch, state: 'committed' },
    confirmReceipt: receipt,
  });
  const initial = props();
  const view = render(<CsvImports {...initial} />);
  await screen.findByRole('option', { name: /Сделки.csv/ });
  fireEvent.change(screen.getByRole('combobox', { name: 'Сохранённая партия CSV' }), {
    target: { value: detail.batch.batchId },
  });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(receipt.requestId));
  const shown = screen.getByRole('status');
  for (const state of [
    { loading: true, error: null },
    { loading: false, error: 'Не удалось загрузить инструменты.' },
    { loading: false, error: null },
  ]) {
    view.rerender(
      <CsvImports {...initial} instrumentCatalog={{ ...initial.instrumentCatalog, ...state }} />,
    );
    expect(screen.getByRole('status')).toBe(shown);
    expect(shown).toHaveTextContent(receipt.requestId);
  }
  expect(csvImportsApi.detail).toHaveBeenCalledTimes(1);
  expect(csvImportsApi.confirm).not.toHaveBeenCalled();
  expect(csvImportsApi.rollback).not.toHaveBeenCalled();
});
