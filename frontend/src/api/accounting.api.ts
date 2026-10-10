import apiClient from './client';

/** W1: how the owner holds a wallet's coins. */
export type WalletKind = 'software' | 'hardware' | 'exchange';

export interface AccountSummary {
  id: string;
  name: string;
  /** Null until the owner says. */
  kind: WalletKind | null;
  currentRevision: number;
  createdAt: string;
}

export interface Instrument {
  id: string;
  name: string;
  symbol: string | null;
  namespace: 'manual';
  createdAt: string;
}

export interface UuidPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AccountInput {
  requestId: string;
  name: string;
  kind?: WalletKind;
}

export const accountingApi = {
  listAccounts: async (cursor?: string): Promise<UuidPage<AccountSummary>> => {
    const response = await apiClient.get<UuidPage<AccountSummary>>('/accounting/accounts', {
      params: { limit: 50, ...(cursor ? { cursor } : {}) },
    });
    return response.data;
  },

  createAccount: async (input: AccountInput): Promise<AccountSummary> => {
    const response = await apiClient.post<AccountSummary>('/accounting/accounts', input);
    return response.data;
  },

  /** WAL-RENAME, W1: the name and the kind change; what is recorded in the account stays. */
  updateAccount: async (
    id: string,
    changes: { name?: string; kind?: WalletKind | null },
  ): Promise<AccountSummary> => {
    const response = await apiClient.patch<AccountSummary>(
      `/accounting/accounts/${encodeURIComponent(id)}`,
      changes,
    );
    return response.data;
  },
};
