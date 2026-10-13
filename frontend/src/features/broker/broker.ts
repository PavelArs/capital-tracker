import type { NewPortfolioAsset, ValuationCurrency } from '@api/portfolio-assets.api';
import type { TradeCommand } from '@api/trades.api';
import { decimal, positive, tradeFromEntry } from '../portfolio/add-transaction';

// "Add broker account" from the accepted mockups (v8): a broker account with the stocks, bonds
// and funds it holds, each at the price the owner sees at the broker, and the cash kept there.
// Prices are set by hand for now; what the account holds counts as money put in today.
export const brokerAccountTypes = ['Regular', 'IIS'] as const;
export type BrokerAccountType = (typeof brokerAccountTypes)[number];

export interface PositionEntry {
  /** A ticker or a name, as the broker shows it. */
  ticker: string;
  quantity: string;
  /** The price of one unit now, in the entry's currency. */
  price: string;
}

export interface BrokerEntry {
  broker: string;
  account: BrokerAccountType;
  /** The currency of the prices and of the cash. */
  currency: ValuationCurrency;
  positions: PositionEntry[];
  /** Cash at the broker; empty for none. */
  cash: string;
}

export type PositionField = keyof PositionEntry;
export type BrokerProblem = 'broker' | 'cash' | 'holdings' | `${PositionField}-${number}`;

export const MAX_BROKER_NAME = 100;
export const MAX_TICKER = 120;
export const MAX_POSITIONS = 20;

export const blankPosition = (): PositionEntry => ({ ticker: '', quantity: '', price: '' });
const blank = (position: PositionEntry) =>
  !position.ticker.trim() && !position.quantity.trim() && !position.price.trim();

/** The account's name: the broker, with "IIS" for an individual investment account. */
export const brokerAccountName = (entry: Pick<BrokerEntry, 'broker' | 'account'>) =>
  entry.account === 'IIS' ? `${entry.broker.trim()} · IIS` : entry.broker.trim();

/** The rows that are filled in; a row left empty is not a position. */
export const filledPositions = (entry: BrokerEntry) =>
  entry.positions.filter((position) => !blank(position));

export function brokerProblems(entry: BrokerEntry): Set<BrokerProblem> {
  const found = new Set<BrokerProblem>();
  const broker = entry.broker.trim();
  if (!broker || broker.length > MAX_BROKER_NAME || /[\r\n]/.test(broker)) found.add('broker');
  entry.positions.forEach((position, index) => {
    if (blank(position)) return;
    const ticker = position.ticker.trim();
    if (!ticker || ticker.length > MAX_TICKER || /[\r\n]/.test(ticker))
      found.add(`ticker-${index}`);
    if (positive(position.quantity) === null) found.add(`quantity-${index}`);
    if (positive(position.price) === null) found.add(`price-${index}`);
  });
  const cash = entry.cash.trim();
  if (cash && positive(cash) === null) found.add('cash');
  if (!filledPositions(entry).length && !cash) found.add('holdings');
  return found;
}

/** A ticker-like entry (letters, digits, dots, dashes) is kept as the asset's ticker too. */
export function positionAsset(
  position: PositionEntry,
  currency: ValuationCurrency,
): Omit<NewPortfolioAsset, 'requestId'> {
  const name = position.ticker.trim();
  const symbol = name.toUpperCase();
  return {
    name,
    ...(/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(symbol) ? { symbol } : {}),
    assetType: 'manual',
    valuationCurrency: currency,
  };
}

const MAX_PLACES = 30;
const scaled = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return { units: BigInt(whole + fraction), places: fraction.length };
};

/** Exact `quantity × price` of two decimal strings, half up past 30 places, zeros trimmed. */
export function times(quantity: string, price: string): string {
  const left = scaled(decimal(quantity) ?? '0');
  const right = scaled(decimal(price) ?? '0');
  let units = left.units * right.units;
  let places = left.places + right.places;
  if (places > MAX_PLACES) {
    const cut = 10n ** BigInt(places - MAX_PLACES);
    units = (units * 2n + cut) / (cut * 2n);
    places = MAX_PLACES;
  }
  const digits = units.toString().padStart(places + 1, '0');
  if (!places) return digits;
  const fraction = digits.slice(-places).replace(/0+$/, '');
  return fraction ? `${digits.slice(0, -places)}.${fraction}` : digits.slice(0, -places);
}

/**
 * A holding as a buy of its quantity for what it is worth now, at the current minute. It
 * carries no settlement currency, so it counts as money put in, as an opening balance does.
 */
export function holdingTrade(
  holding: { quantity: string; total: string; currency: ValuationCurrency },
  instrumentId: string,
  now: Date,
  identity: { requestId: string; expectedJournalRevision: number },
): TradeCommand {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  return tradeFromEntry(
    {
      side: 'buy',
      instrumentId,
      amount: decimal(holding.quantity) ?? holding.quantity,
      date: minute.slice(0, 10),
      time: minute.slice(11, 16),
      total: decimal(holding.total) ?? holding.total,
      currency: holding.currency,
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
