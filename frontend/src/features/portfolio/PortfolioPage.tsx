import { cachedReads } from '@api/cached-reads';
import type { AssetType, PortfolioAsset } from '@api/portfolio-assets.api';
import type {
  AccountingCurrency,
  AssetValuation,
  PortfolioValuation,
  RealReading,
} from '@api/portfolio-valuation.api';
import { useToast } from '@contexts/ToastContext';
import { sumDecimals } from '@utils/decimal';
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRowsLayout } from '@/ui/useMediaQuery';
import AddBrokerAccountDialog from '../broker/AddBrokerAccountDialog';
import { AddDepositDialog } from '../deposits/DepositDialogs';
import { accountsWithoutRate } from '../deposits/deposit-format';
import AddPropertyDialog from '../property/AddPropertyDialog';
import AssetIcon from '../shell/AssetIcon';
import { type AccountClasses, heldClass } from '../shell/asset-identity';
import { basisText } from '../shell/basis-text';
import LoadMore, { useInfinite } from '../shell/InfiniteScroll';
import { Icon } from '../shell/icons';
import { type InflationBasis, useInflationBasis } from '../shell/inflation-basis';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { onlyChain, type TokenChains, useTokenChains, withChains } from '../shell/token-chains';
import { useAccountClasses } from '../shell/useAccountClasses';
import { useValueView } from '../shell/value-view';
import AddAssetDialog from './AddAssetDialog';
import AddToPortfolioDialog, { type AddChoice } from './AddToPortfolioDialog';
import Allocation, { shareText } from './Allocation';
import { assetCaption, Change, Signed, toneClass } from './asset-parts';
import { ratesNote, useAskedCurrency, withCurrency } from './currency';
import { DASH, missingLabel, money, percent, price, priceNote, quantity } from './format';
import { adjustmentText, compareDecimals } from './real-cost';
import '../shell/shell-page.css';
import './portfolio.css';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip, ChipGroup } from '@/ui/Chip';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Input, Select } from '@/ui/inputs';
import { ListRowText, rowClass } from '@/ui/ListRow';
import { Stat, Stats } from '@/ui/Stats';

// The filter is the asset's class (polish 12); Manual is how an asset is priced, so it stays on
// the row and is no class of its own.
type AssetClassFilter = 'crypto' | 'cash' | 'broker' | 'property' | 'other';
type Filter = 'all' | AssetClassFilter;
const filters: [Filter, string][] = [
  ['all', 'All'],
  ['crypto', 'Crypto'],
  ['cash', 'Cash'],
  ['broker', 'Broker'],
  ['property', 'Real estate'],
  ['other', 'Other'],
];
const typeClass: Record<AssetType, AssetClassFilter> = {
  crypto: 'crypto',
  fiat: 'cash',
  manual: 'other',
};

/** An asset's class: its accounts' class when they all are brokers or property, else its type's. */
function assetClassOf(asset: AssetValuation, classes: AccountClasses): AssetClassFilter {
  return heldClass(asset.holdings, classes) ?? typeClass[asset.assetType];
}

// The rows are grouped by class in the chips' order, each group in the chosen sort.
const classOrder = filters.slice(1).map(([value]) => value) as AssetClassFilter[];
const classLabels = Object.fromEntries(filters) as Record<Filter, string>;

/**
 * A group's value: the exact sum of its rows' values, and how many held rows have none, so a
 * missing value is never counted as zero. Null when no row has a value.
 */
export function groupSubtotal(rows: readonly AssetValuation[]): {
  value: string | null;
  missing: number;
} {
  const known = rows.flatMap((row) => (row.value === null ? [] : [row.value]));
  return {
    value: known.length > 0 ? sumDecimals(known) : null,
    missing: rows.filter((row) => row.value === null && Number(row.quantity) !== 0).length,
  };
}

/** A group's share of the portfolio, display-only; none while the group or the total is partial. */
function groupShare(subtotal: ReturnType<typeof groupSubtotal>, total: string | null) {
  if (subtotal.value === null || subtotal.missing > 0 || total === null) return null;
  const whole = Number(total);
  if (!(whole > 0)) return null;
  const share = (Number(subtotal.value) / whole) * 100;
  return share > 0 && share < 0.05 ? '<0.1%' : `${share.toFixed(1)}%`;
}

type GroupHead = ReturnType<typeof groupSubtotal> & {
  key: AssetClassFilter;
  label: string;
  share: string | null;
};
type AssetGroup = { head: GroupHead; rows: AssetValuation[] };

/** A group's name and share, and its subtotal on the right, marked when a value is missing. */
function GroupHeadText({ head, currency }: { head: GroupHead; currency: AccountingCurrency }) {
  return (
    <>
      <span className="portfolio-group__name">{head.label}</span>
      {head.share !== null && <span className="portfolio-group__share">{head.share}</span>}
      <span className="portfolio-group__total">
        {money(head.value, currency)}
        {head.missing > 0 && <span className="ui-sub">{head.missing} without a price</span>}
      </span>
    </>
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
const sortColumns = (real: boolean): [SortKey, string][] => [
  ['name', 'Asset'],
  ['amount', 'Amount'],
  ['price', 'Price'],
  ['value', 'Value'],
  ['allocation', 'Allocation'],
  ['avgBuy', 'Avg cost'],
  ['pnl', real ? 'Real P&L' : 'Unrealized P&L'],
  ['change', '24h'],
];

// The phone list's Sort by choices, as in the prototype.
const phoneSorts = (real: boolean): [SortKey, string][] => [
  ['value', 'Value'],
  ['pnl', real ? 'Real P&L' : 'Unrealized P&L'],
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
  return phoneSorts(false).some(([key]) => key === sort.key)
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
 * The asset's profit after inflation under the chosen basis (INFL-REAL-PF); unknown when the
 * server has no real reading for it, or an answer saved before it existed.
 */
export function realProfit(
  asset: AssetValuation,
  basis: InflationBasis,
): { pnl: string | null; ratio: string | null } {
  const real = asset.real?.[basis] ?? null;
  return { pnl: real?.unrealizedPnl ?? null, ratio: real?.unrealizedReturnPercent ?? null };
}

/**
 * The nominal profit beside or instead of a real one, "known" when it covers only the coins with a
 * purchase price (portfolio-08); null when there is none.
 */
function nominalLine(asset: AssetValuation, currency: AccountingCurrency): string | null {
  const { pnl } = shownProfit(asset);
  if (pnl === null) return null;
  return `nominal ${money(pnl, currency, true)}${asset.unrealizedPnl === null ? ' known' : ''}`;
}

/**
 * Assets in the chosen order. Assets no longer held go last, as the server ranks them, so a
 * holding without a price stays above them; then unknown figures (no price, no purchase price)
 * go last in either direction; ties keep the names A to Z. A name order is only names.
 */
export function sortAssets(
  assets: readonly AssetValuation[],
  sort: AssetSort,
  /** Order the profit column by the profit after inflation on this basis instead. */
  real: InflationBasis | null = null,
): AssetValuation[] {
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
        return real === null ? shownProfit(asset).pnl : realProfit(asset, real).pnl;
      default:
        // A hand price shows "Manual", not a change, so it ranks with the unknown ones.
        return asset.priceSource === 'manual' ? null : asset.priceChange24hPercent;
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
    return sign * compareDecimals(left, right) || byName(a, b);
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

const NO_REAL_ACCOUNT = 'an account history starts later';
// Bank deposits count in the current value only: cost basis and P&L are the assets' (DEP-VALUE).
const NO_DEPOSITS = 'excluding bank deposits';
const NO_REAL_COST = 'a purchase price, exchange rate or inflation figure is missing for some lots';

function Summary({
  portfolio,
  asked,
  real: showReal,
  basis,
}: {
  portfolio: PortfolioValuation;
  asked: AccountingCurrency | undefined;
  /** Under Real the cost and the profit are the ones after inflation, the nominal ones below. */
  real: boolean;
  basis: InflationBasis;
}) {
  const summaryTitle = useId();
  const reading: RealReading | null = portfolio.real?.[basis] ?? null;
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
  // The coins left out, for a missing price or a missing purchase price, are named in the note.
  const partialProfit = portfolio.unrealizedPnl === null && portfolio.knownUnrealizedPnl !== null;
  const partialRealized =
    portfolio.realizedPnl === null && Number(portfolio.knownRealizedSubtotal) !== 0;
  const partial = partialValue || partialCost || partialProfit || partialRealized;
  const withDeposits = Number(portfolio.depositsValue) > 0;
  const missing = [
    unpriced > 0 && `${unpriced} ${unpriced === 1 ? 'asset' : 'assets'} without a price`,
    portfolio.unavailableAccountCount > 0 &&
      `${portfolio.unavailableAccountCount} account history starts later`,
    unrated > 0 && `${unrated} ${unrated === 1 ? 'deposit' : 'deposits'} without a rate`,
  ]
    .filter((reason) => reason !== false)
    .join(', ');
  return (
    <Card className="portfolio-summary" labelledBy={summaryTitle}>
      <h2 id={summaryTitle} className="ui-sr">
        Portfolio summary
      </h2>
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
      <Stats size="lg">
        <Stat
          lead
          label="Current value"
          value={
            <>
              {amount(partialValue ? portfolio.pricedSubtotal : portfolio.totalValue)}
              {partialValue && missing !== '' && <span className="ui-sub">{missing}</span>}
              {withDeposits && (
                <span className="ui-sub">
                  {amount(portfolio.depositsValue)} in{' '}
                  <Link className="ui-link" to={withCurrency('/deposits', asked)}>
                    bank deposits
                  </Link>
                </span>
              )}
            </>
          }
        />
        <Stat
          label={showReal ? "Cost in today's money" : 'Cost basis'}
          value={
            <>
              {showReal ? (
                reading === null ? (
                  <>
                    {DASH}
                    <span className="ui-sub">
                      {portfolio.unavailableAccountCount > 0 ? NO_REAL_ACCOUNT : NO_REAL_COST}
                    </span>
                    {portfolio.costBasis !== null ? (
                      <span className="ui-sub">{amount(portfolio.costBasis)} paid</span>
                    ) : (
                      portfolio.assets.some((asset) => Number(asset.knownCostQuantity) > 0) && (
                        <span className="ui-sub">
                          {amount(portfolio.knownCostSubtotal)} paid for the known part
                        </span>
                      )
                    )}
                  </>
                ) : (
                  <>
                    {amount(reading.costBasis)}
                    {portfolio.costBasis !== null && (
                      <span className="ui-sub">
                        {amount(portfolio.costBasis)} paid{' '}
                        {adjustmentText(reading.costBasis, portfolio.costBasis, amount)}
                      </span>
                    )}
                  </>
                )
              ) : partialCost ? (
                amount(portfolio.knownCostSubtotal)
              ) : (
                amount(portfolio.costBasis)
              )}
              {!showReal && reading !== null && portfolio.costBasis !== null && (
                <span className="ui-sub">{amount(reading.costBasis)} in today&apos;s money</span>
              )}
              {!showReal && portfolio.costBasis === null && !partialCost && (
                <span className="ui-sub">
                  {amount(portfolio.knownCostSubtotal)} known,{' '}
                  {portfolio.unknownCostCount > 0
                    ? 'part has no purchase price'
                    : portfolio.missingRateCount > 0
                      ? 'part predates the stored rates'
                      : NO_REAL_ACCOUNT}
                </span>
              )}
              {withDeposits && <span className="ui-sub">{NO_DEPOSITS}</span>}
            </>
          }
        />
        <Stat
          label={showReal ? 'Real P&L' : 'Unrealized P&L'}
          value={
            <>
              {showReal ? (
                <>
                  <Signed
                    value={reading?.unrealizedPnl ?? null}
                    currency={currency}
                    ratio={reading?.unrealizedReturnPercent ?? null}
                  />
                  {portfolio.unrealizedPnl !== null ? (
                    <span className="ui-sub">
                      Nominal {money(portfolio.unrealizedPnl, currency, true)}
                    </span>
                  ) : (
                    partialProfit && (
                      <span className="ui-sub">
                        Nominal {money(portfolio.knownUnrealizedPnl, currency, true)} known
                      </span>
                    )
                  )}
                </>
              ) : partialProfit ? (
                <Signed
                  value={portfolio.knownUnrealizedPnl}
                  currency={currency}
                  ratio={portfolio.knownUnrealizedReturnPercent}
                />
              ) : (
                <>
                  <Signed
                    value={portfolio.unrealizedPnl}
                    currency={currency}
                    ratio={portfolio.unrealizedReturnPercent}
                  />
                  {reading?.unrealizedPnl != null && portfolio.unrealizedPnl !== null && (
                    <span className="ui-sub">
                      Real {money(reading.unrealizedPnl, currency, true)}
                    </span>
                  )}
                </>
              )}
              {withDeposits && <span className="ui-sub">{NO_DEPOSITS}</span>}
            </>
          }
        />
        <Stat
          label="Realized P&L"
          value={
            <Signed
              value={partialRealized ? portfolio.knownRealizedSubtotal : portfolio.realizedPnl}
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
      {!!portfolio.interestMissingDepositCount && (
        <Banner tone="warn">{accountsWithoutRate(portfolio.interestMissingDepositCount)}</Banner>
      )}
      {portfolio.stalePriceCount > 0 && (
        <Banner tone="warn">
          {portfolio.stalePriceCount === 1
            ? '1 price is older than 2 hours; the last stored price is used.'
            : `${portfolio.stalePriceCount} prices are older than 2 hours; the last stored prices are used.`}
        </Banner>
      )}
      {portfolio.missingRateCount > 0 && (
        <Banner tone="warn">
          {portfolio.missingRateCount === 1
            ? '1 asset has'
            : `${portfolio.missingRateCount} assets have`}{' '}
          operations dated before the stored Bank of Russia rates, so their cost or P&amp;L in{' '}
          {currency} is not shown.
        </Banner>
      )}
    </Card>
  );
}

function AssetsTable({
  groups,
  currency,
  asked,
  now,
  chains,
  sort,
  onSort,
  real,
}: {
  groups: AssetGroup[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  now: Date;
  chains: TokenChains;
  sort: AssetSort;
  onSort: (key: SortKey) => void;
  /** The basis of the profit after inflation when the Real view is on; null for nominal. */
  real: InflationBasis | null;
}) {
  const classes = useAccountClasses();
  return (
    <div className="ui-table-wrap">
      <table className="ui-table portfolio-table" aria-labelledby="portfolio-assets">
        <thead>
          <tr>
            {sortColumns(real !== null).map(([key, label]) => {
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
        {groups.map(({ head, rows }) => (
          <tbody key={head.key}>
            <tr className="portfolio-group">
              <th scope="rowgroup" colSpan={sortColumns(real !== null).length}>
                <span className="portfolio-group__head">
                  <GroupHeadText head={head} currency={currency} />
                </span>
              </th>
            </tr>
            {rows.map((asset) => (
              <tr key={asset.instrumentId}>
                <td>
                  <span className="portfolio-asset">
                    <AssetIcon
                      symbol={asset.symbol}
                      name={asset.name}
                      assetType={asset.assetType}
                      assetClass={heldClass(asset.holdings, classes)}
                      network={onlyChain(asset.symbol, chains)}
                    />
                    <span className="portfolio-asset__text">
                      <Link
                        className="portfolio-asset__name"
                        to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}
                      >
                        {asset.name}
                      </Link>
                      <span className="portfolio-asset__ticker" title={assetCaption(asset, chains)}>
                        {assetCaption(asset, chains)}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="ui-num">{quantity(asset.quantity)}</td>
                <td className="ui-num">
                  {asset.price ? price(asset.price.value, currency) : missingLabel(asset)}
                  <span className="ui-sub">{priceNote(asset, now)}</span>
                </td>
                <td className="ui-num ui-strong">{money(asset.value, currency)}</td>
                <td className="ui-num">
                  <span className="portfolio-share">
                    <span className="portfolio-share__bar" aria-hidden="true">
                      <i
                        style={{ width: `${Math.min(Number(asset.allocationPercent ?? 0), 100)}%` }}
                      />
                    </span>
                    <span className="portfolio-share__text">
                      {shareText(asset.allocationPercent)}
                    </span>
                  </span>
                </td>
                <td className="ui-num">
                  {asset.averageBuyPrice === null ? DASH : price(asset.averageBuyPrice, currency)}
                </td>
                <td className="ui-num">
                  {real === null ? (
                    <Signed
                      value={shownProfit(asset).pnl}
                      currency={currency}
                      ratio={shownProfit(asset).ratio}
                      inline
                    />
                  ) : (
                    <>
                      <Signed
                        value={realProfit(asset, real).pnl}
                        currency={currency}
                        ratio={realProfit(asset, real).ratio}
                        inline
                      />
                      {nominalLine(asset, currency) !== null && (
                        <span className="ui-sub">{nominalLine(asset, currency)}</span>
                      )}
                    </>
                  )}
                </td>
                <td className="ui-num">
                  {asset.priceSource === 'manual' ? (
                    <span className="ui-muted">Manual</span>
                  ) : (
                    <Change value={asset.priceChange24hPercent} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * A phone row's unrealized P&L: money and percent, coloured by sign; under Real it says so, and an
 * asset without a real reading keeps its nominal profit.
 */
function Profit({
  asset,
  currency,
  real,
}: {
  asset: AssetValuation;
  currency: AccountingCurrency;
  real: InflationBasis | null;
}) {
  const { pnl, ratio } = real === null ? shownProfit(asset) : realProfit(asset, real);
  if (pnl === null) {
    const nominal = real === null ? null : nominalLine(asset, currency);
    return nominal === null ? (
      DASH
    ) : (
      <>
        {DASH}
        <span className="ui-sub">{nominal}</span>
      </>
    );
  }
  return (
    <span className={toneClass(pnl)}>
      {money(pnl, currency, true)}
      {real !== null && ' real'}
      {ratio !== null && ` · ${percent(ratio)}`}
    </span>
  );
}

// Phones get two-line rows instead of the table: the whole row opens the asset, and the
// columns that do not fit are on the asset page (design: tables on phones).
function AssetsList({
  groups,
  currency,
  asked,
  chains,
  real,
}: {
  groups: AssetGroup[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  chains: TokenChains;
  real: InflationBasis | null;
}) {
  const classes = useAccountClasses();
  return groups.map(({ head, rows }) => (
    <Fragment key={head.key}>
      <div className="portfolio-mgrp">
        <h3 className="portfolio-group__name">{head.label}</h3>
        {head.share !== null && <span className="portfolio-group__share">{head.share}</span>}
        <span className="portfolio-group__total">
          {money(head.value, currency)}
          {head.missing > 0 && <span className="ui-sub">{head.missing} without a price</span>}
        </span>
      </div>
      <ul className="ui-rows">
        {rows.map((asset) => (
          <li key={asset.instrumentId}>
            <Link
              className={rowClass()}
              to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}
            >
              <AssetIcon
                symbol={asset.symbol}
                name={asset.name}
                assetType={asset.assetType}
                assetClass={heldClass(asset.holdings, classes)}
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
                value={<Profit asset={asset} currency={currency} real={real} />}
              />
            </Link>
          </li>
        ))}
      </ul>
    </Fragment>
  ));
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
  // Rows instead of the table below 900 px, as on a phone (TABLE-ROWS).
  const phone = useRowsLayout();
  const [view] = useValueView();
  const [basis] = useInflationBasis();
  // Under Real the profit column is the profit after inflation on the chosen basis. An answer
  // saved before real figures existed has none to show, so it stays nominal until a fresh one.
  const real = view === 'real' && portfolio?.real !== undefined ? basis : null;
  // Add opens the kind picker; the kind then opens its own form, or the page it is added on.
  const [adding, setAdding] = useState<'pick' | Exclude<AddChoice, 'crypto'> | null>(null);
  const navigate = useNavigate();
  const [refreshFailed, setRefreshFailed] = useState(false);
  const chains = useTokenChains();
  const latest = useRef(0);
  const toast = useToast();

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
  const classes = useAccountClasses();
  const inFilter = (asset: AssetValuation, value: Filter) =>
    value === 'all' || assetClassOf(asset, classes) === value;
  const count = (value: Filter) => assets.filter((asset) => inFilter(asset, value)).length;
  // A class with no assets gets no chip; a chosen class that no longer has any shows them all.
  const active: Filter = filter !== 'all' && count(filter) === 0 ? 'all' : filter;
  const visible = assets.filter((asset) => inFilter(asset, active) && matchesSearch(asset, search));
  // PAGES: twenty assets a page; the list is sorted first, so its pages follow the order.
  // The table and the phone list share one order, Value largest first until another is chosen;
  // a phone shows only the orders its Sort by can name.
  const shown = phone ? phoneSort(sort) : sort;
  const classOf = (asset: AssetValuation) => assetClassOf(asset, classes);
  const sorted = sortAssets(visible, shown, real);
  const ordered = classOrder.flatMap((key) => sorted.filter((asset) => classOf(asset) === key));
  // A group's subtotal counts all its rows shown, not only the loaded page.
  const heads = new Map(
    classOrder.map((key): [AssetClassFilter, GroupHead] => {
      const subtotal = groupSubtotal(visible.filter((asset) => classOf(asset) === key));
      // A net worth that is a floor for want of an account's interest overstates every share.
      const floor = (portfolio?.interestMissingDepositCount ?? 0) > 0;
      const share = groupShare(subtotal, floor ? null : (portfolio?.totalValue ?? null));
      return [key, { key, label: classLabels[key], share, ...subtotal }];
    }),
  );
  const paged = useInfinite(ordered, {
    resetKey: `${active}|${search.trim()}|${shown.key}|${shown.direction}|${phone}`,
  });
  // A new asset opens on its own page, and a toast says it was added (portfolio-06).
  const added = (asset: PortfolioAsset) => {
    toast.show({ tone: 'success', title: 'Asset added', detail: asset.name });
    navigate(withCurrency(`/portfolio/${asset.id}`, asked));
  };
  const addButton = (primary: boolean) => (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      icon="plus"
      onClick={() => setAdding('pick')}
    >
      Add
    </Button>
  );
  const now = new Date();
  const groups = paged.rows.reduce<AssetGroup[]>((list, asset) => {
    const last = list.at(-1);
    if (last?.head.key === classOf(asset)) last.rows.push(asset);
    else list.push({ head: heads.get(classOf(asset)) as GroupHead, rows: [asset] });
    return list;
  }, []);

  return (
    <div className="shell-page">
      <PageHeader title="Portfolio" currency={portfolio?.currency} valueSwitch />
      {failed ? (
        <ErrorState what="your portfolio" onRetry={() => void load()} />
      ) : portfolio === null ? (
        <PageSkeleton label="Loading portfolio" show={['stats', 'rows']} />
      ) : assets.length === 0 && !hasDeposits(portfolio) ? (
        <EmptyState id="portfolio-empty" title="No assets yet" actions={addButton(true)}>
          Add a wallet, a bank deposit, a coin or anything else you want to track.
        </EmptyState>
      ) : (
        <>
          {refreshFailed && (
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
          <Summary portfolio={portfolio} asked={asked} real={real !== null} basis={basis} />
          {assets.length === 0 ? (
            <EmptyState id="portfolio-empty" title="No assets yet" actions={addButton(true)}>
              Add a wallet, a bank deposit, a coin or anything else you want to track.
            </EmptyState>
          ) : (
            <Card labelledBy="portfolio-assets">
              <div className="ui-toolbar">
                <h2 id="portfolio-assets" className="ui-sr">
                  Assets
                </h2>
                <ChipGroup label="Filter assets">
                  {filters
                    .filter(([value]) => value === 'all' || count(value) > 0)
                    .map(([value, label]) => (
                      <Chip
                        key={value}
                        pressed={active === value}
                        count={count(value)}
                        countTone="muted"
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </Chip>
                    ))}
                </ChipGroup>
                <div className="portfolio-tools">
                  <Input
                    type="search"
                    size="sm"
                    className="ui-search"
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
                    <Select
                      size="sm"
                      value={shown.key}
                      onChange={(event) => {
                        const key = event.target.value as SortKey;
                        setSort({ key, direction: firstDirection(key) });
                      }}
                    >
                      {phoneSorts(real !== null).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <AssetsList
                    groups={groups}
                    currency={portfolio.currency}
                    asked={asked}
                    chains={chains}
                    real={real}
                  />
                </>
              ) : (
                <AssetsTable
                  groups={groups}
                  currency={portfolio.currency}
                  asked={asked}
                  now={now}
                  chains={chains}
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                  real={real}
                />
              )}
              {paged.more && <LoadMore {...paged.more} label="assets" />}
              {visible.length === 0 && (
                <p className="ui-none">
                  {search.trim()
                    ? `No assets match "${search.trim()}".`
                    : 'No assets of this class.'}
                </p>
              )}
              <p className="ui-sub portfolio-card-note">
                {ratesNote(portfolio)} Holdings come from your{' '}
                <Link className="ui-link" to="/wallets">
                  wallets
                </Link>{' '}
                and the transactions you add.
              </p>
            </Card>
          )}
          <Allocation portfolio={portfolio} />
        </>
      )}
      {adding === 'pick' && (
        <AddToPortfolioDialog
          onClose={() => setAdding(null)}
          onChoose={(choice) =>
            choice === 'crypto'
              ? navigate(withCurrency('/wallets', asked), { state: { addWallet: true } })
              : setAdding(choice)
          }
        />
      )}
      {adding === 'other' && <AddAssetDialog onClose={() => setAdding(null)} onAdded={added} />}
      {adding === 'broker' && (
        <AddBrokerAccountDialog
          onClose={() => setAdding(null)}
          onAdded={(account) =>
            navigate(withCurrency('/brokers', asked), { state: { focusAccount: account } })
          }
        />
      )}
      {adding === 'property' && (
        <AddPropertyDialog
          onClose={() => setAdding(null)}
          onAdded={(asset) => navigate(withCurrency(`/portfolio/${asset.id}`, asked))}
        />
      )}
      {adding === 'bank' && (
        <AddDepositDialog
          onClose={() => setAdding(null)}
          onSaved={(created) => navigate(withCurrency(`/deposits/${created.id}`, asked))}
        />
      )}
    </div>
  );
}
