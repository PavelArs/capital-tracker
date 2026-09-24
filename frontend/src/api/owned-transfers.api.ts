import apiClient from './client';
import type { BasisCoverage, TransferArrival, TransferOrigin } from './trades.api';

export interface TransferMovement {
  instrumentId: string;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  feeInstrumentId: string | null;
  feeQuantity: string;
}

export interface TransferVersion extends TransferMovement {
  transferId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  kind: 'create' | 'correct' | 'void';
  createdAt: string;
  fromAccountId: string;
  toAccountId: string;
  fromJournalRevision: number;
  toJournalRevision: number;
  instrumentName: string;
  instrumentSymbol: string | null;
  feeInstrumentName: string | null;
  feeInstrumentSymbol: string | null;
}

export interface TransferReceipt {
  journalRevision: number;
  transfer: TransferVersion;
}

export interface TransferCommand extends TransferMovement {
  requestId: string;
  expectedFromJournalRevision: number;
  expectedToJournalRevision: number;
  assertInternal: true;
}

export interface TransferCreateCommand extends TransferCommand {
  fromAccountId: string;
  toAccountId: string;
}

export interface TransferCorrectionCommand extends TransferCommand {
  expectedVersion: number;
}

export interface TransferVoidCommand {
  requestId: string;
  expectedVersion: number;
  expectedFromJournalRevision: number;
  expectedToJournalRevision: number;
}

export interface TransferPage {
  journalRevision: number;
  activeCount: number;
  versionCount: number;
  limits: { activeTransfers: number; versions: number };
  items: TransferVersion[];
  nextOffset: number | null;
}

export interface TransferVersions {
  items: TransferVersion[];
  nextBeforeVersion: number | null;
}

export interface TransferAllocationItem {
  kind: 'principal' | 'fee';
  instrumentId: string;
  quantity: string;
  costUsd: string | null;
  origin: TransferOrigin;
  intervalStart: string;
  intervalEnd: string;
  arrival: TransferArrival | null;
}

export interface TransferAllocation {
  transferId: string;
  version: number;
  fromJournalRevision: number;
  toJournalRevision: number;
  principalBasisUsd: string | null;
  feeConsumedBasisUsd: string | null;
  items: TransferAllocationItem[];
  nextOffset: number | null;
  basisCoverage?: { principal: BasisCoverage; fee: BasisCoverage };
}

const path = '/accounting/transfers';
const transferPath = (id: string) => `${path}/${encodeURIComponent(id)}`;

export const ownedTransfersApi = {
  create: async (input: TransferCreateCommand): Promise<TransferReceipt> =>
    (await apiClient.post<TransferReceipt>(path, input)).data,
  correct: async (id: string, input: TransferCorrectionCommand): Promise<TransferReceipt> =>
    (await apiClient.post<TransferReceipt>(`${transferPath(id)}/corrections`, input)).data,
  void: async (id: string, input: TransferVoidCommand): Promise<TransferReceipt> =>
    (await apiClient.post<TransferReceipt>(`${transferPath(id)}/voids`, input)).data,
  list: async (journalRevision?: number, offset = 0): Promise<TransferPage> =>
    (
      await apiClient.get<TransferPage>(path, {
        params: {
          ...(journalRevision === undefined ? {} : { journalRevision }),
          offset,
          limit: 50,
        },
      })
    ).data,
  versions: async (id: string, beforeVersion?: number): Promise<TransferVersions> =>
    (
      await apiClient.get<TransferVersions>(`${transferPath(id)}/versions`, {
        params: { limit: 10, ...(beforeVersion === undefined ? {} : { beforeVersion }) },
      })
    ).data,
  allocation: async (
    id: string,
    fromJournalRevision?: number,
    toJournalRevision?: number,
    offset = 0,
  ): Promise<TransferAllocation> =>
    (
      await apiClient.get<TransferAllocation>(`${transferPath(id)}/allocation`, {
        params: {
          ...(fromJournalRevision === undefined ? {} : { fromJournalRevision }),
          ...(toJournalRevision === undefined ? {} : { toJournalRevision }),
          offset,
          limit: 50,
        },
      })
    ).data,
};
