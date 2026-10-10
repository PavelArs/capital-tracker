import apiClient from './client';

export interface AccountSummary {
  id: string;
  name: string;
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

  /** WAL-RENAME: only the name changes; what is recorded in the account stays. */
  renameAccount: async (id: string, name: string): Promise<AccountSummary> => {
    const response = await apiClient.patch<AccountSummary>(
      `/accounting/accounts/${encodeURIComponent(id)}`,
      { name },
    );
    return response.data;
  },
};
