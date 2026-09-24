import type { Instrument } from '@api/accounting.api';
import type { ReactNode } from 'react';
import type { SwapDraft, SwapMode } from './swap-draft';

export function AssetSwapForm({
  draft,
  instruments,
  mode,
  busy,
  reviewed,
  review,
  reviewError,
  recovery,
  onChange,
  onReview,
  onSubmit,
  onCancel,
}: {
  draft: SwapDraft;
  instruments: readonly Instrument[];
  mode: SwapMode;
  busy: boolean;
  reviewed: boolean;
  review?: ReactNode;
  reviewError?: string;
  recovery?: ReactNode;
  onChange: (draft: SwapDraft) => void;
  onReview: () => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const update = (value: Partial<SwapDraft>) => onChange({ ...draft, ...value });
  const options = instruments.map((instrument) => (
    <option key={instrument.id} value={instrument.id}>
      {instrument.name}
      {instrument.symbol ? ` (${instrument.symbol})` : ''} · {instrument.id}
    </option>
  ));
  return (
    <form
      className="manual-form"
      aria-label="Редактор обмена"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {recovery}
      <fieldset className="manual-position" disabled={busy || mode === 'void'}>
        <legend>
          {mode === 'create'
            ? 'Новый обмен'
            : mode === 'correct'
              ? 'Исправление обмена'
              : 'Отмена обмена'}
        </legend>
        <div className="manual-form-grid">
          <label>
            Отдаваемый актив
            <select
              aria-label="Отдаваемый актив"
              required
              value={draft.outgoingInstrumentId}
              onChange={(event) => update({ outgoingInstrumentId: event.target.value })}
            >
              <option value="">Выберите актив</option>
              {options}
            </select>
          </label>
          <label>
            Получаемый актив
            <select
              aria-label="Получаемый актив"
              required
              value={draft.incomingInstrumentId}
              onChange={(event) =>
                update({
                  incomingInstrumentId: event.target.value,
                  ...(draft.feeSource === 'incoming'
                    ? { feeInstrumentId: event.target.value }
                    : {}),
                })
              }
            >
              <option value="">Выберите актив</option>
              {options}
            </select>
          </label>
          <label>
            Отдаваемое количество
            <input
              inputMode="decimal"
              required
              value={draft.outgoingQuantity}
              onChange={(event) => update({ outgoingQuantity: event.target.value })}
            />
          </label>
          <label>
            Получаемое количество до комиссии
            <input
              inputMode="decimal"
              required
              value={draft.incomingQuantity}
              onChange={(event) => update({ incomingQuantity: event.target.value })}
            />
          </label>
          <label>
            Момент обмена (ISO с часовым поясом)
            <input
              type="text"
              required
              value={draft.occurredAt}
              onChange={(event) => update({ occurredAt: event.target.value })}
            />
          </label>
          <label>
            Порядок в моменте
            <input
              inputMode="numeric"
              required
              value={draft.orderWithinTimestamp}
              onChange={(event) => update({ orderWithinTimestamp: event.target.value })}
            />
          </label>
          <label>
            Оценка обмена в USD
            <select
              aria-label="Оценка обмена в USD"
              value={draft.considerationKnown ? 'known' : 'unknown'}
              onChange={(event) =>
                update({
                  considerationKnown: event.target.value === 'known',
                  considerationUsd: event.target.value === 'known' ? draft.considerationUsd : '',
                })
              }
            >
              <option value="unknown">Неизвестна</option>
              <option value="known">Известна</option>
            </select>
          </label>
          {draft.considerationKnown && (
            <label>
              Сумма оценки, USD
              <input
                inputMode="decimal"
                required
                value={draft.considerationUsd}
                onChange={(event) => update({ considerationUsd: event.target.value })}
              />
            </label>
          )}
          <label>
            Источник комиссии
            <select
              aria-label="Источник комиссии"
              value={draft.feeSource}
              onChange={(event) => {
                const source = event.target.value as SwapDraft['feeSource'];
                update({
                  feeSource: source,
                  feeInstrumentId:
                    source === 'none'
                      ? ''
                      : source === 'incoming'
                        ? draft.incomingInstrumentId
                        : draft.feeInstrumentId,
                  feeQuantity:
                    source === 'none' ? '0' : draft.feeSource === 'none' ? '' : draft.feeQuantity,
                });
              }}
            >
              <option value="none">Без комиссии</option>
              <option value="held">Из имеющегося остатка</option>
              <option value="incoming">Из получаемого актива</option>
            </select>
          </label>
          {draft.feeSource !== 'none' && (
            <>
              <label>
                Актив комиссии
                <select
                  aria-label="Актив комиссии"
                  required
                  disabled={draft.feeSource === 'incoming'}
                  value={draft.feeInstrumentId}
                  onChange={(event) => update({ feeInstrumentId: event.target.value })}
                >
                  <option value="">Выберите актив</option>
                  {options}
                </select>
              </label>
              <label>
                Количество комиссии
                <input
                  inputMode="decimal"
                  required
                  value={draft.feeQuantity}
                  onChange={(event) => update({ feeQuantity: event.target.value })}
                />
              </label>
            </>
          )}
        </div>
        <label className="manual-review-check">
          <input
            type="checkbox"
            checked={draft.assertExecuted}
            onChange={(event) => update({ assertExecuted: event.target.checked })}
          />
          Подтверждаю: это уже выполненный обмен внутри этого счёта.
        </label>
      </fieldset>
      <p className="manual-muted">
        Оценка относится ко всему получаемому количеству до комиссии. Неизвестная оценка не равна
        нулю. Комиссия из получаемого актива уменьшает только новый лот; комиссия из остатка
        списывается по FIFO до поступления нового актива.
      </p>
      {review}
      {reviewError && (
        <p className="manual-feedback manual-feedback--error" role="alert">
          {reviewError}
        </p>
      )}
      <button
        className="manual-button manual-button--secondary"
        type="button"
        disabled={busy}
        onClick={onReview}
      >
        {mode === 'create'
          ? 'Проверить обмен'
          : mode === 'correct'
            ? 'Проверить исправление'
            : 'Проверить отмену'}
      </button>
      <button
        className="manual-button"
        type="submit"
        disabled={busy || !reviewed || (mode !== 'void' && !draft.assertExecuted)}
      >
        {mode === 'create'
          ? 'Записать обмен'
          : mode === 'correct'
            ? 'Записать исправление'
            : 'Отменить обмен'}
      </button>
      {onCancel && (
        <button
          className="manual-button manual-button--secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Отменить редактирование
        </button>
      )}
    </form>
  );
}
