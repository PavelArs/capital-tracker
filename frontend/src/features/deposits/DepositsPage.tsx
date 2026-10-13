import { cachedReads } from '@api/cached-reads';
import type { Deposit } from '@api/deposits.api';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import EmptyState from '@/ui/EmptyState';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { Icon } from '../shell/icons';
import { useMainCurrency } from '../shell/main-currency';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { AddDepositDialog } from './DepositDialogs';
import { attention, dateText, money, statusText, statusTone, termText } from './deposit-format';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import './deposits.css';

function Card({
  deposit,
  asOf,
  shown,
}: {
  deposit: Deposit;
  asOf: string;
  shown: keyof Deposit['values'];
}) {
  const [asked] = useAskedCurrency();
  const note = attention(deposit, asOf);
  const check = deposit.lastCheck;
  const inOwn = shown === deposit.currency;
  return (
    <li>
      <Link className="deposit-card" to={withCurrency(`/deposits/${deposit.id}`, asked)}>
        <div className="deposit-card__head">
          <div>
            <span className="deposit-card__name">{deposit.name}</span>
            <span className="deposit-card__bank">{deposit.bank}</span>
          </div>
          <Badge tone={statusTone[deposit.status]}>{statusText[deposit.status]}</Badge>
        </div>
        <div className="deposit-card__value">
          <strong>{money(deposit.values[shown], shown)}</strong>
          {!inOwn && <span>{money(deposit.balance, deposit.currency)}</span>}
        </div>
        <p className="deposit-card__terms">{termText(deposit)}</p>
        <dl className="deposit-card__facts">
          {deposit.nextPayout && (
            <div>
              <dt>Next interest</dt>
              <dd>
                {money(deposit.nextPayout.interest, deposit.currency)} on{' '}
                {dateText(deposit.nextPayout.date)}
              </dd>
            </div>
          )}
          {deposit.atMaturity && (
            <div>
              <dt>At the end of the term</dt>
              <dd>{money(deposit.atMaturity.balance, deposit.currency)}</dd>
            </div>
          )}
          {check && (
            <div>
              <dt>Last check</dt>
              <dd>
                {dateText(check.checkedOn)},{' '}
                {Number(check.difference) === 0
                  ? 'matches the bank'
                  : `differs by ${money(check.difference, deposit.currency)}`}
              </dd>
            </div>
          )}
        </dl>
        {note && (
          <p className="deposit-card__attention">
            <Icon name="alert" className="shell-icon shell-icon--sm" />
            {note}
          </p>
        )}
      </Link>
    </li>
  );
}

// DEP-LIST: every deposit with what it is worth today and what needs a look.
export default function DepositsPage() {
  const { data: list, error } = useCachedRead(cachedReads.deposits);
  const [adding, setAdding] = useState(false);
  const [asked] = useAskedCurrency();
  const { main } = useMainCurrency();
  const navigate = useNavigate();
  const shown = asked ?? main ?? 'USD';

  return (
    <div className="shell-page">
      <PageHeader
        title="Deposits"
        actions={
          <button
            type="button"
            className="shell-button shell-button--secondary"
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" className="shell-icon shell-icon--sm" />
            Add deposit
          </button>
        }
      />
      {error && list === null ? (
        <p className="shell-note" role="alert">
          Could not load the deposits. Try again later.
        </p>
      ) : list === null ? (
        <PageSkeleton label="Loading deposits" show={['cards']} />
      ) : list.items.length === 0 ? (
        <EmptyState
          id="deposits-empty"
          title="No deposits yet"
          icon={<Icon name="archive" />}
          actions={
            <button
              type="button"
              className="shell-button shell-button--primary"
              onClick={() => setAdding(true)}
            >
              Add deposit
            </button>
          }
        >
          Enter a bank deposit once, with its rate and term. The app counts the interest and what
          the deposit is worth in USD, EUR and RUB.
        </EmptyState>
      ) : (
        <>
          <section className="shell-card deposit-total" aria-label="Total in deposits">
            <span className="deposit-total__label">In deposits</span>
            <strong className="deposit-total__value">{money(list.totals[shown], shown)}</strong>
            <span className="deposit-total__note">
              At the Bank of Russia rate of {dateText(list.asOf)}. A closed deposit counts only
              while interest it earned is unpaid.
            </span>
          </section>
          <ul className="deposit-list">
            {list.items.map((deposit) => (
              <Card key={deposit.id} deposit={deposit} asOf={list.asOf} shown={shown} />
            ))}
          </ul>
        </>
      )}
      {adding && (
        <AddDepositDialog
          onClose={() => setAdding(false)}
          onSaved={(created) => navigate(withCurrency(`/deposits/${created.id}`, asked))}
        />
      )}
    </div>
  );
}
