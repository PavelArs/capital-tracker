import {
  type HistoryPeriod,
  historyPeriods,
  type PortfolioHistory,
  portfolioHistoryApi,
} from '@api/portfolio-history.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CurrencySwitch, useAskedCurrency } from '../portfolio/currency';
import { money, percent, tone } from '../portfolio/format';
import HistoryChart from './HistoryChart';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import './dashboard.css';

const periodLabels: Record<HistoryPeriod, string> = {
  '24H': 'past 24 hours',
  '7D': 'past 7 days',
  '1M': 'past month',
  '3M': 'past 3 months',
  '1Y': 'past year',
  ALL: 'since Jan 1, 2025',
};

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The selected period's change split into market movement and money added or taken out
// (split-market-and-flows).
function ChangeSplit({ history }: { history: PortfolioHistory }) {
  const { currency, marketEffect, marketReturnPercent, netFlow } = history;
  // Only the market part is a gain or a loss; money added is neither.
  const market = tone(marketEffect);
  return (
    <div className="dashboard-split" aria-label="What changed">
      <span className="dashboard-split__period">{sentence(periodLabels[history.period])}</span>
      <span className="dashboard-split__item">
        <i className="dashboard-split__key dashboard-split__key--market" aria-hidden="true" />
        <span className="dashboard-split__label">Market</span>
        <span className={market ? `portfolio-${market}` : undefined}>
          {money(marketEffect, currency, true)}
        </span>
        {marketReturnPercent !== null && <span>{percent(marketReturnPercent)}</span>}
      </span>
      <span className="dashboard-split__item">
        <i className="dashboard-split__key dashboard-split__key--flows" aria-hidden="true" />
        <span className="dashboard-split__label">Net deposits</span>
        <span>{money(netFlow, currency, true)}</span>
      </span>
    </div>
  );
}

// Under the net worth: profit or loss to date against all the money put in, whatever the
// period; the period itself only drives the chart and the split below.
function NetWorth({ history }: { history: PortfolioHistory }) {
  const { currency, profit } = history;
  const direction = tone(profit);
  return (
    <section className="dashboard-hero" aria-label="Net worth">
      <div className="dashboard-hero__label">Total net worth · {currency}</div>
      <div className="dashboard-hero__value">
        {history.value === null ? 'No rate' : money(history.value, currency)}
      </div>
      <div
        className={`dashboard-hero__delta${direction ? ` portfolio-${direction}` : ''}`}
        aria-label="Profit or loss to date"
      >
        <span>
          {direction === 'neg' ? '▼ ' : direction === 'pos' ? '▲ ' : ''}
          {money(profit, currency, true)}
        </span>
        {history.profitPercent !== null && <span>{percent(history.profitPercent)}</span>}
        {history.invested !== null && (
          <span className="dashboard-hero__period">
            on {money(history.invested, currency)} net invested
          </span>
        )}
      </div>
      <ChangeSplit history={history} />
      {!history.complete && (
        <p className="portfolio-warn" role="note">
          Incomplete: some assets had no price or rate in this period, so their value is not
          included. Add the missing prices on the Portfolio page.
        </p>
      )}
    </section>
  );
}

// Net worth, change for the period and the capital chart from portfolio snapshots
// (record-portfolio-snapshots). Allocation and attention arrive with M16.
export default function DashboardPage() {
  const [history, setHistory] = useState<PortfolioHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<HistoryPeriod>('1M');
  const [asked, setAsked] = useAskedCurrency();
  const latest = useRef(0);

  // Only the newest request may change the page; switching keeps the last chart visible.
  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    try {
      const next = await portfolioHistoryApi.get(period, asked);
      if (request === latest.current) setHistory(next);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [period, asked]);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = history;
  const chartLabel = shown
    ? `Portfolio value, ${periodLabels[shown.period]}, from ${money(
        shown.points.find((point) => point.value !== null)?.value ?? null,
        shown.currency,
      )} to ${money(shown.value, shown.currency)}`
    : '';

  return (
    <div className="shell-page">
      <div className="shell-page__head">
        <h1>Dashboard</h1>
        {shown && <CurrencySwitch value={shown.currency} onChange={setAsked} />}
      </div>
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your capital history. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : shown === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading your capital…
        </section>
      ) : (
        <>
          <NetWorth history={shown} />
          <section
            className="shell-card dashboard-chart-card"
            aria-label="Portfolio value over time"
          >
            <div className="portfolio-toolbar">
              <div className="dashboard-chart-card__title">
                <h2>Capital</h2>
                <div className="dashboard-legend" aria-label="Chart legend">
                  <span>
                    <i className="dashboard-legend__line" aria-hidden="true" />
                    Portfolio value
                  </span>
                  <span>
                    <i
                      className="dashboard-legend__line dashboard-legend__line--invested"
                      aria-hidden="true"
                    />
                    Net invested
                  </span>
                  <span>
                    <i className="dashboard-legend__deposit" aria-hidden="true" />
                    Deposit
                  </span>
                </div>
              </div>
              <div className="dashboard-periods" role="tablist" aria-label="Chart period">
                {historyPeriods.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={period === value}
                    onClick={() => setPeriod(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <HistoryChart
              key={`${shown.period}:${shown.currency}:${shown.at}`}
              points={shown.points}
              period={shown.period}
              currency={shown.currency}
              label={chartLabel}
            />
            <p className="shell-note dashboard-note">
              Values come from snapshots of your holdings at stored prices and Bank of Russia rates:
              hourly for the last week, daily since Jan 1, 2025. Times are UTC. Net invested is the
              money you put in minus the money you took out, each at its day&apos;s rate; the gap
              between the two lines is your profit or loss.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
