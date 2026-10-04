import { deriveCarryInAmounts, type FifoCarryInInput } from './fifo';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { JournalRow } from './trade-journal.store';

export interface CarryInOrigin {
  accountId: string;
  requestId: string;
  originKind: 'known-cost-carry-in';
  coverageFrom: string;
  openingRevision: number;
  lotCount: number;
  carryInCostUsd: string;
  createdAt: string;
}

export function projectCarryInOrigin(
  journal: Extract<JournalRow, { originKind: 'known-cost-carry-in' }>,
  baseline: readonly FifoCarryInInput[],
): CarryInOrigin {
  const cost = baseline.reduce(
    (sum, lot) =>
      sum +
      canonicalDecimalToAtoms(
        deriveCarryInAmounts(lot.originalQuantity, lot.originalCostUsd, lot.carriedQuantity)
          .carriedCostUsd,
      ),
    0n,
  );
  return {
    accountId: journal.accountId,
    requestId: journal.requestId,
    originKind: 'known-cost-carry-in',
    coverageFrom: journal.coverageFrom.toISOString(),
    openingRevision: journal.openingRevision,
    lotCount: baseline.length,
    carryInCostUsd: formatAtoms(cost),
    createdAt: journal.createdAt.toISOString(),
  };
}
