import type { AccountSummary } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { ListRowText, rowClass } from '@/ui/ListRow';
import PageIntro from '@/ui/PageIntro';
import { Stat, Stats } from '@/ui/Stats';
import { dayText } from '@/utils/dates';
import { sumDecimals } from '@/utils/decimal';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { money, price, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { heldClass } from '../shell/asset-identity';
import { Icon } from '../shell/icons';
import { netWorthUnknown } from '../shell/net-worth';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useAccountClasses } from '../shell/useAccountClasses';
import AddBrokerAccountDialog from './AddBrokerAccountDialog';
import {
  accountLabel,
  type BrokerAccount,
  type BrokerGroup,
  type BrokerPosition,
  brokerAccountsOf,
  brokerGaps,
  brokerGroupsOf,
  brokerShare,
  leftOut,
  plural,
} from './brokers';
import '../shell/shell-page.css';
import './broker.css';

function Position({
  position,
  portfolio,
}: {
  position: BrokerPosition;
  portfolio: PortfolioValuation;
}) {
  const [asked] = useAskedCurrency();
  const classes = useAccountClasses();
  const { asset } = position;
  const currency = portfolio.currency;
  const cash = asset.assetType === 'fiat';
  const priced = asset.price?.observedAt ? `Price of ${dayText(asset.price.observedAt)}` : null;
  return (
    <li>
      <Link className={rowClass()} to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}>
        <AssetIcon
          symbol={asset.symbol}
          name={asset.name}
          assetType={asset.assetType}
          assetClass={heldClass(asset.holdings, classes)}
          size="sm"
        />
        <ListRowText
          title={cash ? `Cash, ${asset.symbol ?? asset.name}` : asset.name}
          detail={
            cash
              ? quantity(position.quantity)
              : `${asset.symbol && asset.symbol !== asset.name.toUpperCase() ? `${asset.symbol} · ` : ''}${quantity(position.quantity)} × ${price(asset.price?.value ?? null, currency)}`
          }
          amount={money(position.value, currency)}
          value={
            asset.missingPrice === 'no-rate'
              ? 'No rate'
              : cash
                ? undefined
                : (priced ?? 'No price yet')
          }
        />
      </Link>
    </li>
  );
}

function Account({
  account,
  portfolio,
}: {
  account: BrokerAccount;
  portfolio: PortfolioValuation;
}) {
  const label = accountLabel(account);
  const missing = leftOut(account.unpriced, account.unrated);
  return (
    <div
      className="broker-group"
      role="group"
      aria-label={label}
      data-account={account.id}
      tabIndex={-1}
    >
      <div className="broker-group__head">
        <b>{label}</b>
        <span className="broker-group__total" data-testid="account-total">
          {account.valued ? money(account.value, portfolio.currency) : '—'}
          {missing && <small>{missing}</small>}
        </span>
      </div>
      {account.pending ? (
        <Banner tone="info" icon="clock" role="none">
          Connected. Positions and cash arrive with the history import, which runs in the
          background.
        </Banner>
      ) : account.positions.length ? (
        <ul className="ui-rows">
          {account.positions.map((position) => (
            <Position key={position.asset.instrumentId} position={position} portfolio={portfolio} />
          ))}
        </ul>
      ) : (
        <p className="broker-account__empty">Holds nothing yet.</p>
      )}
    </div>
  );
}

const via = (group: BrokerGroup) =>
  group.connected === 0
    ? 'tracked manually'
    : group.connected === group.accounts.length
      ? 'synced via token'
      : `${group.connected} synced via token`;

// BROKERS-GROUP: one card per broker; its total leaves out what has no value and says so.
function Broker({ group, portfolio }: { group: BrokerGroup; portfolio: PortfolioValuation }) {
  const waiting = !group.valued && group.pending === group.accounts.length;
  const missing = waiting ? null : brokerGaps(group.unpriced, group.unrated, group.pending);
  return (
    <Card as="li" variant="flush" className="broker-account">
      <section aria-label={group.name}>
        <div className="broker-account__head">
          <span className="broker-account__icon" aria-hidden="true">
            <Icon name="briefcase" />
          </span>
          <div className="broker-account__title">
            <b>{group.name}</b>
            <small>{`${plural(group.accounts.length, 'account')} · ${via(group)}`}</small>
          </div>
          <div className="broker-account__total" data-testid="broker-total">
            <b>{group.valued ? money(group.value, portfolio.currency) : '—'}</b>
            {waiting && <small>Waiting for the history import</small>}
            {missing && <small>{missing}</small>}
          </div>
        </div>
        {group.accounts.map((account) => (
          <Account key={account.id} account={account} portfolio={portfolio} />
        ))}
      </section>
    </Card>
  );
}

// Brokers (v8): each broker account with its stocks, bonds and funds at the prices the owner
// entered, and its cash. A position's page updates its price.
export default function BrokersPage() {
  const [asked] = useAskedCurrency();
  const [portfolio, setPortfolio] = useState(() => cachedReads.portfolio.last(asked) ?? null);
  const [accounts, setAccounts] = useState<readonly AccountSummary[] | null>(
    () => cachedReads.accounts.last() ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const latest = useRef(0);
  const location = useLocation();
  // A newly added account, brought into view once it is drawn.
  const [focus, setFocus] = useState<string | null>(
    () => (location.state as { focusAccount?: string } | null)?.focusAccount ?? null,
  );
  const list = useRef<HTMLUListElement>(null);

  // Only the newest request may change the page; a refresh keeps what is shown and says so
  // when it fails, as Real estate does.
  const load = useCallback(
    (quiet = false) => {
      const request = ++latest.current;
      setFailed(false);
      if (!quiet) setPortfolio(cachedReads.portfolio.last(asked) ?? null);
      Promise.all([cachedReads.portfolio.load(asked), cachedReads.accounts.load()]).then(
        ([nextPortfolio, nextAccounts]) => {
          if (request !== latest.current) return;
          setPortfolio(nextPortfolio);
          setAccounts(nextAccounts);
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

  const brokers = portfolio && accounts ? brokerAccountsOf(portfolio, accounts) : null;
  const groups = brokerGroupsOf(brokers ?? []);
  const valued = groups.filter((group) => group.valued);
  const total = sumDecimals(valued.map((group) => group.value));
  const sum = (part: 'unpriced' | 'unrated' | 'pending') =>
    groups.reduce((count, group) => count + group[part], 0);
  // Nothing valued yet is "—", never zero, and no share is worked out from it.
  const share = portfolio && valued.length > 0 ? brokerShare(total, portfolio) : null;
  const unknown = portfolio && netWorthUnknown(portfolio);
  const missing = brokerGaps(sum('unpriced'), sum('unrated'), sum('pending'));

  useEffect(() => {
    if (!focus) return;
    const target = list.current?.querySelector<HTMLElement>(`[data-account="${focus}"]`);
    if (!target) return;
    target.focus();
    setFocus(null);
  });
  // The page's main action, primary as on every list page (PageIntro).
  const addButton = (
    <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
      Add broker account
    </Button>
  );

  return (
    <div className="shell-page">
      <PageHeader title="Brokers" currency={portfolio?.currency} />
      {failed && !brokers ? (
        <ErrorState what="your broker accounts" onRetry={() => load()} />
      ) : brokers === null || portfolio === null ? (
        <PageSkeleton label="Loading broker accounts" show={['cards']} />
      ) : brokers.length === 0 ? (
        <EmptyState
          id="brokers-empty"
          title="No broker account yet"
          icon={<Icon name="briefcase" />}
          actions={addButton}
        >
          Add a broker account with the stocks, bonds and funds it holds and its cash. Prices are
          entered by hand for now, with the price you see at your broker.
        </EmptyState>
      ) : (
        <>
          {failed && (
            <Banner
              tone="warn"
              role="alert"
              action={
                <Button size="sm" onClick={() => load(true)}>
                  Try again
                </Button>
              }
            >
              Could not refresh your broker accounts; showing the last loaded figures.
            </Banner>
          )}
          <PageIntro action={addButton}>
            Positions are entered by hand for now, with the price you see at your broker. Update a
            price on the position's page.
          </PageIntro>
          <Card labelledBy="broker-summary-title">
            <h2 id="broker-summary-title" className="ui-sr">
              Total at brokers
            </h2>
            <Stats size="lg">
              <Stat
                lead
                label="At brokers"
                value={valued.length > 0 ? money(total, portfolio.currency) : '—'}
                hint={`${plural(groups.length, 'broker')} · ${plural(brokers.length, 'account')}`}
              />
              <Stat
                label="Share of net worth"
                value={
                  share === null
                    ? '—'
                    : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(share)}%`
                }
                hint={share === null && unknown ? unknown : undefined}
              />
            </Stats>
            {missing && <p className="ui-sub broker-summary__note">{missing}</p>}
          </Card>
          <ul className="broker-accounts" ref={list}>
            {groups.map((group) => (
              <Broker key={group.key} group={group} portfolio={portfolio} />
            ))}
          </ul>
        </>
      )}
      {adding && (
        <AddBrokerAccountDialog
          onClose={() => setAdding(false)}
          onAdded={(account) => {
            setAdding(false);
            setFocus(account ?? null);
            load(true);
          }}
        />
      )}
    </div>
  );
}
