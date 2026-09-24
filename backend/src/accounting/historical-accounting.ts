import {
  type CarryInFifoResult,
  type FifoCarryInInput,
  FifoHistoryError,
  type FifoTrade,
  MAX_ACTIVE_TRADES,
  calculateFifo,
  deriveCarryInAmounts,
} from './fifo';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { TradeKind } from './trade-journal.store';

export interface HistoricalPosition {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  costUsd: string | null;
  knownCostSubtotalUsd?: string;
  unknownCostQuantity?: string;
}

/** Restate a complete effective prefix; pagination belongs after this calculation. */
export function projectHistoricalAccounting(
  heads: readonly (FifoTrade & { kind: TradeKind })[],
  baseline: readonly FifoCarryInInput[],
  at: string,
) {
  const active = heads.filter((head) => head.kind !== 'void');
  if (heads.length > 10000 || active.length > MAX_ACTIVE_TRADES) throw new FifoHistoryError();
  const fifo = calculateFifo(
    active.filter((head) => head.occurredAt <= at),
    baseline,
  );
  return projectHistoricalFifo(fifo, baseline);
}

/** Aggregate all held fragments after the connected replay, before paging or pricing. */
export function projectHistoricalFifo(
  fifo:
    | Pick<CarryInFifoResult, 'lots' | 'summary'>
    | import('./owned-transfer-fifo').AccountFifoResult,
  baseline: readonly FifoCarryInInput[],
) {
  const totals = new Map<
    string,
    Omit<
      HistoricalPosition,
      'quantity' | 'costUsd' | 'knownCostSubtotalUsd' | 'unknownCostQuantity'
    > & { quantity: bigint; knownCost: bigint; unknownQuantity: bigint }
  >();
  for (const lot of fifo.lots) {
    const position = totals.get(lot.instrumentId) ?? {
      instrumentId: lot.instrumentId,
      instrumentName: lot.instrumentName,
      instrumentSymbol: lot.instrumentSymbol,
      quantity: 0n,
      knownCost: 0n,
      unknownQuantity: 0n,
    };
    const quantity = canonicalDecimalToAtoms(lot.remainingQuantity);
    position.quantity += quantity;
    if (lot.remainingCostUsd === null) position.unknownQuantity += quantity;
    else position.knownCost += canonicalDecimalToAtoms(lot.remainingCostUsd);
    totals.set(lot.instrumentId, position);
  }
  const initialCost = baseline.reduce(
    (sum, lot) =>
      sum +
      canonicalDecimalToAtoms(
        deriveCarryInAmounts(lot.originalQuantity, lot.originalCostUsd, lot.carriedQuantity)
          .carriedCostUsd,
      ),
    0n,
  );
  const positions: HistoricalPosition[] = [...totals.values()]
    .sort((left, right) => (left.instrumentId < right.instrumentId ? -1 : 1))
    .map((position) => ({
      instrumentId: position.instrumentId,
      instrumentName: position.instrumentName,
      instrumentSymbol: position.instrumentSymbol,
      quantity: formatAtoms(position.quantity),
      costUsd: position.unknownQuantity > 0n ? null : formatAtoms(position.knownCost),
      ...(position.unknownQuantity > 0n
        ? {
            knownCostSubtotalUsd: formatAtoms(position.knownCost),
            unknownCostQuantity: formatAtoms(position.unknownQuantity),
          }
        : {}),
    }));
  return {
    initialCostUsd: formatAtoms(initialCost),
    summary: fifo.summary,
    positions,
    ...('rewardSummary' in fifo && fifo.rewardSummary ? { rewardSummary: fifo.rewardSummary } : {}),
    ...('swapSummary' in fifo && fifo.swapSummary ? { swapSummary: fifo.swapSummary } : {}),
  };
}
