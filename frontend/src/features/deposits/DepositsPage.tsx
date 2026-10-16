import { cachedReads } from '@api/cached-reads';
import type { Deposit } from '@api/deposits.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import EmptyState from '@/ui/EmptyState';
import { sumDecimals } from '@/utils/decimal';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { DASH } from '../portfolio/format';
import { Icon } from '../shell/icons';
import { useInflationBasis } from '../shell/inflation-basis';
import { useMainCurrency } from '../shell/main-currency';
import { netWorthUnknown } from '../shell/net-worth';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { AddDepositDialog } from './DepositDialogs';
import {
  attention,
  dateText,
  money,
  realOf,
  realRateText,
  statusText,
  statusTone,
  termText,
  toneClass,
} from './deposit-format';
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
  const [basis] = useInflationBasis();
  const note = attention(deposit, asOf);
  const check = deposit.lastCheck;
  const inOwn = shown === deposit.currency;
  const real = realOf(deposit, basis);
  const rate = realRateText(real);
  return (
    <li>
      <Link className="deposit-card" to={withCurrency(`/deposits/${deposit.id}`, asked)}>
        <div className="deposit-card__head">
          <span className="deposit-card__name">{deposit.name}</span>
          <Badge tone={statusTone[deposit.status]}>{statusText[deposit.status]}</Badge>
        </div>
        <div className="deposit-card__value">
          <strong>{money(deposit.values[shown], shown)}</strong>
          {!inOwn && <span>{money(deposit.balance, deposit.currency)}</span>}
        </div>
        <p className="deposit-card__terms">{termText(deposit)}</p>
        {rate && (
          <p className="deposit-card__terms">
            <span className={toneClass(real?.ratePercent ?? null)}>{rate}</span>
          </p>
        )}
        <dl className="deposit-card__facts">
          {deposit.interestEarned !== undefined && (
            <div>
              <dt>Interest earned</dt>
              <dd>
                {money(deposit.interestEarned, deposit.currency)}
                {real?.gain != null && (
                  <span className={toneClass(real.gain)}>
                    {' '}
                    ({money(real.gain, deposit.currency, true)} after inflation)
                  </span>
                )}
              </dd>
            </div>
          )}
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
                  : `differs by ${money(check.difference, deposit.currency, false, 'exact')}`}
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

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** The deposits that count in a total: a closed one only while interest it earned is unpaid. */
const counted = (deposit: Deposit) => deposit.status !== 'closed' || /[1-9]/.test(deposit.balance);

/** The banks in the order their first deposit is listed, each with its deposits. */
function byBank(deposits: readonly Deposit[]): [string, Deposit[]][] {
  const banks = new Map<string, Deposit[]>();
  for (const deposit of deposits)
    banks.set(deposit.bank, [...(banks.get(deposit.bank) ?? []), deposit]);
  return [...banks];
}

/** One bank: its deposits, how many there are and what they hold together in the currency shown. */
function Bank({
  bank,
  deposits,
  asOf,
  shown,
}: {
  bank: string;
  deposits: Deposit[];
  asOf: string;
  shown: AccountingCurrency;
}) {
  const id = useId();
  const values = deposits.filter(counted).map((deposit) => deposit.values[shown]);
  const known = values.filter((value): value is string => value !== null);
  // Missing is not zero: the total of the rest is shown and said to be incomplete.
  const missing = values.length - known.length;
  // A bank whose deposits are all closed and paid out holds nothing: zero, not unknown.
  const total = values.length === 0 ? '0' : known.length > 0 ? sumDecimals(known) : null;
  return (
    <li>
      <section className="shell-card deposit-bank" aria-labelledby={`${id}-bank`}>
        <div className="deposit-bank__head">
          <div>
            <h2 id={`${id}-bank`} className="deposit-bank__name">
              {bank}
            </h2>
            <span className="deposit-bank__count">{plural(deposits.length, 'deposit')}</span>
          </div>
          <div className="deposit-bank__total">
            <strong>{money(total, shown)}</strong>
            {missing > 0 && (
              <span>
                Incomplete: {plural(missing, 'deposit')} {missing === 1 ? 'has' : 'have'} no current
                exchange rate to {shown}
              </span>
            )}
          </div>
        </div>
        <ul className="deposit-list">
          {deposits.map((deposit) => (
            <Card key={deposit.id} deposit={deposit} asOf={asOf} shown={shown} />
          ))}
        </ul>
      </section>
    </li>
  );
}

const shareFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// DEP-LIST: every deposit with what it is worth today and what needs a look, bank by bank.
export default function DepositsPage() {
  const { data: list, error } = useCachedRead(cachedReads.deposits);
  const [adding, setAdding] = useState(false);
  const [asked] = useAskedCurrency();
  const { main } = useMainCurrency();
  const navigate = useNavigate();
  const shown = asked ?? main ?? 'USD';
  const { data: portfolio } = useCachedRead(cachedReads.portfolio, asked ?? undefined);
  const total = list?.totals[shown] ?? null;
  // The net worth in the currency shown, once it has arrived.
  const net = portfolio?.currency === shown ? portfolio : null;
  // Why there is no share of it: unknown, zero or below zero. Missing is not zero.
  const unknown = net && netWorthUnknown(net);
  // Display only: the share is a ratio of two exact totals in the same currency, both known.
  const share =
    total !== null && net && !unknown ? (Number(total) / Number(net.totalValue)) * 100 : null;

  return (
    <div className="shell-page">
      <PageHeader
        title="Banks"
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
            <div className="deposit-total__figures">
              <div>
                <span className="deposit-total__label">In deposits</span>
                <strong className="deposit-total__value">{money(total, shown)}</strong>
              </div>
              {(share !== null || (total !== null && unknown)) && (
                <div>
                  <span className="deposit-total__label">Share of net worth</span>
                  <strong className="deposit-total__value">
                    {share === null ? DASH : `${shareFormat.format(share)}%`}
                  </strong>
                  {share === null && unknown && (
                    <span className="deposit-total__reason">{unknown}</span>
                  )}
                </div>
              )}
            </div>
            <span className="deposit-total__note">
              At the Bank of Russia rate of {dateText(list.asOf)}. A closed deposit counts only
              while interest it earned is unpaid.
            </span>
          </section>
          <ul className="deposit-banks">
            {byBank(list.items).map(([bank, deposits]) => (
              <Bank key={bank} bank={bank} deposits={deposits} asOf={list.asOf} shown={shown} />
            ))}
          </ul>
        </>
      )}
      {adding && (
        <AddDepositDialog
          banks={list?.items.map((deposit) => deposit.bank)}
          onClose={() => setAdding(false)}
          onSaved={(created) => navigate(withCurrency(`/deposits/${created.id}`, asked))}
        />
      )}
    </div>
  );
}
