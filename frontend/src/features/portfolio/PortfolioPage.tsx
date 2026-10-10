import type { AssetType, PortfolioAsset } from '@api/portfolio-assets.api';
import {
  type AccountingCurrency,
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AssetIcon from '../shell/AssetIcon';
import PageHeader from '../shell/PageHeader';
import { onlyChain, type TokenChains, useTokenChains, withChains } from '../shell/token-chains';
import { useNarrowScreen } from '../transactions/useNarrowScreen';
import AddAssetDialog from './AddAssetDialog';
import Allocation from './Allocation';
import { ratesNote, useAskedCurrency, withCurrency } from './currency';
import { DASH, missingLabel, money, percent, price, priceNote, quantity, tone } from './format';
import '../shell/shell-page.css';
import './portfolio.css';

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
}: {
  value: string | null;
  currency: AccountingCurrency;
  ratio?: string | null;
}) {
  return (
    <span className={tone(value) ? `portfolio-${tone(value)}` : undefined}>
      {money(value, currency, true)}
      {ratio !== undefined && value !== null && ratio !== null && (
        <span className="portfolio-sub">{percent(ratio)}</span>
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

export type SortKey = 'value' | 'pnl' | 'change' | 'name';
const sortKeys: [SortKey, string][] = [
  ['value', 'Value'],
  ['pnl', 'Unrealized P&L'],
  ['change', '24h change'],
  ['name', 'Name'],
];

/** Assets in the phone list's order: numbers largest first with unknowns last, names A to Z. */
export function sortAssets(assets: readonly AssetValuation[], key: SortKey): AssetValuation[] {
  if (key === 'name')
    return [...assets].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const field = (asset: AssetValuation) =>
    key === 'value'
      ? asset.value
      : key === 'pnl'
        ? asset.unrealizedPnl
        : asset.priceChange24hPercent;
  const number = (asset: AssetValuation) => {
    const value = field(asset);
    return value === null ? Number.NEGATIVE_INFINITY : Number(value);
  };
  return [...assets].sort((a, b) => number(b) - number(a) || a.name.localeCompare(b.name));
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

function Summary({ portfolio }: { portfolio: PortfolioValuation }) {
  const unpriced = portfolio.missingPriceCount;
  const currency = portfolio.currency;
  const amount = (value: string | null) => money(value, currency);
  return (
    <section className="shell-card portfolio-summary" aria-label="Portfolio summary">
      <dl>
        <div>
          <dt>Current value</dt>
          <dd>
            {portfolio.totalValue !== null ? amount(portfolio.totalValue) : 'Incomplete'}
            {portfolio.totalValue === null && (
              <span className="portfolio-sub">
                {amount(portfolio.pricedSubtotal)} priced
                {unpriced > 0 &&
                  `, ${unpriced} ${unpriced === 1 ? 'asset' : 'assets'} without a price`}
                {portfolio.unavailableAccountCount > 0 &&
                  `, ${portfolio.unavailableAccountCount} account history starts later`}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Cost basis</dt>
          <dd>
            {amount(portfolio.costBasis)}
            {portfolio.costBasis === null && (
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
            <Signed
              value={portfolio.unrealizedPnl}
              currency={currency}
              ratio={portfolio.unrealizedReturnPercent}
            />
          </dd>
        </div>
        <div>
          <dt>Realized P&amp;L</dt>
          <dd>
            <Signed value={portfolio.realizedPnl} currency={currency} />
          </dd>
        </div>
      </dl>
      {portfolio.stalePriceCount > 0 && (
        <p className="portfolio-warn" role="note">
          {portfolio.stalePriceCount === 1
            ? '1 price is older than 2 hours; the last stored price is used.'
            : `${portfolio.stalePriceCount} prices are older than 2 hours; the last stored prices are used.`}
        </p>
      )}
      {portfolio.missingRateCount > 0 && (
        <p className="portfolio-warn" role="note">
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
}: {
  assets: AssetValuation[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  now: Date;
  chains: TokenChains;
}) {
  return (
    <div className="portfolio-table-wrap">
      <table className="portfolio-table">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col" className="portfolio-num">
              Amount
            </th>
            <th scope="col" className="portfolio-num">
              Price
            </th>
            <th scope="col" className="portfolio-num">
              Value
            </th>
            <th scope="col" className="portfolio-num">
              Allocation
            </th>
            <th scope="col" className="portfolio-num">
              Avg buy price
            </th>
            <th scope="col" className="portfolio-num">
              Unrealized P&amp;L
            </th>
            <th scope="col" className="portfolio-num">
              24h
            </th>
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
              <td className="portfolio-num">{quantity(asset.quantity)}</td>
              <td className="portfolio-num">
                {asset.price ? price(asset.price.value, currency) : missingLabel(asset)}
                <span className="portfolio-sub">{priceNote(asset, now)}</span>
              </td>
              <td className="portfolio-num portfolio-strong">{money(asset.value, currency)}</td>
              <td className="portfolio-num">{percent(asset.allocationPercent, false)}</td>
              <td className="portfolio-num">
                {asset.averageBuyPrice === null ? DASH : price(asset.averageBuyPrice, currency)}
              </td>
              <td className="portfolio-num">
                <Signed
                  value={asset.unrealizedPnl}
                  currency={currency}
                  ratio={asset.unrealizedReturnPercent}
                />
              </td>
              <td className="portfolio-num">
                <Change value={asset.priceChange24hPercent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <ul className="portfolio-list">
      {assets.map((asset) => (
        <li key={asset.instrumentId}>
          <Link
            className="portfolio-list__row"
            to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}
          >
            <AssetIcon
              symbol={asset.symbol}
              name={asset.name}
              assetType={asset.assetType}
              network={onlyChain(asset.symbol, chains)}
            />
            <span className="portfolio-list__name">{asset.name}</span>
            <span className="portfolio-list__value">{money(asset.value, currency)}</span>
            <span className="portfolio-list__detail">
              {withChains(
                `${quantity(asset.quantity)}${asset.symbol ? ` ${asset.symbol}` : ''}`,
                asset.symbol,
                chains,
              )}
            </span>
            <span
              className={`portfolio-list__pnl${tone(asset.unrealizedPnl) ? ` portfolio-${tone(asset.unrealizedPnl)}` : ''}`}
            >
              {asset.unrealizedPnl === null
                ? DASH
                : `${money(asset.unrealizedPnl, currency, true)}${
                    asset.unrealizedReturnPercent === null
                      ? ''
                      : ` · ${percent(asset.unrealizedReturnPercent)}`
                  }`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Whole-portfolio value, allocation and the assets table (portfolio-valuation PV-5, AST-3).
export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const phone = useNarrowScreen();
  const [adding, setAdding] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [asked] = useAskedCurrency();
  const chains = useTokenChains();
  const latest = useRef(0);

  // Only the newest request may change the page; a quiet refresh keeps what is shown.
  const load = useCallback(
    async (quiet = false) => {
      const request = ++latest.current;
      setFailed(false);
      setRefreshFailed(false);
      if (!quiet) setPortfolio(null);
      try {
        const next = await portfolioValuationApi.get(asked);
        if (request === latest.current) setPortfolio(next);
      } catch {
        if (request !== latest.current) return;
        if (quiet) setRefreshFailed(true);
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
      <PageHeader
        title="Portfolio"
        currency={portfolio?.currency}
        actions={assets.length > 0 && addButton(false)}
        onTransactionSaved={() => void load(true)}
      />
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your portfolio. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : portfolio === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading portfolio…
        </section>
      ) : assets.length === 0 ? (
        <section className="shell-card shell-empty" aria-labelledby="portfolio-empty">
          <h2 id="portfolio-empty">No assets yet</h2>
          <p>Add a coin, cash or anything else you want to track.</p>
          {addButton(true)}
        </section>
      ) : (
        <>
          {refreshFailed && (
            <p className="portfolio-warn" role="alert">
              Could not refresh the values after adding the asset; showing the last loaded ones.{' '}
              <button type="button" className="shell-button" onClick={() => void load(true)}>
                Refresh
              </button>
            </p>
          )}
          <Summary portfolio={portfolio} />
          <section className="shell-card" aria-labelledby="portfolio-assets">
            <div className="portfolio-toolbar">
              <h2 id="portfolio-assets">Assets</h2>
              <div className="portfolio-chips" role="group" aria-label="Filter assets">
                {filters.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="portfolio-chip"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                    <span className="portfolio-chip__count">
                      {' '}
                      {value === 'all'
                        ? assets.length
                        : assets.filter((asset) => asset.assetType === value).length}
                    </span>
                  </button>
                ))}
              </div>
              <input
                type="search"
                className="portfolio-search"
                placeholder="Search assets"
                aria-label="Search assets"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {phone ? (
              <>
                <label className="portfolio-sort">
                  <span>Sort by</span>
                  <select
                    className="portfolio-input"
                    value={sortKey}
                    onChange={(event) => setSortKey(event.target.value as SortKey)}
                  >
                    {sortKeys.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <AssetsList
                  assets={sortAssets(visible, sortKey)}
                  currency={portfolio.currency}
                  asked={asked}
                  chains={chains}
                />
              </>
            ) : (
              <AssetsTable
                assets={visible}
                currency={portfolio.currency}
                asked={asked}
                now={now}
                chains={chains}
              />
            )}
            {visible.length === 0 && (
              <p className="portfolio-none">
                {search.trim() ? `No assets match "${search.trim()}".` : 'No assets of this type.'}
              </p>
            )}
            <p className="shell-note portfolio-note">
              {ratesNote(portfolio)} Holdings come from your{' '}
              <Link className="shell-link" to="/manual-accounts">
                manual accounts
              </Link>
              .
            </p>
          </section>
          <Allocation portfolio={portfolio} />
        </>
      )}
      {adding && <AddAssetDialog onClose={() => setAdding(false)} onAdded={added} />}
    </div>
  );
}
