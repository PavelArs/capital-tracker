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
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dayText } from '@/utils/dates';
import AboutChart from '../shell/AboutChart';
import AssetIcon from '../shell/AssetIcon';
import { heldClass } from '../shell/asset-identity';
import { basisText } from '../shell/basis-text';
import { useInflationBasis } from '../shell/inflation-basis';
import PageHeader from '../shell/PageHeader';
import { InlineSkeleton, PageSkeleton } from '../shell/Skeleton';
import { onlyChain, useTokenChains } from '../shell/token-chains';
import { useAccountClasses } from '../shell/useAccountClasses';
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
import AssetLotsCard from './AssetLots';
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
import { adjustmentText } from './real-cost';
import UpdatePriceDialog from './UpdatePriceDialog';
import '../shell/shell-page.css';
import './portfolio.css';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Legend } from '@/ui/Legend';
import { ListRowText, rowClass } from '@/ui/ListRow';
import { Crumb, PageHead } from '@/ui/PageHead';
import { useSegmentedTabs } from '@/ui/SegmentedTabs';
import { Stat, Stats } from '@/ui/Stats';

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
  const chartTitle = useId();
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
  // portfolio-19: the periods are tabs with arrow keys; the chart is the panel they control.
  const { tabs, panelProps } = useSegmentedTabs({
    label: 'Chart period',
    options: historyPeriods,
    value: period,
    onChange: setPeriod,
    size: 'sm',
  });
  const purchases =
    typeof operations === 'object' ? purchasesOf(operations.operations, instrumentId) : [];
  const unit = asset.symbol ?? asset.name;
  const costHidden = history !== null && costUnknown(history.points);
  return (
    <Card variant="chart" className="dashboard-chart-card" labelledBy={chartTitle}>
      {/* The card is the region the chart's tests and readers find by this name. */}
      <h2 id={chartTitle} className="ui-sr">
        Position value over time
      </h2>
      <div className="ui-toolbar">
        <div className="dashboard-chart-card__name">
          <div aria-label="Chart legend" role="group">
            <Legend
              items={[
                { key: 'value', label: 'Position value', swatch: 'line', color: 'var(--accent)' },
                ...(costHidden
                  ? []
                  : ([
                      {
                        key: 'cost',
                        label: 'Cost basis',
                        swatch: 'dash',
                        color: 'var(--ink-3)',
                      },
                      {
                        key: 'purchase',
                        label: 'Purchase',
                        swatch: 'marker',
                        color: 'var(--ink-2)',
                      },
                    ] as const)),
              ]}
            />
            {costHidden && <span className="ui-sub">Cost basis unknown</span>}
          </div>
          <AboutChart>
            Value of what you held at stored prices and Bank of Russia rates in{' '}
            {history?.currency ?? currency}: hourly for the last week, daily since Jan 1, 2025.
            Times are UTC. Cost basis counts the coins with a known purchase price.
          </AboutChart>
        </div>
        {tabs}
      </div>
      <div {...panelProps}>
        {failed ? (
          <Banner
            tone="neg"
            action={
              <Button size="sm" icon="refresh" onClick={() => void load()}>
                Try again
              </Button>
            }
          >
            Could not load the chart. Your data is safe; try again.
          </Banner>
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
      </div>
    </Card>
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
    <Card labelledBy="asset-transactions">
      <CardHeader
        id="asset-transactions"
        title="Transactions"
        sub={
          typeof operations === 'object'
            ? own.length > latest.length
              ? `Latest ${latest.length} of ${own.length}`
              : own.length
            : undefined
        }
      />
      {operations === 'failed' ? (
        <Banner
          tone="neg"
          action={
            <Button size="sm" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          Could not load this asset's transactions.
        </Banner>
      ) : operations === 'loading' ? (
        <InlineSkeleton label="Loading transactions" />
      ) : own.length === 0 ? (
        <p className="ui-none">No transactions yet.</p>
      ) : (
        <>
          <ul className="ui-rows portfolio-rows">
            {latest.map((operation) => (
              <li key={operation.id} className={rowClass()}>
                <ListRowText
                  title={
                    operation.status === 'needs-classification' ? (
                      <Badge tone="warn" dot>
                        {statusLabels[operation.status]}
                      </Badge>
                    ) : (
                      typeLabel(operation)
                    )
                  }
                  detail={`${day(operation.occurredAt)} · ${placeLabel(operation)}`}
                  amount={movedAmount(operation, key)}
                  value={
                    operation.value !== null && typeof operations === 'object'
                      ? money(operation.value, operations.quoteCurrency)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
          <ButtonLink to={all} size="sm" className="portfolio-card-action">
            Open in Transactions
          </ButtonLink>
        </>
      )}
    </Card>
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
  hide,
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
  /** Hide asset, at the end of the page head. */
  hide: ReactNode;
}) {
  const [pricing, setPricing] = useState(false);
  const positionTitle = useId();
  const unit = asset.symbol ?? '';
  const currency = portfolio.currency;
  const chains = useTokenChains();
  const classes = useAccountClasses();
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
  // A fully sold asset has no lots left, so no real reading: that is not missing data.
  const empty = Number(asset.quantity) === 0;
  // With an account whose history starts later, nothing held may only mean nothing known.
  const sold = empty && portfolio.unavailableAccountCount === 0;
  const emptyUnknown = empty && !sold;
  return (
    <>
      <PageHead
        icon={
          <AssetIcon
            symbol={asset.symbol}
            name={asset.name}
            assetType={asset.assetType}
            assetClass={heldClass(asset.holdings, classes)}
            network={onlyChain(asset.symbol, chains)}
            size="lg"
          />
        }
        title={asset.name}
        subtitle={assetCaption(asset, chains)}
        aside={
          <>
            <b className="ui-num portfolio-head__price">
              {asset.price ? price(asset.price.value, currency) : missingLabel(asset)}
            </b>
            {/* A hand price has no market move to show: the page offers Update price instead. */}
            {asset.priceChange24hPercent !== null && asset.priceSource !== 'manual' && (
              <span className="portfolio-head__change">
                <Change value={asset.priceChange24hPercent} /> today
              </span>
            )}
            <span
              className={
                asset.price?.status === 'stale' ? 'ui-sub portfolio-head__stale' : 'ui-sub'
              }
            >
              {priceDetail(asset, currency, now)}
            </span>
            {asset.priceSource === 'manual' && (
              <Button size="sm" icon="edit" onClick={() => setPricing(true)}>
                Update price
              </Button>
            )}
          </>
        }
        actions={hide}
      />
      {pricing && (
        <UpdatePriceDialog
          instrumentId={asset.instrumentId}
          name={asset.name}
          currency={asset.valuationCurrency}
          onClose={() => setPricing(false)}
          onSaved={() => {
            setPricing(false);
            onPriceSaved();
          }}
        />
      )}
      <Card labelledBy={positionTitle}>
        <h2 id={positionTitle} className="ui-sr">
          Position
        </h2>
        <Stats>
          <Stat
            label="Amount"
            value={
              <>
                {quantity(asset.quantity)} {unit}
              </>
            }
          />
          <Stat label="Current value" value={amount(asset.value)} />
          <Stat
            label="Average buy price"
            value={asset.averageBuyPrice === null ? '—' : price(asset.averageBuyPrice, currency)}
          />
          {showReal ? (
            <>
              <Stat
                label="Cost in today's money"
                value={
                  reading === null ? (
                    sold ? (
                      <>
                        {amount('0')}
                        <span className="ui-sub">
                          Nothing held, so there is no real cost or profit
                        </span>
                      </>
                    ) : emptyUnknown ? (
                      <>
                        {DASH}
                        <span className="ui-sub">an account history starts later</span>
                      </>
                    ) : (
                      <>
                        {DASH}
                        <span className="ui-sub">
                          a purchase price, exchange rate or inflation figure is missing for some
                          lots
                        </span>
                        {asset.costBasis !== null ? (
                          <span className="ui-sub">{amount(asset.costBasis)} paid</span>
                        ) : (
                          Number(asset.knownCostQuantity) > 0 && (
                            <span className="ui-sub">
                              {amount(asset.knownCostSubtotal)} paid for the known part
                            </span>
                          )
                        )}
                      </>
                    )
                  ) : (
                    <>
                      {amount(reading.costBasis)}
                      {asset.costBasis !== null && (
                        <span className="ui-sub">
                          {amount(asset.costBasis)} paid{' '}
                          {adjustmentText(reading.costBasis, asset.costBasis, amount)}
                        </span>
                      )}
                    </>
                  )
                }
              />
              <Stat
                label="Real P&L"
                value={
                  <>
                    <Signed
                      value={sold ? '0' : (reading?.unrealizedPnl ?? null)}
                      currency={currency}
                      ratio={reading?.unrealizedReturnPercent ?? null}
                    />
                    {asset.unrealizedPnl !== null || sold ? (
                      <span className="ui-sub">
                        Nominal {money(sold ? '0' : asset.unrealizedPnl, currency, true)}
                      </span>
                    ) : (
                      asset.knownUnrealizedPnl !== null && (
                        <span className="ui-sub">
                          Nominal {money(asset.knownUnrealizedPnl, currency, true)} known
                        </span>
                      )
                    )}
                  </>
                }
              />
            </>
          ) : (
            <>
              <Stat
                label="Cost basis"
                value={
                  <>
                    {amount(partial ? asset.knownCostSubtotal : asset.costBasis)}
                    {reading !== null && asset.costBasis !== null && (
                      <span className="ui-sub">
                        {amount(reading.costBasis)} in today&apos;s money
                      </span>
                    )}
                  </>
                }
              />
              <Stat
                label="Unrealized P&L"
                value={
                  <>
                    <Signed
                      value={partial ? asset.knownUnrealizedPnl : asset.unrealizedPnl}
                      currency={currency}
                      ratio={
                        partial ? asset.knownUnrealizedReturnPercent : asset.unrealizedReturnPercent
                      }
                    />
                    {reading?.unrealizedPnl != null && asset.unrealizedPnl !== null && (
                      <span className="ui-sub">
                        Real {money(reading.unrealizedPnl, currency, true)}
                      </span>
                    )}
                  </>
                }
              />
            </>
          )}
          <Stat
            label="Realized P&L"
            value={
              <Signed
                value={
                  asset.realizedPnl === null && Number(asset.knownRealizedSubtotal) !== 0
                    ? asset.knownRealizedSubtotal
                    : asset.realizedPnl
                }
                currency={currency}
              />
            }
          />
        </Stats>
        {showReal && reading !== null && (
          <p className="ui-sub portfolio-card-note">
            In today&apos;s {currency}, {basisText(basis, reading, currency)} ·{' '}
            <Link className="ui-link" to="/settings">
              Settings
            </Link>
          </p>
        )}
        {portfolio.unavailableAccountCount > 0 && (
          <Banner tone="warn">
            {portfolio.unavailableAccountCount === 1
              ? '1 account whose history starts later is'
              : `${portfolio.unavailableAccountCount} accounts whose history starts later are`}{' '}
            left out of these figures.
          </Banner>
        )}
        {unknown && (
          <Banner
            tone="warn"
            action={
              <ButtonLink
                size="sm"
                to={`/transactions?asset=${encodeURIComponent(keyOf(asset))}&cost=unknown`}
              >
                Review transactions
              </ButtonLink>
            }
          >
            {quantity(asset.unknownCostQuantity)} {unit} has no purchase price, so cost basis and
            unrealized P&amp;L {partial ? 'cover only the rest' : 'are unknown'}. Known cost:{' '}
            {amount(asset.knownCostSubtotal)}.
          </Banner>
        )}
        {missingRate && (
          <Banner tone="warn">
            {quantity(asset.missingRateQuantity)} {unit} was bought before the stored Bank of Russia
            rates, so its cost in {currency} is unknown. Known cost:{' '}
            {amount(asset.knownCostSubtotal)}.
          </Banner>
        )}
        {asset.unknownRealizedCount > 0 && (
          <Banner tone="warn">
            A sale used coins without a purchase price or a stored rate, so realized P&amp;L is
            unknown. Known part: {amount(asset.knownRealizedSubtotal, true)}.
          </Banner>
        )}
      </Card>
      <ValueChart asset={asset} currency={currency} asked={asked} operations={operations} />
      {!sold && (
        <AssetLotsCard
          instrumentId={asset.instrumentId}
          asked={asked}
          values={`${asset.quantity}|${asset.value}|${JSON.stringify(asset.price)}`}
        />
      )}
      <div className="portfolio-split">
        <Card labelledBy="asset-holdings">
          <CardHeader id="asset-holdings" title="Holdings" sub="Where this balance sits" />
          {asset.holdings.length === 0 ? (
            <p className="ui-none">Nothing held right now.</p>
          ) : (
            <ul className="ui-rows portfolio-rows">
              {asset.holdings.map((holding) => {
                const kind = kinds[holding.accountId];
                // A property account has no wallet page: it is shown by its own name only.
                const wallet = classed !== null && !classed.has(holding.accountId);
                // A wallet's whole row opens it (prototype .list-row); the link keeps the
                // wallet's name as its own and stretches over the row.
                return (
                  <li
                    key={holding.accountId}
                    className={wallet ? `${rowClass()} portfolio-row--link` : rowClass()}
                  >
                    <ListRowText
                      title={
                        wallet ? (
                          <Link to={withCurrency(`/wallets/${holding.accountId}`, asked)}>
                            {holding.accountName}
                          </Link>
                        ) : (
                          holding.accountName
                        )
                      }
                      detail={kind ? kindLabels[kind] : undefined}
                      amount={`${quantity(holding.quantity)} ${unit}`}
                      value={amount(holding.value)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <p className="ui-sub portfolio-card-note">
            Price source: {sourceLabels[asset.priceSource]}. {ratesNote(portfolio)}
          </p>
        </Card>
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
  const [refreshFailed, setRefreshFailed] = useState(false);
  // A refresh after a change (a saved price) keeps the page and its focus on screen: the change
  // dropped the kept answer, and a skeleton would take the Update price button away (portfolio-02).
  const load = useCallback(
    async (quiet = false) => {
      setFailed(false);
      setRefreshFailed(false);
      const kept = cachedReads.portfolio.last(asked);
      if (!quiet) setPortfolio(kept ?? null);
      try {
        setPortfolio(await cachedReads.portfolio.load(asked));
      } catch {
        // With an answer on screen (kept or quiet) the page stays and says it is not refreshed.
        if (quiet || kept) setRefreshFailed(true);
        else setFailed(true);
      }
    },
    [asked],
  );
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
      <Crumb to={withCurrency('/portfolio', asked)}>Portfolio</Crumb>
      {refreshFailed && !failed && portfolio !== null && (
        <Banner
          tone="warn"
          role="alert"
          action={
            <Button size="sm" icon="refresh" onClick={() => void load(true)}>
              Refresh
            </Button>
          }
        >
          Could not refresh the values; showing the last loaded ones.
        </Banner>
      )}
      {failed ? (
        <ErrorState onRetry={() => void load()}>
          Could not load this asset. Your data is safe; try again.
        </ErrorState>
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
          onPriceSaved={() => void load(true)}
          now={new Date()}
          hide={
            <HideAsset
              instrumentId={asset.instrumentId}
              symbol={asset.symbol}
              onHidden={() => navigate(withCurrency('/portfolio', asked))}
            />
          }
        />
      ) : (
        <EmptyState id="asset-missing" title="Asset not found">
          It may belong to another owner or the link is wrong.
        </EmptyState>
      )}
    </div>
  );
}
