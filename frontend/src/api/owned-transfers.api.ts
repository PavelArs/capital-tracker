import apiClient from './client';

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

/** Without an order the server places the transfer after every operation at its instant. */
export interface TransferCommand extends Omit<TransferMovement, 'orderWithinTimestamp'> {
  orderWithinTimestamp?: number;
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

const path = '/accounting/transfers';
const transferPath = (id: string) => `${path}/${encodeURIComponent(id)}`;

export const ownedTransfersApi = {
  create: async (input: TransferCreateCommand): Promise<TransferReceipt> =>
    (await apiClient.post<TransferReceipt>(path, input)).data,
  correct: async (id: string, input: TransferCorrectionCommand): Promise<TransferReceipt> =>
    (await apiClient.post<TransferReceipt>(`${transferPath(id)}/corrections`, input)).data,
  void: async (id: string, input: TransferVoidCommand): Promise<TransferReceipt> =>
    (await apiClient.post<TransferReceipt>(`${transferPath(id)}/voids`, input)).data,
};
