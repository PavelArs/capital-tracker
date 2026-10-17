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

/** One journal entry the history would become (backend tbank-import-plan PlanEntry). */
export interface TBankPlanEntry {
  record: 'trade' | 'reward';
  action: 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'income' | 'fee' | 'tax';
  occurredAt: string;
  ticker: string;
  quantity: string;
  amount: string;
  fee: string;
  currency: string;
  operationIds: string[];
}

export interface TBankImportProblem {
  reason:
    | 'not-recordable'
    | 'already-imported'
    | 'no-rate'
    | 'amount'
    | 'fee-above-proceeds'
    | 'not-held'
    | 'before-records'
    | 'too-many-rewards'
    | 'too-many-entries';
  occurredAt: string | null;
  ticker: string;
  operationIds: string[];
}

/** BROKER-SYNC: what a connected account's T-Bank history would become. Nothing is recorded. */
export interface TBankImportPreview {
  grouping: 'operation' | 'day' | 'month';
  entries: TBankPlanEntry[];
  skipped: { operationId: string; type: string; reason: string }[];
  trades: number;
  rewards: number;
  fitsTradeLimit: boolean;
  fitsRewardLimit: boolean;
  accountHasEntries: boolean;
  problems: TBankImportProblem[];
  canImport: boolean;
  previewHash: string;
}

export interface TBankImportReceipt {
  importId: string;
  accountId: string;
  requestId: string;
  trades: number;
  rewards: number;
  createdAt: string;
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

  importPreview: async (accountId: string): Promise<TBankImportPreview> => {
    const response = await apiClient.get<TBankImportPreview>(
      `/brokers/${accountId}/connection/import-preview`,
    );
    return response.data;
  },

  /** Writes the previewed history; a retry with the same request id returns the first receipt. */
  importHistory: async (
    accountId: string,
    requestId: string,
    previewHash: string,
  ): Promise<TBankImportReceipt> => {
    const response = await apiClient.post<TBankImportReceipt>(
      `/brokers/${accountId}/connection/import`,
      { requestId, previewHash },
    );
    return response.data;
  },
};
