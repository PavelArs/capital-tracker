import type { FifoReward, RewardCategory, RewardSummary } from './asset-reward-types';
import type { FifoSwap, SwapAllocation, SwapSummary } from './asset-swap-types';
import type {
  CarryInFifoResult,
  CarryInLot,
  CarryInMatch,
  FifoCarryInInput,
  FifoLot,
  FifoMatch,
  FifoRealization,
  FifoSummary,
  FifoTrade,
} from './fifo';

export interface BasisCoverage {
  knownSubtotalUsd: string;
  unknownCount: number;
}

export interface ConnectedFifoSummary
  extends Omit<FifoSummary, 'consumedCostUsd' | 'realizedUsd' | 'remainingCostUsd'> {
  consumedCostUsd: string | null;
  realizedUsd: string | null;
  remainingCostUsd: string | null;
  basisCoverage?: {
    consumed: BasisCoverage;
    remaining: BasisCoverage;
    realized: BasisCoverage;
  };
}

export interface ConnectedFifoRealization
  extends Omit<FifoRealization, 'consumedCostUsd' | 'realizedUsd'> {
  consumedCostUsd: string | null;
  realizedUsd: string | null;
  basisCoverage?: { knownConsumedCostUsd: string; unknownMatchCount: number };
}

export interface OwnedAccountInput {
  accountId: string;
  coverageFrom: string;
  trades: readonly FifoTrade[];
  initialLots: readonly FifoCarryInInput[];
  rewards?: readonly FifoReward[];
  swaps?: readonly FifoSwap[];
}

/** Current-effective movement; immutable version history is resolved by the store. */
export interface ActiveTransferInput {
  transferId: string;
  version: number;
  fromAccountId: string;
  toAccountId: string;
  instrumentId: string;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  feeInstrumentId: string | null;
  feeQuantity: string;
}

export type LotOrigin =
  | {
      accountId: string;
      kind: 'trade';
      tradeId: string;
      version: number;
      acquiredAt: string;
      orderWithinTimestamp: number;
      originalQuantity: string;
      originalCostUsd: string;
    }
  | {
      accountId: string;
      kind: 'carry-in';
      lotId: string;
      openingRevision: number;
      ordinal: number;
      acquiredAt: string;
      orderWithinTimestamp: number;
      originalQuantity: string;
      originalCostUsd: string;
    }
  | {
      accountId: string;
      kind: 'reward';
      rewardId: string;
      version: number;
      category: RewardCategory;
      acquiredAt: string;
      orderWithinTimestamp: number;
      originalQuantity: string;
      originalCostUsd: string | null;
    }
  | {
      accountId: string;
      kind: 'swap';
      swapId: string;
      version: number;
      acquiredAt: string;
      orderWithinTimestamp: number;
      originalQuantity: string;
      originalCostUsd: string | null;
    };

export interface TransferArrival {
  transferId: string;
  version: number;
}

export interface TransferAllocationItem {
  kind: 'principal' | 'fee';
  instrumentId: string;
  quantity: string;
  costUsd: string | null;
  origin: LotOrigin;
  intervalStart: string;
  intervalEnd: string;
  arrival: TransferArrival | null;
}

export interface TransferAllocation {
  transferId: string;
  principalBasisUsd: string | null;
  feeConsumedBasisUsd: string | null;
  items: TransferAllocationItem[];
  basisCoverage?: { principal: BasisCoverage; fee: BasisCoverage };
}

export interface RewardLot {
  sourceKind: 'reward';
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  origin: Extract<LotOrigin, { kind: 'reward' }>;
  intervalStart: string;
  intervalEnd: string;
  remainingQuantity: string;
  remainingCostUsd: string | null;
}

export interface RewardSaleMatch {
  sourceKind: 'reward';
  sellTradeId: string;
  sellVersion: number;
  origin: Extract<LotOrigin, { kind: 'reward' }>;
  intervalStart: string;
  intervalEnd: string;
  quantity: string;
  costUsd: string | null;
}

export interface SwapLot {
  sourceKind: 'swap';
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  origin: Extract<LotOrigin, { kind: 'swap' }>;
  intervalStart: string;
  intervalEnd: string;
  remainingQuantity: string;
  remainingCostUsd: string | null;
}

export interface SwapSaleMatch {
  sourceKind: 'swap';
  sellTradeId: string;
  sellVersion: number;
  origin: Extract<LotOrigin, { kind: 'swap' }>;
  intervalStart: string;
  intervalEnd: string;
  quantity: string;
  costUsd: string | null;
}

export interface ReceivedLot {
  sourceKind: 'transfer';
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  origin: LotOrigin;
  arrival: TransferArrival;
  intervalStart: string;
  intervalEnd: string;
  remainingQuantity: string;
  remainingCostUsd: string | null;
}

export interface ReceivedSaleMatch {
  sourceKind: 'transfer';
  sellTradeId: string;
  sellVersion: number;
  origin: LotOrigin;
  arrival: TransferArrival;
  intervalStart: string;
  intervalEnd: string;
  quantity: string;
  costUsd: string | null;
}

export interface TransferFeeSummary {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  consumedBasisUsd: string | null;
  knownBasisSubtotalUsd?: string;
  unknownCostQuantity?: string;
}

export interface TransferSummary {
  receivedBasisUsd: string | null;
  sentBasisUsd: string | null;
  feeConsumedBasisUsd: string | null;
  fees: TransferFeeSummary[];
  basisCoverage?: { received: BasisCoverage; sent: BasisCoverage; fee: BasisCoverage };
}

export interface AccountFifoResult
  extends Omit<CarryInFifoResult, 'summary' | 'realizations' | 'lots' | 'matches'> {
  summary: ConnectedFifoSummary;
  realizations: ConnectedFifoRealization[];
  lots: (FifoLot | CarryInLot | RewardLot | SwapLot | ReceivedLot)[];
  matches: (FifoMatch | CarryInMatch | RewardSaleMatch | SwapSaleMatch | ReceivedSaleMatch)[];
  transferSummary?: TransferSummary;
  rewardSummary?: RewardSummary;
  swapSummary?: SwapSummary;
}

export interface OwnedProjection {
  accounts: ReadonlyMap<string, AccountFifoResult>;
  allocations: ReadonlyMap<string, TransferAllocation>;
  swapAllocations: ReadonlyMap<string, SwapAllocation>;
}
