import apiClient from './client';
import type { TradeCommand, TradeReceipt } from './trades.api';

export type SyncState = 'never' | 'partial' | 'complete';
export type SyncOutcome = 'complete' | 'partial' | 'provider_error';
export type ProviderFailure = 'rate_limited' | 'unavailable' | 'invalid_response';

export interface WalletAddress {
  id: string;
  network: 'bitcoin';
  address: string;
  createdAt: string;
  transactionCount: number;
  sync: { state: SyncState; completedAt: string | null };
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
  receivedBtc: string;
  sentBtc: string;
  netBtc: string;
  feeBtc: string;
  usdValue: string | null;
  usdValueStatus: 'known' | 'missing';
  trade: CompletedTrade | null;
}

export interface CompletedTrade {
  accountId: string;
  tradeId: string;
  status: 'active' | 'voided';
  grossUsd: string;
  feeUsd: string;
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
  complete: async (
    id: string,
    txid: string,
    body: { accountId: string; trade: TradeCommand },
  ): Promise<TradeReceipt> =>
    (
      await apiClient.post<TradeReceipt>(
        `${path}/${encodeURIComponent(id)}/transactions/${encodeURIComponent(txid)}/trade`,
        body,
      )
    ).data,
};
