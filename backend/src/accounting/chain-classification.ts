import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { chainAsset, type Network, unitsToAtoms } from '../wallet-addresses/chain-assets';
import type { RewardCategory } from './asset-reward-types';
import { parseDecimal, parseUuid } from './input';
import { formatAtoms } from './money';
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
];
const outgoing: readonly ChainType[] = ['sell', 'transfer', 'expense', 'gift', 'fee'];

/** Buy or sell: what was paid or received, in the currency it was paid in. */
export interface PricedClassification {
  type: 'buy' | 'sell';
  currency: SettlementCurrency;
  amount: string;
  /** RUB or EUR only: the rate actually paid, units per 1 USD; otherwise the Bank of Russia's. */
  perUsd?: string;
}
/** Income, expense, gift or fee: its value in USD at the time. */
export interface ValuedClassification {
  type: 'income' | 'expense' | 'gift' | 'fee';
  valueUsd: string;
}
/** A reward, staking reward or airdrop; its value may be unknown. */
export interface RewardClassification {
  type: 'reward' | 'staking-reward' | 'airdrop';
  valueUsd: string | null;
}
/** A move between the owner's own accounts (M13): the account on the other side. */
export interface TransferClassification {
  type: 'transfer';
  accountId: string;
}
/** Received, but nothing more is known: the coins count without a purchase price. */
export interface OtherClassification {
  type: 'other';
}
export type Classification =
  | PricedClassification
  | ValuedClassification
  | RewardClassification
  | TransferClassification
  | OtherClassification;

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
    const row = object(raw, ['type', 'currency', 'amount', 'perUsd']);
    const currency = settlementCurrencies.find((code) => code === row.currency) ?? bad();
    if (row.perUsd !== undefined && !isPaidCurrency(currency)) return bad();
    return {
      type,
      currency,
      amount: parseDecimal(row.amount, true),
      ...(row.perUsd === undefined ? {} : { perUsd: parseDecimal(row.perUsd, true) }),
    };
  }
  if (type === 'transfer') {
    const row = object(raw, ['type', 'accountId']);
    return { type, accountId: parseUuid(row.accountId) };
  }
  if (type === 'income' || type === 'expense' || type === 'gift' || type === 'fee') {
    const row = object(raw, ['type', 'valueUsd']);
    return { type, valueUsd: parseDecimal(row.valueUsd, true) };
  }
  if (type === 'reward' || type === 'staking-reward' || type === 'airdrop') {
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
  | { journal: 'reward'; fields: Record<string, unknown> };

const purposes: Record<'income' | 'expense' | 'fee', TradePurpose> = {
  income: 'income',
  expense: 'expense',
  fee: 'fee',
};
const categories: Record<RewardClassification['type'], RewardCategory> = {
  reward: 'other',
  'staking-reward': 'staking',
  airdrop: 'airdrop',
};

/**
 * The entry for the whole amount the leg moved, at the block time. A buy or sale settles in
 * the account's cash like one added by hand (PR-OPS-9); income, expense, gift and fee carry
 * their value; a reward's value is also its cost basis. Other adds the coins with an unknown
 * cost and no deposit, like a reward nobody valued. The network fee stays inside the amount;
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
  const common = { occurredAt: leg.blockTime, quantity };
  const note = comment === undefined ? {} : { comment };
  switch (value.type) {
    case 'buy':
    case 'sell': {
      const amounts = isPaidCurrency(value.currency)
        ? {
            paid: {
              currency: value.currency,
              gross: value.amount,
              fee: '0',
              ...(value.perUsd === undefined ? {} : { perUsd: value.perUsd }),
            },
          }
        : { grossUsd: value.amount, feeUsd: '0' };
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
    case 'other':
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
