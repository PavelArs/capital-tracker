import {
  type AccountingCurrency,
  accountingCurrencies,
  type PortfolioValuation,
} from '@api/portfolio-valuation.api';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { dayText } from '@/utils/dates';
import { rateText } from './format';

const isCurrency = (value: string | null): value is AccountingCurrency =>
  accountingCurrencies.includes(value as AccountingCurrency);

/** The currency asked in the address (?currency=EUR); none means the main currency. */
export function useAskedCurrency(): [
  AccountingCurrency | undefined,
  (currency: AccountingCurrency) => void,
] {
  const [params, setParams] = useSearchParams();
  const asked = params.get('currency');
  return [
    isCurrency(asked) ? asked : undefined,
    // Other parameters of the page (Transactions filters) stay as they are.
    (currency) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('currency', currency);
          return next;
        },
        { replace: true },
      ),
  ];
}

/** Keeps a switched currency when following a link to another portfolio page. */
export function withCurrency(path: string, asked: AccountingCurrency | undefined): string {
  return asked ? `${path}?currency=${asked}` : path;
}

export function CurrencySwitch({
  value,
  onChange,
}: {
  value: AccountingCurrency;
  onChange: (currency: AccountingCurrency) => void;
}) {
  // The router applies the new address in a transition, after React has already put the
  // controlled radio back; keep the clicked one marked until the page's currency changes.
  const [choice, setChoice] = useState({ value, chosen: value });
  const chosen = choice.value === value ? choice.chosen : value;
  return (
    <SegmentedControl
      name="portfolio-currency"
      label="Currency"
      options={accountingCurrencies}
      value={chosen}
      onChange={(currency) => {
        setChoice({ value, chosen: currency });
        onChange(currency);
      }}
    />
  );
}

/** Which Bank of Russia rates the shown values use, and which currencies cannot be converted. */
export function ratesNote({
  currency,
  rates,
  staleRates = [],
}: Pick<PortfolioValuation, 'currency' | 'rates' | 'staleRates'>): string {
  const why = (from: AccountingCurrency) => {
    const stale = staleRates.find((rate) => rate.currency === from);
    return stale
      ? `the latest Bank of Russia ${from} rate is older than 15 days (${dayText(stale.date)})`
      : `no Bank of Russia ${from} rate from the last 15 days is stored`;
  };
  const rated = (of: AccountingCurrency) =>
    of === 'RUB' || rates.some((rate) => rate.currency === of);
  // Without a fresh rate of the report currency nothing converts into it, so no rate is listed.
  if (!rated(currency))
    return `Values in other currencies cannot be converted to ${currency} because ${why(currency)}; ${currency} holdings still show.`;
  const used = rates
    .map((rate) => `${rateText(rate.currency, rate.rubPerUnit)} (${dayText(rate.date)})`)
    .join(', ');
  return [
    used
      ? `Values are in ${currency} from the latest stored prices and Bank of Russia rates: ${used}. Costs and realized P&L use the rate of each operation's date.`
      : `Values are in ${currency} from the latest stored prices.`,
    ...accountingCurrencies
      .filter((from) => !rated(from))
      .map((from) => `Values in ${from} cannot be converted to ${currency} because ${why(from)}.`),
  ].join(' ');
}
