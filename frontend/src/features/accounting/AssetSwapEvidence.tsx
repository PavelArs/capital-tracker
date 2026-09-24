import type { SwapVersion } from '@api/asset-swaps.api';
import type { SwapDraft, SwapMode } from './swap-draft';

export const swapFeeLabel = (source: 'none' | 'held' | 'incoming' | null) =>
  source === 'held'
    ? 'Из имеющегося остатка'
    : source === 'incoming'
      ? 'Из получаемого актива'
      : 'Без комиссии';

export function AssetSwapFields({
  draft,
  instrumentName,
}: {
  draft: SwapDraft;
  instrumentName: (id: string) => string;
}) {
  return (
    <>
      <dt>Отдаваемый актив</dt>
      <dd>
        {instrumentName(draft.outgoingInstrumentId)} · {draft.outgoingInstrumentId}
      </dd>
      <dt>Получаемый актив</dt>
      <dd>
        {instrumentName(draft.incomingInstrumentId)} · {draft.incomingInstrumentId}
      </dd>
      <dt>Отдаваемое количество</dt>
      <dd>{draft.outgoingQuantity}</dd>
      <dt>Получаемое количество до комиссии</dt>
      <dd>{draft.incomingQuantity}</dd>
      <dt>Момент обмена, UTC</dt>
      <dd>{draft.occurredAt}</dd>
      <dt>Порядок в моменте</dt>
      <dd>{draft.orderWithinTimestamp}</dd>
      <dt>Оценка обмена, USD</dt>
      <dd>{draft.considerationKnown ? draft.considerationUsd : 'Неизвестно'}</dd>
      <dt>Источник комиссии</dt>
      <dd>{swapFeeLabel(draft.feeSource)}</dd>
      <dt>Актив комиссии</dt>
      <dd>
        {draft.feeSource === 'none'
          ? 'Нет'
          : `${instrumentName(draft.feeInstrumentId)} · ${draft.feeInstrumentId}`}
      </dd>
      <dt>Количество комиссии</dt>
      <dd>{draft.feeQuantity}</dd>
    </>
  );
}

export function AssetSwapReview({
  draft,
  journalRevision,
  mode,
  targetId,
  targetVersion,
  instrumentName,
  requestId,
  frozen = false,
}: {
  draft: SwapDraft;
  journalRevision: number;
  mode: SwapMode;
  targetId?: string;
  targetVersion?: number;
  instrumentName: (id: string) => string;
  requestId?: string;
  frozen?: boolean;
}) {
  return (
    <section className="manual-card" aria-label="Проверка обмена">
      <h3>{frozen ? 'Сохранённая команда' : 'Проверка обмена'}</h3>
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
            <dt>Номер обмена</dt>
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
        <AssetSwapFields draft={draft} instrumentName={instrumentName} />
        {mode !== 'void' && (
          <>
            <dt>Подтверждение выполненного обмена</dt>
            <dd>{draft.assertExecuted ? 'Подтверждено' : 'Не подтверждено'}</dd>
          </>
        )}
      </dl>
      <p>Это проверка введённых данных. Достаточность остатков и FIFO проверяются при записи.</p>
      {mode === 'void' && (
        <p>
          Показана отменяемая версия. Отмена сохраняется отдельной записью без удаления истории.
        </p>
      )}
    </section>
  );
}

export function savedSwapName(swap: SwapVersion): (id: string) => string {
  return (id) =>
    id === swap.outgoingInstrumentId
      ? swap.outgoingInstrumentName
      : id === swap.incomingInstrumentId
        ? swap.incomingInstrumentName
        : id === swap.feeInstrumentId
          ? (swap.feeInstrumentName ?? id)
          : id;
}
