import apiClient from './client';
import type { TransferAllocationItem } from './owned-transfers.api';
import type { BasisCoverage } from './trades.api';

export interface SwapFields {
  outgoingInstrumentId: string;
  incomingInstrumentId: string;
  occurredAt: string;
  orderWithinTimestamp: number;
  outgoingQuantity: string;
  incomingQuantity: string;
  considerationUsd: string | null;
  feeSource: 'held' | 'incoming' | null;
  feeInstrumentId: string | null;
  feeQuantity: string;
}
export interface SwapVersion extends SwapFields {
  swapId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  kind: 'create' | 'correct' | 'void';
  createdAt: string;
  outgoingInstrumentName: string;
  outgoingInstrumentSymbol: string | null;
  incomingInstrumentName: string;
  incomingInstrumentSymbol: string | null;
  feeInstrumentName: string | null;
  feeInstrumentSymbol: string | null;
}
export interface SwapReceipt {
  accountId: string;
  journalRevision: number;
  swap: SwapVersion;
}
export interface SwapCommand extends SwapFields {
  requestId: string;
  expectedJournalRevision: number;
  assertExecuted: true;
}
export interface SwapCorrectionCommand extends SwapCommand {
  expectedVersion: number;
}
export interface SwapVoidCommand {
  requestId: string;
  expectedJournalRevision: number;
  expectedVersion: number;
}
export interface SwapPage {
  accountId: string;
  journalRevision: number;
  activeCount: number;
  versionCount: number;
  limits: { activeSwaps: number; versions: number };
  items: SwapVersion[];
  nextOffset: number | null;
}
export interface SwapVersions {
  items: SwapVersion[];
  nextBeforeVersion: number | null;
}
export interface SwapTotals {
  considerationUsd: string | null;
  principalBasisUsd: string | null;
  feeConsumedBasisUsd: string | null;
  realizedUsd: string | null;
  coverage: {
    consideration: BasisCoverage;
    principal: BasisCoverage;
    fee: BasisCoverage;
    realized: BasisCoverage;
  };
}
export interface SwapSummary extends SwapTotals {
  activeCount: number;
}
export interface SwapAllocation extends SwapTotals {
  accountId: string;
  journalRevision: number;
  swapId: string;
  version: number;
  kind: SwapVersion['kind'];
  items: TransferAllocationItem[];
  nextOffset: number | null;
}
const accountPath = (accountId: string) =>
  `/accounting/accounts/${encodeURIComponent(accountId)}/swaps`;
const swapPath = (accountId: string, swapId: string) =>
  `${accountPath(accountId)}/${encodeURIComponent(swapId)}`;

export const assetSwapsApi = {
  create: async (accountId: string, input: SwapCommand): Promise<SwapReceipt> =>
    (await apiClient.post<SwapReceipt>(accountPath(accountId), input)).data,
  correct: async (
    accountId: string,
    swapId: string,
    input: SwapCorrectionCommand,
  ): Promise<SwapReceipt> =>
    (await apiClient.post<SwapReceipt>(`${swapPath(accountId, swapId)}/correct`, input)).data,
  void: async (accountId: string, swapId: string, input: SwapVoidCommand): Promise<SwapReceipt> =>
    (await apiClient.post<SwapReceipt>(`${swapPath(accountId, swapId)}/void`, input)).data,
  list: async (accountId: string, journalRevision: number, offset = 0): Promise<SwapPage> =>
    (
      await apiClient.get<SwapPage>(accountPath(accountId), {
        params: { journalRevision, offset, limit: 50 },
      })
    ).data,
  versions: async (
    accountId: string,
    swapId: string,
    beforeVersion?: number,
  ): Promise<SwapVersions> =>
    (
      await apiClient.get<SwapVersions>(`${swapPath(accountId, swapId)}/versions`, {
        params: { limit: 10, ...(beforeVersion === undefined ? {} : { beforeVersion }) },
      })
    ).data,
  allocation: async (
    accountId: string,
    swapId: string,
    journalRevision: number,
    expectedVersion: number,
    offset = 0,
  ): Promise<SwapAllocation> =>
    (
      await apiClient.get<SwapAllocation>(`${swapPath(accountId, swapId)}/allocation`, {
        params: { journalRevision, expectedVersion, offset, limit: 50 },
      })
    ).data,
};
