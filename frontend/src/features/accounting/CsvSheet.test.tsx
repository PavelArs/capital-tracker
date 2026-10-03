import type { Instrument } from '@api/accounting.api';
import type { CsvDocument, CsvReconciliation } from '@api/csv-imports.api';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsvMapping, type CsvMappingDraft, csvSettings, emptyCsvMapping } from './CsvMapping';
import { CsvReconciliationView, sheetReferenceColumns } from './CsvReconciliation';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const btc: Instrument = {
  id: '00000000-0000-4000-8000-000000000b7c',
  namespace: 'manual',
  name: 'Bitcoin',
  symbol: 'BTC',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const headers = [
  'Дата',
  'Купил',
  'Количество',
  'Купил за',
  'За количество',
  'в USD',
  'Курс',
  'Текущий курс',
  'Текущая стоимость',
  'Разница',
  'Доход',
];
const sample = [
  '13.06.2025',
  'BTC',
  '0,00918359',
  'USDT',
  '1000',
  '1000',
  '108889,8786',
  '84945',
  '780,1000526',
  '-219,8999475',
  '-21,99%',
];
const sheet: CsvDocument = {
  batchId: '11111111-1111-4111-8111-111111111111',
  valid: true,
  headers,
  rows: [{ ordinal: 1, startLine: 2, cells: sample }],
  error: null,
};

let latest: CsvMappingDraft = emptyCsvMapping();
function Mapping() {
  const [draft, setDraft] = useState(emptyCsvMapping());
  latest = draft;
  return (
    <CsvMapping
      document={sheet}
      draft={draft}
      onChange={setDraft}
      instruments={[btc]}
      instrumentCatalog={{ hasMore: false, loading: false, error: null, onLoadMore: vi.fn() }}
      disabled={false}
    />
  );
}

describe('SHEET-4 purchase-sheet mapping', () => {
  it('SHEET-UI preset fills the owner layout but leaves instruments and the USD attestation explicit', () => {
    render(<Mapping />);
    fireEvent.click(screen.getByRole('button', { name: 'Заполнить по таблице покупок' }));
    expect(screen.getByRole('combobox', { name: 'Колонка: Дата сделки' })).toHaveValue('0');
    expect(screen.getByRole('combobox', { name: 'Колонка: Инструмент' })).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: 'Колонка: Количество' })).toHaveValue('2');
    expect(screen.getByRole('combobox', { name: 'Колонка: Валовая сумма USD' })).toHaveValue('5');
    for (const name of ['Тип сделки', 'Комиссия USD', 'Порядок в одну дату', 'Валюта'])
      expect(screen.getByRole('combobox', { name: `Колонка: ${name}` })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Десятичный разделитель' })).toHaveValue(',');
    expect(screen.getByRole('combobox', { name: 'Формат времени' })).toHaveValue(
      'day-month-year-utc',
    );
    expect(screen.getByRole('checkbox', { name: 'Все строки — покупки' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Комиссия уже включена в сумму в USD' }),
    ).toBeChecked();
    const attestation = screen.getByRole('checkbox', {
      name: 'Валовые суммы и комиссии выражены в USD',
    });
    expect(attestation).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Инструмент для BTC' })).toHaveValue('');
    expect(() => csvSettings(latest, sheet, '\t')).toThrow();

    fireEvent.change(screen.getByRole('combobox', { name: 'Инструмент для BTC' }), {
      target: { value: btc.id },
    });
    fireEvent.click(attestation);
    expect(csvSettings(latest, sheet, '\t')).toEqual({
      format: { delimiter: '\t', decimalSeparator: ',', timestampMode: 'day-month-year-utc' },
      mapping: {
        columns: { instrument: 1, occurredAt: 0, quantity: 2, grossUsd: 5 },
        instruments: [{ source: 'BTC', instrumentId: btc.id }],
        sides: [],
        allRowsSide: 'buy',
      },
      assertUsd: true,
      feeIncludedInGross: true,
    });
  });

  it('SHEET-EXPLICIT requires the visible statements for omitted side, fee and order', () => {
    const base: CsvMappingDraft = {
      ...emptyCsvMapping(),
      columns: {
        ...emptyCsvMapping().columns,
        occurredAt: '0',
        instrument: '1',
        quantity: '2',
        grossUsd: '5',
      },
      instruments: [{ source: 'BTC', instrumentId: btc.id }],
      decimalSeparator: ',',
      timestampMode: 'day-month-year-utc',
      allRowsBuy: true,
      feeIncluded: true,
      assertUsd: true,
    };
    expect(() => csvSettings(base, sheet, '\t')).not.toThrow();
    expect(() => csvSettings({ ...base, allRowsBuy: false }, sheet, '\t')).toThrow(
      'Выберите колонку типа сделки или отметьте, что все строки — покупки.',
    );
    expect(() => csvSettings({ ...base, feeIncluded: false }, sheet, '\t')).toThrow(
      'Выберите колонку комиссии или отметьте, что комиссия включена в сумму.',
    );
    expect(() => csvSettings({ ...base, timestampMode: 'offset' }, sheet, '\t')).toThrow(
      'Колонку порядка можно не выбирать только для дат без времени.',
    );
  });
});

describe('SHEET-4 reconciliation view', () => {
  it('prefills reference columns from the owner headers', () => {
    expect(sheetReferenceColumns(headers)).toEqual({
      usdAmount: '5',
      rate: '6',
      currentRate: '7',
      currentValue: '8',
      difference: '9',
      returnPercent: '10',
    });
    expect(sheetReferenceColumns(['a', 'b'])).toEqual({
      usdAmount: '',
      rate: '',
      currentRate: '',
      currentValue: '',
      difference: '',
      returnPercent: '',
    });
  });

  it('SHEET-UI shows sheet and app values with a result per cell and the totals', () => {
    const value: CsvReconciliation = {
      batchId: sheet.batchId,
      batchState: 'committed',
      columns: { usdAmount: 5, rate: 6, currentRate: 7, returnPercent: 10 },
      rows: [
        {
          ordinal: 1,
          startLine: 2,
          tradeId: '22222222-2222-4222-8222-222222222222',
          status: 'imported',
          instrumentId: btc.id,
          occurredAt: '2025-06-13T00:00:00.000Z',
          quantity: '0.00918359',
          costUsd: '1000',
          checks: [
            { field: 'usdAmount', sheet: '1000', app: '1000', result: 'match' },
            { field: 'rate', sheet: '108889,8786', app: '108889.8786', result: 'match' },
            { field: 'returnPercent', sheet: '#DIV/0!', app: '-21.99', result: 'unreadable' },
          ],
          latestPrice: { priceUsd: '84945', observedAt: '2025-10-01T00:00:00.000Z' },
          valueUsd: '780.10005255',
          unrealizedPnlUsd: '-219.89994745',
          unrealizedReturnPercent: '-21.99',
        },
      ],
      totals: {
        matchCount: 2,
        mismatchCount: 0,
        unreadableCount: 1,
        unavailableCount: 0,
        costUsd: '1000',
        unrealizedPnlUsd: '-219.89994745',
      },
    };
    render(<CsvReconciliationView value={value} instruments={[btc]} />);
    const table = screen.getByRole('table', { name: 'Сверка строк с таблицей' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('13.06.2025');
    expect(row).toHaveTextContent('Bitcoin (BTC)');
    expect(row).toHaveTextContent('0.00918359');
    expect(row).toHaveTextContent('Курс: 108889,8786 / 108889.8786 — совпадает');
    expect(row).toHaveTextContent('Доход, %: #DIV/0! / -21.99 — не читается');
    expect(row).toHaveTextContent('84945 на 01.10.2025');
    expect(row).toHaveTextContent('-219.89994745');
    expect(screen.getByText(/Совпадает: 2 · расходится: 0 · не читается: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Себестоимость всего: 1000 USD/)).toBeInTheDocument();
  });
});
