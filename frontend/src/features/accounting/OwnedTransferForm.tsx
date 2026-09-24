import type { ReactNode } from 'react';

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
      className="manual-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset className="manual-position" disabled={busy || isVoid}>
        <legend>{mode === 'create' ? 'Новый перевод' : 'Параметры перевода'}</legend>
        <div className="manual-form-grid">
          <label>
            Со счёта
            <select
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
            На счёт
            <select
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
            Актив перевода
            <select
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
              inputMode="decimal"
              value={draft.quantity}
              onChange={(event) => update({ quantity: event.target.value })}
              required
            />
          </label>
          <label>
            Время перевода (UTC)
            <input
              type="text"
              value={draft.occurredAt}
              onChange={(event) => update({ occurredAt: event.target.value })}
              required
            />
          </label>
          <label>
            Порядок в эту миллисекунду
            <input
              inputMode="numeric"
              value={draft.orderWithinTimestamp}
              onChange={(event) => update({ orderWithinTimestamp: event.target.value })}
              required
            />
          </label>
          <label>
            Актив комиссии
            <select
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
              inputMode="decimal"
              value={draft.feeQuantity}
              onChange={(event) => update({ feeQuantity: event.target.value })}
              required
            />
          </label>
        </div>
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
      <p className="manual-muted">
        Запишите уже совершённое перемещение между своими счетами. Деньги не отправляются. Комиссия
        списывается с отправителя; её учётная себестоимость не является рыночной стоимостью.
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
    </form>
  );
}
