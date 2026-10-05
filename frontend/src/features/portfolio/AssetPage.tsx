import { type AssetHistory, assetHistoryApi } from '@api/asset-history.api';
import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import { type HistoryPeriod, historyPeriods } from '@api/portfolio-history.api';
import {
  type AccountingCurrency,
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AssetIcon from '../shell/AssetIcon';
import PageHeader from '../shell/PageHeader';
import {
  assetKey,
  day,
  amount as operationAmount,
  placeLabel,
  signedAmount,
  statusLabels,
  typeLabel,
} from '../transactions/operation-format';
import AssetChart, { type Purchase } from './AssetChart';
import { ratesNote, useAskedCurrency, withCurrency } from './currency';
import { age, missingLabel, money, price, quantity, sourceLabels, sourceName } from './format';
import { assetCaption, Change, Signed } from './PortfolioPage';
import '../shell/shell-page.css';
import './portfolio.css';

const dateFormat = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Where the price came from and how fresh it is. */
function priceDetail(asset: AssetValuation, currency: AccountingCurrency, now: Date): string {
  const current = asset.price;
  if (!current) {
    return asset.missingPrice === 'no-rate'
      ? `No Bank of Russia rate stored to show it in ${currency}`
      : asset.priceSource === 'market'
        ? 'No market price stored yet'
        : 'Set a price to value it';
  }
  if (current.status === 'fixed')
    return asset.valuationCurrency === currency
      ? `Fixed: one unit is one ${currency}`
      : `Fixed: one ${asset.valuationCurrency} at today's Bank of Russia rate`;
  if (current.status === 'manual')
    return `Manual price set for ${dateFormat.format(new Date(current.observedAt ?? ''))}`;
  const when = current.observedAt ? age(current.observedAt, now) : '';
  return `${sourceName(current.source)} · ${current.status === 'stale' ? 'stale, ' : ''}updated ${when}`;
}

const SHOWN_OPERATIONS = 10;
const periodNames: Record<HistoryPeriod, string> = {
  '24H': 'past 24 hours',
  '7D': 'past 7 days',
  '1M': 'past month',
  '3M': 'past 3 months',
  '1Y': 'past year',
  ALL: 'since Jan 1, 2025',
};

/** The Transactions filter key of an asset, as the operations list writes it. */
const keyOf = (asset: AssetValuation) =>
  assetKey({ instrumentId: asset.instrumentId, symbol: asset.symbol, name: asset.name });

/** Operations that move this asset, newest first (as the Transactions page filters them). */
export function assetOperations(operations: readonly Operation[], key: string): Operation[] {
  return operations
    .filter((operation) =>
      [operation.asset, operation.counterAsset].some((item) => item && assetKey(item) === key),
    )
    .sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.orderWithinTimestamp - left.orderWithinTimestamp,
    );
}

/** Recorded buys of the asset, drawn as dots on the chart. */
export function purchasesOf(operations: readonly Operation[], instrumentId: string): Purchase[] {
  return operations.flatMap((operation) =>
    operation.type === 'buy' &&
    operation.status === 'recorded' &&
    operation.asset.instrumentId === instrumentId
      ? [{ at: operation.occurredAt, quantity: operation.quantity }]
      : [],
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="portfolio-stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

type OperationsState = OperationList | 'loading' | 'failed';

// Position value against cost basis over a period, with purchase dots (ASSET-CHART).
function ValueChart({
  asset,
  currency,
  asked,
  operations,
}: {
  asset: AssetValuation;
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  operations: OperationsState;
}) {
  const [period, setPeriod] = useState<HistoryPeriod>('1M');
  const [history, setHistory] = useState<AssetHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const instrumentId = asset.instrumentId;
  // Only the latest request may fill the chart: an earlier period's answer can arrive later.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    setHistory(null);
    try {
      const loaded = await assetHistoryApi.get(instrumentId, period, asked);
      if (request === latest.current) setHistory(loaded);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [instrumentId, period, asked]);
  useEffect(() => {
    void load();
  }, [load]);
  const purchases =
    typeof operations === 'object' ? purchasesOf(operations.operations, instrumentId) : [];
  const unit = asset.symbol ?? asset.name;
  return (
    <section className="shell-card dashboard-chart-card" aria-label="Position value over time">
      <div className="portfolio-toolbar">
        <div className="dashboard-legend" aria-label="Chart legend">
          <span>
            <i className="dashboard-legend__line" aria-hidden="true" />
            Position value
          </span>
          <span>
            <i
              className="dashboard-legend__line dashboard-legend__line--invested"
              aria-hidden="true"
            />
            Cost basis
          </span>
          <span>
            <i className="dashboard-legend__deposit" aria-hidden="true" />
            Purchase
          </span>
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
      {failed ? (
        <div className="portfolio-state" role="alert">
          <p>Could not load the chart. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : history === null ? (
        <p className="dashboard-chart__empty" role="status">
          Loading the chart…
        </p>
      ) : (
        <AssetChart
          key={`${history.period}:${history.currency}:${history.at}`}
          points={history.points}
          period={history.period}
          currency={history.currency}
          symbol={unit}
          purchases={purchases}
          label={`${asset.name} position value and cost basis, ${periodNames[history.period]}, in ${history.currency}`}
        />
      )}
      <p className="shell-note dashboard-note">
        Value of what you held at stored prices and Bank of Russia rates in{' '}
        {history?.currency ?? currency}: hourly for the last week, daily since Jan 1, 2025. Times
        are UTC. Cost basis counts the coins with a known purchase price.
      </p>
    </section>
  );
}

/** The amount of this asset an operation moves: a swap into it shows what arrived. */
function movedAmount(operation: Operation, key: string): string {
  if (assetKey(operation.asset) === key || !operation.counterAsset || !operation.counterQuantity)
    return signedAmount(operation);
  return operationAmount(operation.counterQuantity, operation.counterAsset, '+');
}

// The asset's own operations: the latest ten, then a link to all of them (prototype).
function AssetTransactions({
  asset,
  operations,
  onRetry,
}: {
  asset: AssetValuation;
  operations: OperationsState;
  onRetry: () => void;
}) {
  const key = keyOf(asset);
  const own = typeof operations === 'object' ? assetOperations(operations.operations, key) : [];
  const all = `/transactions?asset=${encodeURIComponent(key)}`;
  return (
    <section className="shell-card" aria-labelledby="asset-transactions">
      <div className="portfolio-toolbar">
        <h2 id="asset-transactions">Transactions</h2>
        {typeof operations === 'object' && <span className="portfolio-sub">{own.length}</span>}
      </div>
      {operations === 'failed' ? (
        <div className="portfolio-state" role="alert">
          <p>Could not load this asset's transactions.</p>
          <button type="button" className="shell-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : operations === 'loading' ? (
        <p className="portfolio-none" role="status">
          Loading transactions…
        </p>
      ) : own.length === 0 ? (
        <p className="portfolio-none">No transactions yet.</p>
      ) : (
        <>
          <ul className="portfolio-holdings portfolio-operations">
            {own.slice(0, SHOWN_OPERATIONS).map((operation) => (
              <li key={operation.id}>
                <span>
                  {operation.status === 'needs-classification' ? (
                    <span className="portfolio-pill">{statusLabels[operation.status]}</span>
                  ) : (
                    typeLabel(operation)
                  )}
                  <span className="portfolio-sub">
                    {day(operation.occurredAt)} · {placeLabel(operation)}
                  </span>
                </span>
                <span className="portfolio-num">
                  {movedAmount(operation, key)}
                  {operation.value !== null && typeof operations === 'object' && (
                    <span className="portfolio-sub">
                      {money(operation.value, operations.quoteCurrency)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Link className="portfolio-link portfolio-operations__all" to={all}>
            {own.length > SHOWN_OPERATIONS ? `Show all ${own.length}` : 'Open in Transactions'}
          </Link>
        </>
      )}
    </section>
  );
}

function AssetDetails({
  asset,
  portfolio,
  asked,
  operations,
  onRetryOperations,
  now,
}: {
  asset: AssetValuation;
  portfolio: PortfolioValuation;
  asked: AccountingCurrency | undefined;
  operations: OperationsState;
  onRetryOperations: () => void;
  now: Date;
}) {
  const unit = asset.symbol ?? '';
  const currency = portfolio.currency;
  const amount = (value: string | null, signed = false) => money(value, currency, signed);
  const unknown = Number(asset.unknownCostQuantity) > 0;
  const missingRate = Number(asset.missingRateQuantity) > 0;
  return (
    <>
      <div className="portfolio-head">
        <AssetIcon symbol={asset.symbol} name={asset.name} assetType={asset.assetType} size="lg" />
        <div className="portfolio-head__title">
          <h2>{asset.name}</h2>
          <span className="portfolio-sub">{assetCaption(asset)}</span>
        </div>
        <div className="portfolio-head__price">
          <b>{asset.price ? price(asset.price.value, currency) : missingLabel(asset)}</b>
          {asset.priceChange24hPercent !== null && (
            <span className="portfolio-head__change">
              <Change value={asset.priceChange24hPercent} /> today
            </span>
          )}
          <span
            className={asset.price?.status === 'stale' ? 'portfolio-warn-text' : 'portfolio-sub'}
          >
            {priceDetail(asset, currency, now)}
          </span>
        </div>
      </div>
      <section className="shell-card" aria-label="Position">
        <dl className="portfolio-stats">
          <Stat label="Amount">
            {quantity(asset.quantity)} {unit}
          </Stat>
          <Stat label="Current value">{amount(asset.value)}</Stat>
          <Stat label="Average buy price">
            {asset.averageBuyPrice === null ? '—' : price(asset.averageBuyPrice, currency)}
          </Stat>
          <Stat label="Cost basis">{amount(asset.costBasis)}</Stat>
          <Stat label="Unrealized P&L">
            <Signed
              value={asset.unrealizedPnl}
              currency={currency}
              ratio={asset.unrealizedReturnPercent}
            />
          </Stat>
          <Stat label="Realized P&L">
            <Signed value={asset.realizedPnl} currency={currency} />
          </Stat>
        </dl>
        {unknown && (
          <p className="portfolio-warn" role="note">
            {quantity(asset.unknownCostQuantity)} {unit} has no purchase price, so cost basis and
            unrealized P&amp;L are unknown. Known cost: {amount(asset.knownCostSubtotal)}.
          </p>
        )}
        {missingRate && (
          <p className="portfolio-warn" role="note">
            {quantity(asset.missingRateQuantity)} {unit} was bought before the stored Bank of Russia
            rates, so its cost in {currency} is unknown. Known cost:{' '}
            {amount(asset.knownCostSubtotal)}.
          </p>
        )}
        {asset.unknownRealizedCount > 0 && (
          <p className="portfolio-warn" role="note">
            A sale used coins without a purchase price or a stored rate, so realized P&amp;L is
            unknown. Known part: {amount(asset.knownRealizedSubtotal, true)}.
          </p>
        )}
      </section>
      <ValueChart asset={asset} currency={currency} asked={asked} operations={operations} />
      <div className="portfolio-split">
        <section className="shell-card" aria-labelledby="asset-holdings">
          <div className="portfolio-toolbar">
            <h2 id="asset-holdings">Holdings</h2>
            <span className="portfolio-sub">Where this balance sits</span>
          </div>
          {asset.holdings.length === 0 ? (
            <p className="portfolio-none">Nothing held right now.</p>
          ) : (
            <ul className="portfolio-holdings">
              {asset.holdings.map((holding) => (
                <li key={holding.accountId}>
                  <Link to={withCurrency(`/wallets/${holding.accountId}`, asked)}>
                    {holding.accountName}
                  </Link>
                  <span className="portfolio-num">
                    {quantity(holding.quantity)} {unit}
                    <span className="portfolio-sub">{amount(holding.value)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="shell-note portfolio-note">
            Price source: {sourceLabels[asset.priceSource]}. {ratesNote(portfolio)}
          </p>
        </section>
        <AssetTransactions asset={asset} operations={operations} onRetry={onRetryOperations} />
      </div>
    </>
  );
}

// One asset across every account (portfolio-valuation PV-5).
export default function AssetPage() {
  const { assetId } = useParams();
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(null);
  const [failed, setFailed] = useState(false);
  const [asked] = useAskedCurrency();

  const load = useCallback(async () => {
    setFailed(false);
    setPortfolio(null);
    try {
      setPortfolio(await portfolioValuationApi.get(asked));
    } catch {
      setFailed(true);
    }
  }, [asked]);
  useEffect(() => {
    void load();
  }, [load]);

  // The asset's operations feed both the chart's purchases and its transactions card.
  const [operations, setOperations] = useState<OperationsState>('loading');
  const latestOperations = useRef(0);
  const loadOperations = useCallback(async () => {
    const request = ++latestOperations.current;
    setOperations('loading');
    try {
      // The same currency as the page, so the values match its other amounts.
      const list = await operationsApi.list(asked);
      if (request === latestOperations.current) setOperations(list);
    } catch {
      if (request === latestOperations.current) setOperations('failed');
    }
  }, [asked]);
  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  const asset = portfolio?.assets.find((item) => item.instrumentId === assetId);
  return (
    <div className="shell-page">
      <PageHeader
        title={asset?.name ?? 'Asset'}
        currency={portfolio?.currency}
        onTransactionSaved={() => {
          void load();
          void loadOperations();
        }}
      />
      <div className="portfolio-crumbs">
        <Link className="portfolio-crumb" to={withCurrency('/portfolio', asked)}>
          ← Portfolio
        </Link>
      </div>
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load this asset. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : portfolio === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading asset…
        </section>
      ) : asset ? (
        <AssetDetails
          asset={asset}
          portfolio={portfolio}
          asked={asked}
          operations={operations}
          onRetryOperations={() => void loadOperations()}
          now={new Date()}
        />
      ) : (
        <section className="shell-card shell-empty" aria-labelledby="asset-missing">
          <h2 id="asset-missing">Asset not found</h2>
          <p>It may belong to another owner or the link is wrong.</p>
        </section>
      )}
    </div>
  );
}
