import type { Instrument } from '@api/accounting.api';
import type { TradeExecution, TradeVersion } from '@api/trades.api';
import { DateTimeField, utcDay } from '@components/common/DateTimeField';
import { useId } from 'react';
import './OperationForm.css';
import './TradeForm.css';

export type TradeDraft = Omit<TradeExecution, 'orderWithinTimestamp'> & {
  orderWithinTimestamp: string;
};

export function emptyTradeDraft(): TradeDraft {
  return {
    instrumentId: '',
    side: 'buy',
    occurredAt: utcDay(),
    // Empty: the backend places the trade after everything already at this moment.
    orderWithinTimestamp: '',
    quantity: '',
    grossUsd: '',
    feeUsd: '0',
  };
}

/** Draft fields a host can keep read-only, e.g. values taken from an imported transaction. */
export type TradeField = keyof TradeDraft;

export function TradeForm({
  draft,
  onChange,
  onSubmit,
  instruments,
  selected,
  disabled,
  lockDraft,
  lockedFields = [],
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
  lockedFields?: readonly TradeField[];
  correction: boolean;
  onCancel: () => void;
  cancelDisabled: boolean;
}) {
  const hintId = useId();
  const update = (value: Partial<TradeDraft>) => onChange({ ...draft, ...value });
  const locked = (field: TradeField) => lockDraft || lockedFields.includes(field);
  return (
    <form className="trade-form operation-form" onSubmit={onSubmit}>
      <fieldset className="manual-position" aria-label="Сделка в USD" disabled={disabled}>
        <legend>{correction ? 'Исправление сделки' : 'Новая сделка'}</legend>
        <div className="operation-form__section">
          <h3>Что и когда</h3>
          <div className="operation-form__fields">
            <label>
              Инструмент
              <select
                disabled={locked('instrumentId')}
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
                disabled={locked('side')}
                value={draft.side}
                onChange={(event) =>
                  update({ side: event.target.value === 'sell' ? 'sell' : 'buy' })
                }
              >
                <option value="buy">Покупка</option>
                <option value="sell">Продажа</option>
              </select>
            </label>
            <div className="operation-form__field">
              <DateTimeField
                label="Дата сделки"
                timeLabel="Время сделки, UTC"
                describedBy={`${hintId}-time`}
                disabled={locked('occurredAt')}
                value={draft.occurredAt}
                onChange={(occurredAt) => update({ occurredAt })}
                required
              />
              <small id={`${hintId}-time`}>
                Время можно не указывать: тогда сделка записывается на 00:00 UTC выбранного дня.
              </small>
            </div>
          </div>
        </div>
        <div className="operation-form__section">
          <h3>Сколько</h3>
          <div className="operation-form__fields">
            <label>
              Количество
              <input
                disabled={locked('quantity')}
                inputMode="decimal"
                value={draft.quantity}
                onChange={(event) => update({ quantity: event.target.value })}
                required
              />
            </label>
            {/* The purchase-currency fields belong next to this total. */}
            <div className="operation-form__field">
              <label>
                Сумма сделки, USD
                <input
                  aria-describedby={`${hintId}-gross`}
                  disabled={locked('grossUsd')}
                  inputMode="decimal"
                  value={draft.grossUsd}
                  onChange={(event) => update({ grossUsd: event.target.value })}
                  required
                />
              </label>
              <small id={`${hintId}-gross`}>
                {draft.side === 'sell'
                  ? 'Общая сумма, которую получили за продажу, до вычета комиссии. Не цена за единицу.'
                  : 'Общая сумма, которую заплатили за покупку, без комиссии. Не цена за единицу.'}
              </small>
            </div>
            <div className="operation-form__field">
              <label>
                Комиссия, USD
                <input
                  aria-describedby={`${hintId}-fee`}
                  disabled={locked('feeUsd')}
                  inputMode="decimal"
                  value={draft.feeUsd}
                  onChange={(event) => update({ feeUsd: event.target.value })}
                />
              </label>
              <small id={`${hintId}-fee`}>
                Комиссия отдельно в USD, необязательно. Пустое поле означает 0.
              </small>
            </div>
          </div>
        </div>
        <details className="trade-form__order">
          <summary>
            Порядок в один момент:{' '}
            {draft.orderWithinTimestamp === '' ? 'авто' : draft.orderWithinTimestamp}
          </summary>
          <div className="operation-form__field">
            <label>
              Порядок в этот момент
              <input
                aria-describedby={`${hintId}-order`}
                disabled={locked('orderWithinTimestamp')}
                inputMode="numeric"
                value={draft.orderWithinTimestamp}
                onChange={(event) => update({ orderWithinTimestamp: event.target.value })}
              />
            </label>
            <small id={`${hintId}-order`}>
              Различает операции с одинаковым временем. Оставьте пустым, и сделка встанет после уже
              записанных в этот момент; 0, 1, 2… задают порядок вручную.
            </small>
          </div>
        </details>
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
