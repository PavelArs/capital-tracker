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
  consumedCostUsd: string;
  realizedUsd: string;
  remainingCostUsd: string;
}
export interface Journal extends JournalOrigin {
  journalRevision: number;
  activeTradeCount: number;
  versionCount: number;
  limits: { activeTrades: number; versions: number };
  summary: TradeSummary;
}
export interface JournalState {
  accountId: string;
  eligible: boolean;
  ineligibilityReason: 'opening-history' | 'already-initialized' | null;
  journal: Journal | null;
}
export interface TradeVersion extends TradeExecution {
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
  consumedCostUsd: string;
  realizedUsd: string;
}
export interface TradeMatch {
  sellTradeId: string;
  sellVersion: number;
  buyTradeId: string;
  buyVersion: number;
  quantity: string;
  costUsd: string;
}
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
export interface TradeCommand extends TradeExecution {
  requestId: string;
  expectedJournalRevision: number;
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
  lots: async (id: string, revision: number, offset = 0): Promise<TradePage<TradeLot>> =>
    (
      await apiClient.get<TradePage<TradeLot>>(`${accountPath(id)}/trade-lots`, {
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
  ): Promise<TradePage<TradeMatch>> =>
    (
      await apiClient.get<TradePage<TradeMatch>>(`${tradePath(id, tradeId)}/matches`, {
        params: pageParams(revision, offset),
      })
    ).data,
  versions: async (id: string, tradeId: string, beforeVersion?: number): Promise<TradeVersions> =>
    (
      await apiClient.get<TradeVersions>(`${tradePath(id, tradeId)}/versions`, {
        params: { limit: 10, ...(beforeVersion === undefined ? {} : { beforeVersion }) },
      })
    ).data,
};
