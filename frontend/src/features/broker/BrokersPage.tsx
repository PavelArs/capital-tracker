import type { AccountSummary } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
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
import AddBrokerDialog from './AddBrokerDialog';
import {
  type BrokerAccount,
  type BrokerPosition,
  brokerAccountsOf,
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
  const securities = account.positions.filter(({ asset }) => asset.assetType !== 'fiat').length;
  const missing = leftOut(account.unpriced, account.unrated);
  return (
    <Card as="li" variant="flush" className="broker-account">
      <section aria-label={account.name}>
        <div className="broker-account__head">
          <span className="broker-account__icon" aria-hidden="true">
            <Icon name="briefcase" />
          </span>
          <div className="broker-account__title">
            <b>{account.name}</b>
            <small>{plural(securities, 'position')}</small>
          </div>
          <div className="broker-account__total">
            <b>{money(account.value, portfolio.currency)}</b>
            {missing && <small>{missing}</small>}
          </div>
        </div>
        {account.positions.length ? (
          <ul className="ui-rows">
            {account.positions.map((position) => (
              <Position
                key={position.asset.instrumentId}
                position={position}
                portfolio={portfolio}
              />
            ))}
          </ul>
        ) : (
          <p className="broker-account__empty">Holds nothing yet.</p>
        )}
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
  const toast = useToast();

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
  const total = sumDecimals(brokers?.map((account) => account.value) ?? []);
  const unpriced = brokers?.reduce((sum, account) => sum + account.unpriced, 0) ?? 0;
  const unrated = brokers?.reduce((sum, account) => sum + account.unrated, 0) ?? 0;
  const share = portfolio && brokerShare(total, portfolio);
  const unknown = portfolio && netWorthUnknown(portfolio);
  const missing = leftOut(unpriced, unrated);
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
              <Stat lead label="At brokers" value={money(total, portfolio.currency)} />
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
          <ul className="broker-accounts">
            {brokers.map((account) => (
              <Account key={account.id} account={account} portfolio={portfolio} />
            ))}
          </ul>
        </>
      )}
      {adding && (
        <AddBrokerDialog
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false);
            load(true);
            if (name) toast.show({ tone: 'success', title: `${name} added` });
          }}
        />
      )}
    </div>
  );
}
