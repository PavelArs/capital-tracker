import type { AccountSummary } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { AssetValuation, PortfolioValuation } from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import PageIntro from '@/ui/PageIntro';
import { Stat, Stats } from '@/ui/Stats';
import { dayText } from '@/utils/dates';
import { sumDecimals } from '@/utils/decimal';
import { securityLabels } from '../portfolio/asset-parts';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { money, price, priceNote, quantity, quoted } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { heldClass } from '../shell/asset-identity';
import { Icon } from '../shell/icons';
import { estimateMark, netWorthUnknown, shareBase } from '../shell/net-worth';
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
import ImportHistoryDialog from './ImportHistoryDialog';
import '../shell/shell-page.css';
import './broker.css';

/**
 * Where a position's price comes from: the day a price typed by hand is for, or the broker's price
 * and its age (BPR-3). Cash needs no price; a price without a rate to the shown currency says so.
 */
function priceText(asset: AssetValuation, now: Date): string | null {
  if (asset.missingPrice === 'no-rate') return 'No rate';
  if (asset.assetType === 'fiat') return null;
  const current = asset.price;
  if (!current) return 'No price yet';
  if (current.status === 'manual')
    return current.observedAt ? `Price set for ${dayText(current.observedAt)}` : null;
  if (quoted(asset)) return priceNote(asset, now);
  return current.observedAt ? `Price of ${dayText(current.observedAt)}` : null;
}

/** "SBER · Share": the ticker unless it is the name, and the security type a T-Bank link names. */
function caption(asset: AssetValuation): string | null {
  const parts = [
    asset.symbol && asset.symbol !== asset.name.toUpperCase() ? asset.symbol : null,
    asset.securityType ? securityLabels[asset.securityType] : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * BROKERS-ROW (prototype v8 Brokers): a position's name, quantity × price, where its price comes
 * from, its value and, for a price typed by hand, a "Manual price" badge, in columns.
 */
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
  const sub = cash ? null : caption(asset);
  const note = priceText(asset, new Date());
  return (
    <li>
      <Link className="broker-row" to={withCurrency(`/portfolio/${asset.instrumentId}`, asked)}>
        <span className="broker-row__asset">
          <AssetIcon
            symbol={asset.symbol}
            name={asset.name}
            assetType={asset.assetType}
            assetClass={heldClass(asset.holdings, classes)}
            size="sm"
          />
          <span>
            <strong>{cash ? `Cash, ${asset.symbol ?? asset.name}` : asset.name}</strong>
            {sub && <small>{sub}</small>}
          </span>
        </span>
        <span className="broker-row__amount">
          {cash
            ? quantity(position.quantity)
            : `${quantity(position.quantity)} × ${price(asset.price?.value ?? null, currency)}`}
        </span>
        {note && <span className="broker-row__price">{note}</span>}
        <span className="broker-row__value ui-num">{money(position.value, currency)}</span>
        {!cash && asset.price?.status === 'manual' && (
          <Badge className="broker-row__badge">Manual price</Badge>
        )}
      </Link>
    </li>
  );
}

/** A connected account whose history to import: the Import history dialog. */
type Importing = { accountId: string; name: string };

function Account({
  account,
  broker,
  portfolio,
  onImport,
}: {
  account: BrokerAccount;
  /** The broker card it is shown in. */
  broker: BrokerGroup;
  portfolio: PortfolioValuation;
  onImport: (account: Importing) => void;
}) {
  const label = accountLabel(account, broker.key);
  const missing = leftOut(account.unpriced, account.unrated);
  // The broker's only account under the broker's own name: the card's head already shows its name,
  // total and what that leaves out, so its positions follow the head as in the prototype.
  const plain = broker.accounts.length === 1 && label === broker.name;
  return (
    <div
      className={plain ? 'broker-group broker-group--plain' : 'broker-group'}
      role="group"
      aria-label={label}
      data-account={account.id}
      tabIndex={-1}
    >
      {!plain && (
        <div className="broker-group__head">
          <b>{label}</b>
          <span className="broker-group__total" data-testid="account-total">
            {account.valued ? money(account.value, portfolio.currency) : '—'}
            {missing && <small>{missing}</small>}
          </span>
        </div>
      )}
      {account.pending && (
        <Banner
          tone="info"
          icon="clock"
          role="none"
          action={
            <Button
              size="sm"
              onClick={() => onImport({ accountId: account.id, name: account.name })}
            >
              Import history
            </Button>
          }
        >
          {account.positions.length
            ? 'Connected. The T-Bank history is not imported yet.'
            : 'Connected. Positions and cash arrive with the history import.'}
        </Banner>
      )}
      {account.positions.length ? (
        <ul className="broker-rows">
          {account.positions.map((position) => (
            <Position key={position.asset.instrumentId} position={position} portfolio={portfolio} />
          ))}
        </ul>
      ) : (
        !account.pending && <p className="broker-account__empty">Holds nothing yet.</p>
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
function Broker({
  group,
  portfolio,
  onImport,
}: {
  group: BrokerGroup;
  portfolio: PortfolioValuation;
  onImport: (account: Importing) => void;
}) {
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
          <Account
            key={account.id}
            account={account}
            broker={group}
            portfolio={portfolio}
            onImport={onImport}
          />
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
  const [importing, setImporting] = useState<Importing | null>(null);
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
  const estimated = portfolio && shareBase(portfolio)?.estimated;
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
          Connect T-Bank with a read-only token, or add an account at another broker with the
          stocks, bonds and funds it holds and its cash, at the prices you see there.
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
            T-Bank accounts read with a read-only token. At another broker, positions are entered by
            hand with the price you see there; update a price on the position's page.
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
                    : `${estimateMark(estimated)}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(share.percent)}%`
                }
                hint={(share === null ? unknown : estimated) || undefined}
              />
            </Stats>
            {missing && <p className="ui-sub broker-summary__note">{missing}</p>}
          </Card>
          <ul className="broker-accounts" ref={list}>
            {groups.map((group) => (
              <Broker key={group.key} group={group} portfolio={portfolio} onImport={setImporting} />
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
          onImport={setImporting}
        />
      )}
      {importing && (
        <ImportHistoryDialog
          accountId={importing.accountId}
          name={importing.name}
          onClose={() => setImporting(null)}
          onImported={() => {
            setImporting(null);
            setFocus(importing.accountId);
            load(true);
          }}
        />
      )}
    </div>
  );
}
