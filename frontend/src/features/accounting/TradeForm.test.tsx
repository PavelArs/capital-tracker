import type { Instrument } from '@api/accounting.api';
import type { TradeVersion } from '@api/trades.api';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { emptyTradeDraft, TradeForm, tradeCommand, tradeDraft } from './TradeForm';

// Synthetic instrument, dates and amounts only (CUR-PAID-RUB).
const instruments: Instrument[] = [
  {
    id: 'instrument-btc',
    name: 'Bitcoin',
    symbol: 'BTC',
    namespace: 'manual',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
];
const identity = { requestId: 'request-1', expectedJournalRevision: 4 };
const saved: TradeVersion = {
  tradeId: 'trade-1',
  version: 1,
  journalRevision: 1,
  requestId: 'request-0',
  kind: 'create',
  createdAt: '2025-06-03T10:00:00.000Z',
  instrumentId: 'instrument-btc',
  instrumentName: 'Bitcoin',
  instrumentSymbol: 'BTC',
  side: 'buy',
  occurredAt: '2025-06-03T09:00:00.000Z',
  orderWithinTimestamp: 0,
  quantity: '0.01',
  grossUsd: '1265.822784810126582278481012658228',
  feeUsd: '0',
  paid: {
    currency: 'RUB',
    gross: '100000',
    fee: '0',
    rateDate: '2025-06-03',
    perUsd: '79',
    rateSource: 'bank-of-russia',
  },
};

function ControlledForm({ onSubmit }: { onSubmit: (input: unknown) => void }) {
  const [draft, setDraft] = useState(emptyTradeDraft);
  return (
    <TradeForm
      draft={draft}
      onChange={setDraft}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(tradeCommand(draft, identity));
      }}
      instruments={instruments}
      selected={null}
      disabled={false}
      lockDraft={false}
      correction={false}
      onCancel={vi.fn()}
      cancelDisabled={false}
    />
  );
}

describe('CUR-PAID-RUB the trade form takes amounts in the currency paid', () => {
  it('keeps USD amounts by default', async () => {
    const onSubmit = vi.fn();
    render(<ControlledForm onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText('Инструмент'), 'instrument-btc');
    await userEvent.type(screen.getByLabelText('Количество'), '0.01');
    await userEvent.type(screen.getByLabelText('Валовая сумма, USD'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить сделку' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ grossUsd: '1000', feeUsd: '0', ...identity }),
    );
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('paid');
  });

  it('sends ruble amounts for the server to convert at the Bank of Russia rate', async () => {
    const onSubmit = vi.fn();
    render(<ControlledForm onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText('Инструмент'), 'instrument-btc');
    await userEvent.type(screen.getByLabelText('Количество'), '0.01');
    await userEvent.selectOptions(screen.getByLabelText('Валюта оплаты'), 'RUB');
    expect(screen.getByText(/USD рассчитается по курсу ЦБ РФ на дату сделки/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Валовая сумма, USD')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Валовая сумма, RUB'), '100000');
    await userEvent.clear(screen.getByLabelText('Комиссия, RUB'));
    await userEvent.type(screen.getByLabelText('Комиссия, RUB'), '150');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить сделку' }));
    const input = onSubmit.mock.calls[0][0];
    expect(input).toMatchObject({
      instrumentId: 'instrument-btc',
      quantity: '0.01',
      orderWithinTimestamp: 0,
      paid: { currency: 'RUB', gross: '100000', fee: '150' },
      ...identity,
    });
    expect(input).not.toHaveProperty('grossUsd');
    expect(input).not.toHaveProperty('feeUsd');
    expect(input).not.toHaveProperty('paidCurrency');
  });

  it('corrects a trade paid in rubles in rubles', () => {
    expect(tradeDraft(saved)).toEqual({
      instrumentId: 'instrument-btc',
      side: 'buy',
      occurredAt: '2025-06-03T09:00:00.000Z',
      orderWithinTimestamp: '0',
      quantity: '0.01',
      paidCurrency: 'RUB',
      grossUsd: '100000',
      feeUsd: '0',
    });
    // A rate the owner entered stays with the correction unless the currency changes.
    const own = { ...saved, paid: { ...saved.paid!, perUsd: '80', rateSource: 'owner' as const } };
    expect(tradeDraft(own)).toMatchObject({ paidCurrency: 'RUB', paidPerUsd: '80' });
    expect(tradeCommand(tradeDraft(own), identity)).toMatchObject({
      paid: { currency: 'RUB', gross: '100000', fee: '0', perUsd: '80' },
    });
    expect(tradeCommand(tradeDraft(saved), identity)).not.toHaveProperty('paid.perUsd');
    const { paid: _paid, ...usd } = saved;
    expect(tradeDraft(usd)).toMatchObject({
      paidCurrency: 'USD',
      grossUsd: '1265.822784810126582278481012658228',
    });
  });
});
