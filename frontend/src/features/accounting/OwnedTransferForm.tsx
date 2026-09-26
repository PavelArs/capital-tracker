import { type ReactNode, useId } from 'react';
import './OperationForm.css';

export interface TransferDraft {
  fromAccountId: string;
  toAccountId: string;
  instrumentId: string;
  quantity: string;
  occurredAt: string;
  orderWithinTimestamp: string;
  feeInstrumentId: string;
  feeQuantity: string;
  assertInternal: boolean;
}

export interface TransferAccountOption {
  id: string;
  name: string;
}

export interface TransferInstrumentOption {
  id: string;
  name: string;
  symbol: string | null;
}

export function OwnedTransferForm({
  draft,
  accounts,
  instruments,
  mode,
  busy,
  reviewed,
  review,
  onChange,
  onReview,
  onSubmit,
  onCancel,
}: {
  draft: TransferDraft;
  accounts: readonly TransferAccountOption[];
  instruments: readonly TransferInstrumentOption[];
  mode: 'create' | 'correct' | 'void';
  busy: boolean;
  reviewed: boolean;
  review?: ReactNode;
  onChange: (draft: TransferDraft) => void;
  onReview: () => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const formId = useId();
  const hintId = `${formId}-hint`;
  const update = (value: Partial<TransferDraft>) => onChange({ ...draft, ...value });
  const isVoid = mode === 'void';
  const submitLabel =
    mode === 'create'
      ? 'Записать перевод'
      : mode === 'correct'
        ? 'Сохранить исправление'
        : 'Подтвердить отмену';

  return (
    <form
      className="manual-form operation-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset className="manual-position" disabled={busy || isVoid}>
        <legend>{mode === 'create' ? 'Новый перевод' : 'Параметры перевода'}</legend>
        <section className="operation-form__section" aria-labelledby={`${formId}-accounts-heading`}>
          <h3 id={`${formId}-accounts-heading`}>Счета и сумма получателю</h3>
          <div className="operation-form__fields">
            <label>
              <span id={`${formId}-from`}>Со счёта</span>
              <select
                aria-labelledby={`${formId}-from`}
                value={draft.fromAccountId}
                disabled={mode !== 'create'}
                onChange={(event) => update({ fromAccountId: event.target.value })}
                required
              >
                <option value="">Выберите счёт</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span id={`${formId}-to`}>На счёт</span>
              <select
                aria-labelledby={`${formId}-to`}
                value={draft.toAccountId}
                disabled={mode !== 'create'}
                onChange={(event) => update({ toAccountId: event.target.value })}
                required
              >
                <option value="">Выберите счёт</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span id={`${formId}-asset`}>Актив перевода</span>
              <select
                aria-labelledby={`${formId}-asset`}
                value={draft.instrumentId}
                onChange={(event) => update({ instrumentId: event.target.value })}
                required
              >
                <option value="">Выберите актив</option>
                {instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.name}
                    {instrument.symbol ? ` (${instrument.symbol})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Количество получателю
              <input
                aria-describedby={`${hintId}-quantity`}
                inputMode="decimal"
                value={draft.quantity}
                onChange={(event) => update({ quantity: event.target.value })}
                required
              />
            </label>
          </div>
          <p className="operation-form__hint" id={`${hintId}-quantity`}>
            Количество получателю не включает комиссию: она списывается с отправителя отдельно.
          </p>
        </section>

        <section className="operation-form__section" aria-labelledby={`${formId}-time-heading`}>
          <h3 id={`${formId}-time-heading`}>Время и порядок</h3>
          <div className="operation-form__fields">
            <label>
              Время перевода (UTC)
              <input
                aria-describedby={`${hintId}-time`}
                type="text"
                value={draft.occurredAt}
                onChange={(event) => update({ occurredAt: event.target.value })}
                required
              />
            </label>
            <label>
              Порядок в эту миллисекунду
              <input
                aria-describedby={`${hintId}-order`}
                inputMode="numeric"
                value={draft.orderWithinTimestamp}
                onChange={(event) => update({ orderWithinTimestamp: event.target.value })}
                required
              />
            </label>
          </div>
          <p className="operation-form__hint" id={`${hintId}-time`}>
            Укажите время в UTC в формате YYYY-MM-DDTHH:mm:ss.sssZ, например
            2025-01-03T12:30:00.000Z.
          </p>
          <p className="operation-form__hint" id={`${hintId}-order`}>
            Порядок задаёт последовательность операций с одинаковой миллисекундой на обоих счетах.
          </p>
        </section>

        <section className="operation-form__section" aria-labelledby={`${formId}-fee-heading`}>
          <h3 id={`${formId}-fee-heading`}>Комиссия</h3>
          <div className="operation-form__fields">
            <label>
              <span id={`${formId}-fee`}>Актив комиссии</span>
              <select
                aria-labelledby={`${formId}-fee`}
                aria-describedby={`${hintId}-fee-asset ${hintId}-fee-quantity`}
                value={draft.feeInstrumentId}
                onChange={(event) => update({ feeInstrumentId: event.target.value })}
              >
                <option value="">Без комиссии</option>
                {instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.name}
                    {instrument.symbol ? ` (${instrument.symbol})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Количество комиссии
              <input
                aria-describedby={`${hintId}-fee-asset ${hintId}-fee-quantity`}
                inputMode="decimal"
                value={draft.feeQuantity}
                onChange={(event) => update({ feeQuantity: event.target.value })}
                required
              />
            </label>
          </div>
          <p className="operation-form__hint" id={`${hintId}-fee-asset`}>
            При нулевой комиссии (0) актив комиссии не указывается.
          </p>
          <p className="operation-form__hint" id={`${hintId}-fee-quantity`}>
            Себестоимость комиссии — историческая учётная стоимость, а не рыночная цена.
          </p>
        </section>
        {!isVoid && (
          <label className="manual-review-check">
            <input
              type="checkbox"
              checked={draft.assertInternal}
              onChange={(event) => update({ assertInternal: event.target.checked })}
            />
            Это перевод между моими счетами
          </label>
        )}
      </fieldset>
      <section className="operation-form__section" aria-labelledby={`${formId}-review-heading`}>
        <h3 id={`${formId}-review-heading`}>Проверка и запись</h3>
        <p className="operation-form__hint">
          Запишите уже совершённое перемещение между своими счетами. Деньги не отправляются.
          Проверьте актуальные счета перед записью.
        </p>
        <button
          type="button"
          className="manual-button manual-button--secondary"
          disabled={busy}
          onClick={onReview}
        >
          Проверить счета
        </button>
        {review}
        <div className="operation-form__actions">
          <button
            type="submit"
            className="manual-button"
            disabled={busy || !reviewed || (!isVoid && !draft.assertInternal)}
          >
            {submitLabel}
          </button>
          {onCancel && (
            <button
              type="button"
              className="manual-button manual-button--secondary"
              disabled={busy}
              onClick={onCancel}
            >
              Отменить редактирование
            </button>
          )}
        </div>
      </section>
    </form>
  );
}
