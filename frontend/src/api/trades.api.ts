import type { SwapSummary } from './asset-swaps.api';
import type { CarryInCurrentLot, CarryInMatch, CarryInOrigin } from './carry-in.api';
import apiClient from './client';

export interface TradeExecution {
  instrumentId: string;
  side: 'buy' | 'sell';
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
}
/** Amounts as paid in RUB or EUR; the trade's USD amounts are derived from them at the
 * Bank of Russia rate of its date, or at `perUsd` (units per 1 USD) when the owner gives it. */
export interface TradePaymentInput {
  currency: 'RUB' | 'EUR';
  gross: string;
  fee: string;
  perUsd?: string;
}
export interface TradePayment {
  currency: 'RUB' | 'EUR';
  gross: string;
  fee: string;
  rateDate: string;
  /** Units of the paid currency per 1 USD that gave the stored USD amounts. */
  perUsd: string;
  rateSource: 'bank-of-russia' | 'owner';
}
export interface JournalOrigin {
  accountId: string;
  requestId: string;
  originKind: 'declared-empty';
  coverageFrom: string;
  createdAt: string;
}
export interface TradeSummary {
  grossBuysUsd: string;
  buyFeesUsd: string;
  grossSalesUsd: string;
  sellFeesUsd: string;
  netSalesUsd: string;
  consumedCostUsd: string | null;
  realizedUsd: string | null;
  remainingCostUsd: string | null;
  basisCoverage?: {
    consumed: BasisCoverage;
    remaining: BasisCoverage;
    realized: BasisCoverage;
  };
}
export interface BasisCoverage {
  knownSubtotalUsd: string;
  unknownCount: number;
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
export interface RevisionBudget {
  used: number;
  limit: 10000;
}
export type Journal = (JournalOrigin | CarryInOrigin) & {
  journalRevision: number;
  activeTradeCount: number;
  versionCount: number;
  limits: { activeTrades: number; versions: number };
  summary: TradeSummary;
  transferSummary?: TransferSummary;
  rewardSummary?: RewardSummary;
  swapSummary?: SwapSummary;
  revisionBudget?: RevisionBudget;
};
export interface JournalState {
  accountId: string;
  eligible: boolean;
  ineligibilityReason: 'opening-history' | 'already-initialized' | null;
  journal: Journal | null;
}
export interface TradeVersion extends TradeExecution {
  paid?: TradePayment;
  comment?: string;
  tradeId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  kind: 'create' | 'correct' | 'void';
  createdAt: string;
  instrumentName: string;
  instrumentSymbol: string | null;
}
export interface TradeReceipt {
  accountId: string;
  journalRevision: number;
  trade: TradeVersion;
}
export interface TradeLot {
  buyTradeId: string;
  buyVersion: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string;
  remainingQuantity: string;
  remainingCostUsd: string;
}
export interface TradeRealization {
  sellTradeId: string;
  sellVersion: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
  netUsd: string;
  consumedCostUsd: string | null;
  realizedUsd: string | null;
  basisCoverage?: { knownConsumedCostUsd: string; unknownMatchCount: number };
}
export interface TradeMatch {
  sellTradeId: string;
  sellVersion: number;
  buyTradeId: string;
  buyVersion: number;
  quantity: string;
  costUsd: string;
}
export interface TransferArrival {
  transferId: string;
  version: number;
}
export interface RewardOrigin {
  accountId: string;
  kind: 'reward';
  rewardId: string;
  version: number;
  category: 'staking' | 'airdrop' | 'other' | 'unclassified';
  acquiredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string | null;
}
export interface SwapOrigin {
  accountId: string;
  kind: 'swap';
  swapId: string;
  version: number;
  acquiredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string | null;
}
export interface SwapCurrentLot {
  sourceKind: 'swap';
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  origin: SwapOrigin;
  intervalStart: string;
  intervalEnd: string;
  remainingQuantity: string;
  remainingCostUsd: string | null;
}
export interface SwapMatch {
  sourceKind: 'swap';
  sellTradeId: string;
  sellVersion: number;
  origin: SwapOrigin;
  intervalStart: string;
  intervalEnd: string;
  quantity: string;
  costUsd: string | null;
}
export type TransferOrigin =
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
      kind: 'trade';
      tradeId: string;
      version: number;
      acquiredAt: string;
      orderWithinTimestamp: number;
      originalQuantity: string;
      originalCostUsd: string;
    }
  | RewardOrigin
  | SwapOrigin;
export interface RewardCurrentLot {
  sourceKind: 'reward';
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  origin: RewardOrigin;
  intervalStart: string;
  intervalEnd: string;
  remainingQuantity: string;
  remainingCostUsd: string | null;
}
export interface RewardMatch {
  sourceKind: 'reward';
  sellTradeId: string;
  sellVersion: number;
  origin: RewardOrigin;
  intervalStart: string;
  intervalEnd: string;
  quantity: string;
  costUsd: string | null;
}
export interface TransferCurrentLot {
  sourceKind: 'transfer';
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  origin: TransferOrigin;
  arrival: TransferArrival;
  intervalStart: string;
  intervalEnd: string;
  remainingQuantity: string;
  remainingCostUsd: string | null;
}
export interface TransferMatch {
  sourceKind: 'transfer';
  sellTradeId: string;
  sellVersion: number;
  origin: TransferOrigin;
  arrival: TransferArrival;
  intervalStart: string;
  intervalEnd: string;
  quantity: string;
  costUsd: string | null;
}
export type JournalLot =
  | TradeLot
  | CarryInCurrentLot
  | RewardCurrentLot
  | SwapCurrentLot
  | TransferCurrentLot;
export type JournalMatch = TradeMatch | CarryInMatch | RewardMatch | SwapMatch | TransferMatch;
export interface TradePage<T> {
  journalRevision: number;
  items: T[];
  nextOffset: number | null;
}
export interface TradeVersions {
  tradeId: string;
  items: TradeVersion[];
  nextBeforeVersion: number | null;
}
/** Without an order the server places the trade after every operation at its instant. */
export type TradeCommand = Omit<TradeExecution, 'grossUsd' | 'feeUsd' | 'orderWithinTimestamp'> &
  ({ grossUsd: string; feeUsd: string } | { paid: TradePaymentInput }) & {
    orderWithinTimestamp?: number;
    comment?: string;
    requestId: string;
    expectedJournalRevision: number;
  };
/** What an account can sell or send at an instant: its lowest balance from then on. */
export interface AvailableQuantity {
  accountId: string;
  instrumentId: string;
  at: string;
  journalRevision: number | null;
  quantity: string;
}
/** A 409 that names the later operation a change would leave short (OPS-DELETE-GUARD). */
export interface DependentOperation {
  operationId: string;
  accountId: string;
  instrumentId: string;
  occurredAt: string;
}
export interface VoidCommand {
  requestId: string;
  expectedJournalRevision: number;
}

const accountPath = (id: string) => `/accounting/accounts/${encodeURIComponent(id)}`;
const tradePath = (id: string, tradeId: string) =>
  `${accountPath(id)}/trades/${encodeURIComponent(tradeId)}`;
const pageParams = (journalRevision: number, offset = 0) => ({
  journalRevision,
  offset,
  limit: 50,
});

export const tradesApi = {
  state: async (id: string): Promise<JournalState> =>
    (await apiClient.get<JournalState>(`${accountPath(id)}/trade-journal`)).data,
  initialize: async (
    id: string,
    input: { requestId: string; coverageFrom: string; assertEmpty: true },
  ): Promise<JournalOrigin> =>
    (await apiClient.post<JournalOrigin>(`${accountPath(id)}/trade-journal`, input)).data,
  create: async (id: string, input: TradeCommand): Promise<TradeReceipt> =>
    (await apiClient.post<TradeReceipt>(`${accountPath(id)}/trades`, input)).data,
  correct: async (id: string, tradeId: string, input: TradeCommand): Promise<TradeReceipt> =>
    (await apiClient.post<TradeReceipt>(`${tradePath(id, tradeId)}/corrections`, input)).data,
  void: async (id: string, tradeId: string, input: VoidCommand): Promise<TradeReceipt> =>
    (await apiClient.post<TradeReceipt>(`${tradePath(id, tradeId)}/voids`, input)).data,
  trades: async (id: string, revision: number, offset = 0): Promise<TradePage<TradeVersion>> =>
    (
      await apiClient.get<TradePage<TradeVersion>>(`${accountPath(id)}/trades`, {
        params: pageParams(revision, offset),
      })
    ).data,
  lots: async (id: string, revision: number, offset = 0): Promise<TradePage<JournalLot>> =>
    (
      await apiClient.get<TradePage<JournalLot>>(`${accountPath(id)}/trade-lots`, {
        params: pageParams(revision, offset),
      })
    ).data,
  realizations: async (
    id: string,
    revision: number,
    offset = 0,
  ): Promise<TradePage<TradeRealization>> =>
    (
      await apiClient.get<TradePage<TradeRealization>>(`${accountPath(id)}/trade-realizations`, {
        params: pageParams(revision, offset),
      })
    ).data,
  matches: async (
    id: string,
    tradeId: string,
    revision: number,
    offset = 0,
  ): Promise<TradePage<JournalMatch>> =>
    (
      await apiClient.get<TradePage<JournalMatch>>(`${tradePath(id, tradeId)}/matches`, {
        params: pageParams(revision, offset),
      })
    ).data,
  available: async (
    id: string,
    query: { instrumentId: string; at: string; excludeTradeId?: string },
  ): Promise<AvailableQuantity> =>
    (await apiClient.get<AvailableQuantity>(`${accountPath(id)}/available`, { params: query }))
      .data,
  versions: async (id: string, tradeId: string, beforeVersion?: number): Promise<TradeVersions> =>
    (
      await apiClient.get<TradeVersions>(`${tradePath(id, tradeId)}/versions`, {
        params: { limit: 10, ...(beforeVersion === undefined ? {} : { beforeVersion }) },
      })
    ).data,
};
