import apiClient from './client';

// BROKER-SETUP: one read-only T-Bank token makes and connects a broker account for each T-Bank
// account the owner picks. The token goes to the server with each request and is never kept here.

export interface TBankAccountOption {
  /** T-Bank's own account number. */
  id: string;
  name: string;
  /** An Invest Box (Инвесткопилка). */
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
    | 'opening-holding'
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
  availableQuantity?: string;
  requiredQuantity?: string;
  missingQuantity?: string;
}

/** BROKER-SYNC: what a connected account's T-Bank history would become. Nothing is recorded. */
export interface TBankOpening {
  asOf: string;
  lots: { asset: string; acquiredAt: string; quantity: string; costUsd: string }[];
}

/** SPLIT: a share split declared for a security of the history, saved with the import. */
export interface TBankSplit {
  asset: string;
  effectiveAt: string;
  ratio: number;
}

export interface TBankImportPreview {
  openingAssets?: { asset: string; label: string; currency: string }[];
  grouping: 'operation' | 'day' | 'month';
  entries: TBankPlanEntry[];
  skipped: {
    operationId: string;
    type: string;
    reason: string;
    ticker?: string;
    occurredAt?: string | null;
  }[];
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

  importPreview: async (
    accountId: string,
    opening?: TBankOpening,
    splits?: TBankSplit[],
  ): Promise<TBankImportPreview> => {
    if (opening || splits)
      return (
        await apiClient.post<TBankImportPreview>(
          `/brokers/${accountId}/connection/import-preview`,
          { ...(opening ? { opening } : {}), ...(splits ? { splits } : {}) },
          { changesNothing: true },
        )
      ).data;
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
    opening?: TBankOpening,
    splits?: TBankSplit[],
  ): Promise<TBankImportReceipt> => {
    const response = await apiClient.post<TBankImportReceipt>(
      `/brokers/${accountId}/connection/import`,
      { requestId, previewHash, ...(opening ? { opening } : {}), ...(splits ? { splits } : {}) },
    );
    return response.data;
  },
};
