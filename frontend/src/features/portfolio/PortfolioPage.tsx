import { cachedReads } from '@api/cached-reads';
import type { AssetType, PortfolioAsset } from '@api/portfolio-assets.api';
import type {
  AccountingCurrency,
  AssetValuation,
  PortfolioValuation,
} from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import AssetIcon from '../shell/AssetIcon';
import LoadMore, { useInfinite } from '../shell/InfiniteScroll';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { onlyChain, type TokenChains, useTokenChains, withChains } from '../shell/token-chains';
import AddAssetDialog from './AddAssetDialog';
import Allocation from './Allocation';
import { ratesNote, useAskedCurrency, withCurrency } from './currency';
import { DASH, missingLabel, money, percent, price, priceNote, quantity, tone } from './format';
import '../shell/shell-page.css';
import './portfolio.css';
import EmptyState from '@/ui/EmptyState';
import { ListRowText, rowClass } from '@/ui/ListRow';

export const typeLabels: Record<AssetType, string> = {
  crypto: 'Crypto',
  fiat: 'Cash',
  manual: 'Manual',
};
type Filter = 'all' | AssetType;
const filters: [Filter, string][] = [
  ['all', 'All'],
  ['crypto', 'Crypto'],
  ['fiat', 'Cash'],
  ['manual', 'Manual'],
];

/**
 * "BTC · Crypto · USD": ticker, type and value currency of an asset; a token held in tracked
 * wallets names their blockchains, "USDT on Ethereum, Solana" (TOKEN-CHAIN).
 */
export function assetCaption(asset: AssetValuation, chains: TokenChains = new Map()): string {
  return [
    asset.symbol && withChains(asset.symbol, asset.symbol, chains),
    typeLabels[asset.assetType],
    asset.valuationCurrency,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function Signed({
  value,
  currency,
  ratio,
  inline,
}: {
  value: string | null;
  currency: AccountingCurrency;
  ratio?: string | null;
  /** The percentage beside the amount, on one line, as in a table row. */
  inline?: boolean;
}) {
  return (
    <span className={tone(value) ? `portfolio-${tone(value)}` : undefined}>
      {money(value, currency, true)}
      {ratio !== undefined && value !== null && ratio !== null && (
        <span className={`portfolio-sub${inline ? ' portfolio-sub--inline' : ''}`}>
          {percent(ratio)}
        </span>
      )}
    </span>
  );
}

/** A signed percentage in the gain or loss colour: "+2.10%", "-1.40%", or a dash. */
export function Change({ value }: { value: string | null }) {
  return (
    <span className={tone(value) ? `portfolio-${tone(value)}` : undefined}>{percent(value)}</span>
  );
}

export type SortKey =
  | 'name'
  | 'amount'
  | 'price'
  | 'value'
  | 'allocation'
  | 'avgBuy'
  | 'pnl'
  | 'change';
export type SortDirection = 'desc' | 'asc';
export type AssetSort = { key: SortKey; direction: SortDirection };

/** The prototype's order on opening: the largest value first. */
export const defaultSort: AssetSort = { key: 'value', direction: 'desc' };

// The table's columns, left to right.
const sortColumns: [SortKey, string][] = [
  ['name', 'Asset'],
  ['amount', 'Amount'],
  ['price', 'Price'],
  ['value', 'Value'],
  ['allocation', 'Allocation'],
  ['avgBuy', 'Avg buy price'],
  ['pnl', 'Unrealized P&L'],
  ['change', '24h'],
];

// The phone list's Sort by choices, as in the prototype.
const phoneSorts: [SortKey, string][] = [
  ['value', 'Value'],
  ['pnl', 'Unrealized P&L'],
  ['change', '24h change'],
  ['name', 'Name'],
];

/** Names run A to Z first; every number column starts with the largest. */
function firstDirection(key: SortKey): SortDirection {
  return key === 'name' ? 'asc' : 'desc';
}

/**
 * What a click on a column header does: a new column starts in its first direction, the same
 * column turns the order around.
 */
export function nextSort(current: AssetSort, key: SortKey): AssetSort {
  if (current.key !== key) return { key, direction: firstDirection(key) };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

/**
 * The order a phone shows. Its Sort by offers each choice in one direction only, so a table
 * order it cannot name falls back to Value, largest first; a wider screen brings the table's
 * order back.
 */
export function phoneSort(sort: AssetSort): AssetSort {
  return phoneSorts.some(([key]) => key === sort.key)
    ? { key: sort.key, direction: firstDirection(sort.key) }
    : defaultSort;
}

/**
 * The asset's unrealized P&L: over the coins whose purchase price is known when others have
 * none, instead of a dash (PV-KNOWN-PART).
 */
export function shownProfit(asset: AssetValuation): { pnl: string | null; ratio: string | null } {
  return asset.unrealizedPnl === null && asset.knownUnrealizedPnl !== null
    ? { pnl: asset.knownUnrealizedPnl, ratio: asset.knownUnrealizedReturnPercent }
    : { pnl: asset.unrealizedPnl, ratio: asset.unrealizedReturnPercent };
}

/**
 * Assets in the chosen order. Assets no longer held go last, as the server ranks them, so a
 * holding without a price stays above them; then unknown figures (no price, no purchase price)
 * go last in either direction; ties keep the names A to Z. A name order is only names.
 */
export function sortAssets(assets: readonly AssetValuation[], sort: AssetSort): AssetValuation[] {
  const byName = (a: AssetValuation, b: AssetValuation) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const sign = sort.direction === 'asc' ? 1 : -1;
  if (sort.key === 'name') return [...assets].sort((a, b) => sign * byName(a, b));
  const field = (asset: AssetValuation): string | null => {
    switch (sort.key) {
      case 'amount':
        return asset.quantity;
      case 'price':
        return asset.price?.value ?? null;
      case 'value':
        return asset.value;
      case 'allocation':
        return asset.allocationPercent;
      case 'avgBuy':
        return asset.averageBuyPrice;
      case 'pnl':
        return shownProfit(asset).pnl;
      default:
        return asset.priceChange24hPercent;
    }
  };
  const held = (asset: AssetValuation) => Number(asset.quantity) !== 0;
  return [...assets].sort((a, b) => {
    if (held(a) !== held(b)) return held(a) ? -1 : 1;
    const left = field(a);
    const right = field(b);
    if (left === null || right === null) {
      return left === right ? byName(a, b) : left === null ? 1 : -1;
    }
    return sign * (Number(left) - Number(right)) || byName(a, b);
  });
}

/** Whether the asset's name or ticker contains the search text, ignoring case. */
export function matchesSearch(asset: AssetValuation, search: string): boolean {
  const text = search.trim().toLowerCase();
  return (
    !text ||
    asset.name.toLowerCase().includes(text) ||
    (asset.symbol ?? '').toLowerCase().includes(text)
  );
}

const PARTIAL_NOTE =
  'Coins without a price or without a purchase price are left out: current value counts the priced assets, cost basis and P&L the coins whose purchase price is known. Open an asset to see what is missing.';

// Bank deposits are part of the value even when no asset is held.
const hasDeposits = (portfolio: PortfolioValuation) =>
  Number(portfolio.depositsValue) > 0 || portfolio.unratedDepositCount > 0;

function Summary({
  portfolio,
  asked,
}: {
  portfolio: PortfolioValuation;
  asked: AccountingCurrency | undefined;
}) {
  const unpriced = portfolio.missingPriceCount;
  const unrated = portfolio.unratedDepositCount;
  const currency = portfolio.currency;
  const amount = (value: string | null) => money(value, currency);
  // Coins without a price or a purchase price stay out of the figures instead of emptying
  // them; one tooltip says so (PV-KNOWN-PART).
  const partialValue = portfolio.totalValue === null;
  const partialCost =
    portfolio.costBasis === null &&
    (portfolio.unknownCostCount > 0 || portfolio.missingRateCount > 0) &&
    Number(portfolio.knownCostSubtotal) > 0;
  const partialProfit =
    portfolio.unrealizedPnl === null && partialCost && portfolio.knownUnrealizedPnl !== null;
  const partialRealized =
    portfolio.realizedPnl === null && Number(portfolio.knownRealizedSubtotal) !== 0;
  const partial = partialValue || partialCost || partialProfit || partialRealized;
  const missing = [
    unpriced > 0 && `${unpriced} ${unpriced === 1 ? 'asset' : 'assets'} without a price`,
    portfolio.unavailableAccountCount > 0 &&
      `${portfolio.unavailableAccountCount} account history starts later`,
    unrated > 0 && `${unrated} ${unrated === 1 ? 'deposit' : 'deposits'} without a rate`,
  ]
    .filter((reason) => reason !== false)
    .join(', ');
  return (
    <section className="shell-card portfolio-summary" aria-label="Portfolio summary">
      {partial && (
        <span
          className="portfolio-info"
          role="img"
          tabIndex={0}
          aria-label={PARTIAL_NOTE}
          data-tip={PARTIAL_NOTE}
        >
          <Icon name="info" className="shell-icon shell-icon--sm" />
        </span>
      )}
      <dl>
        <div>
          <dt>Current value</dt>
          <dd>
            {amount(partialValue ? portfolio.pricedSubtotal : portfolio.totalValue)}
            {partialValue && missing !== '' && <span className="portfolio-sub">{missing}</span>}
            {Number(portfolio.depositsValue) > 0 && (
              <span className="portfolio-sub">
                {amount(portfolio.depositsValue)} in{' '}
                <Link to={withCurrency('/deposits', asked)}>bank deposits</Link>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Cost basis</dt>
          <dd>
            {partialCost ? amount(portfolio.knownCostSubtotal) : amount(portfolio.costBasis)}
            {portfolio.costBasis === null && !partialCost && (
              <span className="portfolio-sub">
                {amount(portfolio.knownCostSubtotal)} known,{' '}
                {portfolio.unknownCostCount > 0
                  ? 'part has no purchase price'
                  : portfolio.missingRateCount > 0
                    ? 'part predates the stored rates'
                    : 'an account history starts later'}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Unrealized P&amp;L</dt>
          <dd>
            {partialProfit ? (
              <Signed
                value={portfolio.knownUnrealizedPnl}
                currency={currency}
                ratio={portfolio.knownUnrealizedReturnPercent}
              />
            ) : (
              <Signed
                value={portfolio.unrealizedPnl}
                currency={currency}
                ratio={portfolio.unrealizedReturnPercent}
              />
            )}
          </dd>
        </div>
        <div>
          <dt>Realized P&amp;L</dt>
          <dd>
            <Signed
              value={partialRealized ? portfolio.knownRealizedSubtotal : portfolio.realizedPnl}
              currency={currency}
            />
          </dd>
        </div>
      </dl>
      {portfolio.stalePriceCount > 0 && (
        <p className="ui-banner ui-banner--warn portfolio-warn" role="note">
          {portfolio.stalePriceCount === 1
            ? '1 price is older than 2 hours; the last stored price is used.'
            : `${portfolio.stalePriceCount} prices are older than 2 hours; the last stored prices are used.`}
        </p>
      )}
      {portfolio.missingRateCount > 0 && (
        <p className="ui-banner ui-banner--warn portfolio-warn" role="note">
          {portfolio.missingRateCount === 1
            ? '1 asset has'
            : `${portfolio.missingRateCount} assets have`}{' '}
          operations dated before the stored Bank of Russia rates, so their cost or P&amp;L in{' '}
          {currency} is not shown.
        </p>
      )}
    </section>
  );
}

function AssetsTable({
  assets,
  currency,
  asked,
  now,
  chains,
  sort,
  onSort,
}: {
  assets: AssetValuation[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  now: Date;
  chains: TokenChains;
  sort: AssetSort;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <thead>
          <tr>
            {sortColumns.map(([key, label]) => {
              const active = sort.key === key ? sort.direction : null;
              return (
                <th
                  key={key}
                  scope="col"
                  className={key === 'name' ? undefined : 'ui-num'}
                  aria-sort={
                    active === null ? undefined : active === 'asc' ? 'ascending' : 'descending'
                  }
                >
                  <button type="button" className="ui-th-sort" onClick={() => onSort(key)}>
                    {label}
                    {active && (
                      <Icon
                        name={active === 'asc' ? 'arrowUp' : 'arrowDown'}
                        className="shell-icon shell-icon--sm"
                      />
                    )}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.instrumentId}>
              <td>
                <span className="portfolio-asset">
                  <AssetIcon
                    symbol={asset.symbol}
                    name={asset.name}
                    assetType={asset.assetType}
                    network={onlyChain(asset.symbol, chains)}
                  />
                  <span>
                    <Link
                      className="portfolio-asset__name"
                      to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}
                    >
                      {asset.name}
                    </Link>
                    <span className="portfolio-asset__ticker">{assetCaption(asset, chains)}</span>
                  </span>
                </span>
              </td>
              <td className="ui-num">{quantity(asset.quantity)}</td>
              <td className="ui-num">
                {asset.price ? price(asset.price.value, currency) : missingLabel(asset)}
                <span className="portfolio-sub">{priceNote(asset, now)}</span>
              </td>
              <td className="ui-num portfolio-strong">{money(asset.value, currency)}</td>
              <td className="ui-num">
                <span className="portfolio-share">
                  <span className="portfolio-share__bar" aria-hidden="true">
                    <i
                      style={{ width: `${Math.min(Number(asset.allocationPercent ?? 0), 100)}%` }}
                    />
                  </span>
                  <span className="portfolio-share__text">
                    {percent(asset.allocationPercent, false)}
                  </span>
                </span>
              </td>
              <td className="ui-num">
                {asset.averageBuyPrice === null ? DASH : price(asset.averageBuyPrice, currency)}
              </td>
              <td className="ui-num">
                <Signed
                  value={shownProfit(asset).pnl}
                  currency={currency}
                  ratio={shownProfit(asset).ratio}
                  inline
                />
              </td>
              <td className="ui-num">
                <Change value={asset.priceChange24hPercent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A phone row's unrealized P&L: money and percent, coloured by sign. */
function Profit({ asset, currency }: { asset: AssetValuation; currency: AccountingCurrency }) {
  const { pnl, ratio } = shownProfit(asset);
  if (pnl === null) return DASH;
  const sign = tone(pnl);
  return (
    <span className={sign ? `portfolio-${sign}` : undefined}>
      {money(pnl, currency, true)}
      {ratio !== null && ` · ${percent(ratio)}`}
    </span>
  );
}

// Phones get two-line rows instead of the table: the whole row opens the asset, and the
// columns that do not fit are on the asset page (design: tables on phones).
function AssetsList({
  assets,
  currency,
  asked,
  chains,
}: {
  assets: AssetValuation[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  chains: TokenChains;
}) {
  return (
    <ul className="ui-rows">
      {assets.map((asset) => (
        <li key={asset.instrumentId}>
          <Link className={rowClass()} to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}>
            <AssetIcon
              symbol={asset.symbol}
              name={asset.name}
              assetType={asset.assetType}
              network={onlyChain(asset.symbol, chains)}
            />
            <ListRowText
              title={asset.name}
              detail={withChains(
                `${quantity(asset.quantity)}${asset.symbol ? ` ${asset.symbol}` : ''}`,
                asset.symbol,
                chains,
              )}
              amount={money(asset.value, currency)}
              value={<Profit asset={asset} currency={currency} />}
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Whole-portfolio value, allocation and the assets table (portfolio-valuation PV-5, AST-3).
export default function PortfolioPage() {
  const [asked] = useAskedCurrency();
  // Coming back to the page paints the last answer at once; the load below replaces it.
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(
    () => cachedReads.portfolio.last(asked) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AssetSort>(defaultSort);
  const phone = useNarrowScreen();
  const [adding, setAdding] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const chains = useTokenChains();
  const latest = useRef(0);

  // Only the newest request may change the page; a quiet refresh keeps what is shown.
  const load = useCallback(
    async (quiet = false) => {
      const request = ++latest.current;
      setFailed(false);
      setRefreshFailed(false);
      // What was kept for this currency stays on screen while the fresh answer loads.
      const kept = cachedReads.portfolio.last(asked);
      if (!quiet) setPortfolio(kept ?? null);
      try {
        const next = await cachedReads.portfolio.load(asked);
        if (request === latest.current) setPortfolio(next);
      } catch {
        if (request !== latest.current) return;
        if (quiet || kept) setRefreshFailed(true);
        else setFailed(true);
      }
    },
    [asked],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const assets = portfolio?.assets ?? [];
  const visible = assets.filter(
    (asset) => (filter === 'all' || asset.assetType === filter) && matchesSearch(asset, search),
  );
  // PAGES: twenty assets a page; the list is sorted first, so its pages follow the order.
  // The table and the phone list share one order, Value largest first until another is chosen;
  // a phone shows only the orders its Sort by can name.
  const shown = phone ? phoneSort(sort) : sort;
  const ordered = sortAssets(visible, shown);
  const paged = useInfinite(ordered, {
    resetKey: `${filter}|${search.trim()}|${shown.key}|${shown.direction}|${phone}`,
  });
  const added = (asset: PortfolioAsset) => {
    // The new row must be visible, so a filter or search that would hide it is cleared.
    setFilter((current) => (current === 'all' || current === asset.assetType ? current : 'all'));
    setSearch('');
    setAdding(false);
    void load(true);
  };
  const addButton = (primary: boolean) => (
    <button
      type="button"
      className={`shell-button${primary ? ' shell-button--primary' : ' shell-button--secondary'}`}
      onClick={() => setAdding(true)}
    >
      Add asset
    </button>
  );
  const now = new Date();

  return (
    <div className="shell-page">
      <PageHeader title="Portfolio" currency={portfolio?.currency} />
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your portfolio. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : portfolio === null ? (
        <PageSkeleton label="Loading portfolio" show={['stats', 'rows']} />
      ) : assets.length === 0 && !hasDeposits(portfolio) ? (
        <EmptyState id="portfolio-empty" title="No assets yet" actions={addButton(true)}>
          Add a coin, cash or anything else you want to track.
        </EmptyState>
      ) : (
        <>
          {refreshFailed && (
            <p className="ui-banner ui-banner--warn portfolio-warn" role="alert">
              Could not refresh the values; showing the last loaded ones.{' '}
              <button type="button" className="shell-button" onClick={() => void load(true)}>
                Refresh
              </button>
            </p>
          )}
          <Summary portfolio={portfolio} asked={asked} />
          {assets.length === 0 ? (
            <EmptyState id="portfolio-empty" title="No assets yet" actions={addButton(true)}>
              Add a coin, cash or anything else you want to track.
            </EmptyState>
          ) : (
            <section className="shell-card" aria-labelledby="portfolio-assets">
              <div className="ui-toolbar">
                <h2 id="portfolio-assets">Assets</h2>
                <div className="ui-chips" role="group" aria-label="Filter assets">
                  {filters.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="ui-chip"
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                      <span className="ui-chip__count">
                        {' '}
                        {value === 'all'
                          ? assets.length
                          : assets.filter((asset) => asset.assetType === value).length}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="portfolio-tools">
                  <input
                    type="search"
                    className="ui-input ui-input--sm ui-search"
                    placeholder="Search assets"
                    aria-label="Search assets"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {addButton(false)}
                </div>
              </div>
              {phone ? (
                <>
                  <label className="portfolio-sort">
                    Sort by
                    <select
                      className="ui-input ui-input--sm"
                      value={shown.key}
                      onChange={(event) => {
                        const key = event.target.value as SortKey;
                        setSort({ key, direction: firstDirection(key) });
                      }}
                    >
                      {phoneSorts.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <AssetsList
                    assets={paged.rows}
                    currency={portfolio.currency}
                    asked={asked}
                    chains={chains}
                  />
                </>
              ) : (
                <AssetsTable
                  assets={paged.rows}
                  currency={portfolio.currency}
                  asked={asked}
                  now={now}
                  chains={chains}
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
              )}
              {paged.more && <LoadMore {...paged.more} label="assets" />}
              {visible.length === 0 && (
                <p className="portfolio-none">
                  {search.trim()
                    ? `No assets match "${search.trim()}".`
                    : 'No assets of this type.'}
                </p>
              )}
              <p className="shell-note portfolio-note">
                {ratesNote(portfolio)} Holdings come from your{' '}
                <Link className="shell-link" to="/wallets">
                  wallets
                </Link>{' '}
                and the transactions you add.
              </p>
            </section>
          )}
          <Allocation portfolio={portfolio} />
        </>
      )}
      {adding && <AddAssetDialog onClose={() => setAdding(false)} onAdded={added} />}
    </div>
  );
}
