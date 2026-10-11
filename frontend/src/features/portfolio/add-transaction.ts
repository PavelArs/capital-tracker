import type { RewardCommand } from '@api/asset-rewards.api';
import type { FxRatesReport } from '@api/fx-rates.api';
import type { Operation } from '@api/operations.api';
import type { TransferCommand } from '@api/owned-transfers.api';
import type { TradeCommand, TradePurpose } from '@api/trades.api';

// "Add transaction" from the accepted prototype: buys and sells, the currency they were paid in
// (CUR-PAID-RUB), a comment, and a sale limited to what the account holds (M9, PR-OPS-8). The
// currency is also the account's cash: a sale's proceeds stay as it and a buy spends it first
// (PR-OPS-9).
export const paidIn = ['USD', 'USDT', 'USDC', 'EUR', 'RUB'] as const;
export type PaidIn = (typeof paidIn)[number];
export const needsRate = (currency: PaidIn): currency is 'EUR' | 'RUB' =>
  currency === 'EUR' || currency === 'RUB';

/** Whether an asset is the cash a currency is kept as: a cash asset or the stablecoin itself. */
export function isCashOf(
  asset: { assetType: string; symbol: string | null; priceSource?: string },
  currency: PaidIn,
): boolean {
  const symbol = asset.symbol?.toUpperCase();
  if (symbol !== currency) return false;
  return needsRate(currency) || currency === 'USD'
    ? asset.assetType === 'fiat'
    : asset.assetType === 'crypto' && (asset.priceSource ?? 'market') === 'market';
}

export interface TransactionEntry {
  side: 'buy' | 'sell';
  instrumentId: string;
  amount: string;
  date: string;
  time: string;
  total: string;
  currency: PaidIn;
  /** Units of the paid currency per 1 USD, as shown in the rate field. */
  rate: string;
  /** Whether the owner changed the prefilled Bank of Russia rate. */
  rateEdited: boolean;
  fee: string;
  comment: string;
}

/**
 * The window's types (M9, PR-OPS-2): Buy, Sell, Transfer, Income and Expense, and under More
 * Reward, Airdrop, Gift and Fee. A gift is received or sent.
 */
export type EntryKind =
  | 'buy'
  | 'sell'
  | 'transfer'
  | 'income'
  | 'expense'
  | 'reward'
  | 'airdrop'
  | 'gift-received'
  | 'gift-sent'
  | 'fee';

/** Kinds recorded as a buy or sale with a purpose: their value is money in or out. */
const purposeKinds = {
  income: 'income',
  expense: 'expense',
  'gift-received': 'gift-received',
  'gift-sent': 'gift-sent',
  fee: 'fee',
} as const satisfies Partial<Record<EntryKind, TradePurpose>>;
type PurposeKind = keyof typeof purposeKinds;
export const isPurposeKind = (kind: EntryKind): kind is PurposeKind => kind in purposeKinds;
/** Kinds that take coins out of the account: limited to what it holds then. */
export const spends = (kind: EntryKind) =>
  kind === 'sell' ||
  kind === 'expense' ||
  kind === 'gift-sent' ||
  kind === 'fee' ||
  kind === 'transfer';
/** Kinds with a value in USD instead of a price paid in a currency. */
export const valued = (kind: EntryKind) =>
  isPurposeKind(kind) || kind === 'reward' || kind === 'airdrop';
/** A reward or airdrop may have no known value: it then counts in net worth, not in profit. */
export const valueOptional = (kind: EntryKind) => kind === 'reward' || kind === 'airdrop';

export const MAX_COMMENT_LENGTH = 500;

/**
 * "1,500" could be one and a half or fifteen hundred: a comma followed by exactly three digits
 * after an integer part that does not start with 0 is not read either way.
 */
export const ambiguousComma = (value: string) =>
  /^[1-9]\d{0,2},\d{3}$/.test(value.replace(/[\s ]/g, ''));

/** "1 000,50" as typed becomes "1000.50"; anything else that is not a decimal is null. */
export function decimal(value: string): string | null {
  if (ambiguousComma(value)) return null;
  const text = value.replace(/[\s ]/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}

/** What to tell the owner about a number the form refused: the comma case needs its own words. */
export const numberProblem = (value: string, fallback: string) =>
  ambiguousComma(value) ? 'Write it without a comma between thousands: 1500, or 1.5' : fallback;
export const positive = (value: string) => {
  const text = decimal(value);
  return text !== null && Number(text) > 0 ? text : null;
};

/** Display figure for a rate or a computed amount; the saved amounts are what was typed. */
export function trimmed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

/**
 * Display figure for a price per unit: cents from 1 up, and below 1 enough places to keep five
 * significant digits, so a $0.004 token never shows as 0.
 */
export function priceFigure(value: number): string {
  const places = value >= 1 || value <= 0 ? 2 : Math.min(18, Math.ceil(-Math.log10(value)) + 5);
  return trimmed(value, places);
}

/** The Bank of Russia rate of the date as units per 1 USD, or null if none is stored. */
export function bankRate(currency: 'EUR' | 'RUB', report: FxRatesReport): string | null {
  const rub = (code: 'USD' | 'EUR') =>
    report.rates.find((rate) => rate.currency === code)?.rubPerUnit ?? null;
  const usd = rub('USD');
  if (usd === null) return null;
  if (currency === 'RUB') return usd;
  const eur = rub('EUR');
  return eur === null ? null : trimmed(Number(usd) / Number(eur), 6);
}

/** The cost or proceeds in USD for the summary line, or null while it cannot be known. */
export function usdTotal(entry: TransactionEntry): number | null {
  const total = positive(entry.total);
  if (total === null) return null;
  if (!needsRate(entry.currency)) return Number(total);
  const rate = positive(entry.rate);
  return rate === null ? null : Number(total) / Number(rate);
}

export type EntryProblem =
  | 'instrument'
  | 'amount'
  | 'date'
  | 'time'
  | 'total'
  | 'rate'
  | 'fee'
  | 'comment';

export function problems(
  entry: TransactionEntry,
  today: string,
  kind: EntryKind = entry.side,
): Set<EntryProblem> {
  const found = new Set<EntryProblem>();
  const priced = kind === 'buy' || kind === 'sell';
  if (!entry.instrumentId) found.add('instrument');
  if (positive(entry.amount) === null) found.add('amount');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.date > today) found.add('date');
  if (entry.time && !/^\d{2}:\d{2}$/.test(entry.time)) found.add('time');
  if (kind !== 'transfer' && positive(entry.total) === null)
    if (!valueOptional(kind) || entry.total.trim()) found.add('total');
  if (priced && needsRate(entry.currency) && positive(entry.rate) === null) found.add('rate');
  if ((priced || kind === 'transfer') && entry.fee && decimal(entry.fee) === null) found.add('fee');
  if ([...entry.comment.trim()].length > MAX_COMMENT_LENGTH) found.add('comment');
  return found;
}

/** The instant the entry stands for: its date at the time given, or at 00:00 UTC. */
export const occurredAt = (entry: Pick<TransactionEntry, 'date' | 'time'>) =>
  `${entry.date}T${entry.time || '00:00'}:00.000Z`;

/**
 * A new entry dated today (UTC) without a time stands for the current minute, so it follows
 * today's earlier operations, such as an asset added with an amount a moment ago.
 */
export function withDefaultTime<T extends Pick<TransactionEntry, 'date' | 'time'>>(
  entry: T,
  now: Date,
): T {
  const instant = now.toISOString();
  if (entry.time || entry.date !== instant.slice(0, 10)) return entry;
  return { ...entry, time: instant.slice(11, 16) };
}

/**
 * The Moscow calendar date the server will use for the entry's Bank of Russia rate: the date of
 * its instant (with the default time of a new entry dated today) at UTC+3, not the typed date.
 */
export function rateDate(
  entry: Pick<TransactionEntry, 'date' | 'time'>,
  now: Date,
  editing = false,
): string {
  const timed = editing ? entry : withDefaultTime(entry, now);
  const time = Date.parse(occurredAt(timed));
  if (Number.isNaN(time)) return entry.date;
  return new Date(time + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Two nonnegative decimal strings as integers of the same scale, and that scale. */
function scaledPair(left: string, right: string): [bigint, bigint, number] {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const places = Math.max(leftFraction.length, rightFraction.length);
  const scaled = (whole: string, fraction: string) => BigInt(whole + fraction.padEnd(places, '0'));
  return [scaled(leftWhole, leftFraction), scaled(rightWhole, rightFraction), places];
}

function unscaled(value: bigint, places: number): string {
  if (value <= 0n) return '0';
  if (places === 0) return String(value);
  const padded = String(value).padStart(places + 1, '0');
  const fraction = padded.slice(-places).replace(/0+$/, '');
  const whole = padded.slice(0, -places);
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Exact sum of two nonnegative decimal strings, as a transfer spends its amount and fee. */
export function addDecimal(left: string, right: string): string {
  const [a, b, places] = scaledPair(left, right);
  return unscaled(a + b, places);
}

/** Exact difference of two nonnegative decimal strings, never below 0. */
export function subtractDecimal(left: string, right: string): string {
  const [a, b, places] = scaledPair(left, right);
  return unscaled(a - b, places);
}

/** Exact comparison of two nonnegative decimal strings: -1, 0 or 1. */
export function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const places = Math.max(leftFraction.length, rightFraction.length);
  const scaled = (whole: string, fraction: string) => BigInt(whole + fraction.padEnd(places, '0'));
  const difference = scaled(leftWhole, leftFraction) - scaled(rightWhole, rightFraction);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** The window's type for a saved operation, or null for one it does not edit. */
export function entryKind(operation: Operation): EntryKind | null {
  switch (operation.type) {
    case 'buy':
    case 'sell':
    case 'income':
    case 'expense':
    case 'fee':
    case 'airdrop':
      return operation.type;
    case 'transfer':
      return operation.kind === 'transfer' ? 'transfer' : null;
    case 'reward':
      return operation.kind === 'reward' ? 'reward' : null;
    case 'gift':
      return operation.direction === 'out' ? 'gift-sent' : 'gift-received';
    default:
      return null;
  }
}

/** A saved operation as the window shows it for editing (OPS-EDIT). */
export function entryFromOperation(operation: Operation): TransactionEntry {
  const at = operation.occurredAt;
  const time = at.slice(11, 16);
  const paid = operation.paid;
  const fee = paid ? paid.fee : (operation.feeUsd ?? '0');
  // A trade settled in USDT or USDC keeps that choice; otherwise the amounts tell it.
  const kept = operation.settlement?.asset.symbol?.toUpperCase();
  const stable = kept === 'USDT' || kept === 'USDC' ? kept : null;
  // A transfer's fee is in the coin moved; every other fee is money.
  const shownFee = operation.kind === 'transfer' ? (operation.fee?.quantity ?? '0') : fee;
  return {
    side: operation.direction === 'out' ? 'sell' : 'buy',
    instrumentId: operation.asset.instrumentId ?? '',
    amount: operation.quantity,
    date: at.slice(0, 10),
    time: time === '00:00' && at.slice(16, 23) === ':00.000' ? '' : time,
    total: paid ? paid.gross : (operation.valueUsd ?? ''),
    currency: paid ? paid.currency : (stable ?? 'USD'),
    rate: paid?.rateSource === 'owner' ? paid.perUsd : '',
    rateEdited: paid?.rateSource === 'owner',
    fee: Number(shownFee) === 0 || operation.type === 'fee' ? '' : shownFee,
    comment: operation.comment ?? '',
  };
}

/**
 * The trade as the server takes it. RUB and EUR amounts go as paid; the server converts them
 * at the Bank of Russia rate of the date unless the owner changed the rate. USDT and USDC count
 * one to one with USD. The currency settles the trade in the account's cash unless the asset
 * traded is that cash itself.
 */
export function tradeFromEntry(
  entry: TransactionEntry,
  identity: { requestId: string; expectedJournalRevision: number },
  orderWithinTimestamp?: number,
  settle = true,
): TradeCommand {
  const gross = decimal(entry.total)!;
  const fee = entry.fee ? decimal(entry.fee)! : '0';
  const comment = entry.comment.trim();
  // Without an order the server places the trade after every operation at that instant.
  const trade = {
    instrumentId: entry.instrumentId,
    side: entry.side,
    occurredAt: occurredAt(entry),
    ...(orderWithinTimestamp === undefined ? {} : { orderWithinTimestamp }),
    quantity: decimal(entry.amount)!,
    ...(comment ? { comment } : {}),
    ...(settle ? { settlementCurrency: entry.currency } : {}),
    ...identity,
  };
  if (!needsRate(entry.currency)) return { ...trade, grossUsd: gross, feeUsd: fee };
  return {
    ...trade,
    paid: {
      currency: entry.currency,
      gross,
      fee,
      ...(entry.rateEdited ? { perUsd: decimal(entry.rate)! } : {}),
    },
  };
}

/**
 * Income, an expense, a gift or a fee as the server takes it (PR-OPS-2): a buy or sale with
 * that purpose, its value in USD and no settlement, so the value is money in or out. A fee is
 * all fee: what it costs is what it was worth.
 */
export function purposeTradeFromEntry(
  entry: TransactionEntry,
  kind: PurposeKind,
  identity: { requestId: string; expectedJournalRevision: number },
  orderWithinTimestamp?: number,
): TradeCommand {
  const value = decimal(entry.total)!;
  const comment = entry.comment.trim();
  const purpose = purposeKinds[kind];
  return {
    instrumentId: entry.instrumentId,
    side: purpose === 'income' || purpose === 'gift-received' ? 'buy' : 'sell',
    occurredAt: occurredAt(entry),
    ...(orderWithinTimestamp === undefined ? {} : { orderWithinTimestamp }),
    quantity: decimal(entry.amount)!,
    grossUsd: value,
    feeUsd: purpose === 'fee' ? value : '0',
    purpose,
    ...(comment ? { comment } : {}),
    ...identity,
  };
}

/** A reward or airdrop: what it was worth is both its income and its cost basis. */
export function rewardFromEntry(
  entry: TransactionEntry,
  kind: 'reward' | 'airdrop',
  identity: { requestId: string; expectedJournalRevision: number },
  orderWithinTimestamp?: number,
): RewardCommand {
  const value = positive(entry.total);
  return {
    ...identity,
    assertReward: true,
    instrumentId: entry.instrumentId,
    category: kind === 'airdrop' ? 'airdrop' : 'other',
    occurredAt: occurredAt(entry),
    ...(orderWithinTimestamp === undefined ? {} : { orderWithinTimestamp }),
    quantity: decimal(entry.amount)!,
    acquisitionBasisUsd: value,
    incomeValueUsd: value,
  };
}

/** A move between two of the owner's accounts; the fee, if any, is paid in the same coin. */
export function transferFromEntry(
  entry: TransactionEntry,
  identity: {
    requestId: string;
    expectedFromJournalRevision: number;
    expectedToJournalRevision: number;
  },
  orderWithinTimestamp?: number,
): TransferCommand {
  const fee = entry.fee ? decimal(entry.fee)! : '0';
  const paidFee = Number(fee) > 0;
  return {
    ...identity,
    assertInternal: true,
    instrumentId: entry.instrumentId,
    occurredAt: occurredAt(entry),
    ...(orderWithinTimestamp === undefined ? {} : { orderWithinTimestamp }),
    quantity: decimal(entry.amount)!,
    feeInstrumentId: paidFee ? entry.instrumentId : null,
    feeQuantity: paidFee ? fee : '0',
  };
}
