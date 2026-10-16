import type { AccountClass } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import EmptyState from '@/ui/EmptyState';
import SummaryCard from '@/ui/SummaryCard';
import { dayText, moscowDate } from '@/utils/dates';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { money, percent, tone } from '../portfolio/format';
import { Icon } from '../shell/icons';
import { shareFigure } from '../shell/net-worth';
import SectionPage, { SectionAction, SectionGrid } from '../shell/SectionPage';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import AddPropertyDialog from './AddPropertyDialog';
import {
  estimateOverdue,
  firstBought,
  type Property,
  propertiesOf,
  propertyTotal,
  shareText,
} from './real-estate';
import './property.css';

/** The Moscow day of an instant, written as the rest of the app writes dates. */
const day = (at: string) => dayText(moscowDate(at));

const classesOf = (accounts: readonly { id: string; assetClass?: AccountClass | null }[]) =>
  Object.fromEntries(accounts.map((account) => [account.id, account.assetClass ?? null]));

function Card({
  property,
  portfolio,
  classes,
}: {
  property: Property;
  portfolio: PortfolioValuation;
  classes: Readonly<Record<string, AccountClass | null>>;
}) {
  const [asked] = useAskedCurrency();
  const { asset, share } = property;
  const currency = portfolio.currency;
  const estimated = asset.price?.observedAt ?? null;
  const bought = firstBought(
    useCachedRead(cachedReads.assetLots, asset.instrumentId, asked).data,
    classes,
  );
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
            <dd>
              {estimated ? day(estimated) : '—'}
              {estimated && estimateOverdue(estimated, new Date()) && (
                <Badge tone="warn" className="property-card__badge">
                  Over 60 days old
                </Badge>
              )}
            </dd>
          </div>
          {bought && (
            <div>
              <dt>Bought</dt>
              <dd>{dayText(bought)}</dd>
            </div>
          )}
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
  const latest = useRef(0);

  // Only the newest request may change the page; a refresh keeps what is shown and says so
  // when it fails, as Portfolio does.
  const load = useCallback(
    (quiet = false) => {
      const request = ++latest.current;
      setFailed(false);
      if (!quiet) setPortfolio(cachedReads.portfolio.last(asked) ?? null);
      Promise.all([cachedReads.portfolio.load(asked), cachedReads.accounts.load()]).then(
        ([nextPortfolio, accounts]) => {
          if (request !== latest.current) return;
          setPortfolio(nextPortfolio);
          setClasses(classesOf(accounts));
        },
        () => request === latest.current && setFailed(true),
      );
    },
    [asked],
  );
  useEffect(() => {
    load();
    return () => {
      latest.current++;
    };
  }, [load]);

  const properties = portfolio && classes ? propertiesOf(portfolio, classes) : null;
  const total = propertyTotal(properties ?? []);
  const unpriced = properties?.filter(({ value }) => value === null).length ?? 0;
  return (
    <SectionPage
      title="Real estate"
      currency={portfolio?.currency}
      intro="Valued at your own estimate. Update it on the property's page whenever you like."
      action={<SectionAction onClick={() => setAdding(true)}>Add property</SectionAction>}
      notice={
        failed && properties ? (
          <p className="ui-banner ui-banner--warn" role="alert">
            Could not refresh your real estate; showing the last loaded figures.{' '}
            <button type="button" className="shell-button" onClick={() => load(true)}>
              Refresh
            </button>
          </p>
        ) : undefined
      }
      summary={
        properties && portfolio && properties.length > 0 ? (
          <SummaryCard
            label="Total in real estate"
            figures={[
              { label: 'In real estate', value: money(total, portfolio.currency) },
              shareFigure(total, portfolio),
            ]}
            note={
              unpriced > 0
                ? `Your share of each property at its latest estimate; ${unpriced} without an estimate left out.`
                : 'Your share of each property at its latest estimate.'
            }
          />
        ) : undefined
      }
    >
      {failed && !properties ? (
        <section className="shell-card property-state" role="alert">
          <p>Could not load your real estate. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => load()}>
            Try again
          </button>
        </section>
      ) : properties === null || portfolio === null ? (
        <PageSkeleton label="Loading real estate" show={['cards']} />
      ) : properties.length === 0 ? (
        <EmptyState id="real-estate-empty" title="No property yet" icon={<Icon name="home" />}>
          Add an apartment, a house, land or parking with what you paid and your share. Its value is
          your own estimate, counted in your net worth in USD, EUR or RUB.
        </EmptyState>
      ) : (
        <SectionGrid>
          {properties.map((property) => (
            <Card
              key={property.asset.instrumentId}
              property={property}
              portfolio={portfolio}
              classes={classes ?? {}}
            />
          ))}
        </SectionGrid>
      )}
      {adding && (
        <AddPropertyDialog
          onClose={() => setAdding(false)}
          onAdded={(asset) => navigate(withCurrency(`/portfolio/${asset.id}`, asked))}
        />
      )}
    </SectionPage>
  );
}
