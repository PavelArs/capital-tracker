import { cachedReads } from '@api/cached-reads';
import { showingKept, useConnection } from '@api/connection';
import {
  type HistoryPeriod,
  historyPeriods,
  type PortfolioHistory,
} from '@api/portfolio-history.api';
import type { AccountingCurrency, PortfolioValuation } from '@api/portfolio-valuation.api';
import { clockText } from '@utils/dates';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { accountsWithoutRate } from '../deposits/deposit-format';
import NearestGoal from '../goals/NearestGoal';
import AddTransactionDialog from '../portfolio/AddTransactionDialog';
import Allocation from '../portfolio/Allocation';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { DASH, money, percent, quantity, tone } from '../portfolio/format';
import AboutChart from '../shell/AboutChart';
import { useAttention } from '../shell/attention-context';
import { basisText } from '../shell/basis-text';
import { Icon } from '../shell/icons';
import { useInflationBasis } from '../shell/inflation-basis';
import PageHeader from '../shell/PageHeader';
import { tokenChains } from '../shell/token-chains';
import { useValueView } from '../shell/value-view';
import DashboardLoading, { AllocationLoading } from './DashboardLoading';
import HistoryChart from './HistoryChart';
import TopAssets from './TopAssets';
import '../shell/shell-page.css';
import './dashboard.css';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button, ButtonLink } from '@/ui/Button';
import { Card } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Legend, type LegendItem } from '@/ui/Legend';
import { useSegmentedTabs } from '@/ui/SegmentedTabs';

const periodLabels: Record<HistoryPeriod, string> = {
  '24H': 'past 24 hours',
  '7D': 'past 7 days',
  '1M': 'past month',
  '3M': 'past 3 months',
  '1Y': 'past year',
  ALL: 'since Jan 1, 2025',
};

const LEGEND: readonly LegendItem[] = [
  { key: 'value', label: 'Portfolio value', swatch: 'line', color: 'var(--accent)' },
  { key: 'invested', label: 'Net invested', swatch: 'line', color: 'var(--ink-3)' },
  { key: 'deposit', label: 'Deposit', swatch: 'marker', color: 'var(--ink-2)' },
];

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The selected period's change split into market movement and money added or taken out
// (split-market-and-flows).
function ChangeSplit({
  history,
  portfolio,
}: {
  history: PortfolioHistory;
  portfolio: PortfolioValuation | null;
}) {
  const { currency, marketEffect, marketReturnPercent, netFlow } = history;
  // Only the market part is a gain or a loss; money added is neither.
  const market = tone(marketEffect);
  const unknown = unknownCostCoins(portfolio);
  return (
    <div className="dashboard-split" aria-label="What changed">
      <span className="dashboard-split__period">{sentence(periodLabels[history.period])}</span>
      {!!((history.excludedAssetCount ?? 0) + (history.excludedDepositCount ?? 0)) && (
        <span className="dashboard-split__period">
          Priced assets only ·{' '}
          {(history.excludedAssetCount ?? 0) + (history.excludedDepositCount ?? 0)} without a price
          or rate excluded
        </span>
      )}
      <span className="dashboard-split__item">
        <i className="dashboard-split__key dashboard-split__key--market" aria-hidden="true" />
        <span className="dashboard-split__label">Market</span>
        <span className={market ? `ui-${market}` : undefined}>
          {money(marketEffect, currency, true)}
        </span>
        {marketReturnPercent !== null && <span>{percent(marketReturnPercent)}</span>}
      </span>
      <span className="dashboard-split__item">
        <i className="dashboard-split__key dashboard-split__key--flows" aria-hidden="true" />
        <span className="dashboard-split__label">Net deposits</span>
        <span>{money(netFlow, currency, true)}</span>
      </span>
      {/* Coins without a purchase price leave the cost basis and the profit incomplete: said
          in words here, not only in the note beside the profit. */}
      {unknown !== null && (
        <span className="dashboard-split__item dashboard-split__unknown">
          <Icon name="info" className="shell-icon shell-icon--sm" />
          {unknown} without purchase price
        </span>
      )}
    </div>
  );
}

// Coins with no purchase price leave cost basis, net invested and profit incomplete
// (prototype: "0.0087 BTC without purchase price" beside Market and Net deposits).
function unknownCostCoins(portfolio: PortfolioValuation | null): string | null {
  const coins = (portfolio?.assets ?? []).filter((asset) => Number(asset.unknownCostQuantity) > 0);
  if (coins.length === 0) return null;
  const shown = coins.slice(0, 2).map((asset) => {
    const unit = asset.symbol ?? asset.name;
    return `${quantity(asset.unknownCostQuantity)} ${unit}`;
  });
  const more = coins.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

export function unknownCostNote(portfolio: PortfolioValuation | null): string | null {
  const coins = unknownCostCoins(portfolio);
  return coins === null
    ? null
    : `${coins} without purchase price, so cost basis and profit are incomplete.`;
}

const INCOMPLETE_NOTE =
  'Incomplete: some assets had no price or rate, or an account had no interest rate, in this period, so their value is not fully included. Add the missing prices on the Portfolio page.';

// The prototype dims the cents of the big number: $42,738.84 with .84 muted. A rouble figure
// shows whole roubles, cut from the exact amount by money(); a loss keeps its kopecks here.
function Amount({ value, currency }: { value: string; currency: AccountingCurrency }) {
  if (currency === 'RUB') {
    const negative = value.startsWith('-') && /[1-9]/.test(value.split('.')[1] ?? '');
    return money(value, currency, false, negative ? 'exact' : 'down');
  }
  const text = money(value, currency);
  const point = text.lastIndexOf('.');
  if (point < 0) return text;
  const cents = text.slice(point);
  return (
    <>
      {text.slice(0, point)}
      <span className="dashboard-hero__cents">{cents}</span>
    </>
  );
}

const NO_REAL =
  'No real profit: an inflation figure, exchange rate or price is missing for some of your deposits.';

// Under the net worth: profit or loss to date against all the money put in, whatever the
// period; the period itself only drives the chart and the split below. Under Real, money put
// in is grown by the inflation since each deposit's day (INFL-REAL).
function NetWorth({
  history,
  portfolio,
  asked,
  refreshFailed,
}: {
  history: PortfolioHistory;
  portfolio: PortfolioValuation | null;
  asked: AccountingCurrency | undefined;
  /** The last refresh failed: the figure is the last one loaded. */
  refreshFailed: boolean;
}) {
  const { currency } = history;
  const [view] = useValueView();
  const [basis] = useInflationBasis();
  const real = history.real?.[basis] ?? null;
  // VIEW-ONE: one reading at a time. Under Real a profit that cannot be computed is a dash and
  // the reason, never the nominal one; an answer saved before real figures existed has none to
  // miss, so it stays nominal until a fresh one arrives.
  const realView = view === 'real' && history.real !== undefined;
  // A real reading can exist and still state no profit when no held asset is priced.
  const shownReal = realView && real !== null && real.profit !== null;
  const noReal = realView && !shownReal;
  const profit = shownReal ? real.profit : noReal ? null : history.profit;
  const profitPercent = shownReal ? real.profitPercent : noReal ? null : history.profitPercent;
  const invested = shownReal ? real.invested : noReal ? null : history.invested;
  const direction = tone(profit);
  // What is left out of these figures is said once, in a tooltip, not as lines of text.
  const note = [unknownCostNote(portfolio), history.complete ? null : INCOMPLETE_NOTE]
    .filter((text) => text !== null)
    .join(' ');
  const info =
    note === '' ? null : (
      <span
        className="dashboard-hero__info"
        role="img"
        tabIndex={0}
        aria-label={note}
        data-tip={note}
      >
        <Icon name="info" className="shell-icon shell-icon--sm" />
      </span>
    );
  return (
    <section className="dashboard-hero" aria-label="Net worth">
      <div className="dashboard-hero__label">
        Total net worth · {currency}
        {/* The number carries its own data state: the banners above can scroll away. */}
        {refreshFailed ? (
          <Badge tone="warn">As of {clockText(history.at)}</Badge>
        ) : portfolio !== null && portfolio.stalePriceCount > 0 ? (
          <Badge tone="warn">Stale prices</Badge>
        ) : null}
      </div>
      <div className="dashboard-hero__value" aria-live="polite">
        {history.value === null ? 'No rate' : <Amount value={history.value} currency={currency} />}
      </div>
      <div
        className={`dashboard-hero__delta${direction ? ` ui-${direction}` : ''}`}
        aria-label={realView ? 'Real profit or loss to date' : 'Profit or loss to date'}
      >
        <span>
          {direction === 'neg' ? '▼ ' : direction === 'pos' ? '▲ ' : ''}
          {noReal ? DASH : money(profit, currency, true)}
        </span>
        {profitPercent !== null && <span>{percent(profitPercent)}</span>}
        {noReal ? (
          <span className="dashboard-hero__period">
            {real === null ? NO_REAL : 'No real profit: prices are missing for the assets held.'}
            {info}
          </span>
        ) : invested !== null ? (
          // The note icon is the last word of the line it qualifies, so it wraps with it.
          <span className="dashboard-hero__period">
            {shownReal ? (
              <>
                {`real, on ${money(invested, currency)} put in, in today's money · ${basisText(basis, real, currency)} · `}
                <Link to="/settings">Settings</Link>
              </>
            ) : (
              `on ${money(invested, currency)} net invested`
            )}
            {info}
          </span>
        ) : (
          info
        )}
      </div>
      {portfolio !== null &&
        portfolio.currency === currency &&
        Number(portfolio.depositsValue) > 0 && (
          <div className="dashboard-hero__note">
            Includes {money(portfolio.depositsValue, currency)} in{' '}
            <Link to={withCurrency('/deposits', asked)}>bank deposits</Link>
          </div>
        )}
      <ChangeSplit history={history} portfolio={portfolio} />
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

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      id="dashboard-empty"
      title="Your portfolio is empty"
      icon={<Icon name="wallets" />}
      actions={
        <>
          <ButtonLink variant="primary" icon="plus" to="/wallets">
            Add wallet
          </ButtonLink>
          <Button onClick={onAdd}>Add transaction</Button>
        </>
      }
    >
      Add your first wallet or asset to start tracking your capital. Wallet balances and history
      load automatically.
    </EmptyState>
  );
}

// Net worth, change for the period and the capital chart from portfolio snapshots
// (record-portfolio-snapshots); top assets and allocation from the current valuation. What
// needs the owner lives in the header bell (ATTN-BELL).
export default function DashboardPage() {
  const [asked] = useAskedCurrency();
  // Coming back to the page paints the last answers at once; the loads below replace them.
  const [history, setHistory] = useState<PortfolioHistory | null>(
    () => cachedReads.history.last('1M', asked) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<HistoryPeriod>('1M');
  const { tabs, panelProps } = useSegmentedTabs({
    label: 'Chart period',
    options: historyPeriods,
    value: period,
    onChange: setPeriod,
    size: 'sm',
  });
  const chartTitle = useId();
  const [adding, setAdding] = useState(false);
  const latest = useRef(0);
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(
    () => cachedReads.portfolio.last(asked) ?? null,
  );
  const [portfolioFailed, setPortfolioFailed] = useState(false);
  const latestPortfolio = useRef(0);
  const wallets = useAttention()?.wallets ?? null;
  // Offline, or reads go unanswered: the figure may be one kept from before (STALE-STATE).
  const current = useConnection();

  // Only the newest request may change the page; switching keeps the last chart visible.
  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    try {
      const next = await cachedReads.history.load(period, asked);
      if (request === latest.current) setHistory(next);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [period, asked]);
  useEffect(() => {
    void load();
  }, [load]);

  // Top assets, allocation and old prices come from today's valuation; a failure there
  // leaves the net worth and the chart in place.
  const loadPortfolio = useCallback(async () => {
    const request = ++latestPortfolio.current;
    setPortfolioFailed(false);
    try {
      const next = await cachedReads.portfolio.load(asked);
      if (request === latestPortfolio.current) setPortfolio(next);
    } catch {
      if (request === latestPortfolio.current) setPortfolioFailed(true);
    }
  }, [asked]);
  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);
  const reload = () => {
    void load();
    void loadPortfolio();
  };

  const shown = history;
  const chartLabel = shown
    ? `Portfolio value, ${periodLabels[shown.period]}, from ${money(
        shown.points.find((point) => point.value !== null)?.value ?? null,
        shown.currency,
      )} to ${money(shown.value, shown.currency)}`
    : '';

  return (
    <div className="shell-page">
      <PageHeader title="Dashboard" currency={shown?.currency} valueSwitch />
      {/* A failed later load keeps what is on screen and says so above it. */}
      {failed && shown !== null && (
        <Banner
          tone="neg"
          action={
            <Button size="sm" icon="refresh" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          Could not update your capital history. Showing the last loaded figures.
        </Banner>
      )}
      {failed && shown === null ? (
        <ErrorState what="your capital history" onRetry={() => void load()} />
      ) : shown === null ? (
        <DashboardLoading />
      ) : isEmptyPortfolio(shown) ? (
        <>
          <NearestGoal />
          <Empty onAdd={() => setAdding(true)} />
        </>
      ) : (
        <>
          {portfolio !== null && !!portfolio.interestMissingDepositCount && (
            <Banner tone="warn">
              {accountsWithoutRate(portfolio.interestMissingDepositCount)}
            </Banner>
          )}
          {portfolio !== null && portfolio.stalePriceCount > 0 && (
            <Banner tone="warn">
              {portfolio.stalePriceCount === 1
                ? '1 price is older than 2 hours; the last stored price is used.'
                : `${portfolio.stalePriceCount} prices are older than 2 hours; the last stored prices are used.`}
            </Banner>
          )}
          <NetWorth
            history={shown}
            portfolio={portfolio}
            asked={asked}
            refreshFailed={failed || showingKept(current)}
          />
          <NearestGoal />
          <Card variant="chart" className="dashboard-chart-card" labelledBy={chartTitle}>
            <span id={chartTitle} className="ui-sr">
              Portfolio value over time
            </span>
            <div className="ui-toolbar">
              <div className="dashboard-chart-card__title">
                <div className="dashboard-chart-card__name">
                  <h2>Capital</h2>
                  <AboutChart>
                    Snapshots at stored prices and Bank of Russia rates: hourly for the last week,
                    daily since Jan 1, 2025, in UTC. Net invested is the money put in minus the
                    money taken out; the gap to the value line is your profit or loss.
                  </AboutChart>
                </div>
                <div role="group" aria-label="Chart legend">
                  <Legend items={LEGEND} />
                </div>
              </div>
              {tabs}
            </div>
            <div {...panelProps}>
              <HistoryChart
                key={`${shown.period}:${shown.currency}:${shown.at}`}
                points={shown.points}
                period={shown.period}
                currency={shown.currency}
                label={chartLabel}
              />
            </div>
          </Card>
          <div className="dashboard-bottom">
            <TopAssets
              chains={tokenChains(wallets)}
              portfolio={portfolio}
              failed={portfolioFailed}
              onRetry={() => void loadPortfolio()}
              asked={asked}
            />
            {portfolio !== null ? (
              <Allocation portfolio={portfolio} limit={6} />
            ) : (
              !portfolioFailed && <AllocationLoading />
            )}
          </div>
        </>
      )}
      {adding && (
        <AddTransactionDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
