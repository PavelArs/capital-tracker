import { type SwapAllocation, type SwapVersion, assetSwapsApi } from '@api/asset-swaps.api';
import { useEffect, useRef, useState } from 'react';
import { AssetSwapTotals } from './AssetSwapTotals';
import { AllocationOrigin, allocationKey } from './TransferAllocationDetails';
import { accountingError } from './feedback';

/** Parent keys this reader by the complete current revision/version pair. */
export function AssetSwapAllocation({
  accountId,
  swap,
  journalRevision,
  disabled,
}: {
  accountId: string;
  swap: SwapVersion;
  journalRevision: number;
  disabled: boolean;
}) {
  const [allocation, setAllocation] = useState<SwapAllocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function load(offset = 0) {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const next = await assetSwapsApi.allocation(
        accountId,
        swap.swapId,
        journalRevision,
        swap.version,
        offset,
      );
      if (request !== generation.current) return;
      setAllocation((previous) =>
        offset === 0 || !previous ? next : { ...next, items: [...previous.items, ...next.items] },
      );
    } catch (cause) {
      if (request !== generation.current) return;
      setAllocation(null);
      setError(
        `${accountingError(cause, 'загрузить распределение обмена')} Обновите список обменов.`,
      );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  return (
    <section aria-label="Распределение обмена">
      <button
        className="manual-button manual-button--secondary"
        type="button"
        disabled={disabled || loading}
        onClick={() => void load()}
      >
        Показать распределение обмена
      </button>
      {loading && <p>Загрузка распределения…</p>}
      {error && <p role="alert">{error}</p>}
      {allocation && (
        <>
          <p>
            Текущая версия {allocation.version}; ревизия журнала {allocation.journalRevision}.
          </p>
          <dl className="trade-summary">
            <AssetSwapTotals summary={allocation} />
          </dl>
          {allocation.items.length === 0 && <p>Нет списанных лотов.</p>}
          <ol>
            {allocation.items.map((item) => (
              <li key={allocationKey(item)} style={{ overflowWrap: 'anywhere' }}>
                <span>
                  {item.kind === 'principal' ? 'Отданный актив' : 'Комиссия'}: {item.quantity},
                  себестоимость {item.costUsd === null ? 'Неизвестно' : `${item.costUsd} USD`},
                  актив {item.instrumentId}.
                </span>
                <br />
                <AllocationOrigin item={item} />
              </li>
            ))}
          </ol>
          {allocation.nextOffset !== null && (
            <button
              className="manual-button manual-button--secondary"
              type="button"
              disabled={disabled || loading}
              onClick={() => void load(allocation.nextOffset ?? 0)}
            >
              Следующая страница распределения
            </button>
          )}
        </>
      )}
    </section>
  );
}
