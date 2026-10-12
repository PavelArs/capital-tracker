import type { AccountClass } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import EmptyState from '@/ui/EmptyState';
import PageIntro from '@/ui/PageIntro';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { money, percent, tone } from '../portfolio/format';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import AddPropertyDialog from './AddPropertyDialog';
import { type Property, propertiesOf, shareText } from './real-estate';
import '../shell/shell-page.css';
import './property.css';

const day = (at: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(at));

const classesOf = (accounts: readonly { id: string; assetClass?: AccountClass | null }[]) =>
  Object.fromEntries(accounts.map((account) => [account.id, account.assetClass ?? null]));

function Card({ property, portfolio }: { property: Property; portfolio: PortfolioValuation }) {
  const [asked] = useAskedCurrency();
  const { asset, share } = property;
  const currency = portfolio.currency;
  return (
    <li>
      <Link className="property-card" to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}>
        <div>
          <span className="property-card__name">{asset.name}</span>
          <span className="property-card__share">{shareText(share)}</span>
        </div>
        <strong className="property-card__value">{money(property.value, currency)}</strong>
        <dl className="property-card__facts">
          {share < 100 && (
            <div>
              <dt>Whole property</dt>
              <dd>{money(asset.price?.value ?? null, currency)}</dd>
            </div>
          )}
          <div>
            <dt>Estimate of</dt>
            <dd>{asset.price?.observedAt ? day(asset.price.observedAt) : '—'}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>{money(property.costBasis, currency)}</dd>
          </div>
          <div>
            <dt>Gain</dt>
            <dd className={`property-card__gain--${tone(property.unrealizedPnl) ?? 'flat'}`}>
              {money(property.unrealizedPnl, currency, true)}
              {property.unrealizedReturnPercent !== null &&
                ` (${percent(property.unrealizedReturnPercent)})`}
            </dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}

// Real estate (v8): each property at the owner's own estimate, with what the owner's share is
// worth, what it cost and the gain. A property's page updates the estimate.
export default function RealEstatePage() {
  const [asked] = useAskedCurrency();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState(() => cachedReads.portfolio.last(asked) ?? null);
  const [classes, setClasses] = useState(() => {
    const kept = cachedReads.accounts.last();
    return kept ? classesOf(kept) : null;
  });
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    Promise.all([cachedReads.portfolio.load(asked), cachedReads.accounts.load()]).then(
      ([nextPortfolio, accounts]) => {
        if (!live) return;
        setPortfolio(nextPortfolio);
        setClasses(classesOf(accounts));
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [asked]);

  const properties = portfolio && classes ? propertiesOf(portfolio, classes) : null;
  const total = properties?.reduce((sum, { value }) => sum + Number(value ?? 0), 0) ?? 0;
  const unpriced = properties?.filter(({ value }) => value === null).length ?? 0;
  const addButton = (primary: boolean) => (
    <button
      type="button"
      className={`shell-button ${primary ? 'shell-button--primary' : 'shell-button--secondary'}`}
      onClick={() => setAdding(true)}
    >
      <Icon name="plus" className="shell-icon shell-icon--sm" />
      Add property
    </button>
  );

  return (
    <div className="shell-page">
      <PageHeader title="Real estate" currency={portfolio?.currency} />
      {failed && !properties ? (
        <p className="shell-note" role="alert">
          Could not load your real estate. Try again later.
        </p>
      ) : properties === null || portfolio === null ? (
        <PageSkeleton label="Loading real estate" show={['cards']} />
      ) : properties.length === 0 ? (
        <EmptyState
          id="real-estate-empty"
          title="No property yet"
          icon={<Icon name="home" />}
          actions={addButton(true)}
        >
          Add an apartment, a house, land or parking with what you paid and your share. Its value is
          your own estimate, counted in your net worth in USD, EUR or RUB.
        </EmptyState>
      ) : (
        <>
          <PageIntro action={addButton(false)}>
            Valued at your own estimate. Update it on the property's page whenever you like.
          </PageIntro>
          <section className="shell-card property-total" aria-label="Total in real estate">
            <span className="property-total__label">In real estate</span>
            <strong className="property-total__value">
              {money(String(total), portfolio.currency)}
            </strong>
            <span className="property-total__note">
              {unpriced > 0
                ? `Your share of each property at its latest estimate; ${unpriced} without an estimate left out.`
                : 'Your share of each property at its latest estimate.'}
            </span>
          </section>
          <ul className="property-list">
            {properties.map((property) => (
              <Card key={property.asset.instrumentId} property={property} portfolio={portfolio} />
            ))}
          </ul>
        </>
      )}
      {adding && (
        <AddPropertyDialog
          onClose={() => setAdding(false)}
          onAdded={(asset) => navigate(withCurrency(`/portfolio/${asset.id}`, asked))}
        />
      )}
    </div>
  );
}
