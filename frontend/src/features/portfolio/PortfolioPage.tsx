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
import { assetIdentity, assetTypeColors } from '../shell/asset-identity';
import PageHeader from '../shell/PageHeader';
import AddAssetDialog from './AddAssetDialog';
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
type Grouping = 'byAsset' | 'byType' | 'byAccount';
const groupings: [Grouping, string][] = [
  ['byAsset', 'Asset'],
  ['byType', 'Type'],
  ['byAccount', 'Account'],
];

/** "BTC · Crypto · USD": ticker, type and value currency of an asset. */
export function assetCaption(asset: AssetValuation): string {
  return [asset.symbol, typeLabels[asset.assetType], asset.valuationCurrency]
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

/** Slice colour: the asset's own or its type's; accounts keep the positional palette. */
function sliceColor(
  portfolio: PortfolioValuation,
  grouping: Grouping,
  key: string,
): string | undefined {
  if (grouping === 'byType') return assetTypeColors[key as AssetType];
  if (grouping !== 'byAsset') return undefined;
  const asset = portfolio.assets.find((item) => item.instrumentId === key);
  return asset ? assetIdentity(asset).color : undefined;
}

function Allocation({ portfolio }: { portfolio: PortfolioValuation }) {
  const [grouping, setGrouping] = useState<Grouping>('byAsset');
  const slices = portfolio.allocation[grouping].map((slice, index) => {
    const color = sliceColor(portfolio, grouping, slice.key);
    const asset =
      grouping === 'byAsset'
        ? portfolio.assets.find((item) => item.instrumentId === slice.key)
        : undefined;
    // An asset is shown as "Bitcoin BTC" when its ticker differs from its name.
    const ticker = asset?.symbol && asset.symbol !== slice.label ? asset.symbol : undefined;
    return { ...slice, ticker, color, tone: color ? undefined : index % 6 };
  });
  return (
    <section className="shell-card" aria-labelledby="portfolio-allocation">
      <div className="portfolio-toolbar">
        <h2 id="portfolio-allocation">Allocation</h2>
        <div className="shell-seg" role="radiogroup" aria-label="Group allocation by">
          {groupings.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="allocation-grouping"
                value={value}
                checked={grouping === value}
                onChange={() => setGrouping(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      {slices.length === 0 ? (
        <p className="portfolio-none">Nothing with a price yet.</p>
      ) : (
        <>
          <div className="portfolio-bar" aria-hidden="true">
            {slices.map((slice) => (
              <span
                key={slice.key}
                style={{ width: `${slice.percent ?? 0}%`, background: slice.color }}
                data-tone={slice.tone}
              />
            ))}
          </div>
          <ul
            className="portfolio-slices"
            aria-label={`Allocation by ${grouping.slice(2).toLowerCase()}`}
          >
            {slices.map((slice) => (
              <li key={slice.key}>
                <span
                  className="portfolio-swatch"
                  style={{ background: slice.color }}
                  data-tone={slice.tone}
                  aria-hidden="true"
                />
                <span className="portfolio-slices__label">
                  {slice.label}
                  {slice.ticker && (
                    <span className="portfolio-slices__ticker"> {slice.ticker}</span>
                  )}
                </span>
                <span className="portfolio-slices__value">
                  {money(slice.value, portfolio.currency)}
                </span>
                <span className="portfolio-slices__percent">{percent(slice.percent, false)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!portfolio.allocation.complete && (
        <p className="shell-note portfolio-note">
          {portfolio.missingPriceCount > 0 && 'Assets without a price are not included.'}
          {portfolio.missingPriceCount > 0 && portfolio.unavailableAccountCount > 0 && ' '}
          {portfolio.unavailableAccountCount > 0 &&
            'Accounts whose history starts later are not included.'}
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
}: {
  assets: AssetValuation[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
  now: Date;
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
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.instrumentId}>
              <td>
                <span className="portfolio-asset">
                  <AssetIcon symbol={asset.symbol} name={asset.name} assetType={asset.assetType} />
                  <span>
                    <Link
                      className="portfolio-asset__name"
                      to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}
                    >
                      {asset.name}
                    </Link>
                    <span className="portfolio-asset__ticker">{assetCaption(asset)}</span>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Whole-portfolio value, allocation and the assets table (portfolio-valuation PV-5, AST-3).
export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [asked] = useAskedCurrency();
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
  const visible = assets.filter((asset) => filter === 'all' || asset.assetType === filter);
  const added = (asset: PortfolioAsset) => {
    // The new row must be visible, so a filter that would hide it is cleared.
    setFilter((current) => (current === 'all' || current === asset.assetType ? current : 'all'));
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
          <Allocation portfolio={portfolio} />
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
            </div>
            <AssetsTable assets={visible} currency={portfolio.currency} asked={asked} now={now} />
            {visible.length === 0 && <p className="portfolio-none">No assets of this type.</p>}
            <p className="shell-note portfolio-note">
              {ratesNote(portfolio)} Holdings come from your{' '}
              <Link to="/manual-accounts">manual accounts</Link>.
            </p>
          </section>
        </>
      )}
      {adding && <AddAssetDialog onClose={() => setAdding(false)} onAdded={added} />}
    </div>
  );
}
