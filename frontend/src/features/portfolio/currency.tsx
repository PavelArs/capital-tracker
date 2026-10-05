import {
  type AccountingCurrency,
  accountingCurrencies,
  type PortfolioValuation,
} from '@api/portfolio-valuation.api';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
    <div className="shell-seg" role="radiogroup" aria-label="Currency">
      {accountingCurrencies.map((currency) => (
        <label key={currency}>
          <input
            type="radio"
            name="portfolio-currency"
            value={currency}
            checked={chosen === currency}
            onChange={() => {
              setChoice({ value, chosen: currency });
              onChange(currency);
            }}
          />
          {currency}
        </label>
      ))}
    </div>
  );
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Which Bank of Russia rates the shown values use, or why some cannot be shown. */
export function ratesNote(portfolio: PortfolioValuation): string {
  if (portfolio.currency === 'USD' && portfolio.rates.length === 0)
    return 'Values are in USD from the latest stored prices.';
  const rates = portfolio.rates
    .map(
      (rate) =>
        `${rateText(rate.currency, rate.rubPerUnit)} (${dateFormat.format(new Date(rate.date))})`,
    )
    .join(', ');
  return rates
    ? `Values are in ${portfolio.currency} from the latest stored prices and Bank of Russia rates: ${rates}. Costs and realized P&L use the rate of each operation's date.`
    : `No Bank of Russia rate is stored yet, so values in ${portfolio.currency} cannot be shown.`;
}
