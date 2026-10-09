import apiClient from './client';
import type { SourceState } from './sync-status.api';

export type SyncState = 'never' | 'partial' | 'complete';
export type SyncOutcome = 'complete' | 'partial' | 'provider_error';
export type ProviderFailure =
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'not_configured'
  | 'key_rejected';
export type Network = 'bitcoin' | 'ethereum' | 'solana' | 'bybit';

/** One asset's balance on the chain, an exact decimal. */
export interface ChainBalance {
  symbol: string;
  quantity: string;
}

export type StakeState = 'activating' | 'active' | 'deactivating' | 'inactive' | 'closed';

/** One stake account of a Solana wallet; its SOL is part of the wallet's balance. */
export interface StakeAccount {
  account: string;
  /** The vote account it delegates to; null when it delegates to none. */
  validator: string | null;
  /** Null until the chain was read after the account was found. */
  state: StakeState | null;
  quantity: string;
  rewards: string;
}

/** SOL in the wallet's stake accounts, already included in its SOL balance. */
export interface Staking {
  symbol: string;
  quantity: string;
  rewards: string;
  accounts: StakeAccount[];
}

/** A Bitcoin wallet tracked through its account public key (M21) and the addresses it derives. */
export interface AccountKey {
  prefix: 'xpub' | 'ypub' | 'zpub';
  /** Receiving and change addresses derived so far, up to 20 unused after the last used one. */
  derivedAddresses: number;
  /** Addresses with any confirmed transaction. */
  usedAddresses: number;
  /** The owner's single-address wallets this key also derives: their coins count twice. */
  alsoTracked: { id: string; address: string; label: string | null }[];
}

/** A Bybit account read with the owner's read-only API key (M22); the key is never returned. */
export interface ExchangeAccount {
  /** The last four characters of the API key. */
  keyHint: string;
  /** Bound to IP addresses; an unbound key expires after 90 days. */
  ipBound: boolean;
  keyExpiresAt: string | null;
  /** When Bybit last reported the balances shown; null until the history is read. */
  reportedAt: string | null;
  /** Coins Bybit holds that the app does not track; they never count. */
  untracked: ChainBalance[];
  /** How far back the history is read: Bybit keeps two years of trades. */
  historyFrom: string;
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
  /** Every asset the wallet can hold (ETH or SOL, USDT, USDC); null until a sync completes. */
  balances: ChainBalance[] | null;
  /** Solana stake accounts; null when there are none or until a sync completes. */
  staking?: Staking | null;
  /** Set when the Bitcoin wallet is an account public key rather than one address. */
  accountKey?: AccountKey | null;
  /** Set for a Bybit account: its balances are those Bybit reports. */
  exchange?: ExchangeAccount | null;
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

export type NewWalletAddress =
  | { network: Exclude<Network, 'bybit'>; address: string; accountId?: string; label?: string }
  | { network: 'bybit'; apiKey: string; apiSecret: string; accountId?: string; label?: string };

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
  /** The asset the leg moves; the fee is in the network's own coin (on Bybit in this one). */
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
