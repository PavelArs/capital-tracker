import type { AccountClass } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { PriceBook } from '@api/manual-prices.api';
import type { AccountingCurrency, PortfolioValuation } from '@api/portfolio-valuation.api';
import type { PropertyDetails } from '@api/property-details.api';
import { type ReactNode, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Banner } from '@/ui/Banner';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import { ListRowText, rowClass } from '@/ui/ListRow';
import { Crumb, PageHead } from '@/ui/PageHead';
import { Stat, Stats } from '@/ui/Stats';
import { dayText, moscowDate } from '@/utils/dates';
import { ValueChart } from '../portfolio/AssetPage';
import { Signed } from '../portfolio/asset-parts';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { DASH, money, price } from '../portfolio/format';
import UpdatePriceDialog from '../portfolio/UpdatePriceDialog';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { InlineSkeleton, PageSkeleton } from '../shell/Skeleton';
import { type CachedRead, useCachedRead } from '../shell/useCachedRead';
import { assetKey } from '../transactions/operation-format';
import PropertyDetailsDialog from './PropertyDetailsDialog';
import {
  estimateOverdue,
  firstBought,
  type Property,
  propertiesOf,
  shareText,
} from './real-estate';
import '../shell/shell-page.css';
import './property.css';

/** The Moscow day of an instant, written as the rest of the app writes dates. */
const day = (at: string) => dayText(moscowDate(at));

/** What the figures say about the rent: not made, not read yet, or not readable. */
type Recorded = PropertyDetails | null | undefined | 'loading';

/** The record of one property: none made, not read yet, or not readable. */
function recordOf(recorded: CachedRead<PropertyDetails[]>, instrumentId: string): Recorded {
  if (recorded.data)
    return recorded.data.find((item) => item.instrumentId === instrumentId) ?? null;
  return recorded.error ? undefined : 'loading';
}

/** A read that failed with nothing kept to show. */
const neverRead = (read: Pick<CachedRead<unknown>, 'data' | 'error'>) => !!read.error && !read.data;

function rentFigure(recorded: Recorded) {
  if (recorded === 'loading') return { value: DASH, hint: 'Loading' };
  if (recorded === undefined) return { value: DASH, hint: 'Could not be read' };
  if (recorded?.monthlyRent == null)
    return { value: 'Not recorded', hint: 'Add it under Rent and notes' };
  return {
    value: (
      <>
        {money(recorded.monthlyRent, recorded.currency, false, 'exact')}
        <span className="ui-sub"> /mo</span>
      </>
    ),
    hint: 'Entered by you, not part of the value',
  };
}

// PROPERTY-PAGE (prototype v3): one property's own page. The owner's estimate with what was paid
// and the gain, the rent, the estimate's value over time, the estimates entered, and the rent
// and notes the owner keeps. An estimate older than two months is called out.
export default function PropertyPage() {
  const { assetId } = useParams();
  const [asked] = useAskedCurrency();
  const portfolio = useCachedRead(cachedReads.portfolio, asked);
  const accounts = useCachedRead(cachedReads.accounts);
  const [pricing, setPricing] = useState(false);
  const [editing, setEditing] = useState(false);

  const back = withCurrency('/real-estate', asked);
  const classes = Object.fromEntries(
    (accounts.data ?? []).map((account) => [account.id, account.assetClass ?? null]),
  );
  const failed = neverRead(portfolio) || neverRead(accounts);
  const loaded = portfolio.data && accounts.data;
  const property = loaded
    ? propertiesOf(portfolio.data as NonNullable<typeof portfolio.data>, classes).find(
        (item) => item.asset.instrumentId === assetId,
      )
    : undefined;
  const asset = portfolio.data?.assets.find((item) => item.instrumentId === assetId);

  let body = null;
  if (failed) {
    body = (
      <ErrorState
        what="this property"
        onRetry={() => {
          portfolio.reload();
          accounts.reload();
        }}
      />
    );
  } else if (!loaded) {
    body = <PageSkeleton label="Loading property" show={['stats', 'chart', 'rows']} />;
  } else if (!property && asset) {
    // Held somewhere else than in a property account: the generic page shows it.
    return <Navigate replace to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)} />;
  } else if (!property || !portfolio.data) {
    body = (
      <EmptyState id="property-missing" title="Property not found">
        It may belong to another owner or the link is wrong.
      </EmptyState>
    );
  } else {
    body = (
      <PropertyDetailsView
        property={property}
        portfolio={portfolio.data}
        asked={asked}
        classes={classes}
        pricing={pricing}
        editing={editing}
        setPricing={setPricing}
        setEditing={setEditing}
        onPriceSaved={() => {
          setPricing(false);
          portfolio.reload(true);
        }}
      />
    );
  }

  // A cached answer that could not be refreshed stays on screen, so it says it may be old.
  const refreshFailed = !failed && loaded && (portfolio.stale || accounts.stale);
  return (
    <div className="shell-page">
      <PageHeader title="Real estate" currency={portfolio.data?.currency} />
      <Crumb to={back}>Real estate</Crumb>
      {refreshFailed && (
        <Banner
          tone="warn"
          role="alert"
          action={
            <Button
              size="sm"
              icon="refresh"
              onClick={() => {
                portfolio.reload(true);
                accounts.reload(true);
              }}
            >
              Refresh
            </Button>
          }
        >
          Could not refresh the values; showing the last loaded ones.
        </Banner>
      )}
      {body}
    </div>
  );
}

/** When the estimate was set, and what the whole property is worth when only a share is held. */
function estimateHint(property: Property, currency: AccountingCurrency): string {
  const estimated = property.asset.price?.observedAt ?? null;
  if (!estimated) return 'No estimate yet';
  const whole =
    property.share < 100
      ? ` · whole property ${price(property.asset.price?.value ?? null, currency)}`
      : '';
  return `Set ${day(estimated)}${whole}`;
}

/** A refresh that failed: of the estimates, or of the purchases and chart. */
function StaleBanner({ estimates, onRefresh }: { estimates: boolean; onRefresh: () => void }) {
  return (
    <Banner
      tone="warn"
      role="alert"
      action={
        <Button size="sm" icon="refresh" onClick={onRefresh}>
          Refresh
        </Button>
      }
    >
      {estimates
        ? 'Could not refresh the estimates; showing the last loaded ones.'
        : 'Could not refresh the purchases and chart; showing the last loaded ones.'}
    </Banner>
  );
}

/** The estimates entered, newest first, or why they are not shown yet. */
function EstimatesCard({ prices }: { prices: CachedRead<PriceBook> }) {
  return (
    <Card labelledBy="property-estimates">
      <CardHeader
        id="property-estimates"
        title="Estimates"
        sub={prices.data ? prices.data.items.length : undefined}
      />
      {prices.error && !prices.data ? (
        <Banner
          tone="neg"
          action={
            <Button size="sm" icon="refresh" onClick={() => prices.reload()}>
              Try again
            </Button>
          }
        >
          Could not load the estimates.
        </Banner>
      ) : !prices.data ? (
        <InlineSkeleton label="Loading estimates" />
      ) : (
        <ul className="ui-rows">
          {prices.data.items.map((item) => (
            <li key={item.revision} className={`${rowClass()} property-estimate-row`}>
              <ListRowText
                title={day(item.observedAt)}
                detail="Your estimate"
                amount={money(item.price, item.quoteCurrency, false, 'exact')}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The rent as the record says it, or why it is not shown. */
function rentLine(mine: Recorded, rent: ReactNode): ReactNode {
  if (mine === undefined) return 'Could not be read';
  if (mine === 'loading' || mine === null || mine.monthlyRent === null) return rent;
  return `${money(mine.monthlyRent, mine.currency, false, 'exact')} a month`;
}

/** The note as the record says it, or why there is none. */
function noteLine(mine: Recorded): ReactNode {
  if (mine === undefined) return 'Could not be read';
  if (mine && mine !== 'loading' && mine.note)
    return <span className="property-note">{mine.note}</span>;
  return 'None';
}

/** The rent and notes the owner keeps, editable once the stored record has been read. */
function NotesCard({
  mine,
  rent,
  stale,
  onEdit,
  onRefresh,
}: {
  mine: Recorded;
  rent: ReactNode;
  stale: boolean;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  return (
    <Card labelledBy="property-notes">
      <CardHeader
        id="property-notes"
        title="Rent and notes"
        actions={
          // Saving replaces the whole record, so what is stored must have been read first.
          <Button
            size="sm"
            icon="edit"
            disabled={mine === 'loading' || mine === undefined || stale}
            onClick={onEdit}
          >
            Edit
          </Button>
        }
      />
      {(stale || mine === undefined) && (
        <Banner
          tone="warn"
          role="alert"
          action={
            <Button size="sm" icon="refresh" onClick={onRefresh}>
              Refresh
            </Button>
          }
        >
          {mine === undefined
            ? 'Could not read the rent and notes.'
            : 'Could not refresh the rent and notes; showing the last loaded ones.'}
        </Banner>
      )}
      <KeyValue>
        <KeyValueRow term="Rent">{rentLine(mine, rent)}</KeyValueRow>
        <KeyValueRow term="Notes">{noteLine(mine)}</KeyValueRow>
      </KeyValue>
      <p className="ui-sub">A mortgage or other debt is not subtracted from the value.</p>
    </Card>
  );
}

function PropertyDetailsView({
  property,
  portfolio,
  asked,
  classes,
  pricing,
  editing,
  setPricing,
  setEditing,
  onPriceSaved,
}: {
  property: ReturnType<typeof propertiesOf>[number];
  portfolio: PortfolioValuation;
  asked: AccountingCurrency | undefined;
  classes: Readonly<Record<string, AccountClass | null>>;
  pricing: boolean;
  editing: boolean;
  setPricing: (open: boolean) => void;
  setEditing: (open: boolean) => void;
  onPriceSaved: () => void;
}) {
  const { asset, share } = property;
  const currency = portfolio.currency;
  const instrumentId = asset.instrumentId;
  const estimated = asset.price?.observedAt ?? null;
  const overdue = estimated !== null && estimateOverdue(estimated, new Date());
  const lots = useCachedRead(cachedReads.assetLots, instrumentId, asked);
  const bought = firstBought(lots.data, classes);
  const prices = useCachedRead(cachedReads.manualPrices, instrumentId);
  const operations = useCachedRead(cachedReads.operations, asked);
  const recorded = useCachedRead(cachedReads.propertyDetails);
  const mine = recordOf(recorded, instrumentId);
  const rent = rentFigure(mine);
  const heldElsewhere = asset.holdings.some((holding) => classes[holding.accountId] !== 'property');
  const estimateButton = (
    <Button icon="edit" onClick={() => setPricing(true)}>
      Update estimate
    </Button>
  );
  return (
    <>
      <PageHead
        icon={<Icon name="home" />}
        title={asset.name}
        subtitle={`Real estate · ${shareText(share)}`}
        actions={estimateButton}
      />
      {overdue && estimated && (
        <Banner
          tone="warn"
          icon="clock"
          action={
            <Button size="sm" onClick={() => setPricing(true)}>
              Update estimate
            </Button>
          }
        >
          {`The estimate is from ${day(estimated)}, over two months ago. Prices in your area may have moved.`}
        </Banner>
      )}
      {(prices.stale || lots.stale || operations.stale) && (
        <StaleBanner
          estimates={prices.stale}
          onRefresh={() => {
            prices.reload(true);
            lots.reload(true);
            operations.reload(true);
          }}
        />
      )}
      <Card label="Property figures">
        <Stats>
          <Stat
            label="Your estimate"
            value={money(property.value, currency)}
            hint={estimateHint(property, currency)}
          />
          <Stat
            label="Purchase price"
            value={money(property.costBasis, currency)}
            hint={bought ? dayText(bought) : undefined}
          />
          <Stat
            label="Gain"
            value={
              <Signed
                value={property.unrealizedPnl}
                currency={currency}
                ratio={property.unrealizedReturnPercent}
              />
            }
            hint="Estimate minus purchase"
          />
          <Stat label="Rent" value={rent.value} hint={rent.hint} />
        </Stats>
      </Card>
      {heldElsewhere ? (
        <Card label="Value over time">
          <p className="ui-sub">
            The chart covers every account that holds this property, so it is not shown while part
            of it is held outside property accounts.
          </p>
        </Card>
      ) : (
        <ValueChart
          asset={asset}
          currency={currency}
          asked={asked}
          operations={operations.data ?? (operations.error ? 'failed' : 'loading')}
          names={{ value: 'Estimated value', cost: 'Money put in' }}
        />
      )}
      <EstimatesCard prices={prices} />
      <NotesCard
        mine={mine}
        rent={rent.value}
        stale={recorded.stale}
        onEdit={() => setEditing(true)}
        onRefresh={() => recorded.reload(true)}
      />
      <ButtonLink
        to={`/transactions?asset=${encodeURIComponent(assetKey({ instrumentId, symbol: asset.symbol, name: asset.name }))}`}
        size="sm"
      >
        Open in Transactions
      </ButtonLink>
      {pricing && (
        <UpdatePriceDialog
          estimate
          instrumentId={instrumentId}
          name={asset.name}
          currency={asset.valuationCurrency}
          onClose={() => setPricing(false)}
          onSaved={() => {
            prices.reload(true);
            onPriceSaved();
          }}
        />
      )}
      {editing && (
        <PropertyDetailsDialog
          instrumentId={instrumentId}
          currency={asset.valuationCurrency}
          details={mine && mine !== 'loading' ? mine : null}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            recorded.reload(true);
          }}
        />
      )}
    </>
  );
}
