import type { AccountClass } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import type { PropertyDetails } from '@api/property-details.api';
import { useToast } from '@contexts/ToastContext';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import PageIntro from '@/ui/PageIntro';
import { Stat, Stats } from '@/ui/Stats';
import { dayText, moscowDate } from '@/utils/dates';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { money, percent, price, tone } from '../portfolio/format';
import { Icon } from '../shell/icons';
import { estimateMark, netWorthUnknown, shareBase } from '../shell/net-worth';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import AddPropertyDialog from './AddPropertyDialog';
import {
  estimateOverdue,
  firstBought,
  type Property,
  propertiesOf,
  propertyShare,
  propertyTotal,
  shareText,
} from './real-estate';
import '../shell/shell-page.css';
import './property.css';

/** The Moscow day of an instant, written as the rest of the app writes dates. */
const day = (at: string) => dayText(moscowDate(at));

const classesOf = (accounts: readonly { id: string; assetClass?: AccountClass | null }[]) =>
  Object.fromEntries(accounts.map((account) => [account.id, account.assetClass ?? null]));

/** What the owner's rent record says on a card; its absence and an unread record differ. */
function rentText(details: PropertyDetails | null | undefined | 'loading'): {
  title: string;
  hint: string;
} {
  if (details === 'loading') return { title: 'Rent', hint: 'Loading' };
  if (details === undefined) return { title: 'Rent unavailable', hint: 'Could not be read' };
  if (details?.monthlyRent == null)
    return { title: 'Rent not recorded', hint: 'Add it on the page' };
  return {
    title: `Rent ${money(details.monthlyRent, details.currency, false, 'exact')} a month`,
    hint: 'Entered by you',
  };
}

// PROPERTY-CARD (prototype v3): a card like those of Banks and Brokers. Its header names the
// property and the owner's share, with their value and what it is; one row under it holds what
// was paid, the rent, the gain and how old the estimate is.
function PropertyTile({
  property,
  portfolio,
  classes,
  details,
}: {
  property: Property;
  portfolio: PortfolioValuation;
  classes: Readonly<Record<string, AccountClass | null>>;
  /** The record of this property; null when none was made, undefined when it could not be read. */
  details: PropertyDetails | null | undefined | 'loading';
}) {
  const [asked] = useAskedCurrency();
  const { asset, share } = property;
  const currency = portfolio.currency;
  const estimated = asset.price?.observedAt ?? null;
  const overdue = estimated !== null && estimateOverdue(estimated, new Date());
  const bought = firstBought(
    useCachedRead(cachedReads.assetLots, asset.instrumentId, asked).data,
    classes,
  );
  const direction = tone(property.unrealizedPnl);
  const rent = rentText(details);
  return (
    <li>
      <Link
        className="property-card__link"
        to={withCurrency(`/real-estate/${asset.instrumentId}`, asked)}
      >
        <Card as="div" variant="flush" className="property-card">
          <div className="property-card__head">
            <span className="property-card__icon" aria-hidden="true">
              <Icon name="home" />
            </span>
            <div className="property-card__title">
              <b>{asset.name}</b>
              <small>Real estate · {shareText(share)}</small>
            </div>
            <div className="property-card__total">
              <b className="ui-num">{money(property.value, currency)}</b>
              <small>Your estimate</small>
            </div>
          </div>
          <div className="property-card__row">
            {bought ? (
              <span className="property-card__cell">
                Bought {dayText(bought)}
                <small>for {money(property.costBasis, currency)}</small>
              </span>
            ) : (
              <span className="property-card__cell">
                Paid {money(property.costBasis, currency)}
              </span>
            )}
            <span className="property-card__cell">
              {rent.title}
              <small>{rent.hint}</small>
            </span>
            {share < 100 && (
              <span className="property-card__cell">
                Whole property
                <small className="ui-num">{price(asset.price?.value ?? null, currency)}</small>
              </span>
            )}
            <span className="property-card__cell">
              Gain
              <small className={direction ? `ui-${direction}` : undefined}>
                {money(property.unrealizedPnl, currency, true)}
                {property.unrealizedReturnPercent !== null && (
                  <> {percent(property.unrealizedReturnPercent)}</>
                )}
              </small>
            </span>
            <span className="property-card__estimate">
              <Badge tone={overdue ? 'warn' : 'neutral'} dot={overdue}>
                {estimated ? `Estimate ${day(estimated)}` : 'No estimate'}
                {overdue && <span className="ui-sr">, over two months old</span>}
              </Badge>
            </span>
          </div>
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
  const recorded = useCachedRead(cachedReads.propertyDetails);
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
  // The rent and note of each property: not made, not read yet, or not readable.
  const detailsOf = (instrumentId: string) =>
    recorded.data
      ? (recorded.data.find((item) => item.instrumentId === instrumentId) ?? null)
      : recorded.error
        ? undefined
        : 'loading';
  // PROPERTY-SHARE: what is held in real estate against the whole net worth, as Banks and Brokers.
  const share = portfolio && total !== null ? propertyShare(total, portfolio) : null;
  const unknown = portfolio && netWorthUnknown(portfolio);
  const estimated = portfolio && shareBase(portfolio)?.estimated;
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
            The value is your own estimate. Buying counts as money put in; a new estimate counts as
            market movement. The app reminds you when an estimate is older than two months.
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
              <Stat
                label="Share of net worth"
                value={
                  share === null
                    ? '—'
                    : `${estimateMark(estimated)}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(share.percent)}%`
                }
                hint={(share === null ? unknown : estimated) || undefined}
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
                details={detailsOf(property.asset.instrumentId)}
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
            navigate(withCurrency(`/real-estate/${asset.id}`, asked));
          }}
        />
      )}
    </div>
  );
}
