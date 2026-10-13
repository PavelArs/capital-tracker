import type { WalletKind } from '@api/accounting.api';
import type { AssetHistory } from '@api/asset-history.api';
import { cachedReads } from '@api/cached-reads';
import type { Operation, OperationList } from '@api/operations.api';
import { type HistoryPeriod, historyPeriods } from '@api/portfolio-history.api';
import type {
  AccountingCurrency,
  AssetValuation,
  PortfolioValuation,
} from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dayText } from '@/utils/dates';
import AboutChart from '../shell/AboutChart';
import AssetIcon from '../shell/AssetIcon';
import { basisText } from '../shell/basis-text';
import { Icon } from '../shell/icons';
import { useInflationBasis } from '../shell/inflation-basis';
import PageHeader from '../shell/PageHeader';
import { InlineSkeleton, PageSkeleton } from '../shell/Skeleton';
import { onlyChain, useTokenChains } from '../shell/token-chains';
import { useValueView } from '../shell/value-view';
import {
  assetKey,
  day,
  amount as operationAmount,
  placeLabel,
  signedAmount,
  statusLabels,
  typeLabel,
} from '../transactions/operation-format';
import { classedOf, kindLabels, kindsOf } from '../wallets/wallets';
import AssetChart, { costUnknown, type Purchase } from './AssetChart';
import { assetCaption, Change, Signed } from './asset-parts';
import { ratesNote, useAskedCurrency, withCurrency } from './currency';
import {
  age,
  DASH,
  missingLabel,
  money,
  price,
  quantity,
  sourceLabels,
  sourceName,
} from './format';
import HideAsset from './HideAsset';
import { inflationAdjustment } from './real-cost';
import UpdatePriceDialog from './UpdatePriceDialog';
import '../shell/shell-page.css';
import './portfolio.css';
import EmptyState from '@/ui/EmptyState';

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
    return `Manual price set for ${dayText(current.observedAt ?? '')}`;
  const when = current.observedAt ? age(current.observedAt, now) : '';
  return `${sourceName(current.source)} · ${current.status === 'stale' ? 'stale, ' : ''}updated ${when}`;
}

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

/**
 * Operations that move this asset, newest first (as the Transactions page filters them); dust
 * stays under its own filter there.
 */
export function assetOperations(operations: readonly Operation[], key: string): Operation[] {
  return operations
    .filter(
      (operation) =>
        operation.status !== 'dust' &&
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
  const instrumentId = asset.instrumentId;
  const [history, setHistory] = useState<AssetHistory | null>(
    () => cachedReads.assetHistory.last(instrumentId, '1M', asked) ?? null,
  );
  const [failed, setFailed] = useState(false);
  // Only the latest request may fill the chart: an earlier period's answer can arrive later.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    const kept = cachedReads.assetHistory.last(instrumentId, period, asked);
    setHistory(kept ?? null);
    try {
      const loaded = await cachedReads.assetHistory.load(instrumentId, period, asked);
      if (request === latest.current) setHistory(loaded);
    } catch {
      if (request === latest.current && !kept) setFailed(true);
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
      <div className="ui-toolbar">
        <div className="dashboard-chart-card__name">
          <div className="dashboard-legend" aria-label="Chart legend">
            <span>
              <i className="dashboard-legend__line" aria-hidden="true" />
              Position value
            </span>
            {history && costUnknown(history.points) ? (
              <span>Cost basis unknown</span>
            ) : (
              <>
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
              </>
            )}
          </div>
          <AboutChart>
            Value of what you held at stored prices and Bank of Russia rates in{' '}
            {history?.currency ?? currency}: hourly for the last week, daily since Jan 1, 2025.
            Times are UTC. Cost basis counts the coins with a known purchase price.
          </AboutChart>
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
        <InlineSkeleton label="Loading the chart" chart />
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
    </section>
  );
}

/** The amount of this asset an operation moves: a swap into it shows what arrived. */
function movedAmount(operation: Operation, key: string): string {
  if (assetKey(operation.asset) === key || !operation.counterAsset || !operation.counterQuantity)
    return signedAmount(operation);
  return operationAmount(operation.counterQuantity, operation.counterAsset, '+');
}

/** Latest transactions the asset's card lists; the rest are one button away in Transactions. */
const ASSET_TRANSACTIONS_SHOWN = 5;

// The asset's latest five operations, then a button to all of them in Transactions.
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
  const latest = own.slice(0, ASSET_TRANSACTIONS_SHOWN);
  const all = `/transactions?asset=${encodeURIComponent(key)}`;
  return (
    <section className="shell-card" aria-labelledby="asset-transactions">
      <div className="ui-toolbar">
        <h2 id="asset-transactions">Transactions</h2>
        {typeof operations === 'object' && (
          <span className="portfolio-sub">
            {own.length > latest.length ? `Latest ${latest.length} of ${own.length}` : own.length}
          </span>
        )}
      </div>
      {operations === 'failed' ? (
        <div className="portfolio-state" role="alert">
          <p>Could not load this asset's transactions.</p>
          <button type="button" className="shell-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : operations === 'loading' ? (
        <InlineSkeleton label="Loading transactions" />
      ) : own.length === 0 ? (
        <p className="portfolio-none">No transactions yet.</p>
      ) : (
        <>
          <ul className="portfolio-holdings portfolio-operations">
            {latest.map((operation) => (
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
                <span className="ui-num">
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
          <Link className="shell-button" to={all}>
            Open in Transactions
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
  kinds,
  classed,
  onPriceSaved,
  now,
}: {
  asset: AssetValuation;
  portfolio: PortfolioValuation;
  asked: AccountingCurrency | undefined;
  operations: OperationsState;
  onRetryOperations: () => void;
  /** W1, A3: how each wallet is held, once known. */
  kinds: Record<string, WalletKind | null>;
  /** v8: accounts of another class (property) are no wallets; null until the accounts are read. */
  classed: ReadonlySet<string> | null;
  onPriceSaved: () => void;
  now: Date;
}) {
  const [pricing, setPricing] = useState(false);
  const unit = asset.symbol ?? '';
  const currency = portfolio.currency;
  const chains = useTokenChains();
  const amount = (value: string | null, signed = false) => money(value, currency, signed);
  const unknown = Number(asset.unknownCostQuantity) > 0;
  const missingRate = Number(asset.missingRateQuantity) > 0;
  // Part of the coins has no cost: show the rest on its own, marked as the known part.
  const partial =
    asset.costBasis === null && Number(asset.knownCostQuantity) > 0 && (unknown || missingRate);
  // INFL-REAL-PF: the cost grown by the inflation since each purchase, and the profit over it.
  // An answer saved before real figures existed has none, so it stays nominal.
  const [view] = useValueView();
  const [basis] = useInflationBasis();
  const reading = asset.real?.[basis] ?? null;
  const showReal = view === 'real' && asset.real !== undefined;
  return (
    <>
      <div className="portfolio-head">
        <AssetIcon
          symbol={asset.symbol}
          name={asset.name}
          assetType={asset.assetType}
          network={onlyChain(asset.symbol, chains)}
          size="lg"
        />
        <div className="portfolio-head__title">
          <h2>{asset.name}</h2>
          <span className="portfolio-sub">{assetCaption(asset, chains)}</span>
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
          {asset.priceSource === 'manual' && (
            <button
              type="button"
              className="shell-button shell-button--secondary"
              onClick={() => setPricing(true)}
            >
              Update price
            </button>
          )}
        </div>
      </div>
      {pricing && (
        <UpdatePriceDialog
          instrumentId={asset.instrumentId}
          name={asset.name}
          onClose={() => setPricing(false)}
          onSaved={() => {
            setPricing(false);
            onPriceSaved();
          }}
        />
      )}
      <section className="shell-card" aria-label="Position">
        <dl className="portfolio-stats">
          <Stat label="Amount">
            {quantity(asset.quantity)} {unit}
          </Stat>
          <Stat label="Current value">{amount(asset.value)}</Stat>
          <Stat label="Average buy price">
            {asset.averageBuyPrice === null ? '—' : price(asset.averageBuyPrice, currency)}
          </Stat>
          {showReal ? (
            <>
              <Stat label="Cost in today's money">
                {reading === null ? (
                  <>
                    {DASH}
                    <span className="portfolio-sub">
                      a purchase price, exchange rate or inflation figure is missing for some lots
                    </span>
                  </>
                ) : (
                  <>
                    {amount(reading.costBasis)}
                    {asset.costBasis !== null && (
                      <span className="portfolio-sub">
                        {amount(asset.costBasis)} paid +{' '}
                        {amount(inflationAdjustment(reading.costBasis, asset.costBasis))} inflation
                      </span>
                    )}
                  </>
                )}
              </Stat>
              <Stat label="Real P&L">
                <Signed
                  value={reading?.unrealizedPnl ?? null}
                  currency={currency}
                  ratio={reading?.unrealizedReturnPercent ?? null}
                />
                {reading !== null && asset.unrealizedPnl !== null && (
                  <span className="portfolio-sub">
                    Nominal {money(asset.unrealizedPnl, currency, true)}
                  </span>
                )}
              </Stat>
            </>
          ) : (
            <>
              <Stat label="Cost basis">
                {amount(partial ? asset.knownCostSubtotal : asset.costBasis)}
                {reading !== null && asset.costBasis !== null && (
                  <span className="portfolio-sub">
                    {amount(reading.costBasis)} in today&apos;s money
                  </span>
                )}
              </Stat>
              <Stat label="Unrealized P&L">
                <Signed
                  value={partial ? asset.knownUnrealizedPnl : asset.unrealizedPnl}
                  currency={currency}
                  ratio={
                    partial ? asset.knownUnrealizedReturnPercent : asset.unrealizedReturnPercent
                  }
                />
                {reading?.unrealizedPnl != null && asset.unrealizedPnl !== null && (
                  <span className="portfolio-sub">
                    Real {money(reading.unrealizedPnl, currency, true)}
                  </span>
                )}
              </Stat>
            </>
          )}
          <Stat label="Realized P&L">
            <Signed
              value={
                asset.realizedPnl === null && Number(asset.knownRealizedSubtotal) !== 0
                  ? asset.knownRealizedSubtotal
                  : asset.realizedPnl
              }
              currency={currency}
            />
          </Stat>
        </dl>
        {showReal && reading !== null && (
          <p className="shell-note portfolio-real-note">
            In today&apos;s {currency}, {basisText(basis, reading, currency)} ·{' '}
            <Link className="shell-link" to="/settings">
              Settings
            </Link>
          </p>
        )}
        {unknown && (
          <p className="ui-banner ui-banner--warn ui-banner--action portfolio-warn" role="note">
            <Icon name="alert" className="shell-icon shell-icon--sm" />
            <span>
              {quantity(asset.unknownCostQuantity)} {unit} has no purchase price, so cost basis and
              unrealized P&amp;L {partial ? 'cover only the rest' : 'are unknown'}. Known cost:{' '}
              {amount(asset.knownCostSubtotal)}.
            </span>
            <Link
              className="shell-button"
              to={`/transactions?asset=${encodeURIComponent(keyOf(asset))}&cost=unknown`}
            >
              Review transactions
            </Link>
          </p>
        )}
        {missingRate && (
          <p className="ui-banner ui-banner--warn portfolio-warn" role="note">
            {quantity(asset.missingRateQuantity)} {unit} was bought before the stored Bank of Russia
            rates, so its cost in {currency} is unknown. Known cost:{' '}
            {amount(asset.knownCostSubtotal)}.
          </p>
        )}
        {asset.unknownRealizedCount > 0 && (
          <p className="ui-banner ui-banner--warn portfolio-warn" role="note">
            A sale used coins without a purchase price or a stored rate, so realized P&amp;L is
            unknown. Known part: {amount(asset.knownRealizedSubtotal, true)}.
          </p>
        )}
      </section>
      <ValueChart asset={asset} currency={currency} asked={asked} operations={operations} />
      <div className="portfolio-split">
        <section className="shell-card" aria-labelledby="asset-holdings">
          <div className="ui-toolbar">
            <h2 id="asset-holdings">Holdings</h2>
            <span className="portfolio-sub">Where this balance sits</span>
          </div>
          {asset.holdings.length === 0 ? (
            <p className="portfolio-none">Nothing held right now.</p>
          ) : (
            <ul className="portfolio-holdings">
              {asset.holdings.map((holding) => {
                const kind = kinds[holding.accountId];
                // A property account has no wallet page: it is shown by its own name only.
                const wallet = classed !== null && !classed.has(holding.accountId);
                return (
                  <li key={holding.accountId}>
                    <span className="portfolio-holding">
                      {wallet ? (
                        <Link
                          className="shell-link"
                          to={withCurrency(`/wallets/${holding.accountId}`, asked)}
                        >
                          {holding.accountName}
                        </Link>
                      ) : (
                        <span>{holding.accountName}</span>
                      )}
                      {kind && <span className="portfolio-sub">{kindLabels[kind]}</span>}
                    </span>
                    <span className="ui-num">
                      {quantity(holding.quantity)} {unit}
                      <span className="portfolio-sub">{amount(holding.value)}</span>
                    </span>
                  </li>
                );
              })}
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
  const navigate = useNavigate();
  const [asked] = useAskedCurrency();
  // Coming back shows the last answers at once; the loads below replace them.
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(
    () => cachedReads.portfolio.last(asked) ?? null,
  );
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const kept = cachedReads.portfolio.last(asked);
    setPortfolio(kept ?? null);
    try {
      setPortfolio(await cachedReads.portfolio.load(asked));
    } catch {
      if (!kept) setFailed(true);
    }
  }, [asked]);
  useEffect(() => {
    void load();
  }, [load]);

  // The asset's operations feed both the chart's purchases and its transactions card.
  const [operations, setOperations] = useState<OperationsState>(
    () => cachedReads.operations.last(asked) ?? 'loading',
  );
  const latestOperations = useRef(0);
  const loadOperations = useCallback(async () => {
    const request = ++latestOperations.current;
    const kept = cachedReads.operations.last(asked);
    setOperations(kept ?? 'loading');
    try {
      // The same currency as the page, so the values match its other amounts.
      const list = await cachedReads.operations.load(asked);
      if (request === latestOperations.current) setOperations(list);
    } catch {
      if (request === latestOperations.current && !kept) setOperations('failed');
    }
  }, [asked]);
  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  // A3: how each wallet is held; the page does not wait for it, and shows no label without it.
  const [kinds, setKinds] = useState<Record<string, WalletKind | null>>(() =>
    kindsOf(cachedReads.accounts.last()),
  );
  const [classed, setClassed] = useState<ReadonlySet<string> | null>(() => {
    const kept = cachedReads.accounts.last();
    return kept ? classedOf(kept) : null;
  });
  useEffect(() => {
    let live = true;
    cachedReads.accounts
      .load()
      .then((accounts) => {
        if (!live) return;
        setKinds(kindsOf(accounts));
        setClassed(classedOf(accounts));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const asset = portfolio?.assets.find((item) => item.instrumentId === assetId);
  return (
    <div className="shell-page">
      <PageHeader title={asset?.name ?? 'Asset'} currency={portfolio?.currency} valueSwitch />
      <div className="portfolio-crumbs">
        <Link className="portfolio-crumb" to={withCurrency('/portfolio', asked)}>
          ← Portfolio
        </Link>
        {asset && (
          <HideAsset
            instrumentId={asset.instrumentId}
            symbol={asset.symbol}
            onHidden={() => navigate(withCurrency('/portfolio', asked))}
          />
        )}
      </div>
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load this asset. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : portfolio === null ? (
        <PageSkeleton label="Loading asset" show={['stats', 'chart', 'rows']} />
      ) : asset ? (
        <AssetDetails
          asset={asset}
          portfolio={portfolio}
          asked={asked}
          operations={operations}
          onRetryOperations={() => void loadOperations()}
          kinds={kinds}
          classed={classed}
          onPriceSaved={() => void load()}
          now={new Date()}
        />
      ) : (
        <EmptyState id="asset-missing" title="Asset not found">
          It may belong to another owner or the link is wrong.
        </EmptyState>
      )}
    </div>
  );
}
