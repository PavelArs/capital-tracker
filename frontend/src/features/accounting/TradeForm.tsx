import type { Instrument } from '@api/accounting.api';
import type { TradeExecution, TradeVersion } from '@api/trades.api';

export type TradeDraft = Omit<TradeExecution, 'orderWithinTimestamp'> & {
  orderWithinTimestamp: string;
};

export function emptyTradeDraft(): TradeDraft {
  return {
    instrumentId: '',
    side: 'buy',
    occurredAt: new Date().toISOString(),
    orderWithinTimestamp: '0',
    quantity: '',
    grossUsd: '',
    feeUsd: '0',
  };
}

export function TradeForm({
  draft,
  onChange,
  onSubmit,
  instruments,
  selected,
  disabled,
  lockDraft,
  correction,
  onCancel,
  cancelDisabled,
}: {
  draft: TradeDraft;
  onChange: (draft: TradeDraft) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  instruments: Instrument[];
  selected: TradeVersion | null;
  disabled: boolean;
  lockDraft: boolean;
  correction: boolean;
  onCancel: () => void;
  cancelDisabled: boolean;
}) {
  const update = (value: Partial<TradeDraft>) => onChange({ ...draft, ...value });
  return (
    <form onSubmit={onSubmit}>
      <fieldset className="manual-position" aria-label="Сделка в USD" disabled={disabled}>
        <legend>{correction ? 'Исправление сделки' : 'Новая сделка'}</legend>
        <div className="manual-form-grid">
          <label>
            Инструмент
            <select
              disabled={lockDraft}
              value={draft.instrumentId}
              onChange={(event) => update({ instrumentId: event.target.value })}
              required
            >
              <option value="">Выберите инструмент</option>
              {selected && !instruments.some((item) => item.id === selected.instrumentId) && (
                <option value={selected.instrumentId}>
                  {selected.instrumentName}
                  {selected.instrumentSymbol ? ` (${selected.instrumentSymbol})` : ''}
                </option>
              )}
              {instruments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.symbol ? ` (${item.symbol})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тип сделки
            <select
              disabled={lockDraft}
              value={draft.side}
              onChange={(event) => update({ side: event.target.value === 'sell' ? 'sell' : 'buy' })}
            >
              <option value="buy">Покупка</option>
              <option value="sell">Продажа</option>
            </select>
          </label>
          <label>
            Дата и время сделки (UTC)
            <input
              disabled={lockDraft}
              value={draft.occurredAt}
              onChange={(event) => update({ occurredAt: event.target.value })}
              required
            />
          </label>
          <label>
            Порядок в этот момент
            <input
              disabled={lockDraft}
              inputMode="numeric"
              value={draft.orderWithinTimestamp}
              onChange={(event) => update({ orderWithinTimestamp: event.target.value })}
              required
            />
          </label>
          <label>
            Количество
            <input
              disabled={lockDraft}
              inputMode="decimal"
              value={draft.quantity}
              onChange={(event) => update({ quantity: event.target.value })}
              required
            />
          </label>
          <label>
            Валовая сумма, USD
            <input
              disabled={lockDraft}
              inputMode="decimal"
              value={draft.grossUsd}
              onChange={(event) => update({ grossUsd: event.target.value })}
              required
            />
          </label>
          <label>
            Комиссия, USD
            <input
              disabled={lockDraft}
              inputMode="decimal"
              value={draft.feeUsd}
              onChange={(event) => update({ feeUsd: event.target.value })}
              required
            />
          </label>
        </div>
        <p className="manual-muted">
          Введите фактическую общую сумму сделки, не цену единицы. Комиссия указана отдельно в USD.
          Порядок различает сделки с одинаковым временем.
        </p>
        <button type="submit" className="manual-button">
          Сохранить сделку
        </button>
      </fieldset>
      {correction && (
        <button
          type="button"
          className="manual-button manual-button--secondary"
          onClick={onCancel}
          disabled={cancelDisabled}
        >
          Отменить исправление
        </button>
      )}
    </form>
  );
}
