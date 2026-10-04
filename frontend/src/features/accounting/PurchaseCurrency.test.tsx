import type { CsvDocument, CsvPreviewResult } from '@api/csv-imports.api';
import { type Journal, type TradeVersion, tradesApi } from '@api/trades.api';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsvMapping, type CsvMappingDraft, csvSettings, emptyCsvMapping } from './CsvMapping';
import { CsvPreview } from './CsvPreview';
import { TradeResults } from './TradeResults';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const instrumentId = '00000000-0000-4000-8000-000000001050';
const document: CsvDocument = {
  batchId: '11111111-1111-4111-8111-111111111111',
  valid: true,
  headers: ['asset', 'side', 'at', 'order', 'quantity', 'gross', 'fee', 'currency', 'rate'],
  rows: [
    {
      ordinal: 1,
      startLine: 2,
      cells: ['BTC', 'buy', '2025-11-21T00:00:00Z', '0', '0.01', '100000', '150', 'RUB', '79.0246'],
    },
  ],
  error: null,
};
function mapped(overrides: Partial<CsvMappingDraft> = {}): CsvMappingDraft {
  const empty = emptyCsvMapping();
  return {
    ...empty,
    columns: {
      ...empty.columns,
      instrument: '0',
      side: '1',
      occurredAt: '2',
      order: '3',
      quantity: '4',
      grossUsd: '5',
      feeUsd: '6',
    },
    instruments: [{ source: 'BTC', instrumentId }],
    sides: [{ source: 'buy', side: 'buy' }],
    assertUsd: true,
    ...overrides,
  };
}

function Mapping({ start = mapped() }: { start?: CsvMappingDraft }) {
  const [draft, setDraft] = useState(start);
  return (
    <>
      <CsvMapping
        document={document}
        draft={draft}
        onChange={setDraft}
        instruments={[]}
        disabled={false}
        instrumentCatalog={{ hasMore: false, loading: false, error: null, onLoadMore: vi.fn() }}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}

describe('PCUR-UI payment currency in CSV mapping', () => {
  it('keeps the default USD labels and attestation unchanged', () => {
    render(<Mapping />);
    expect(screen.getByRole('combobox', { name: 'Валюта оплаты для всего файла' })).toHaveValue(
      'USD',
    );
    expect(screen.getByRole('combobox', { name: 'Колонка: Валовая сумма USD' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Колонка: Комиссия USD' })).toBeVisible();
    expect(
      screen.getByRole('checkbox', { name: 'Валовые суммы и комиссии выражены в USD' }),
    ).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /Курс/ })).not.toBeInTheDocument();
  });

  it('asks for the RUB rate and relabels amounts as payment currency', () => {
    render(<Mapping />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Валюта оплаты для всего файла' }), {
      target: { value: 'RUB' },
    });
    const rate = screen.getByRole('textbox', { name: 'Курс: сколько RUB за 1 USD' });
    fireEvent.change(rate, { target: { value: '79.0246' } });
    expect(
      screen.getByRole('combobox', { name: 'Колонка: Валовая сумма в валюте оплаты' }),
    ).toBeVisible();
    expect(
      screen.getByRole('combobox', { name: 'Колонка: Комиссия в валюте оплаты' }),
    ).toBeVisible();
    expect(
      screen.getByRole('checkbox', {
        name: 'Валовые суммы и комиссии выражены в валюте оплаты',
      }),
    ).toBeVisible();
    expect(screen.getByText(/USDT и USDC.*1/)).toBeVisible();
    expect(JSON.parse(screen.getByTestId('draft').textContent ?? '{}')).toMatchObject({
      paymentCurrency: 'RUB',
      perUsd: '79.0246',
    });
  });

  it('takes the currency from a mapped column and disables the file-wide choice', () => {
    render(<Mapping />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Колонка: Валюта' }), {
      target: { value: '7' },
    });
    expect(screen.getByRole('combobox', { name: 'Валюта оплаты для всего файла' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Колонка: Курс к USD' })).toBeVisible();
    expect(
      screen.getByRole('combobox', { name: 'Колонка: Валовая сумма в валюте оплаты' }),
    ).toBeVisible();
  });
});

describe('PCUR-UI settings sent to the server', () => {
  it('sends file-wide RUB with its rate', () => {
    expect(
      csvSettings(mapped({ paymentCurrency: 'RUB', perUsd: '79.0246' }), document, ';'),
    ).toMatchObject({ payment: { currency: 'RUB', perUsd: '79.0246' }, assertUsd: true });
  });
  it('requires a rate for RUB but not for USDT', () => {
    expect(() => csvSettings(mapped({ paymentCurrency: 'RUB' }), document, ';')).toThrow(
      'Укажите курс RUB за 1 USD или сопоставьте колонку курса.',
    );
    const usdt = csvSettings(mapped({ paymentCurrency: 'USDT' }), document, ';');
    expect(usdt.payment).toEqual({ currency: 'USDT' });
  });
  it('omits payment for the default USD and maps currency/rate columns', () => {
    expect(csvSettings(mapped(), document, ';')).not.toHaveProperty('payment');
    const columns = mapped();
    columns.columns = { ...columns.columns, currency: '7', rate: '8' };
    const settings = csvSettings(columns, document, ';');
    expect(settings).not.toHaveProperty('payment');
    expect(settings.mapping.columns).toMatchObject({ currency: 7, rate: 8 });
  });
});

const payment = { currency: 'RUB', gross: '100000', fee: '150', perUsd: '79.0246' };
const paidText = 'Оплачено 100000 RUB, комиссия 150 RUB, курс 79.0246 RUB за 1 USD';

describe('PCUR-UI paid amount next to USD', () => {
  it('shows the payment in the CSV preview row', () => {
    const value: CsvPreviewResult = {
      batchId: document.batchId,
      parserVersion: 'usd-csv-v1',
      journalRevision: 0,
      canConfirm: true,
      rows: [
        {
          ordinal: 1,
          startLine: 2,
          execution: {
            instrumentId,
            side: 'buy',
            occurredAt: '2025-11-21T00:00:00.000Z',
            orderWithinTimestamp: 0,
            quantity: '0.01',
            grossUsd: '1265.42873991',
            feeUsd: '1.89814311',
          },
          payment,
        },
      ],
      ignoredColumns: [],
      rowErrors: [],
      batchErrors: [],
      summaryBefore: {
        grossBuysUsd: '0',
        buyFeesUsd: '0',
        grossSalesUsd: '0',
        sellFeesUsd: '0',
        netSalesUsd: '0',
        consumedCostUsd: '0',
        realizedUsd: '0',
        remainingCostUsd: '0',
      },
      candidateSummary: null,
      previewHash: null,
    };
    render(<CsvPreview value={value} />);
    const table = screen.getByRole('table', { name: 'Сделки перед импортом' });
    const row = within(table).getByRole('row', { name: /1265\.42873991/ });
    expect(row).toHaveTextContent(paidText);
  });

  it('shows the payment in the journal trade row', async () => {
    const trade: TradeVersion = {
      tradeId: 'trade-rub',
      version: 1,
      journalRevision: 1,
      requestId: 'request',
      kind: 'create',
      createdAt: '2026-10-04T00:00:00.000Z',
      instrumentId,
      instrumentName: 'Bitcoin',
      instrumentSymbol: 'BTC',
      side: 'buy',
      occurredAt: '2025-11-21T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '0.01',
      grossUsd: '1265.42873991',
      feeUsd: '1.89814311',
      payment,
    };
    vi.spyOn(tradesApi, 'trades').mockResolvedValue({
      journalRevision: 1,
      items: [trade],
      nextOffset: null,
    });
    vi.spyOn(tradesApi, 'lots').mockResolvedValue({
      journalRevision: 1,
      items: [],
      nextOffset: null,
    });
    vi.spyOn(tradesApi, 'realizations').mockResolvedValue({
      journalRevision: 1,
      items: [],
      nextOffset: null,
    });
    const journal = {
      accountId: 'account',
      requestId: 'origin',
      originKind: 'declared-empty',
      coverageFrom: '2025-01-01T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
      journalRevision: 1,
      activeTradeCount: 1,
      versionCount: 1,
      limits: { activeTrades: 1000, versions: 10000 },
      summary: {
        grossBuysUsd: '1265.42873991',
        buyFeesUsd: '1.89814311',
        grossSalesUsd: '0',
        sellFeesUsd: '0',
        netSalesUsd: '0',
        consumedCostUsd: '0',
        realizedUsd: '0',
        remainingCostUsd: '1267.32688302',
      },
    } satisfies Journal;
    render(
      <TradeResults
        accountId="account"
        journal={journal}
        disabled={false}
        mutationDisabled={false}
        onCorrect={vi.fn()}
        onVoid={vi.fn()}
        onStale={vi.fn()}
      />,
    );
    const table = screen.getByRole('table', { name: 'Сделки журнала' });
    const row = await within(table).findByRole('row', { name: /trade-rub/ });
    expect(row).toHaveTextContent('1265.42873991');
    expect(row).toHaveTextContent(paidText);
  });
});
