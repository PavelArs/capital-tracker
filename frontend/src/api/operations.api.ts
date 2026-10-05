import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';
import type { TradePayment } from './trades.api';

// Exact decimal strings from GET /accounting/operations (list-all-operations, OPS-1..3).
export type OperationType =
  | 'buy'
  | 'sell'
  | 'transfer'
  | 'swap'
  | 'reward'
  | 'staking-reward'
  | 'airdrop'
  | 'opening-balance'
  | 'deposit'
  | 'withdrawal';

export interface OperationAsset {
  instrumentId: string | null;
  symbol: string | null;
  name: string;
}

export interface OperationPlace {
  id: string;
  name: string;
}

export interface Operation {
  id: string;
  kind: 'trade' | 'transfer' | 'swap' | 'reward' | 'opening' | 'flow' | 'chain';
  /** Null for a blockchain transaction nobody has classified yet. */
  type: OperationType | null;
  direction: 'in' | 'out' | 'internal';
  occurredAt: string;
  asset: OperationAsset;
  quantity: string;
  counterAsset: OperationAsset | null;
  counterQuantity: string | null;
  valueUsd: string | null;
  estimatedValueUsd: string | null;
  costBasisUsd: string | null;
  feeUsd: string | null;
  fee: { asset: OperationAsset; quantity: string } | null;
  account: OperationPlace | null;
  counterAccount: OperationPlace | null;
  wallet: { id: string; network: 'bitcoin'; address: string } | null;
  chain: { txid: string; blockHeight: number; priceObservedAt: string | null } | null;
  status: 'recorded' | 'needs-classification';
  source: 'manual' | 'csv' | 'chain';
  version: number | null;
  /** Trades paid in RUB or EUR keep the amounts as paid. */
  paid: TradePayment | null;
  comment: string | null;
  orderWithinTimestamp: number;
  // The amounts above in the list's quote currency at the Bank of Russia rate of the
  // operation's date (an estimate: of today); null without an amount or a rate.
  value: string | null;
  estimatedValue: string | null;
  costBasis: string | null;
  feeValue: string | null;
}

export interface OperationList {
  at: string;
  quoteCurrency: AccountingCurrency;
  needsClassificationCount: number;
  operations: Operation[];
}

export const operationsApi = {
  /** Without a currency the owner's main currency is used. */
  list: async (currency?: AccountingCurrency): Promise<OperationList> => {
    const response = await apiClient.get<OperationList>('/accounting/operations', {
      params: currency ? { currency } : undefined,
    });
    return response.data;
  },
};
