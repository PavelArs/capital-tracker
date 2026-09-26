import type { Instrument } from '@api/accounting.api';
import type { TradeExecution, TradeVersion } from '@api/trades.api';
import { useId } from 'react';
import './TradeForm.css';

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
  const hintId = useId();
  const update = (value: Partial<TradeDraft>) => onChange({ ...draft, ...value });
  return (
    <form className="trade-form" onSubmit={onSubmit}>
      <fieldset className="manual-position" aria-label="Сделка в USD" disabled={disabled}>
        <legend>{correction ? 'Исправление сделки' : 'Новая сделка'}</legend>
        <div className="trade-form__section">
          <h3>Инструмент и направление</h3>
          <div className="trade-form__fields">
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
                onChange={(event) =>
                  update({ side: event.target.value === 'sell' ? 'sell' : 'buy' })
                }
              >
                <option value="buy">Покупка</option>
                <option value="sell">Продажа</option>
              </select>
            </label>
          </div>
        </div>
        <div className="trade-form__section">
          <h3>Количество и суммы</h3>
          <div className="trade-form__fields">
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
            <div className="trade-form__field">
              <label>
                Валовая сумма, USD
                <input
                  aria-describedby={`${hintId}-gross`}
                  disabled={lockDraft}
                  inputMode="decimal"
                  value={draft.grossUsd}
                  onChange={(event) => update({ grossUsd: event.target.value })}
                  required
                />
              </label>
              <small id={`${hintId}-gross`}>Фактическая общая сумма сделки, не цена единицы.</small>
            </div>
            <div className="trade-form__field">
              <label>
                Комиссия, USD
                <input
                  aria-describedby={`${hintId}-fee`}
                  disabled={lockDraft}
                  inputMode="decimal"
                  value={draft.feeUsd}
                  onChange={(event) => update({ feeUsd: event.target.value })}
                  required
                />
              </label>
              <small id={`${hintId}-fee`}>Комиссия отдельно в USD. Если её нет, оставьте 0.</small>
            </div>
          </div>
        </div>
        <div className="trade-form__section">
          <h3>Время исполнения</h3>
          <div className="trade-form__fields">
            <div className="trade-form__field">
              <label>
                Дата и время сделки (UTC)
                <input
                  aria-describedby={`${hintId}-time`}
                  disabled={lockDraft}
                  value={draft.occurredAt}
                  onChange={(event) => update({ occurredAt: event.target.value })}
                  required
                />
              </label>
              <small id={`${hintId}-time`}>
                Укажите дату и время UTC, например 2025-01-01T00:00:00.000Z.
              </small>
            </div>
            <div className="trade-form__field">
              <label>
                Порядок в этот момент
                <input
                  aria-describedby={`${hintId}-order`}
                  disabled={lockDraft}
                  inputMode="numeric"
                  value={draft.orderWithinTimestamp}
                  onChange={(event) => update({ orderWithinTimestamp: event.target.value })}
                  required
                />
              </label>
              <small id={`${hintId}-order`}>
                Порядок различает сделки с одинаковым временем: 0, 1, 2…
              </small>
            </div>
          </div>
        </div>
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
