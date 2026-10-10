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

export interface Position {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  quantity: string;
  costStatus: 'known' | 'unknown';
  totalCostUsd: string | null;
}

export interface Opening {
  accountId: string;
  revision: number;
  requestId: string;
  asOf: string;
  createdAt: string;
  positions: Position[];
}

export interface AccountDetail extends AccountSummary {
  currentOpening: Opening | null;
}

export interface UuidPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OpeningPage {
  items: Opening[];
  nextCursor: number | null;
}

export interface AccountInput {
  requestId: string;
  name: string;
  kind?: WalletKind;
}

export interface InstrumentInput {
  requestId: string;
  name: string;
  symbol?: string;
}

export interface OpeningInput {
  requestId: string;
  expectedRevision: number;
  asOf: string;
  positions: Array<{
    instrumentId: string;
    quantity: string;
    costStatus: 'known' | 'unknown';
    totalCostUsd: string | null;
  }>;
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

  getAccount: async (id: string): Promise<AccountDetail> => {
    const response = await apiClient.get<AccountDetail>(
      `/accounting/accounts/${encodeURIComponent(id)}`,
    );
    return response.data;
  },

  listInstruments: async (cursor?: string): Promise<UuidPage<Instrument>> => {
    const response = await apiClient.get<UuidPage<Instrument>>('/accounting/instruments', {
      params: { limit: 50, ...(cursor ? { cursor } : {}) },
    });
    return response.data;
  },

  createInstrument: async (input: InstrumentInput): Promise<Instrument> => {
    const response = await apiClient.post<Instrument>('/accounting/instruments', input);
    return response.data;
  },

  saveOpening: async (accountId: string, input: OpeningInput): Promise<Opening> => {
    const response = await apiClient.post<Opening>(
      `/accounting/accounts/${encodeURIComponent(accountId)}/openings`,
      input,
    );
    return response.data;
  },

  listOpenings: async (accountId: string, beforeRevision?: number): Promise<OpeningPage> => {
    const response = await apiClient.get<OpeningPage>(
      `/accounting/accounts/${encodeURIComponent(accountId)}/openings`,
      { params: { limit: 10, ...(beforeRevision === undefined ? {} : { beforeRevision }) } },
    );
    return response.data;
  },
};
