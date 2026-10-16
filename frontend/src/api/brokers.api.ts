import apiClient from './client';

// BROKER-SETUP: one read-only T-Bank token makes and connects a broker account for each T-Bank
// account the owner picks. The token goes to the server with each request and is never kept here.

export interface TBankAccountOption {
  /** T-Bank's own account number. */
  id: string;
  name: string;
  /** An Invest Box (Инвесткопилка): T-Bank gives no portfolio for it. */
  investBox: boolean;
  /** Already read by one of the owner's broker accounts. */
  connected: boolean;
}

export interface TBankPick {
  brokerAccountId: string;
  /** Names the broker account this pick makes, so a repeat finds it again. */
  requestId: string;
  name: string;
}

export interface TBankConnection {
  accountId: string;
  name: string;
  brokerAccountId: string;
  /** False when the account was made by an earlier request with the same id. */
  created: boolean;
}

/** Whether a broker account reads T-Bank, without the token. */
export type TBankConnectionState = { connected: false } | { connected: true; tokenHint: string };

export type ImportProblemReason =
  | 'not-recordable'
  | 'already-imported'
  | 'no-rate'
  | 'amount'
  | 'fee-above-proceeds'
  | 'not-held'
  | 'before-records'
  | 'too-many-rewards'
  | 'too-many-entries';

/** What the T-Bank history would become in an empty broker account. Nothing is recorded. */
export interface TBankImportPreview {
  /** How far operations were combined to fit the trade limit. */
  grouping: 'operation' | 'day' | 'month';
  entries: { record: 'trade' | 'reward'; occurredAt: string }[];
  skipped: { operationId: string; type: string; reason: string }[];
  trades: number;
  rewards: number;
  fitsTradeLimit: boolean;
  fitsRewardLimit: boolean;
  /** The account already holds records, so nothing can be written into it. */
  accountHasEntries: boolean;
  problems: {
    reason: ImportProblemReason;
    occurredAt: string | null;
    ticker: string;
    operationIds: string[];
  }[];
  canImport: boolean;
  previewHash: string;
}

export interface TBankImportReceipt {
  importId: string;
  trades: number;
  rewards: number;
}

export const brokersApi = {
  /** The open T-Bank accounts a read-only token reaches. Nothing is stored. */
  tbankAccounts: async (token: string): Promise<TBankAccountOption[]> => {
    const response = await apiClient.post<{ accounts: TBankAccountOption[] }>(
      '/brokers/tbank/accounts',
      { token },
      { changesNothing: true },
    );
    return response.data.accounts;
  },

  connectTBank: async (token: string, accounts: TBankPick[]): Promise<TBankConnection[]> => {
    const response = await apiClient.post<{ connections: TBankConnection[] }>(
      '/brokers/tbank/connect',
      { token, accounts },
    );
    return response.data.connections;
  },

  /** Whether the broker account is connected to T-Bank. */
  connection: async (accountId: string): Promise<TBankConnectionState> => {
    const response = await apiClient.get<TBankConnectionState>(`/brokers/${accountId}/connection`);
    return response.data;
  },

  importPreview: async (accountId: string): Promise<TBankImportPreview> => {
    const response = await apiClient.get<TBankImportPreview>(
      `/brokers/${accountId}/connection/import-preview`,
    );
    return response.data;
  },

  /** Writes the previewed history in one command; `requestId` makes a retry return the receipt. */
  importHistory: async (
    accountId: string,
    input: { requestId: string; previewHash: string },
  ): Promise<TBankImportReceipt> => {
    const response = await apiClient.post<TBankImportReceipt>(
      `/brokers/${accountId}/connection/import`,
      input,
    );
    return response.data;
  },
};
