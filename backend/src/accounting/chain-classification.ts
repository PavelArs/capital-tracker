import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import {
  chainAsset,
  isExchange,
  type Network,
  unitsToAtoms,
} from '../wallet-addresses/chain-assets';
import type { RewardCategory } from './asset-reward-types';
import { parseDecimal, parseUuid } from './input';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import { isPaidCurrency } from './paid-currency';
import { parseComment } from './trade-input';
import type { TradePurpose } from './trade-purpose';
import { type SettlementCurrency, settlementCurrencies } from './trade-settlement';

// classify-chain-transactions (M12, CLS-*): what the owner says a raw chain transaction was.
// The raw row is never edited; a classification produces one journal entry in the wallet's
// account, which then counts like any other operation.

/** Types a chain transaction can be classified as; a transfer joins it with M13. */
export const chainTypes = [
  'buy',
  'sell',
  'transfer',
  'income',
  'expense',
  'gift',
  'fee',
  'reward',
  'staking-reward',
  'airdrop',
  'other',
  'swap',
  'pool-deposit',
  'pool-withdrawal',
  'pool-reward',
  'recorded',
] as const;
export type ChainType = (typeof chainTypes)[number];

const incoming: readonly ChainType[] = [
  'buy',
  'transfer',
  'income',
  'gift',
  'reward',
  'staking-reward',
  'airdrop',
  'other',
  'swap',
  'pool-withdrawal',
  'pool-reward',
  'recorded',
];
const outgoing: readonly ChainType[] = [
  'sell',
  'transfer',
  'expense',
  'gift',
  'fee',
  'other',
  'swap',
  'pool-deposit',
  'recorded',
];
/** POOL-INVALID: an exchange account's records are not the owner's own pool moves. */
const onChainOnly: readonly ChainType[] = ['pool-deposit', 'pool-withdrawal'];

/** Buy or sell: what was paid or received, in the currency it was paid in. */
export interface PricedClassification {
  type: 'buy' | 'sell';
  currency: SettlementCurrency;
  amount: string;
  /** The trading fee in the same currency, beside the amount (a Bybit trade, M22). */
  fee?: string;
  /** RUB or EUR only: the rate actually paid, units per 1 USD; otherwise the Bank of Russia's. */
  perUsd?: string;
}
/** Income, expense or gift: its value in USD at the time. */
export interface ValuedClassification {
  type: 'income' | 'expense' | 'gift';
  valueUsd: string;
}
/** FEE-VALUE: a fee's value in USD at the time; without one, its coins' stored price. */
export interface FeeClassification {
  type: 'fee';
  valueUsd: string | null;
}
/** A reward, staking reward, airdrop or liquidity pool reward; its value may be unknown. */
export interface RewardClassification {
  type: 'reward' | 'staking-reward' | 'airdrop' | 'pool-reward';
  valueUsd: string | null;
}
/** A move between the owner's own accounts (M13): the account on the other side. */
export interface TransferClassification {
  type: 'transfer';
  accountId: string;
}
/** Nothing more is known: received coins count without a purchase price, sent ones without a sale price. */
export interface OtherClassification {
  type: 'other';
}
/**
 * CLS-SWAP: coins of one of the owner's addresses paid for other coins that arrived at one of
 * them. `with` names the other side's raw transaction; the value in USD is optional.
 */
export interface SwapClassification {
  type: 'swap';
  with: { addressId: string; txid: string };
  valueUsd: string | null;
}
/** POOL-DEPOSIT: coins put into a liquidity pool; they stay the owner's. */
export interface PoolDepositClassification {
  type: 'pool-deposit';
}
/**
 * POOL-WITHDRAW: coins a liquidity pool returned; `deposit` names the owner's raw transaction
 * that put the same coin in. The value in USD of a gain above the deposit is optional.
 */
export interface PoolWithdrawalClassification {
  type: 'pool-withdrawal';
  deposit: { addressId: string; txid: string };
  valueUsd: string | null;
  /** POOL-PARTIAL: only a part of the deposit came back; the rest is still in the pool. */
  partial?: true;
}
/**
 * CLS-RECORDED: the owner already added this movement by hand or from CSV, as a trade or a swap
 * in the same account (a purchase paid with these coins, say). It records nothing new and
 * stops counting on its own, so the coins do not count twice.
 */
export interface RecordedClassification {
  type: 'recorded';
  operation: { kind: 'trade' | 'swap'; id: string };
}
export type Classification =
  | PricedClassification
  | ValuedClassification
  | FeeClassification
  | RewardClassification
  | TransferClassification
  | OtherClassification
  | SwapClassification
  | PoolDepositClassification
  | PoolWithdrawalClassification
  | RecordedClassification;

export interface ClassificationInput {
  requestId: string;
  /** The version the owner saw; 0 before the first classification. */
  expectedVersion: number;
  /** Hidden: out of every calculation, still listed (CLS-HIDE). */
  hidden: boolean;
  /** Null: back to "Needs classification". Kept while hidden, so unhiding restores it. */
  classification: Classification | null;
  comment?: string;
}

const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};

/**
 * A hex hash (Bitcoin, Ethereum) or a base58 signature (Solana, M15); a token leg adds its
 * number (M14); a Bybit record off chain has Bybit's own ID (M22), a paid Earn yield its
 * product kind too (BYBIT-EARN).
 */
export const chainTxid =
  /^(([0-9a-f]{64}|[1-9A-HJ-NP-Za-km-z]{64,88})(-[0-9]{1,9})?|bybit-(trade|deposit|withdrawal|earn-flexible|earn-onchain)-[0-9A-Za-z_-]{1,80})$/;

function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return bad();
  if (Reflect.ownKeys(raw).some((key) => typeof key !== 'string' || !keys.includes(key)))
    return bad();
  return raw as Record<string, unknown>;
}

function classification(raw: unknown): Classification | null {
  if (raw === null) return null;
  const type = (raw as Record<string, unknown> | undefined)?.type;
  if (type === 'buy' || type === 'sell') {
    const row = object(raw, ['type', 'currency', 'amount', 'fee', 'perUsd']);
    const currency = settlementCurrencies.find((code) => code === row.currency) ?? bad();
    if (row.perUsd !== undefined && !isPaidCurrency(currency)) return bad();
    return {
      type,
      currency,
      amount: parseDecimal(row.amount, true),
      ...(row.fee === undefined ? {} : { fee: parseDecimal(row.fee, false) }),
      ...(row.perUsd === undefined ? {} : { perUsd: parseDecimal(row.perUsd, true) }),
    };
  }
  if (type === 'transfer') {
    const row = object(raw, ['type', 'accountId']);
    return { type, accountId: parseUuid(row.accountId) };
  }
  if (type === 'income' || type === 'expense' || type === 'gift') {
    const row = object(raw, ['type', 'valueUsd']);
    return { type, valueUsd: parseDecimal(row.valueUsd, true) };
  }
  if (type === 'fee') {
    const row = object(raw, ['type', 'valueUsd']);
    return { type, valueUsd: row.valueUsd === null ? null : parseDecimal(row.valueUsd, true) };
  }
  if (
    type === 'reward' ||
    type === 'staking-reward' ||
    type === 'airdrop' ||
    type === 'pool-reward'
  ) {
    const row = object(raw, ['type', 'valueUsd']);
    return {
      type,
      valueUsd: row.valueUsd === null ? null : parseDecimal(row.valueUsd, true),
    };
  }
  if (type === 'other') {
    object(raw, ['type']);
    return { type };
  }
  if (type === 'swap') {
    const row = object(raw, ['type', 'with', 'valueUsd']);
    const other = object(row.with, ['addressId', 'txid']);
    if (typeof other.txid !== 'string' || !chainTxid.test(other.txid)) return bad();
    return {
      type,
      with: { addressId: parseUuid(other.addressId), txid: other.txid },
      valueUsd: row.valueUsd === null ? null : parseDecimal(row.valueUsd, true),
    };
  }
  if (type === 'pool-deposit') {
    object(raw, ['type']);
    return { type };
  }
  if (type === 'pool-withdrawal') {
    const row = object(raw, ['type', 'deposit', 'valueUsd', 'partial']);
    const deposit = object(row.deposit, ['addressId', 'txid']);
    if (typeof deposit.txid !== 'string' || !chainTxid.test(deposit.txid)) return bad();
    if (row.partial !== undefined && typeof row.partial !== 'boolean') return bad();
    return {
      type,
      deposit: { addressId: parseUuid(deposit.addressId), txid: deposit.txid },
      ...(row.partial === true ? { partial: true as const } : {}),
      valueUsd: row.valueUsd === null ? null : parseDecimal(row.valueUsd, true),
    };
  }
  if (type === 'recorded') {
    const row = object(raw, ['type', 'operation']);
    const operation = object(row.operation, ['kind', 'id']);
    if (operation.kind !== 'trade' && operation.kind !== 'swap') return bad();
    return { type, operation: { kind: operation.kind, id: parseUuid(operation.id) } };
  }
  return bad();
}

export function parseClassification(raw: unknown): ClassificationInput {
  const row = object(raw, ['requestId', 'expectedVersion', 'hidden', 'classification', 'comment']);
  const version = row.expectedVersion;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) return bad();
  if (version > 10000 || typeof row.hidden !== 'boolean') return bad();
  if (!('classification' in row)) return bad();
  return {
    requestId: parseUuid(row.requestId),
    expectedVersion: version,
    hidden: row.hidden,
    classification: classification(row.classification),
    ...parseComment(row.comment),
  };
}

/** The request as stored: replaying it returns the same receipt. */
export function classificationPayload(
  addressId: string,
  txid: string,
  input: ClassificationInput,
): string {
  return JSON.stringify({
    addressId,
    txid,
    expectedVersion: input.expectedVersion,
    hidden: input.hidden,
    classification: input.classification,
    ...(input.comment === undefined ? {} : { comment: input.comment }),
  });
}

/**
 * BYBIT-TRADES (M22): the Buy or Sell a Bybit spot fill is, when it can be told for certain: a
 * pair of a tracked coin and USDT or USDC, its fee charged in one of the two. The amount is the
 * fill's value less a fee charged in the bought coin (so price times quantity holds), and the
 * fee is in the quote coin, valued at the fill's price when charged in the base coin. A buy
 * then spends value plus a quote fee, a sale keeps value less it. Anything else stays to
 * classify.
 */
export function exchangeTrade(raw: unknown): PricedClassification | null {
  const trade = (raw as { trade?: Record<string, unknown> } | null)?.trade;
  if (!trade || typeof trade !== 'object') return null;
  const text = (key: string) => (typeof trade[key] === 'string' ? (trade[key] as string) : null);
  const [side, base, quote, price, value, fee, feeCoin] = [
    'side',
    'base',
    'quote',
    'price',
    'value',
    'fee',
    'feeCoin',
  ].map(text);
  if ((side !== 'buy' && side !== 'sell') || !base || !price || !value || !fee) return null;
  if (quote !== 'USDT' && quote !== 'USDC') return null;
  const decimal = /^\d+(\.\d+)?$/;
  if (![price, value, fee].every((item) => decimal.test(item))) return null;
  const atoms = (item: string) => canonicalDecimalToAtoms(parseDecimal(item, false));
  const feeAtoms = atoms(fee);
  let quoteFee: bigint;
  if (feeAtoms === 0n || feeCoin === quote) quoteFee = feeAtoms;
  else if (feeCoin === base) quoteFee = roundedProduct(feeAtoms, atoms(price));
  else return null;
  const gross = atoms(value) - (feeCoin === base && side === 'buy' ? quoteFee : 0n);
  const amount = side === 'sell' && feeCoin === base ? atoms(value) + quoteFee : gross;
  if (amount <= 0n) return null;
  return {
    type: side,
    currency: quote,
    amount: formatAtoms(amount),
    fee: formatAtoms(quoteFee),
  };
}

/** a × b for two amounts in atoms, half up at the 30 decimals amounts keep. */
function roundedProduct(left: bigint, right: bigint): bigint {
  const scale = 10n ** 30n;
  return (left * right * 2n + scale) / (scale * 2n);
}

/** One stored chain transaction leg of a wallet address, raw as the provider sent it. */
export interface ChainLeg {
  network: Network;
  /** The token the leg moves (M14), or null for the network's own coin. */
  asset: string | null;
  blockTime: string;
  receivedUnits: string;
  sentUnits: string;
}

/** Whether the type fits what the coins did: what arrives cannot be sold, and so on. */
export function fitsDirection(leg: ChainLeg, type: ChainType): boolean {
  const { inbound, quantity } = legMovement(leg);
  if (onChainOnly.includes(type) && isExchange(leg.network)) return false;
  return quantity !== '0' && (inbound ? incoming : outgoing).includes(type);
}

/** The amount the leg moves in its asset: what arrived, or what left with the network fee. */
export function legMovement(leg: ChainLeg): { inbound: boolean; quantity: string } {
  const net = BigInt(leg.receivedUnits) - BigInt(leg.sentUnits);
  const magnitude = net < 0n ? -net : net;
  const atoms = unitsToAtoms(magnitude, chainAsset(leg.network, leg.asset));
  return { inbound: net > 0n, quantity: formatAtoms(atoms) };
}

/** The portfolio asset a leg moves: BTC, ETH, or the USDT or USDC token. */
export function chainCoin(leg: Pick<ChainLeg, 'network' | 'asset'>): {
  assetType: 'crypto';
  symbol: string;
  name: string;
} {
  const { symbol, name } = chainAsset(leg.network, leg.asset);
  return { assetType: 'crypto', symbol, name };
}

export const unfit = () =>
  new UnprocessableEntityException('This type does not fit the direction of the transaction');

/** The journal entry a classification produces, before the journal pins are known. */
export type PlannedOperation =
  | { journal: 'trade'; fields: Record<string, unknown> }
  | { journal: 'reward'; fields: Record<string, unknown> }
  /**
   * Outgoing Other: no entry; the coins leave as an unanswered payment does (D1). A pool deposit
   * (POOL-DEPOSIT) and a withdrawal without a gain record none either: the coins stay held. A
   * movement already recorded by hand (CLS-RECORDED) records none: that record counts.
   */
  | { journal: 'none' };

const purposes: Record<'income' | 'expense' | 'fee', TradePurpose> = {
  income: 'income',
  expense: 'expense',
  fee: 'fee',
};
const categories: Record<RewardClassification['type'], RewardCategory> = {
  reward: 'other',
  'staking-reward': 'staking',
  airdrop: 'airdrop',
  // POOL-REWARD: the journal knows no category of its own for it; the answer names it.
  'pool-reward': 'other',
};

/**
 * The entry for the whole amount the leg moved, at the block time. A buy or sale settles in
 * the account's cash like one added by hand (PR-OPS-9); income, expense, gift and fee carry
 * their value; a reward's value is also its cost basis. Other adds received coins with an
 * unknown cost and no deposit, like a reward nobody valued; sent coins leave with no sale price
 * and no withdrawal, as before any answer (D1). The network fee stays inside the amount;
 * only a transfer (chain-transfer.ts) records it apart.
 */
export function planOperation(
  leg: ChainLeg,
  value: Classification,
  comment: string | undefined,
): PlannedOperation {
  const { inbound, quantity } = legMovement(leg);
  if (!fitsDirection(leg, value.type)) throw unfit();
  if (value.type === 'transfer') throw new Error('A transfer records an owned transfer instead');
  if (value.type === 'swap') throw new Error('A swap records a swap of both legs instead');
  if (value.type === 'pool-withdrawal')
    throw new Error('A pool withdrawal records the gain over its deposit instead');
  const common = { occurredAt: leg.blockTime, quantity };
  const note = comment === undefined ? {} : { comment };
  switch (value.type) {
    case 'buy':
    case 'sell': {
      const fee = value.fee ?? '0';
      const amounts = isPaidCurrency(value.currency)
        ? {
            paid: {
              currency: value.currency,
              gross: value.amount,
              fee,
              ...(value.perUsd === undefined ? {} : { perUsd: value.perUsd }),
            },
          }
        : { grossUsd: value.amount, feeUsd: fee };
      return {
        journal: 'trade',
        fields: {
          ...common,
          side: value.type,
          ...amounts,
          settlementCurrency: value.currency,
          ...note,
        },
      };
    }
    case 'income':
    case 'expense':
    case 'gift':
    case 'fee': {
      // FEE-VALUE: the service fills an empty fee's value from the stored price first.
      if (value.valueUsd === null) throw new Error('A fee without a value takes its stored price');
      const purpose =
        value.type === 'gift' ? (inbound ? 'gift-received' : 'gift-sent') : purposes[value.type];
      return {
        journal: 'trade',
        fields: {
          ...common,
          side: inbound ? 'buy' : 'sell',
          grossUsd: value.valueUsd,
          feeUsd: value.type === 'fee' ? value.valueUsd : '0',
          purpose,
          ...note,
        },
      };
    }
    case 'pool-deposit':
    case 'recorded':
      return { journal: 'none' };
    case 'other':
      if (!inbound) return { journal: 'none' };
      return {
        journal: 'reward',
        fields: {
          ...common,
          assertReward: true,
          category: 'unclassified',
          acquisitionBasisUsd: null,
          incomeValueUsd: null,
        },
      };
    default:
      return {
        journal: 'reward',
        fields: {
          ...common,
          assertReward: true,
          category: categories[value.type],
          acquisitionBasisUsd: value.valueUsd,
          incomeValueUsd: value.valueUsd,
        },
      };
  }
}
