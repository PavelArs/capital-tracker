import type {
  AccountingCurrency,
  AssetValuation,
  PortfolioValuation,
} from '@api/portfolio-valuation.api';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { withCurrency } from '../portfolio/currency';
import {
  missingLabel,
  money,
  percent,
  price,
  quantity,
  sourceLabels,
  tone,
} from '../portfolio/format';
import { Change } from '../portfolio/PortfolioPage';
import AssetIcon from '../shell/AssetIcon';
import { useNarrowScreen } from '../transactions/useNarrowScreen';

const TOP = 5;

/** The largest held assets: the portfolio lists held and priced assets by value first. */
export function topAssets(portfolio: PortfolioValuation): AssetValuation[] {
  return portfolio.assets.filter((asset) => Number(asset.quantity) !== 0).slice(0, TOP);
}

const amount = (asset: AssetValuation) =>
  `${quantity(asset.quantity)}${asset.symbol ? ` ${asset.symbol}` : ''}`;

function Table({
  assets,
  currency,
  asked,
}: {
  assets: AssetValuation[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
}) {
  return (
    <div className="portfolio-table-wrap">
      <table className="portfolio-table">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col" className="portfolio-num">
              Price
            </th>
            <th scope="col" className="portfolio-num">
              24h
            </th>
            <th scope="col" className="portfolio-num">
              Value
            </th>
            <th scope="col" className="portfolio-num">
              Share
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
                    <span className="portfolio-asset__ticker">{amount(asset)}</span>
                  </span>
                </span>
              </td>
              <td className="portfolio-num">
                {asset.price ? price(asset.price.value, currency) : missingLabel(asset)}
              </td>
              <td className="portfolio-num">
                <Change value={asset.priceChange24hPercent} />
              </td>
              <td className="portfolio-num portfolio-strong">{money(asset.value, currency)}</td>
              <td className="portfolio-num">{percent(asset.allocationPercent, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Phones: the same two-line rows as the Portfolio list, with the 24h change on the right
// (mobile tables spec: "+0.80% today").
function List({
  assets,
  currency,
  asked,
}: {
  assets: AssetValuation[];
  currency: AccountingCurrency;
  asked: AccountingCurrency | undefined;
}) {
  return (
    <ul className="portfolio-list">
      {assets.map((asset) => {
        const market = asset.priceSource === 'market';
        const change = asset.priceChange24hPercent;
        return (
          <li key={asset.instrumentId}>
            <Link
              className="portfolio-list__row"
              to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}
            >
              <AssetIcon symbol={asset.symbol} name={asset.name} assetType={asset.assetType} />
              <span className="portfolio-list__name">{asset.name}</span>
              <span className="portfolio-list__value">{money(asset.value, currency)}</span>
              <span className="portfolio-list__detail">{amount(asset)}</span>
              <span
                className={`portfolio-list__pnl${market && tone(change) ? ` portfolio-${tone(change)}` : ''}`}
              >
                {market ? `${percent(change)} today` : sourceLabels[asset.priceSource]}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** DASH-MAIN: the five largest assets, linking to their pages and to the whole Portfolio. */
export default function TopAssets({
  portfolio,
  failed,
  onRetry,
  asked,
}: {
  portfolio: PortfolioValuation | null;
  failed: boolean;
  onRetry: () => void;
  asked: AccountingCurrency | undefined;
}) {
  const heading = useId();
  const phone = useNarrowScreen();
  const assets = portfolio ? topAssets(portfolio) : [];
  return (
    <section className="shell-card dashboard-assets" aria-labelledby={heading}>
      <div className="portfolio-toolbar">
        <h2 id={heading}>Top assets</h2>
        <Link className="dashboard-link" to={withCurrency('/portfolio', asked)}>
          All assets
        </Link>
      </div>
      {failed ? (
        <div role="alert" className="dashboard-assets__state">
          <p>Could not load your assets.</p>
          <button type="button" className="shell-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : portfolio === null ? (
        <p className="portfolio-none">Loading assets…</p>
      ) : assets.length === 0 ? (
        <p className="portfolio-none">No assets held right now.</p>
      ) : phone ? (
        <List assets={assets} currency={portfolio.currency} asked={asked} />
      ) : (
        <Table assets={assets} currency={portfolio.currency} asked={asked} />
      )}
    </section>
  );
}
