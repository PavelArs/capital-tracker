import type { RewardCategory } from '@api/asset-rewards.api';
import type { RewardDraft } from './AssetRewardForm';

const categoryLabel: Record<RewardCategory, string> = {
  staking: 'Стейкинг',
  airdrop: 'Аирдроп',
  other: 'Другой доход',
  unclassified: 'Вид вознаграждения не уточнён',
};

export function AssetRewardReview({
  draft,
  journalRevision,
  mode,
  targetId,
  targetVersion,
  instrumentName,
  instrumentId,
  requestId,
  frozen = false,
}: {
  draft: RewardDraft;
  journalRevision: number;
  mode: 'create' | 'correct' | 'void';
  targetId?: string;
  targetVersion?: number;
  instrumentName: string;
  instrumentId: string;
  requestId?: string;
  frozen?: boolean;
}) {
  return (
    <section className="manual-card" aria-label="Проверка вознаграждения">
      <h3>{frozen ? 'Сохранённая команда' : 'Проверка вознаграждения'}</h3>
      <dl className="trade-summary">
        <dt>Действие</dt>
        <dd>{mode === 'create' ? 'Запись' : mode === 'correct' ? 'Исправление' : 'Отмена'}</dd>
        {requestId && (
          <>
            <dt>Номер запроса</dt>
            <dd>{requestId}</dd>
          </>
        )}
        {targetId && (
          <>
            <dt>Номер вознаграждения</dt>
            <dd>{targetId}</dd>
          </>
        )}
        {targetVersion !== undefined && (
          <>
            <dt>Версия записи</dt>
            <dd>{targetVersion}</dd>
          </>
        )}
        <dt>Ревизия журнала</dt>
        <dd>{journalRevision}</dd>
        <>
          <dt>Актив</dt>
          <dd>{instrumentName}</dd>
          <dt>ID актива</dt>
          <dd>{instrumentId}</dd>
          <dt>Категория</dt>
          <dd>{categoryLabel[draft.category]}</dd>
          <dt>Момент получения</dt>
          <dd>{draft.occurredAt}</dd>
          <dt>Порядок в моменте</dt>
          <dd>{draft.orderWithinTimestamp}</dd>
          <dt>Количество</dt>
          <dd>{draft.quantity}</dd>
          <dt>Себестоимость</dt>
          <dd>{draft.basisKnown ? draft.acquisitionBasisUsd : 'Неизвестна'}</dd>
          <dt>Заявленный доход</dt>
          <dd>{draft.incomeKnown ? draft.incomeValueUsd : 'Неизвестен'}</dd>
          {mode !== 'void' && (
            <>
              <dt>Подтверждение</dt>
              <dd>{draft.assertReward ? 'Подтверждено' : 'Не подтверждено'}</dd>
            </>
          )}
        </>
      </dl>
      {mode === 'void' && (
        <p>
          Поля вознаграждения описывают отменяемую версию; команда отмены передаёт только её номер,
          версию, ревизию и ключ запроса.
        </p>
      )}
    </section>
  );
}
