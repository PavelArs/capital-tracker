import type { AccountClass } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { useToast } from '@contexts/ToastContext';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import PageIntro from '@/ui/PageIntro';
import { Stat, Stats } from '@/ui/Stats';
import { dayText, moscowDate } from '@/utils/dates';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { money, percent, price, tone } from '../portfolio/format';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
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
import '../shell/shell-page.css';
import './property.css';

/** The Moscow day of an instant, written as the rest of the app writes dates. */
const day = (at: string) => dayText(moscowDate(at));

const classesOf = (accounts: readonly { id: string; assetClass?: AccountClass | null }[]) =>
  Object.fromEntries(accounts.map((account) => [account.id, account.assetClass ?? null]));

function PropertyTile({
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
  const direction = tone(property.unrealizedPnl);
  return (
    <li>
      <Link
        className="property-card__link"
        to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}
      >
        <Card as="div" className="property-card">
          <div>
            <span className="property-card__name">{asset.name}</span>
            <span className="property-card__share">{shareText(share)}</span>
          </div>
          <strong className="property-card__value ui-num">{money(property.value, currency)}</strong>
          <KeyValue>
            {share < 100 && (
              <KeyValueRow term="Whole property">
                {price(asset.price?.value ?? null, currency)}
              </KeyValueRow>
            )}
            <KeyValueRow term="Estimate of">
              {estimated ? day(estimated) : '—'}
              {estimated && estimateOverdue(estimated, new Date()) && (
                <Badge tone="warn" className="property-card__badge">
                  Over 60 days old
                </Badge>
              )}
            </KeyValueRow>
            {bought && <KeyValueRow term="Bought">{dayText(bought)}</KeyValueRow>}
            <KeyValueRow term="Paid">{money(property.costBasis, currency)}</KeyValueRow>
            <KeyValueRow term="Gain">
              <span className={direction ? `ui-${direction}` : undefined}>
                {money(property.unrealizedPnl, currency, true)}
                {property.unrealizedReturnPercent !== null &&
                  ` (${percent(property.unrealizedReturnPercent)})`}
              </span>
            </KeyValueRow>
          </KeyValue>
        </Card>
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
  const summaryId = useId();
  const toast = useToast();

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
  const addButton = (
    <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
      Add property
    </Button>
  );

  return (
    <div className="shell-page">
      <PageHeader title="Real estate" currency={portfolio?.currency} />
      {failed && !properties ? (
        <ErrorState what="your real estate" onRetry={() => load()} />
      ) : properties === null || portfolio === null ? (
        <PageSkeleton label="Loading real estate" show={['cards']} />
      ) : properties.length === 0 ? (
        <EmptyState
          id="real-estate-empty"
          title="No property yet"
          icon={<Icon name="home" />}
          actions={addButton}
        >
          Add an apartment, a house, land or parking with what you paid and your share. Its value is
          your own estimate, counted in your net worth in USD, EUR or RUB.
        </EmptyState>
      ) : (
        <>
          {failed && (
            <Banner
              tone="warn"
              role="alert"
              action={
                <Button variant="secondary" size="sm" onClick={() => load(true)}>
                  Refresh
                </Button>
              }
            >
              Could not refresh your real estate; showing the last loaded figures.
            </Banner>
          )}
          <PageIntro action={addButton}>
            Valued at your own estimate. Update it on the property's page whenever you like.
          </PageIntro>
          <Card labelledBy={`${summaryId}-title`}>
            <h2 id={`${summaryId}-title`} className="ui-sr">
              Total in real estate
            </h2>
            <Stats size="lg">
              <Stat
                lead
                label="In real estate"
                value={money(total, portfolio.currency)}
                hint={
                  unpriced > 0
                    ? `Your share of each property at its latest estimate; ${unpriced} without an estimate left out.`
                    : 'Your share of each property at its latest estimate.'
                }
              />
            </Stats>
          </Card>
          <ul className="property-list">
            {properties.map((property) => (
              <PropertyTile
                key={property.asset.instrumentId}
                property={property}
                portfolio={portfolio}
                classes={classes ?? {}}
              />
            ))}
          </ul>
        </>
      )}
      {adding && (
        <AddPropertyDialog
          onClose={() => setAdding(false)}
          onAdded={(asset) => {
            toast.show({ tone: 'success', title: 'Property added' });
            navigate(withCurrency(`/portfolio/${asset.id}`, asked));
          }}
        />
      )}
    </div>
  );
}
