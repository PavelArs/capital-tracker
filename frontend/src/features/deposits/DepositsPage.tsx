import { cachedReads } from '@api/cached-reads';
import type { Deposit, DepositList } from '@api/deposits.api';
import type { AccountingCurrency, PortfolioValuation } from '@api/portfolio-valuation.api';
import { useToast } from '@contexts/ToastContext';
import { Fragment, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Stat, Stats } from '@/ui/Stats';
import { sumDecimals } from '@/utils/decimal';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { DASH } from '../portfolio/format';
import { Icon } from '../shell/icons';
import { useInflationBasis } from '../shell/inflation-basis';
import { useMainCurrency } from '../shell/main-currency';
import { estimateMark, netWorthUnknown, shareBase } from '../shell/net-worth';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { useValueView } from '../shell/value-view';
import { AddDepositDialog } from './DepositDialogs';
import DepositIcon from './DepositIcon';
import {
  accountsWithoutRate,
  dateText,
  endsSoonText,
  endText,
  interestTermsText,
  money,
  realOf,
  realRateText,
  statusText,
  statusTone,
  toneClass,
} from './deposit-format';
import '../shell/shell-page.css';
import './deposits.css';

function DepositTile({
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
  const [view] = useValueView();
  // One reading at a time; an answer saved before real figures existed stays nominal.
  const showReal = view === 'real' && deposit.real !== undefined;
  const real = realOf(deposit, basis);
  const rate = showReal ? realRateText(real) : null;
  const differs = deposit.lastCheck?.difference ?? null;
  // Missing is not zero: an account whose interest is not counted says so on its row.
  const notes = [
    rate && (
      <span key="rate" className={toneClass(real?.ratePercent ?? null)}>
        {rate}
      </span>
    ),
    // Real with no figure shows a dash and why, as everywhere (an account without a rate says so below).
    showReal &&
      deposit.status === 'active' &&
      deposit.ratePercent !== null &&
      rate === null &&
      'Real rate —, no inflation figures yet',
    endText(deposit),
    // The last bank check found a difference: the one thing a reconciled row does not say.
    differs !== null &&
      Number(differs) !== 0 &&
      `Differs from the bank by ${money(differs, deposit.currency)}`,
    deposit.interestMissing &&
      (deposit.ratePercent === null ? 'Interest not counted' : 'Earlier interest not counted'),
  ].filter(Boolean);
  const endsSoon = endsSoonText(deposit, asOf);
  return (
    <li className="deposit-product">
      <Link className="deposit-product__row" to={withCurrency(`/deposits/${deposit.id}`, asked)}>
        <span className="deposit-product__identity">
          <DepositIcon deposit={deposit} size="sm" />
          <span>
            <strong>{deposit.name}</strong>
            <small>{deposit.kind === 'account' ? 'Savings account' : 'Term deposit'}</small>
          </span>
        </span>
        <span className="deposit-product__terms">
          {interestTermsText(deposit)}
          {notes.length > 0 && (
            <small>
              {notes.map((note, index) => (
                // The notes are fixed by the deposit, so their place is their identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <Fragment key={index}>
                  {index > 0 && ' · '}
                  {note}
                </Fragment>
              ))}
            </small>
          )}
        </span>
        <span className="deposit-product__balance ui-num">
          <span className="ui-sr">Balance </span>
          {money(deposit.balance, deposit.currency)}
          {deposit.nextPayout && (
            <small>
              Next {money(deposit.nextPayout.interest, deposit.currency)} on{' '}
              {dateText(deposit.nextPayout.date)}
            </small>
          )}
        </span>
        <span className="deposit-product__value ui-num">{money(deposit.values[shown], shown)}</span>
        <span className="deposit-product__status">
          <Badge tone={endsSoon ? 'warn' : statusTone[deposit.status]}>
            {endsSoon ?? statusText[deposit.status]}
          </Badge>
        </span>
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
      <Card variant="flush" className="deposit-bank" labelledBy={`${id}-bank`}>
        <div className="deposit-bank__head">
          <span className="deposit-bank__icon">
            <Icon name="bank" />
          </span>
          <div className="deposit-bank__identity">
            <h2 id={`${id}-bank`} className="deposit-bank__name">
              {bank}
            </h2>
            <small>Bank · deposits and savings accounts</small>
          </div>
          <div className="deposit-bank__total">
            <strong className="ui-num">{money(total, shown)}</strong>
            <small>{plural(deposits.length, 'product')}</small>
            {missing > 0 && (
              <span className="deposit-bank__reason">
                Incomplete: {plural(missing, 'deposit')} {missing === 1 ? 'has' : 'have'} no current
                exchange rate to {shown}
              </span>
            )}
          </div>
        </div>
        <ul className="deposit-list">
          {deposits.map((deposit) => (
            <DepositTile key={deposit.id} deposit={deposit} asOf={asOf} shown={shown} />
          ))}
        </ul>
      </Card>
    </li>
  );
}

const shareFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** What is held in banks, its share of the net worth, and the rate the total uses. */
function DepositsSummary({
  titleId,
  list,
  shown,
  portfolio,
}: {
  titleId: string;
  list: DepositList;
  shown: AccountingCurrency;
  portfolio: PortfolioValuation | null;
}) {
  const total = list.totals[shown] ?? null;
  // The net worth in the currency shown, once it has arrived.
  const net = portfolio?.currency === shown ? portfolio : null;
  // Why there is no share of it: unknown, zero or below zero. Missing is not zero.
  const unknown = net && netWorthUnknown(net);
  // Display only: a ratio of two exact totals in the same currency, estimated against the known
  // net worth while it leaves something out (NW-SHARE-ESTIMATE).
  const base = net && shareBase(net);
  const share = total !== null && base ? (Number(total) / base.value) * 100 : null;
  return (
    <Card labelledBy={titleId}>
      <h2 id={titleId} className="ui-sr">
        Total in deposits
      </h2>
      <Stats size="lg">
        <Stat lead label="In banks" value={money(total, shown)} />
        {(share !== null || (total !== null && unknown)) && (
          <Stat
            label="Share of net worth"
            value={
              share === null
                ? DASH
                : `${estimateMark(base?.estimated)}${shareFormat.format(share)}%`
            }
            hint={(share === null ? unknown : base?.estimated) || undefined}
          />
        )}
      </Stats>
      <p className="deposit-total__note">
        At the Bank of Russia rate of {dateText(list.asOf)}. A closed deposit counts only while
        interest it earned is unpaid.
        {list.interestMissingCount ? ` ${accountsWithoutRate(list.interestMissingCount)}` : ''}
      </p>
    </Card>
  );
}

// DEP-LIST: every deposit with what it is worth today and what needs a look, bank by bank.
export default function DepositsPage() {
  const { data: list, error, reload } = useCachedRead(cachedReads.deposits);
  const summaryId = useId();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [asked] = useAskedCurrency();
  const { main } = useMainCurrency();
  const navigate = useNavigate();
  const shown = asked ?? main ?? 'USD';
  const { data: portfolio } = useCachedRead(cachedReads.portfolio, asked ?? undefined);

  return (
    <div className="shell-page">
      <PageHeader title="Banks" valueSwitch />
      <div className="deposit-intro">
        <p>
          Deposits and accounts are entered once with their terms. The app counts the interest and
          what each one is worth; you record top-ups, withdrawals and a balance check now and then.
        </p>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
          Add deposit or account
        </Button>
      </div>
      {error && list === null ? (
        <ErrorState what="your deposits" onRetry={() => reload()} />
      ) : list === null ? (
        <PageSkeleton label="Loading deposits" show={['cards']} />
      ) : list.items.length === 0 ? (
        <EmptyState
          id="deposits-empty"
          title="No deposits yet"
          icon={<Icon name="archive" />}
          actions={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add deposit
            </Button>
          }
        >
          Enter a bank deposit once, with its rate and term. The app counts the interest and what
          the deposit is worth in USD, EUR and RUB.
        </EmptyState>
      ) : (
        <>
          <DepositsSummary
            titleId={`${summaryId}-title`}
            list={list}
            shown={shown}
            portfolio={portfolio}
          />
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
          onSaved={(created) => {
            toast.show({ tone: 'success', title: 'Deposit added' });
            navigate(withCurrency(`/deposits/${created.id}`, asked));
          }}
        />
      )}
    </div>
  );
}
