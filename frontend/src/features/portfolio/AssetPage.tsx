import {
  type AccountingCurrency,
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CurrencySwitch, ratesNote, useAskedCurrency, withCurrency } from './currency';
import { age, missingLabel, money, price, quantity, sourceLabels, sourceName } from './format';
import { assetCaption, Signed } from './PortfolioPage';
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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="portfolio-stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function AssetDetails({
  asset,
  portfolio,
  now,
}: {
  asset: AssetValuation;
  portfolio: PortfolioValuation;
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
        <span
          className="portfolio-asset__icon portfolio-asset__icon--lg"
          data-letter={(asset.symbol ?? asset.name).slice(0, 1).toUpperCase()}
          aria-hidden="true"
        />
        <div className="portfolio-head__title">
          <h1>{asset.name}</h1>
          <span className="portfolio-sub">{assetCaption(asset)}</span>
        </div>
        <div className="portfolio-head__price">
          <b>{asset.price ? price(asset.price.value, currency) : missingLabel(asset)}</b>
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
                <Link to={`/manual-accounts/${holding.accountId}`}>{holding.accountName}</Link>
                <span className="portfolio-num">
                  {quantity(holding.quantity)} {unit}
                  <span className="portfolio-sub">{amount(holding.value)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="shell-note portfolio-note">
          Price source: {sourceLabels[asset.priceSource]}. {ratesNote(portfolio)} The price chart
          and this asset's transactions are not built yet.
        </p>
      </section>
    </>
  );
}

// One asset across every account (portfolio-valuation PV-5).
export default function AssetPage() {
  const { assetId } = useParams();
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(null);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useAskedCurrency();

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

  const asset = portfolio?.assets.find((item) => item.instrumentId === assetId);
  // The asked currency shows as chosen while its values load.
  const shownCurrency = asked ?? portfolio?.currency;
  return (
    <div className="shell-page">
      <div className="portfolio-crumbs">
        <Link className="portfolio-crumb" to={withCurrency('/portfolio', asked)}>
          ← Portfolio
        </Link>
        {shownCurrency && <CurrencySwitch value={shownCurrency} onChange={setAsked} />}
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
        <AssetDetails asset={asset} portfolio={portfolio} now={new Date()} />
      ) : (
        <section className="shell-card shell-empty" aria-labelledby="asset-missing">
          <h1 id="asset-missing">Asset not found</h1>
          <p>It may belong to another owner or the link is wrong.</p>
        </section>
      )}
    </div>
  );
}
