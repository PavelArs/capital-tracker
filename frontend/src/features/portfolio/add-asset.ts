import type { AssetType, NewPortfolioAsset, ValuationCurrency } from '@api/portfolio-assets.api';
import type { TradeCommand } from '@api/trades.api';
import { decimal, MAX_COMMENT_LENGTH, positive, tradeFromEntry } from './add-transaction';

// "Add asset" from the accepted prototype: the kind of asset, its amount and what it is worth,
// saved as the asset and a buy that gives it a balance (counted as a deposit).
export type AssetKind = 'cash' | 'deposit' | 'crypto' | 'other';
export const assetKinds: [AssetKind, string][] = [
  ['cash', 'Cash'],
  ['deposit', 'Deposit'],
  ['crypto', 'Cryptocurrency'],
  ['other', 'Other'],
];
const storedTypes: Record<AssetKind, AssetType> = {
  cash: 'fiat',
  deposit: 'manual',
  crypto: 'crypto',
  other: 'manual',
};

export interface AssetEntry {
  kind: AssetKind;
  name: string;
  ticker: string;
  amount: string;
  /** What the amount is worth, or what the coins cost; empty means the same as the amount. */
  value: string;
  currency: ValuationCurrency;
  accountId: string;
  notes: string;
}

export type AssetProblem =
  | 'name'
  | 'ticker'
  | 'amount'
  | 'value'
  | 'account'
  | 'notes'
  | 'no-accounts';

/** Cryptocurrency may start empty and get its purchases from "Add transaction". */
export const amountRequired = (kind: AssetKind) => kind !== 'crypto';

export function assetProblems(entry: AssetEntry, accountCount: number): Set<AssetProblem> {
  const found = new Set<AssetProblem>();
  if (!entry.name.trim()) found.add('name');
  if (entry.kind === 'crypto' && !entry.ticker.trim()) found.add('ticker');
  const amount = entry.amount.trim();
  if (amount || amountRequired(entry.kind)) {
    if (positive(amount) === null) found.add('amount');
    const value = entry.value.trim();
    if (entry.kind === 'crypto' ? positive(value) === null : value && decimal(value) === null)
      found.add('value');
    if (accountCount === 0) found.add('no-accounts');
    else if (!entry.accountId) found.add('account');
  }
  if (entry.notes.trim().length > MAX_COMMENT_LENGTH) found.add('notes');
  return found;
}

/** The asset as the server stores it; cash takes its currency as the ticker. */
export function assetBody(entry: AssetEntry): Omit<NewPortfolioAsset, 'requestId'> {
  const assetType = storedTypes[entry.kind];
  const ticker = entry.ticker.trim().toUpperCase();
  return {
    name: entry.name.trim(),
    assetType,
    ...(assetType === 'fiat' ? { symbol: entry.currency } : ticker ? { symbol: ticker } : {}),
    ...(assetType === 'manual' ? { valuationCurrency: entry.currency } : {}),
  };
}

/** The whole minute the balance is recorded at, so it is never in the server's future. */
export function balanceInstant(now: Date): string {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
}

/**
 * A buy of the amount for its value in the chosen currency: RUB and EUR go as paid and the
 * server converts them at the Bank of Russia rate of the day.
 */
export function balanceTrade(
  entry: AssetEntry,
  instrumentId: string,
  at: string,
  identity: { requestId: string; expectedJournalRevision: number },
): TradeCommand {
  const amount = entry.amount.trim();
  const value = entry.value.trim() || amount;
  return tradeFromEntry(
    {
      side: 'buy',
      instrumentId,
      amount,
      date: at.slice(0, 10),
      time: at.slice(11, 16),
      total: value,
      currency: entry.currency,
      rate: '',
      rateEdited: false,
      fee: '',
      comment: entry.notes,
    },
    identity,
  );
}

const PRICE_PLACES = 18;

/** Exact `total / quantity` of two decimal strings, half up, at 18 places, zeros trimmed. */
export function unitPrice(total: string, quantity: string): string {
  const scaled = (value: string, places: number) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(places, '0').slice(0, places));
  };
  const places = Math.max(total.split('.')[1]?.length ?? 0, quantity.split('.')[1]?.length ?? 0);
  const numerator = scaled(total, places) * 10n ** BigInt(PRICE_PLACES);
  const denominator = scaled(quantity, places);
  const result = (numerator * 2n + denominator) / (denominator * 2n);
  const digits = result.toString().padStart(PRICE_PLACES + 1, '0');
  const whole = digits.slice(0, -PRICE_PLACES);
  const fraction = digits.slice(-PRICE_PLACES).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
