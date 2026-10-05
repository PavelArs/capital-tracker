import type { Instrument } from '@api/accounting.api';
import type { TradeCommand, TradeExecution, TradeVersion } from '@api/trades.api';
import { useId } from 'react';
import './OperationForm.css';
import './TradeForm.css';

/** The currency the amounts were paid in; RUB and EUR are converted by the server. */
export type PaidCurrency = 'USD' | 'RUB' | 'EUR';
/** `grossUsd` and `feeUsd` hold the amounts typed in `paidCurrency`; `paidPerUsd` keeps a
 * rate the owner entered for the trade, so a correction does not replace it. */
export type TradeDraft = Omit<TradeExecution, 'orderWithinTimestamp'> & {
  orderWithinTimestamp: string;
  paidCurrency: PaidCurrency;
  paidPerUsd?: string;
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
    paidCurrency: 'USD',
  };
}

/** A saved trade as an editable draft, in the currency it was paid in. */
export function tradeDraft(trade: TradeVersion): TradeDraft {
  return {
    instrumentId: trade.instrumentId,
    side: trade.side,
    occurredAt: trade.occurredAt,
    orderWithinTimestamp: String(trade.orderWithinTimestamp),
    quantity: trade.quantity,
    ...(trade.paid
      ? {
          paidCurrency: trade.paid.currency,
          grossUsd: trade.paid.gross,
          feeUsd: trade.paid.fee,
          ...(trade.paid.rateSource === 'owner' ? { paidPerUsd: trade.paid.perUsd } : {}),
        }
      : { paidCurrency: 'USD', grossUsd: trade.grossUsd, feeUsd: trade.feeUsd }),
  };
}

/** USD amounts as typed, or RUB/EUR amounts for the server to convert (CUR-PAID-RUB). */
export function tradeCommand(
  draft: TradeDraft,
  identity: { requestId: string; expectedJournalRevision: number },
): TradeCommand {
  const { paidCurrency, paidPerUsd, grossUsd, feeUsd, orderWithinTimestamp, ...fields } = draft;
  return {
    ...fields,
    orderWithinTimestamp: Number(orderWithinTimestamp),
    ...(paidCurrency === 'USD'
      ? { grossUsd, feeUsd }
      : {
          paid: {
            currency: paidCurrency,
            gross: grossUsd,
            fee: feeUsd,
            ...(paidPerUsd ? { perUsd: paidPerUsd } : {}),
          },
        }),
    ...identity,
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
  const currency = draft.paidCurrency;
  return (
    <form className="trade-form operation-form" onSubmit={onSubmit}>
      <fieldset className="manual-position" aria-label="Сделка в USD" disabled={disabled}>
        <legend>{correction ? 'Исправление сделки' : 'Новая сделка'}</legend>
        <div className="operation-form__section">
          <h3>Инструмент и направление</h3>
          <div className="operation-form__fields">
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
        <div className="operation-form__section">
          <h3>Количество и суммы</h3>
          <div className="operation-form__fields">
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
            <div className="operation-form__field">
              <label>
                Валюта оплаты
                <select
                  aria-describedby={`${hintId}-currency`}
                  disabled={lockDraft}
                  value={currency}
                  onChange={(event) =>
                    update({
                      paidCurrency:
                        event.target.value === 'RUB' || event.target.value === 'EUR'
                          ? event.target.value
                          : 'USD',
                      // A rate belongs to its currency.
                      paidPerUsd: undefined,
                    })
                  }
                >
                  <option value="USD">USD</option>
                  <option value="RUB">RUB</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <small id={`${hintId}-currency`}>
                {currency === 'USD'
                  ? 'Валюта, в которой вы заплатили или получили деньги.'
                  : draft.paidPerUsd
                    ? `Суммы сохранятся в ${currency}, а USD рассчитается по вашему курсу ${draft.paidPerUsd} ${currency} за 1 USD.`
                    : `Суммы сохранятся в ${currency}, а USD рассчитается по курсу ЦБ РФ на дату сделки.`}
              </small>
            </div>
            <div className="operation-form__field">
              <label>
                Валовая сумма, {currency}
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
            <div className="operation-form__field">
              <label>
                Комиссия, {currency}
                <input
                  aria-describedby={`${hintId}-fee`}
                  disabled={lockDraft}
                  inputMode="decimal"
                  value={draft.feeUsd}
                  onChange={(event) => update({ feeUsd: event.target.value })}
                  required
                />
              </label>
              <small id={`${hintId}-fee`}>
                Комиссия отдельно в {currency}. Если её нет, оставьте 0.
              </small>
            </div>
          </div>
        </div>
        <div className="operation-form__section">
          <h3>Время исполнения</h3>
          <div className="operation-form__fields">
            <div className="operation-form__field">
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
            <div className="operation-form__field">
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
