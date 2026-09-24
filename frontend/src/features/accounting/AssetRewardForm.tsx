import type { Instrument } from '@api/accounting.api';
import type { RewardCategory } from '@api/asset-rewards.api';
import type { ReactNode } from 'react';

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
  const update = (value: Partial<RewardDraft>) => onChange({ ...draft, ...value });
  const submitLabel =
    mode === 'create'
      ? 'Записать вознаграждение'
      : mode === 'correct'
        ? 'Записать исправление'
        : 'Отменить вознаграждение';

  return (
    <form
      className="manual-form"
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
        <div className="manual-form-grid">
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
          <label>
            Категория вознаграждения
            <select
              aria-label="Категория вознаграждения"
              value={draft.category}
              onChange={(event) => update({ category: event.target.value as RewardCategory })}
            >
              <option value="staking">Стейкинг</option>
              <option value="airdrop">Аирдроп</option>
              <option value="other">Другой доход</option>
              <option value="unclassified">Вид вознаграждения не уточнён</option>
            </select>
          </label>
          <label>
            Момент получения (ISO с часовым поясом)
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
            Полученное количество
            <input
              inputMode="decimal"
              required
              value={draft.quantity}
              onChange={(event) => update({ quantity: event.target.value })}
            />
          </label>
          <label>
            Себестоимость вознаграждения
            <select
              aria-label="Себестоимость вознаграждения"
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
          {draft.basisKnown && (
            <label>
              Сумма себестоимости, USD
              <input
                inputMode="decimal"
                required
                value={draft.acquisitionBasisUsd}
                onChange={(event) => update({ acquisitionBasisUsd: event.target.value })}
              />
            </label>
          )}
          <label>
            Доход от вознаграждения
            <select
              aria-label="Доход от вознаграждения"
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
          {draft.incomeKnown && (
            <label>
              Сумма дохода, USD
              <input
                inputMode="decimal"
                required
                value={draft.incomeValueUsd}
                onChange={(event) => update({ incomeValueUsd: event.target.value })}
              />
            </label>
          )}
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
      <p className="manual-muted">
        Неизвестные суммы не становятся нулём. Нулевая сумма возможна только как явное известное
        значение; категория «Вид вознаграждения не уточнён» требует последующей проверки.
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
    </form>
  );
}
