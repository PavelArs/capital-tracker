import type { NewPortfolioAsset, ValuationCurrency } from '@api/portfolio-assets.api';
import type { TradeCommand } from '@api/trades.api';
import { decimal, positive, tradeFromEntry } from '../portfolio/add-transaction';

// "Add property" from the accepted mockups (v8): a property is a hand-valued asset in an account
// of its own. Its quantity is the owner's share of it, so its price is what the whole property
// is worth and its value is the share of that.
export const propertyKinds = ['Apartment', 'House', 'Land', 'Parking', 'Commercial'] as const;
export type PropertyKind = (typeof propertyKinds)[number];

export interface PropertyEntry {
  kind: PropertyKind;
  /** Empty means the kind is the name. */
  name: string;
  currency: ValuationCurrency;
  /** What the whole property cost. */
  cost: string;
  /** YYYY-MM-DD. */
  bought: string;
  /** What the whole property is worth now; empty means the purchase price. */
  estimate: string;
  /** The owner's share in percent, 100 for the whole property. */
  share: string;
}

export type PropertyProblem = 'name' | 'cost' | 'bought' | 'estimate' | 'share';

export const MAX_PROPERTY_NAME = 120;

export const propertyName = (entry: Pick<PropertyEntry, 'kind' | 'name'>) =>
  entry.name.trim() || entry.kind;

export function propertyProblems(entry: PropertyEntry, today: string): Set<PropertyProblem> {
  const found = new Set<PropertyProblem>();
  const name = entry.name.trim();
  if (name.length > MAX_PROPERTY_NAME || /[\r\n]/.test(name)) found.add('name');
  if (positive(entry.cost) === null) found.add('cost');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.bought) || entry.bought > today) found.add('bought');
  if (entry.estimate.trim() && positive(entry.estimate) === null) found.add('estimate');
  const share = sharePercent(entry.share);
  if (share === null) found.add('share');
  return found;
}

// At most two places of a percent: the share as a fraction then has at most four.
function sharePercent(value: string): string | null {
  const text = positive(value);
  if (text === null || !/^\d+(\.\d{1,2})?$/.test(text) || Number(text) > 100) return null;
  return text;
}

const PLACES = 18;
const scaled = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(PLACES, '0').slice(0, PLACES));
};
const unscaled = (value: bigint) => {
  const digits = value.toString().padStart(PLACES + 1, '0');
  const fraction = digits.slice(-PLACES).replace(/0+$/, '');
  return fraction ? `${digits.slice(0, -PLACES)}.${fraction}` : digits.slice(0, -PLACES);
};

/** The owner's share as a fraction of the whole: 50 becomes 0.5. */
export function shareQuantity(share: string): string {
  return unscaled(scaled(decimal(share) ?? '0') / 100n);
}

/** What the owner's share of an amount for the whole property comes to, exactly. */
export function shareOf(amount: string, share: string): string {
  const product = scaled(decimal(amount) ?? '0') * scaled(decimal(share) ?? '0');
  return unscaled(product / (10n ** BigInt(PLACES) * 100n));
}

export function propertyAsset(entry: PropertyEntry): Omit<NewPortfolioAsset, 'requestId'> {
  return { name: propertyName(entry), assetType: 'manual', valuationCurrency: entry.currency };
}

/**
 * The purchase as a buy of the share for its part of the price, on the day it was bought. It
 * carries no settlement currency, so it counts as money put in. A purchase made today stands
 * for the current minute, so it is never in the server's future.
 */
export function purchaseTrade(
  entry: PropertyEntry,
  instrumentId: string,
  now: Date,
  identity: { requestId: string; expectedJournalRevision: number },
): TradeCommand {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const today = entry.bought === minute.slice(0, 10);
  return tradeFromEntry(
    {
      side: 'buy',
      instrumentId,
      amount: shareQuantity(entry.share),
      date: entry.bought,
      time: today ? minute.slice(11, 16) : '00:00',
      total: shareOf(entry.cost, entry.share),
      currency: entry.currency,
      rate: '',
      rateEdited: false,
      fee: '',
      comment: '',
    },
    identity,
    undefined,
    false,
  );
}
