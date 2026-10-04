import type { Instrument } from '@api/accounting.api';
import { type JournalState, type TradeReceipt, tradesApi } from '@api/trades.api';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TradeDraft, TradeForm } from './TradeForm';
import { TradeJournal } from './TradeJournal';

vi.mock('./TradeResults', () => ({ TradeResults: () => null }));
vi.mock('./AccountAnalytics', () => ({ AccountAnalytics: () => null }));
vi.mock('./CsvImports', () => ({ CsvImports: () => null }));
vi.mock('./CarryIn', () => ({ CarryIn: () => null }));
vi.mock('./AssetSwaps', () => ({ AssetSwaps: () => null }));
vi.mock('./AssetRewards', () => ({ AssetRewards: () => null }));

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tradeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const bitcoin: Instrument = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  namespace: 'manual',
  name: 'Bitcoin',
  symbol: 'BTC',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const state = (journalRevision: number): JournalState => ({
  accountId,
  eligible: false,
  ineligibilityReason: 'already-initialized',
  journal: {
    accountId,
    requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    originKind: 'declared-empty',
    coverageFrom: '2025-06-01T00:00:00.000Z',
    createdAt: '2025-06-01T00:00:00.000Z',
    journalRevision,
    activeTradeCount: journalRevision,
    versionCount: journalRevision,
    limits: { activeTrades: 1000, versions: 10000 },
    summary: {
      grossBuysUsd: '0',
      buyFeesUsd: '0',
      grossSalesUsd: '0',
      sellFeesUsd: '0',
      netSalesUsd: '0',
      consumedCostUsd: '0',
      realizedUsd: '0',
      remainingCostUsd: '0',
    },
  },
});
const receipt = (orderWithinTimestamp: number): TradeReceipt => ({
  accountId,
  journalRevision: orderWithinTimestamp + 1,
  trade: {
    tradeId,
    version: 1,
    journalRevision: orderWithinTimestamp + 1,
    requestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    kind: 'create',
    createdAt: '2026-10-04T10:00:00.000Z',
    instrumentId: bitcoin.id,
    instrumentName: bitcoin.name,
    instrumentSymbol: 'BTC',
    side: 'buy',
    occurredAt: '2025-06-13T00:00:00.000Z',
    orderWithinTimestamp,
    quantity: '0.01',
    grossUsd: '1170',
    feeUsd: '0',
  },
});

afterEach(() => vi.restoreAllMocks());

function journal() {
  render(
    <TradeJournal
      accountId={accountId}
      instruments={[bitcoin]}
      instrumentCatalog={{ hasMore: false, loading: false, error: null, onLoadMore: vi.fn() }}
      openingBusy={false}
      onEligibility={vi.fn()}
      section="operations"
      onSectionChange={vi.fn()}
      openingDetails={null}
    />,
  );
}

async function enterPurchase() {
  const form = await screen.findByRole('group', { name: 'Сделка в USD' });
  fireEvent.change(within(form).getByRole('combobox', { name: 'Инструмент' }), {
    target: { value: bitcoin.id },
  });
  fireEvent.change(within(form).getByLabelText('Дата сделки'), {
    target: { value: '2025-06-13' },
  });
  fireEvent.change(within(form).getByLabelText('Количество'), { target: { value: '0.01' } });
  fireEvent.change(within(form).getByLabelText('Сумма сделки, USD'), {
    target: { value: '1170' },
  });
  fireEvent.change(within(form).getByLabelText('Комиссия, USD'), { target: { value: '' } });
  return form;
}

describe('WORKBENCH-001-B plain same-day purchases', () => {
  it('saves two date-only purchases without an order and confirms them in words', async () => {
    vi.spyOn(tradesApi, 'state')
      .mockResolvedValueOnce(state(0))
      .mockResolvedValueOnce(state(1))
      .mockResolvedValueOnce(state(2));
    const create = vi
      .spyOn(tradesApi, 'create')
      .mockResolvedValueOnce(receipt(0))
      .mockResolvedValueOnce(receipt(1));
    journal();
    const form = await enterPurchase();
    expect(within(form).getByText('Порядок в один момент: авто')).toBeInTheDocument();
    expect(within(form).getByLabelText('Сумма сделки, USD')).toHaveAccessibleDescription(
      /заплатили/,
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить сделку' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const first = create.mock.calls[0][1];
    expect(first).not.toHaveProperty('orderWithinTimestamp');
    expect(first).toMatchObject({
      instrumentId: bitcoin.id,
      side: 'buy',
      occurredAt: '2025-06-13T00:00:00.000Z',
      quantity: '0.01',
      grossUsd: '1170',
      feeUsd: '0',
      expectedJournalRevision: 0,
    });
    expect(
      await screen.findByText(
        'Сделка сохранена: покупка 0.01 BTC на 1170 USD, 13.06.2025. Актуальные итоги показаны в журнале ниже.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(tradeId))).toBeNull();

    await waitFor(() =>
      expect(within(form).getByRole('button', { name: 'Сохранить сделку' })).toBeEnabled(),
    );
    await enterPurchase();
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить сделку' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1]).not.toHaveProperty('orderWithinTimestamp');
    expect(create.mock.calls[1][1]).toMatchObject({ expectedJournalRevision: 1, feeUsd: '0' });
  });
});

function draft(value: Partial<TradeDraft> = {}): TradeDraft {
  return {
    instrumentId: bitcoin.id,
    side: 'buy',
    occurredAt: '2025-06-13T00:00:00.000Z',
    orderWithinTimestamp: '',
    quantity: '0.01',
    grossUsd: '1170',
    feeUsd: '0',
    ...value,
  };
}

function form(value: TradeDraft, extra: { lockedFields?: ('quantity' | 'occurredAt')[] } = {}) {
  render(
    <TradeForm
      draft={value}
      onChange={vi.fn()}
      onSubmit={(event) => event.preventDefault()}
      instruments={[bitcoin]}
      selected={null}
      disabled={false}
      lockDraft={false}
      correction={false}
      onCancel={vi.fn()}
      cancelDisabled={false}
      {...extra}
    />,
  );
}

describe('WORKBENCH-001 plain wording and optional fields', () => {
  it('explains the amount as received for a sale', () => {
    form(draft({ side: 'sell' }));
    expect(screen.getByLabelText('Сумма сделки, USD')).toHaveAccessibleDescription(/получили/);
    expect(screen.getByLabelText('Комиссия, USD')).not.toBeRequired();
    expect(screen.getByLabelText('Порядок в этот момент')).not.toBeRequired();
    expect(screen.getByRole('heading', { name: 'Что и когда' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Сколько' })).toBeInTheDocument();
  });

  it('shows an explicit order in the disclosure summary', () => {
    form(draft({ orderWithinTimestamp: '2' }));
    expect(screen.getByText('Порядок в один момент: 2')).toBeInTheDocument();
    expect(screen.getByText('Порядок в один момент: 2').closest('details')).not.toHaveAttribute(
      'open',
    );
  });

  it('reveals an order the journal would refuse', () => {
    form(draft({ orderWithinTimestamp: '1.5' }));
    expect(screen.getByLabelText('Порядок в этот момент').closest('details')).toHaveAttribute(
      'open',
    );
  });

  it('keeps chosen fields of a prefilled draft read-only', () => {
    form(draft(), { lockedFields: ['quantity', 'occurredAt'] });
    expect(screen.getByLabelText('Количество')).toBeDisabled();
    expect(screen.getByLabelText('Дата сделки')).toBeDisabled();
    expect(screen.getByLabelText('Сумма сделки, USD')).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Инструмент' })).toBeEnabled();
  });
});
