import {
  type HistoryPeriod,
  historyPeriods,
  type PortfolioHistory,
  portfolioHistoryApi,
} from '@api/portfolio-history.api';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AddTransactionDialog from '../portfolio/AddTransactionDialog';
import { useAskedCurrency } from '../portfolio/currency';
import { money, percent, tone } from '../portfolio/format';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
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

// The prototype dims the cents of the big number: $42,738.84 with .84 muted.
function Amount({ text }: { text: string }) {
  const point = text.lastIndexOf('.');
  if (point < 0) return text;
  return (
    <>
      {text.slice(0, point)}
      <span className="dashboard-hero__cents">{text.slice(point)}</span>
    </>
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
        {history.value === null ? 'No rate' : <Amount text={money(history.value, currency)} />}
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

const isZero = (value: string | null) => value !== null && Number(value) === 0;

// Nothing recorded yet: no value now or in the period, no unknown price and nothing put in.
// An owner who sold everything still has money in and out, so keeps the history.
export function isEmptyPortfolio(history: PortfolioHistory): boolean {
  return (
    history.complete &&
    isZero(history.value) &&
    isZero(history.invested) &&
    history.points.every((point) => point.value === null || isZero(point.value))
  );
}

// Grey blocks where the net worth and the chart will appear (prototype "Loading" state).
function Loading() {
  return (
    <section
      className="dashboard-loading"
      role="status"
      aria-busy="true"
      aria-label="Loading your capital"
    >
      <div className="dashboard-loading__hero">
        <i className="dashboard-loading__block dashboard-loading__label" />
        <i className="dashboard-loading__block dashboard-loading__value" />
        <i className="dashboard-loading__block dashboard-loading__delta" />
      </div>
      <div className="shell-card dashboard-loading__card">
        <div className="dashboard-loading__toolbar">
          <i className="dashboard-loading__block dashboard-loading__legend" />
          <i className="dashboard-loading__block dashboard-loading__periods" />
        </div>
        <i className="dashboard-loading__block dashboard-loading__chart" />
      </div>
    </section>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="shell-card shell-empty" aria-labelledby="dashboard-empty">
      <span className="shell-empty__ill" aria-hidden="true">
        <Icon name="wallets" />
      </span>
      <h2 id="dashboard-empty">Your portfolio is empty</h2>
      <p>
        Add your first wallet or asset to start tracking your capital. Wallet balances and history
        load automatically.
      </p>
      <div className="dashboard-empty__actions">
        <Link className="shell-button shell-button--primary" to="/wallets">
          <Icon name="plus" className="shell-icon shell-icon--sm" />
          Add wallet
        </Link>
        <button type="button" className="shell-button" onClick={onAdd}>
          Add transaction
        </button>
      </div>
    </section>
  );
}

// How the chart is built, behind an info button instead of a paragraph under the chart.
function AboutChart() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="dashboard-about">
      <button
        type="button"
        className="dashboard-about__button"
        aria-label="About this chart"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((shown) => !shown)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        onBlur={() => setOpen(false)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      {open && (
        <p id={id} className="dashboard-about__note" role="note">
          Snapshots at stored prices and Bank of Russia rates: hourly for the last week, daily since
          Jan 1, 2025, in UTC. Net invested is the money put in minus the money taken out; the gap
          to the value line is your profit or loss.
        </p>
      )}
    </div>
  );
}

// Net worth, change for the period and the capital chart from portfolio snapshots
// (record-portfolio-snapshots). Allocation and attention arrive with M16.
export default function DashboardPage() {
  const [history, setHistory] = useState<PortfolioHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<HistoryPeriod>('1M');
  const [adding, setAdding] = useState(false);
  const [asked] = useAskedCurrency();
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
      <PageHeader title="Dashboard" currency={shown?.currency} onTransactionSaved={load} />
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your capital history. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : shown === null ? (
        <Loading />
      ) : isEmptyPortfolio(shown) ? (
        <Empty onAdd={() => setAdding(true)} />
      ) : (
        <>
          <NetWorth history={shown} />
          <section
            className="shell-card dashboard-chart-card"
            aria-label="Portfolio value over time"
          >
            <div className="portfolio-toolbar">
              <div className="dashboard-chart-card__title">
                <div className="dashboard-chart-card__name">
                  <h2>Capital</h2>
                  <AboutChart />
                </div>
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
          </section>
        </>
      )}
      {adding && (
        <AddTransactionDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
