/**
 * A share split of one security, for every account that holds it: from `effectiveAt` each unit
 * held becomes `ratio` units, and what the units cost stays the same.
 */
export interface FifoSplit {
  splitId: string;
  instrumentId: string;
  effectiveAt: string;
  /** New units per unit held before the split: a whole number from 2 to 1,000,000. */
  ratio: number;
}

export const SPLIT_LIMITS = { activeSplits: 1000, maxRatio: 1_000_000 } as const;

export const validSplitRatio = (ratio: number) =>
  Number.isSafeInteger(ratio) && ratio >= 2 && ratio <= SPLIT_LIMITS.maxRatio;
