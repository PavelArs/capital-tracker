import apiClient from './client';
import type { SourceState } from './sync-status.api';

export type SyncState = 'never' | 'partial' | 'complete';
export type SyncOutcome = 'complete' | 'partial' | 'provider_error';
export type ProviderFailure =
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'not_configured';
export type Network = 'bitcoin' | 'ethereum';

/** One asset's balance on the chain, an exact decimal. */
export interface ChainBalance {
  symbol: string;
  quantity: string;
}

export interface WalletAddress {
  id: string;
  network: Network;
  address: string;
  /** The account (wallet) the address belongs to; null until the owner picks one. */
  accountId: string | null;
  label: string | null;
  createdAt: string;
  transactionCount: number;
  /** The network's own coin on the chain from the whole stored history; null until a sync completes. */
  chainBalance: string | null;
  /** Every asset the wallet can hold (ETH, USDT, USDC on Ethereum); null until a sync completes. */
  balances: ChainBalance[] | null;
  sync: {
    /** How much of the history is stored. */
    state: SyncState;
    completedAt: string | null;
    /** The background source of this wallet (PR-SYN-1); null until its first sync. */
    status: SourceState | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    nextRunAt: string | null;
    /** Why the last sync failed or was delayed, in plain words. */
    errorMessage: string | null;
  };
}

export interface NewWalletAddress {
  network: Network;
  address: string;
  accountId?: string;
  label?: string;
}

export interface WalletAddressChanges {
  accountId?: string | null;
  label?: string | null;
}

export interface SyncResult {
  outcome: SyncOutcome;
  reason: ProviderFailure | null;
  imported: number;
  address: WalletAddress;
}

export interface AddressTransaction {
  txid: string;
  blockHeight: number;
  blockTime: string;
  direction: 'in' | 'out' | 'self';
  /** The asset the leg moves; the fee is in the network's own coin. */
  symbol: string;
  received: string;
  sent: string;
  net: string;
  fee: string;
  /** The Bitcoin-only screen's names for the same amounts. */
  receivedBtc: string;
  sentBtc: string;
  netBtc: string;
  feeBtc: string;
  usdValue: null;
  usdValueStatus: 'missing';
}

export interface TransactionPage {
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  missingUsdValueCount: number;
  items: AddressTransaction[];
}

const path = '/wallet-addresses';

export const walletAddressesApi = {
  list: async (): Promise<WalletAddress[]> => (await apiClient.get<WalletAddress[]>(path)).data,
  register: async (address: string): Promise<WalletAddress> =>
    (await apiClient.post<WalletAddress>(path, { address })).data,
  /** 201 adds the address; 200 returns the one already tracked, unchanged (WAL-DUP). */
  add: async (input: NewWalletAddress): Promise<{ created: boolean; address: WalletAddress }> => {
    const response = await apiClient.post<WalletAddress>(path, input);
    return { created: response.status === 201, address: response.data };
  },
  update: async (id: string, changes: WalletAddressChanges): Promise<WalletAddress> =>
    (await apiClient.patch<WalletAddress>(`${path}/${encodeURIComponent(id)}`, changes)).data,
  // A sync may read several provider pages; the backend stops itself after 25 s.
  sync: async (id: string): Promise<SyncResult> =>
    (
      await apiClient.post<SyncResult>(`${path}/${encodeURIComponent(id)}/sync`, undefined, {
        timeout: 60_000,
      })
    ).data,
  transactions: async (id: string, offset = 0): Promise<TransactionPage> =>
    (
      await apiClient.get<TransactionPage>(`${path}/${encodeURIComponent(id)}/transactions`, {
        params: { offset, limit: 50 },
      })
    ).data,
};
