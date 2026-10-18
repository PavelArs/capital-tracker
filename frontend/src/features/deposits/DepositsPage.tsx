import { cachedReads } from '@api/cached-reads';
import type { Deposit } from '@api/deposits.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useToast } from '@contexts/ToastContext';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import { Stat, Stats } from '@/ui/Stats';
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
import { useValueView } from '../shell/value-view';
import { AddDepositDialog } from './DepositDialogs';
import {
  accountsWithoutRate,
  attention,
  dateText,
  money,
  NO_REAL_GAIN,
  noRealEndReason,
  realOf,
  realRateText,
  statusText,
  statusTone,
  termText,
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
  const note = attention(deposit, asOf);
  const check = deposit.lastCheck;
  const inOwn = shown === deposit.currency;
  const real = realOf(deposit, basis);
  const rate = showReal ? realRateText(real) : null;
  return (
    <li>
      <Link className="deposit-card__link" to={withCurrency(`/deposits/${deposit.id}`, asked)}>
        <Card as="div" className="deposit-card">
          <div className="deposit-card__head">
            <span className="deposit-card__name">{deposit.name}</span>
            <Badge tone={statusTone[deposit.status]}>{statusText[deposit.status]}</Badge>
          </div>
          <div className="deposit-card__value">
            <strong className="ui-num">{money(deposit.values[shown], shown)}</strong>
            {!inOwn && <span className="ui-num">{money(deposit.balance, deposit.currency)}</span>}
          </div>
          <p className="deposit-card__terms">{termText(deposit)}</p>
          {rate && (
            <p className="deposit-card__terms">
              <span className={toneClass(real?.ratePercent ?? null)}>{rate}</span>
            </p>
          )}
          <KeyValue>
            {deposit.interestMissing && (
              <KeyValueRow term="Interest">
                {deposit.ratePercent === null
                  ? 'Not counted, no rate entered'
                  : 'Not counted before the first rate'}
              </KeyValueRow>
            )}
            {deposit.interestEarned != null &&
              (showReal ? (
                <KeyValueRow term="Interest after inflation">
                  <span className={toneClass(real?.gain ?? null)}>
                    {real?.gain != null ? money(real.gain, deposit.currency, true) : DASH}
                  </span>
                  {real?.gain != null && real.estimated && ESTIMATED}
                  {real?.gain == null && <span className="ui-sub"> {NO_REAL_GAIN}</span>}
                </KeyValueRow>
              ) : (
                <KeyValueRow term="Interest earned">
                  {money(deposit.interestEarned, deposit.currency)}
                </KeyValueRow>
              ))}
            {deposit.nextPayout && (
              <KeyValueRow term="Next interest">
                {money(deposit.nextPayout.interest, deposit.currency)} on{' '}
                {dateText(deposit.nextPayout.date)}
              </KeyValueRow>
            )}
            {deposit.atMaturity &&
              (showReal ? (
                <KeyValueRow term="At the end, in today's money">
                  {deposit.atMaturity.inTodaysMoney?.[basis]
                    ? money(deposit.atMaturity.inTodaysMoney[basis].amount, deposit.currency)
                    : DASH}
                  {deposit.atMaturity.inTodaysMoney?.[basis]?.estimated && ESTIMATED}
                  {!deposit.atMaturity.inTodaysMoney?.[basis] && (
                    <span className="ui-sub">
                      {' '}
                      {noRealEndReason(deposit.atMaturity.date, asOf)}
                    </span>
                  )}
                </KeyValueRow>
              ) : (
                <KeyValueRow term="At the end of the term">
                  {money(deposit.atMaturity.balance, deposit.currency)}
                </KeyValueRow>
              ))}
            {check && (
              <KeyValueRow term="Last check">
                {dateText(check.checkedOn)},{' '}
                {check.difference === null
                  ? 'not compared, the interest is missing'
                  : Number(check.difference) === 0
                    ? 'matches the bank'
                    : `differs by ${money(check.difference, deposit.currency)}`}
              </KeyValueRow>
            )}
          </KeyValue>
          {note && (
            <Banner tone="warn" role="none">
              {note}
            </Banner>
          )}
        </Card>
      </Link>
    </li>
  );
}

const ESTIMATED = ' (estimated)';

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
      <Card labelledBy={`${id}-bank`}>
        <CardHeader
          id={`${id}-bank`}
          title={bank}
          sub={plural(deposits.length, 'deposit')}
          actions={
            <div className="deposit-bank__total">
              <strong className="ui-num">{money(total, shown)}</strong>
              {missing > 0 && (
                <span className="deposit-bank__reason">
                  Incomplete: {plural(missing, 'deposit')} {missing === 1 ? 'has' : 'have'} no
                  current exchange rate to {shown}
                </span>
              )}
            </div>
          }
        />
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
        valueSwitch
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add deposit
          </Button>
        }
      />
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
          <Card labelledBy={`${summaryId}-title`}>
            <h2 id={`${summaryId}-title`} className="ui-sr">
              Total in deposits
            </h2>
            <Stats size="lg">
              <Stat lead label="In deposits" value={money(total, shown)} />
              {(share !== null || (total !== null && unknown)) && (
                <Stat
                  label="Share of net worth"
                  value={share === null ? DASH : `${shareFormat.format(share)}%`}
                  hint={share === null && unknown ? unknown : undefined}
                />
              )}
            </Stats>
            <p className="deposit-total__note">
              At the Bank of Russia rate of {dateText(list.asOf)}. A closed deposit counts only
              while interest it earned is unpaid.
              {list.interestMissingCount
                ? ` ${accountsWithoutRate(list.interestMissingCount)}`
                : ''}
            </p>
          </Card>
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
