import type { FxRatesReport } from '@api/fx-rates.api';
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

// The server keeps 48 whole digits and 30 places; a quantity times a price stays within both.
const MAX_WHOLE_DIGITS = 24;
const MAX_PLACES_ENTERED = 15;

/** A positive amount the server can store, alone and multiplied by another such amount. */
export function amount(value: string): string | null {
  const text = positive(value);
  if (text === null) return null;
  const [whole, fraction = ''] = text.split('.');
  return whole.replace(/^0+/, '').length > MAX_WHOLE_DIGITS || fraction.length > MAX_PLACES_ENTERED
    ? null
    : text;
}

/**
 * Whether a trimmed name is one the server keeps (`label` in backend accounting input): some
 * text, at most `maximum` characters, no control characters and no broken Unicode.
 */
const label = (text: string, maximum: number) => {
  const characters = Array.from(text);
  return (
    characters.length > 0 &&
    characters.length <= maximum &&
    !characters.some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159);
    }) &&
    !/\p{Cs}/u.test(text)
  );
};

export function brokerProblems(entry: BrokerEntry): Set<BrokerProblem> {
  const found = new Set<BrokerProblem>();
  if (!label(entry.broker.trim(), MAX_BROKER_NAME)) found.add('broker');
  entry.positions.forEach((position, index) => {
    if (blank(position)) return;
    if (!label(position.ticker.trim(), MAX_TICKER)) found.add(`ticker-${index}`);
    if (amount(position.quantity) === null) found.add(`quantity-${index}`);
    if (amount(position.price) === null) found.add(`price-${index}`);
  });
  const cash = entry.cash.trim();
  if (cash && amount(cash) === null) found.add('cash');
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

/** `total ÷ quantity`, half up at the 30 places the server keeps a price at, zeros trimmed. */
export function perUnit(total: string, quantity: string): string {
  const numerator = scaled(total);
  const denominator = scaled(quantity);
  // units = total.units × 10^(30 − total.places + quantity.places) ÷ quantity.units
  const shift = MAX_PLACES - numerator.places + denominator.places;
  const top = numerator.units * 10n ** BigInt(Math.max(shift, 0));
  const bottom = denominator.units * 10n ** BigInt(Math.max(-shift, 0));
  const units = (top * 2n + bottom) / (bottom * 2n);
  const digits = units.toString().padStart(MAX_PLACES + 1, '0');
  const fraction = digits.slice(-MAX_PLACES).replace(/0+$/, '');
  return fraction ? `${digits.slice(0, -MAX_PLACES)}.${fraction}` : digits.slice(0, -MAX_PLACES);
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

/** The server converts at a Bank of Russia rate at most this many days old (MAX_RATE_AGE_DAYS). */
export const MAX_RATE_AGE_DAYS = 15;

// The Moscow calendar date of an instant: the day the server takes the Bank of Russia rate of.
export { moscowDate } from '@/utils/dates';

/** Whether the rates a RUB or EUR amount needs today are stored and recent enough. */
export function freshRates(currency: 'EUR' | 'RUB', report: FxRatesReport, today: string): boolean {
  const needed: readonly ('USD' | 'EUR')[] = currency === 'RUB' ? ['USD'] : ['USD', 'EUR'];
  return needed.every((code) => {
    const rate = report.rates.find((item) => item.currency === code);
    if (!rate?.rubPerUnit || !rate.date) return false;
    const age =
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${rate.date}T00:00:00Z`)) / 86_400_000;
    return age <= MAX_RATE_AGE_DAYS;
  });
}

const atoms = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(MAX_PLACES, '0').slice(0, MAX_PLACES));
};
const MAX_SERVER_ATOMS = 10n ** 78n - 1n;

/**
 * Whether a RUB or EUR amount converts to a dollar amount the server keeps: it converts at the
 * Bank of Russia rates, rounding half up at 30 places, and refuses zero or more than 48 digits.
 */
export function convertible(
  total: string,
  currency: 'EUR' | 'RUB',
  report: FxRatesReport,
): boolean {
  const rubPer = (code: 'USD' | 'EUR') =>
    report.rates.find((rate) => rate.currency === code)?.rubPerUnit ?? null;
  const usd = rubPer('USD');
  const unit = currency === 'RUB' ? '1' : rubPer('EUR');
  if (!usd || !unit) return false;
  const rubles = atoms(decimal(total) ?? total) * atoms(unit);
  const target = atoms(usd);
  const dollars = (rubles * 2n + target) / (target * 2n);
  return dollars > 0n && dollars <= MAX_SERVER_ATOMS;
}
