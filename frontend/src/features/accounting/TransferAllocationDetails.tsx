import type { TransferAllocation, TransferAllocationItem } from '@api/owned-transfers.api';

function allocationKey(item: TransferAllocationItem): string {
  const origin = item.origin;
  const identity =
    origin.kind === 'trade'
      ? `${origin.tradeId}:v${origin.version}`
      : origin.kind === 'carry-in'
        ? `${origin.lotId}:r${origin.openingRevision}:o${origin.ordinal}`
        : `${origin.rewardId}:v${origin.version}`;
  return [
    item.kind,
    item.instrumentId,
    origin.accountId,
    origin.kind,
    identity,
    item.arrival?.transferId ?? 'original',
    item.arrival?.version ?? 0,
    item.intervalStart,
    item.intervalEnd,
  ].join(':');
}

function AllocationOrigin({ item }: { item: TransferAllocationItem }) {
  const { origin, arrival } = item;
  return (
    <>
      <span>Исходный счёт {origin.accountId}</span>
      <br />
      {origin.kind === 'trade' ? (
        <span>
          Сделка {origin.tradeId}, версия {origin.version}
        </span>
      ) : origin.kind === 'carry-in' ? (
        <span>
          Начальный лот {origin.lotId}, ревизия позиций {origin.openingRevision}, лот{' '}
          {origin.ordinal}
        </span>
      ) : (
        <span>
          Вознаграждение {origin.rewardId}, версия {origin.version}
        </span>
      )}
      <br />
      <span>
        Приобретено {origin.acquiredAt}, порядок {origin.orderWithinTimestamp}
      </span>
      <br />
      <span>
        {arrival
          ? `Получено переводом ${arrival.transferId}, версия ${arrival.version}`
          : 'Исходный лот этого счёта, без предыдущего перевода'}
      </span>
      <br />
      <span>
        Интервал исходного лота: {item.intervalStart}–{item.intervalEnd}
      </span>
    </>
  );
}

export function TransferAllocationDetails({
  allocation,
  loading,
  onNext,
}: {
  allocation: TransferAllocation;
  loading: boolean;
  onNext: () => void;
}) {
  return (
    <>
      <p>
        Текущая версия {allocation.version}; ревизии счетов {allocation.fromJournalRevision} и{' '}
        {allocation.toJournalRevision}.
      </p>
      <dl className="trade-summary">
        <dt>Себестоимость переданного актива, USD</dt>
        <dd>
          {allocation.principalBasisUsd ?? 'Неизвестно'}
          {allocation.principalBasisUsd === null && allocation.basisCoverage && (
            <small>
              Известная часть: {allocation.basisCoverage.principal.knownSubtotalUsd} USD;
              неизвестных частей: {allocation.basisCoverage.principal.unknownCount}.
            </small>
          )}
        </dd>
        <dt>Списанная себестоимость комиссии, USD</dt>
        <dd>
          {allocation.feeConsumedBasisUsd ?? 'Неизвестно'}
          {allocation.feeConsumedBasisUsd === null && allocation.basisCoverage && (
            <small>
              Известная часть: {allocation.basisCoverage.fee.knownSubtotalUsd} USD; неизвестных
              частей: {allocation.basisCoverage.fee.unknownCount}.
            </small>
          )}
        </dd>
      </dl>
      {allocation.items.length === 0 && <p>В текущем переводе нет распределённых лотов.</p>}
      <ol>
        {allocation.items.map((item) => (
          <li key={allocationKey(item)} style={{ overflowWrap: 'anywhere' }}>
            <span>
              {item.kind === 'principal' ? 'Получателю' : 'Комиссия'}: {item.quantity},
              себестоимость {item.costUsd === null ? 'Неизвестно' : `${item.costUsd} USD`}.
            </span>
            <br />
            <AllocationOrigin item={item} />
          </li>
        ))}
      </ol>
      {allocation.nextOffset !== null && (
        <button
          type="button"
          className="manual-button manual-button--secondary"
          disabled={loading}
          onClick={onNext}
        >
          Следующая страница разбора
        </button>
      )}
    </>
  );
}
