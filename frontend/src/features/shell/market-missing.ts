import type { MarketMissing } from '@api/portfolio-history.api';

// Why the market part of a change is a dash, in the words the server's reason stands for.
const reasons: Record<MarketMissing, string> = {
  'no-start': 'no value is known for this period',
  'flow-without-rate': 'money put in or taken out in this period has no exchange rate',
  'value-unknown': 'the value at the start or now is unknown',
  'deposit-without-rate': "a bank deposit's value has no exchange rate",
  'priced-later': 'an asset you held at the start had no price then',
  'unpriced-changed': 'an asset without a price was bought, sold or moved in this period',
};

/** The line beside an unknown market part; none when the server gave no reason. */
export function marketMissingText(reason: MarketMissing | null | undefined): string | null {
  if (!reason) return null;
  // These two leave the money put in or taken out unknown as well.
  const lead =
    reason === 'no-start' || reason === 'flow-without-rate'
      ? 'Market and net deposits unknown'
      : 'Market unknown';
  return `${lead}: ${reasons[reason]}`;
}
