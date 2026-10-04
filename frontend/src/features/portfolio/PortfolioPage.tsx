import {
  type AssetType,
  type PortfolioAsset,
  type PriceSource,
  portfolioAssetsApi,
} from '@api/portfolio-assets.api';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AddAssetDialog from './AddAssetDialog';
import '../shell/shell-page.css';
import './portfolio.css';

export const typeLabels: Record<AssetType, string> = {
  crypto: 'Crypto',
  fiat: 'Cash',
  manual: 'Manual',
};
const sourceLabels: Record<PriceSource, string> = {
  market: 'Market price',
  manual: 'Manual',
  fixed: 'Fixed',
};
type Filter = 'all' | AssetType;
const filters: [Filter, string][] = [
  ['all', 'All'],
  ['crypto', 'Crypto'],
  ['fiat', 'Cash'],
  ['manual', 'Manual'],
];
const byName = (a: PortfolioAsset, b: PortfolioAsset) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

// Lists the owner's assets with their classification (asset-classification, AST-3).
// Quantities and values arrive with whole-portfolio valuation (M4).
export default function PortfolioPage() {
  const [assets, setAssets] = useState<PortfolioAsset[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setAssets(null);
    try {
      setAssets(await portfolioAssetsApi.listAll());
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => [...(assets ?? [])].sort(byName), [assets]);
  const visible = sorted.filter((asset) => filter === 'all' || asset.assetType === filter);
  const added = (asset: PortfolioAsset) => {
    setAssets((current) => [...(current ?? []).filter((item) => item.id !== asset.id), asset]);
    setAdding(false);
  };
  const addButton = (
    <button
      type="button"
      className="shell-button shell-button--primary"
      onClick={() => setAdding(true)}
    >
      Add asset
    </button>
  );

  return (
    <div className="shell-page">
      <div className="shell-page__head">
        <h1>Portfolio</h1>
        {assets && assets.length > 0 && addButton}
      </div>
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your assets. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : assets === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading assets…
        </section>
      ) : assets.length === 0 ? (
        <section className="shell-card shell-empty" aria-labelledby="portfolio-empty">
          <h2 id="portfolio-empty">No assets yet</h2>
          <p>Add a coin, cash or anything else you want to track.</p>
          {addButton}
        </section>
      ) : (
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
                      ? sorted.length
                      : sorted.filter((asset) => asset.assetType === value).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="portfolio-table-wrap">
            <table className="portfolio-table">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Type</th>
                  <th scope="col">Value currency</th>
                  <th scope="col">Price source</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <span className="portfolio-asset">
                        <span
                          className="portfolio-asset__icon"
                          data-letter={(asset.symbol ?? asset.name).slice(0, 1).toUpperCase()}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="portfolio-asset__name">{asset.name}</span>
                          {asset.symbol && (
                            <span className="portfolio-asset__ticker">{asset.symbol}</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td>{typeLabels[asset.assetType]}</td>
                    <td>{asset.valuationCurrency}</td>
                    <td>{sourceLabels[asset.priceSource]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <p className="portfolio-none">No assets of this type.</p>}
          </div>
          <p className="shell-note portfolio-note">
            Quantities, prices and values will appear here once portfolio valuation is built. Until
            then they are in the <Link to="/manual-accounts">manual accounts</Link>.
          </p>
        </section>
      )}
      {adding && <AddAssetDialog onClose={() => setAdding(false)} onAdded={added} />}
    </div>
  );
}
