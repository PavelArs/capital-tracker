export type RewardCategory = 'staking' | 'airdrop' | 'other' | 'unclassified';

/** Current effective head; persistence resolves immutable versions before projection. */
export interface FifoReward {
  rewardId: string;
  version: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  category: RewardCategory;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  acquisitionBasisUsd: string | null;
  incomeValueUsd: string | null;
}

export interface RewardSummary {
  activeCount: number;
  declaredBasisUsd: string | null;
  declaredIncomeUsd: string | null;
  knownBasisSubtotalUsd: string;
  knownIncomeSubtotalUsd: string;
  unknownBasisCount: number;
  unknownIncomeCount: number;
  unclassifiedCount: number;
}
