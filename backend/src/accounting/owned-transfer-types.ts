import type {
  CarryInFifoResult,
  CarryInLot,
  CarryInMatch,
  FifoCarryInInput,
  FifoLot,
  FifoMatch,
  FifoTrade,
} from './fifo';

export interface OwnedAccountInput {
  accountId: string;
  coverageFrom: string;
  trades: readonly FifoTrade[];
  initialLots: readonly FifoCarryInInput[];
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
    };

export interface TransferArrival {
  transferId: string;
  version: number;
}

export interface TransferAllocationItem {
  kind: 'principal' | 'fee';
  instrumentId: string;
  quantity: string;
  costUsd: string;
  origin: LotOrigin;
  intervalStart: string;
  intervalEnd: string;
  arrival: TransferArrival | null;
}

export interface TransferAllocation {
  transferId: string;
  principalBasisUsd: string;
  feeConsumedBasisUsd: string;
  items: TransferAllocationItem[];
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
  remainingCostUsd: string;
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
  costUsd: string;
}

export interface TransferFeeSummary {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  consumedBasisUsd: string;
}

export interface TransferSummary {
  receivedBasisUsd: string;
  sentBasisUsd: string;
  feeConsumedBasisUsd: string;
  fees: TransferFeeSummary[];
}

export interface AccountFifoResult extends Omit<CarryInFifoResult, 'lots' | 'matches'> {
  lots: (FifoLot | CarryInLot | ReceivedLot)[];
  matches: (FifoMatch | CarryInMatch | ReceivedSaleMatch)[];
  transferSummary?: TransferSummary;
}

export interface OwnedProjection {
  accounts: ReadonlyMap<string, AccountFifoResult>;
  allocations: ReadonlyMap<string, TransferAllocation>;
}
