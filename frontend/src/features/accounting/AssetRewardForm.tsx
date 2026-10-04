import type { Instrument } from '@api/accounting.api';
import type { RewardCategory } from '@api/asset-rewards.api';
import { DateTimeField } from '@components/common/DateTimeField';
import { type ReactNode, useId } from 'react';
import './OperationForm.css';

export type RewardMode = 'create' | 'correct' | 'void';
export interface RewardDraft {
  instrumentId: string;
  category: RewardCategory;
  occurredAt: string;
  orderWithinTimestamp: string;
  quantity: string;
  basisKnown: boolean;
  acquisitionBasisUsd: string;
  incomeKnown: boolean;
  incomeValueUsd: string;
  assertReward: boolean;
}

export function AssetRewardForm({
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
  draft: RewardDraft;
  instruments: readonly Instrument[];
  mode: RewardMode;
  busy: boolean;
  reviewed: boolean;
  review?: ReactNode;
  reviewError?: string;
  recovery?: ReactNode;
  onChange: (draft: RewardDraft) => void;
  onReview: () => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const hintId = useId();
  const update = (value: Partial<RewardDraft>) => onChange({ ...draft, ...value });
  const submitLabel =
    mode === 'create'
      ? 'Записать вознаграждение'
      : mode === 'correct'
        ? 'Записать исправление'
        : 'Отменить вознаграждение';

  return (
    <form
      className="manual-form operation-form"
      aria-label="Редактор вознаграждения"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {recovery}
      <fieldset className="manual-position" disabled={busy || mode === 'void'}>
        <legend>
          {mode === 'create'
            ? 'Новое вознаграждение'
            : mode === 'correct'
              ? 'Исправление вознаграждения'
              : 'Отмена вознаграждения'}
        </legend>
        <div className="operation-form__section">
          <h3>Получение вознаграждения</h3>
          <div className="operation-form__fields">
            <label>
              Актив вознаграждения
              <select
                aria-label="Актив вознаграждения"
                required
                value={draft.instrumentId}
                onChange={(event) => update({ instrumentId: event.target.value })}
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
            <div className="operation-form__field">
              <label>
                Категория вознаграждения
                <select
                  aria-label="Категория вознаграждения"
                  aria-describedby={`${hintId}-category`}
                  value={draft.category}
                  onChange={(event) => update({ category: event.target.value as RewardCategory })}
                >
                  <option value="staking">Стейкинг</option>
                  <option value="airdrop">Аирдроп</option>
                  <option value="other">Другой доход</option>
                  <option value="unclassified">Вид вознаграждения не уточнён</option>
                </select>
              </label>
              <small className="operation-form__hint" id={`${hintId}-category`}>
                Категория «Вид вознаграждения не уточнён» требует последующей проверки.
              </small>
            </div>
            <div className="operation-form__field">
              <label>
                Полученное количество
                <input
                  aria-describedby={`${hintId}-quantity`}
                  inputMode="decimal"
                  required
                  value={draft.quantity}
                  onChange={(event) => update({ quantity: event.target.value })}
                />
              </label>
              <small className="operation-form__hint" id={`${hintId}-quantity`}>
                Укажите точное полученное количество актива.
              </small>
            </div>
          </div>
        </div>
        <div className="operation-form__section">
          <h3>Себестоимость и доход</h3>
          <div className="operation-form__fields">
            <div className="operation-form__field">
              <label>
                Себестоимость вознаграждения
                <select
                  aria-label="Себестоимость вознаграждения"
                  aria-describedby={`${hintId}-basis`}
                  value={draft.basisKnown ? 'known' : 'unknown'}
                  onChange={(event) =>
                    update({
                      basisKnown: event.target.value === 'known',
                      acquisitionBasisUsd:
                        event.target.value === 'known' ? draft.acquisitionBasisUsd : '',
                    })
                  }
                >
                  <option value="unknown">Неизвестна</option>
                  <option value="known">Известна</option>
                </select>
              </label>
              <small className="operation-form__hint" id={`${hintId}-basis`}>
                Указывается независимо от дохода. Неизвестная сумма не равна нулю; ноль задаётся как
                известное значение.
              </small>
            </div>
            {draft.basisKnown && (
              <div className="operation-form__field">
                <label>
                  Сумма себестоимости, USD
                  <input
                    aria-describedby={`${hintId}-basis-value`}
                    inputMode="decimal"
                    required
                    value={draft.acquisitionBasisUsd}
                    onChange={(event) => update({ acquisitionBasisUsd: event.target.value })}
                  />
                </label>
                <small className="operation-form__hint" id={`${hintId}-basis-value`}>
                  Введите точную сумму в USD. Ноль допустим только как явно известное значение.
                </small>
              </div>
            )}
            <div className="operation-form__field">
              <label>
                Доход от вознаграждения
                <select
                  aria-label="Доход от вознаграждения"
                  aria-describedby={`${hintId}-income`}
                  value={draft.incomeKnown ? 'known' : 'unknown'}
                  onChange={(event) =>
                    update({
                      incomeKnown: event.target.value === 'known',
                      incomeValueUsd: event.target.value === 'known' ? draft.incomeValueUsd : '',
                    })
                  }
                >
                  <option value="unknown">Неизвестен</option>
                  <option value="known">Известен</option>
                </select>
              </label>
              <small className="operation-form__hint" id={`${hintId}-income`}>
                Указывается независимо от себестоимости. Неизвестная сумма не равна нулю; ноль
                задаётся как известное значение.
              </small>
            </div>
            {draft.incomeKnown && (
              <div className="operation-form__field">
                <label>
                  Сумма дохода, USD
                  <input
                    aria-describedby={`${hintId}-income-value`}
                    inputMode="decimal"
                    required
                    value={draft.incomeValueUsd}
                    onChange={(event) => update({ incomeValueUsd: event.target.value })}
                  />
                </label>
                <small className="operation-form__hint" id={`${hintId}-income-value`}>
                  Введите точную сумму в USD. Ноль допустим только как явно известное значение.
                </small>
              </div>
            )}
          </div>
        </div>
        <div className="operation-form__section">
          <h3>Время получения</h3>
          <div className="operation-form__fields">
            <div className="operation-form__field">
              <DateTimeField
                label="Дата получения"
                timeLabel="Время получения, UTC"
                describedBy={`${hintId}-time`}
                required
                value={draft.occurredAt}
                onChange={(occurredAt) => update({ occurredAt })}
              />
              <small className="operation-form__hint" id={`${hintId}-time`}>
                Время указывается в UTC и необязательно: без него получение записывается на 00:00
                UTC.
              </small>
            </div>
            <div className="operation-form__field">
              <label>
                Порядок в моменте
                <input
                  aria-describedby={`${hintId}-order`}
                  inputMode="numeric"
                  required
                  value={draft.orderWithinTimestamp}
                  onChange={(event) => update({ orderWithinTimestamp: event.target.value })}
                />
              </label>
              <small className="operation-form__hint" id={`${hintId}-order`}>
                Порядок различает вознаграждения с одинаковым моментом получения.
              </small>
            </div>
          </div>
        </div>
        <label className="manual-review-check">
          <input
            type="checkbox"
            checked={draft.assertReward}
            aria-label="Подтверждаю: это уже полученное вознаграждение, а не покупка, перевод или взнос."
            onChange={(event) => update({ assertReward: event.target.checked })}
          />
          Подтверждаю: это уже полученное вознаграждение, а не покупка, перевод или взнос.
        </label>
      </fieldset>
      {review}
      {reviewError && (
        <p className="manual-feedback manual-feedback--error" role="alert">
          {reviewError}
        </p>
      )}
      <div className="operation-form__actions">
        <button
          className="manual-button manual-button--secondary"
          type="button"
          disabled={busy}
          onClick={onReview}
        >
          {mode === 'create'
            ? 'Проверить вознаграждение'
            : mode === 'correct'
              ? 'Проверить исправление'
              : 'Проверить отмену'}
        </button>
        <button
          className="manual-button"
          type="submit"
          disabled={busy || !reviewed || (mode !== 'void' && !draft.assertReward)}
        >
          {submitLabel}
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
      </div>
    </form>
  );
}
