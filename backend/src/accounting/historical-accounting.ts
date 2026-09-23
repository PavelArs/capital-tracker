import {
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
  costUsd: string;
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
  const totals = new Map<
    string,
    Omit<HistoricalPosition, 'quantity' | 'costUsd'> & { quantity: bigint; costUsd: bigint }
  >();
  for (const lot of fifo.lots) {
    const position = totals.get(lot.instrumentId) ?? {
      instrumentId: lot.instrumentId,
      instrumentName: lot.instrumentName,
      instrumentSymbol: lot.instrumentSymbol,
      quantity: 0n,
      costUsd: 0n,
    };
    position.quantity += canonicalDecimalToAtoms(lot.remainingQuantity);
    position.costUsd += canonicalDecimalToAtoms(lot.remainingCostUsd);
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
      ...position,
      quantity: formatAtoms(position.quantity),
      costUsd: formatAtoms(position.costUsd),
    }));
  return { initialCostUsd: formatAtoms(initialCost), summary: fifo.summary, positions };
}
