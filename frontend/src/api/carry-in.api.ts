import type { Opening } from './accounting.api';
import apiClient from './client';

export interface CarryInLotInput {
  instrumentId: string;
  acquiredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string;
  remainingQuantity: string;
}
export interface CarryInPreviewInput {
  expectedOpeningRevision: number;
  lots: CarryInLotInput[];
}
export interface CarryInInitialization extends CarryInPreviewInput {
  requestId: string;
  assertReviewed: true;
}
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
export interface CarryInState {
  accountId: string;
  eligible: boolean;
  ineligibilityReason: 'already-initialized' | 'no-current-opening' | 'unknown-cost' | null;
  opening: Opening | null;
  origin: CarryInOrigin | null;
}
interface LotLabel {
  instrumentName: string;
  instrumentSymbol: string | null;
}
export interface CarryInPreviewLot extends CarryInLotInput, LotLabel {
  ordinal: number;
  priorDisposedQuantity: string;
  priorAllocatedCostUsd: string;
  carriedCostUsd: string;
}
export interface CarryInPreview {
  accountId: string;
  openingRevision: number;
  coverageFrom: string;
  canInitialize: boolean;
  issues: Array<{
    code:
      | 'acquisition-after-coverage'
      | 'extra-instrument'
      | 'missing-instrument'
      | 'quantity-mismatch'
      | 'cost-mismatch';
    instrumentId: string | null;
    ordinal: number | null;
  }>;
  lots: CarryInPreviewLot[];
  reconciliation: Array<
    LotLabel & {
      instrumentId: string;
      openingQuantity: string | null;
      openingCostUsd: string | null;
      carriedQuantity: string;
      carriedCostUsd: string;
    }
  >;
  carryInCostUsd: string;
}
export interface CarryInEvidenceLot extends LotLabel {
  lotId: string;
  ordinal: number;
  instrumentId: string;
  acquiredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string;
  carriedQuantity: string;
  priorDisposedQuantity: string;
  priorAllocatedCostUsd: string;
  carriedCostUsd: string;
}
export interface CarryInLots {
  accountId: string;
  openingRevision: number;
  items: CarryInEvidenceLot[];
  nextAfterOrdinal: number | null;
}
export interface CarryInCurrentLot
  extends Omit<CarryInEvidenceLot, 'priorDisposedQuantity' | 'priorAllocatedCostUsd'> {
  sourceKind: 'carry-in';
  openingRevision: number;
  remainingQuantity: string;
  remainingCostUsd: string;
}
export interface CarryInMatch {
  sourceKind: 'carry-in';
  sellTradeId: string;
  sellVersion: number;
  lotId: string;
  openingRevision: number;
  ordinal: number;
  quantity: string;
  costUsd: string;
}

const path = (accountId: string) =>
  `/accounting/accounts/${encodeURIComponent(accountId)}/trade-journal/carry-in`;
export const carryInApi = {
  state: async (accountId: string): Promise<CarryInState> =>
    (await apiClient.get<CarryInState>(path(accountId))).data,
  preview: async (accountId: string, input: CarryInPreviewInput): Promise<CarryInPreview> =>
    (await apiClient.post<CarryInPreview>(`${path(accountId)}/preview`, input)).data,
  initialize: async (accountId: string, input: CarryInInitialization): Promise<CarryInOrigin> =>
    (await apiClient.post<CarryInOrigin>(path(accountId), input)).data,
  lots: async (accountId: string, afterOrdinal = 0): Promise<CarryInLots> =>
    (
      await apiClient.get<CarryInLots>(`${path(accountId)}/lots`, {
        params: { afterOrdinal, limit: 50 },
      })
    ).data,
};
