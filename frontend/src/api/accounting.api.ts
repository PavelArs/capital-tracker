import apiClient from './client';

/** W1: how the owner holds a wallet's coins. */
export type WalletKind = 'software' | 'hardware' | 'exchange';
/** Asset classes (v8): an account that holds a broker account or a property, not coins. */
export type AccountClass = 'broker' | 'property';

export interface AccountSummary {
  id: string;
  name: string;
  /** Null until the owner says. */
  kind: WalletKind | null;
  /** Null for a wallet; absent from servers older than the class. */
  assetClass?: AccountClass | null;
  /**
   * BROKER-SETUP: for a broker account read with a token, the provider and whether its history
   * has been imported; null for any other account. Only the account list gives it; absent
   * elsewhere and from older servers.
   */
  connection?: { provider: 'tbank'; imported: boolean } | null;
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
  /** Set once when the account is made; never sent with a kind. */
  assetClass?: AccountClass;
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

  /**
   * WALLET-REMOVE: stops tracking a wallet that holds no recorded transaction (409 otherwise,
   * with the reason in the body).
   */
  removeAccount: async (id: string): Promise<void> => {
    await apiClient.delete(`/accounting/accounts/${encodeURIComponent(id)}`);
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
