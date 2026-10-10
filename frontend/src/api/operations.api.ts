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
  | 'stake'
  | 'unstake'
  | 'airdrop'
  | 'opening-balance'
  | 'deposit'
  | 'withdrawal'
  | 'income'
  | 'expense'
  | 'gift'
  | 'fee'
  | 'other'
  | 'pool-deposit'
  | 'pool-withdrawal'
  | 'pool-reward';

export interface OperationAsset {
  instrumentId: string | null;
  symbol: string | null;
  name: string;
  /** TOKEN-CHAIN: the blockchain a token moved on; absent for a network's own coin. */
  network?: Exclude<OperationWallet['network'], 'bybit'>;
}

export interface OperationPlace {
  id: string;
  name: string;
}

export interface OperationWallet {
  id: string;
  network: 'bitcoin' | 'ethereum' | 'solana' | 'bybit' | 'tron' | 'stellar' | 'zcash';
  address: string;
  label: string | null;
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
  /**
   * A chain transaction's network fee also carries its value in USD at the price stored for its
   * time and in the list's quote currency (TOKEN-FEE); null when unknown.
   */
  fee: {
    asset: OperationAsset;
    quantity: string;
    valueUsd?: string | null;
    value?: string | null;
  } | null;
  account: OperationPlace | null;
  /**
   * A transfer's other account; for a blockchain transaction to classify, the account of the
   * owner's other address in it, as a suggestion (M13).
   */
  counterAccount: OperationPlace | null;
  /** A blockchain row's address; its account is in `account` once the owner picked one (M10). */
  wallet: OperationWallet | null;
  /**
   * Blockchain only: the owner's other address in the same transaction (M13), or the address
   * that paid for a swap (CLS-SWAP).
   */
  counterWallet: OperationWallet | null;
  /** `direction` is the address's own; a transfer between wallets is listed as internal. */
  chain: {
    txid: string;
    blockHeight: number;
    priceObservedAt: string | null;
    direction: 'in' | 'out' | 'internal';
    /**
     * A swap listed on its receiving row: the paying transaction (CLS-SWAP); a pool withdrawal:
     * the deposit it returns (POOL-WITHDRAW).
     */
    pairedTxid?: string | null;
    /** SWAP-ONE-TX: the owner's transaction called a contract; its method when it is named. */
    call?: { method: string | null };
    /** SWAP-ONE-TX-SUGGEST: the other leg of the same transaction, as the other side of a swap. */
    swapWith?: { addressId: string; txid: string };
  } | null;
  /**
   * A pool withdrawal: what its deposit put in, and what came back above what was still in the
   * pool (positive, pool income) or below it (negative, impermanent loss). `partial`: only a
   * part of the deposit came back, and `remaining` is what is still in the pool afterwards
   * (POOL-PARTIAL). Null or absent for every other row.
   */
  pool?: { deposited: string; difference: string; partial?: boolean; remaining?: string } | null;
  /**
   * Hidden: a blockchain transaction left out of every calculation (M12). Dust: an unanswered
   * receipt worth less than the dust threshold; it counts but does not ask to be classified.
   */
  status: 'recorded' | 'needs-classification' | 'hidden' | 'dust';
  source: 'manual' | 'csv' | 'chain';
  /** Blockchain only: the owner's current answer, to change it; null before the first. */
  classification: {
    version: number;
    hidden: boolean;
    value: ChainClassification | null;
    comment: string | null;
    /** A transfer the app recognised between the owner's own wallets (M13). */
    automatic: boolean;
  } | null;
  version: number | null;
  /** Trades paid in RUB or EUR keep the amounts as paid. */
  paid: TradePayment | null;
  comment: string | null;
  /**
   * Trades only: the cash in the same account that settled it (M9). A sale kept this much as
   * cash; a buy spent this much of it before money from outside. Null before M9.
   */
  settlement: { asset: OperationAsset; quantity: string } | null;
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
  /** The dust threshold in USD the statuses were read with; null: off. */
  dustThresholdUsd: string | null;
  operations: Operation[];
}

/** What a blockchain transaction can be classified as (M12, M13). */
export type ChainClassification =
  /** The other wallet of a transfer between the owner's own wallets. */
  | { type: 'transfer'; accountId: string }
  | {
      type: 'buy' | 'sell';
      currency: 'USD' | 'USDT' | 'USDC' | 'EUR' | 'RUB';
      amount: string;
      /** RUB or EUR only: units per 1 USD actually paid; without it the Bank of Russia rate. */
      perUsd?: string;
    }
  | { type: 'income' | 'expense' | 'gift'; valueUsd: string }
  | { type: 'fee'; valueUsd: string | null }
  | { type: 'reward' | 'staking-reward' | 'airdrop' | 'pool-reward'; valueUsd: string | null }
  /** Received, nothing more known: counts without a purchase price and no deposit. */
  | { type: 'other' }
  /**
   * Coins of one address paid for coins that arrived at another or the same one (CLS-SWAP):
   * the other side's transaction; without a value stablecoins count 1:1, other coins at their
   * stored price then.
   */
  | { type: 'swap'; with: { addressId: string; txid: string }; valueUsd: string | null }
  /** Coins put into a liquidity pool: they stay the owner's (POOL-DEPOSIT). */
  | { type: 'pool-deposit' }
  /**
   * Coins a liquidity pool returned: the deposit of the same coin they return; the value of a
   * gain above it is optional (POOL-WITHDRAW). `partial`: only a part of the deposit came back
   * and the rest is still in the pool (POOL-PARTIAL).
   */
  | {
      type: 'pool-withdrawal';
      deposit: { addressId: string; txid: string };
      valueUsd: string | null;
      partial?: true;
    }
  /**
   * Already added by hand or from CSV as this trade or swap of the same wallet (CLS-RECORDED):
   * nothing new is recorded and the transaction stops counting on its own.
   */
  | { type: 'recorded'; operation: { kind: 'trade' | 'swap'; id: string } };

export interface ClassificationCommand {
  requestId: string;
  /** The version shown; 0 before the first classification. */
  expectedVersion: number;
  hidden: boolean;
  classification: ChainClassification | null;
  comment?: string;
}

/** Fired after a classification changes, so counts elsewhere refresh. */
export const CLASSIFICATION_CHANGED = 'capital:classification-changed';
export const announceClassificationChange = () =>
  window.dispatchEvent(new Event(CLASSIFICATION_CHANGED));

export const operationsApi = {
  /** Without a currency the owner's main currency is used. */
  list: async (currency?: AccountingCurrency): Promise<OperationList> => {
    const response = await apiClient.get<OperationList>('/accounting/operations', {
      params: currency ? { currency } : undefined,
    });
    return response.data;
  },
  /** CLS-BUY, CLS-HIDE: records the answer for one blockchain transaction. */
  classify: async (
    wallet: { id: string },
    txid: string,
    command: ClassificationCommand,
  ): Promise<void> => {
    await apiClient.post(
      `/accounting/chain-transactions/${wallet.id}/${txid}/classifications`,
      command,
    );
  },
  /** CLS-COUNT: blockchain transactions nobody has classified or hidden yet. */
  needsClassification: async (): Promise<number> => {
    const response = await apiClient.get<{ count: number }>(
      '/accounting/chain-transactions/needs-classification',
    );
    return response.data.count;
  },
};
