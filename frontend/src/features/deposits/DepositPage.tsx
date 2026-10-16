import { cachedReads } from '@api/cached-reads';
import { type DepositDetail, depositsApi } from '@api/deposits.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useToast } from '@contexts/ToastContext';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { ErrorState } from '@/ui/ErrorState';
import { IconButton } from '@/ui/IconButton';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import { ListRowText, rowClass } from '@/ui/ListRow';
import { Crumb, PageHead } from '@/ui/PageHead';
import Pager, { usePages } from '@/ui/Pager';
import { Stat, Stats } from '@/ui/Stats';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { basisText } from '../shell/basis-text';
import { Icon } from '../shell/icons';
import { type InflationBasis, useInflationBasis } from '../shell/inflation-basis';
import { useMainCurrency } from '../shell/main-currency';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { useValueView } from '../shell/value-view';
import DepositChart from './DepositChart';
import { CheckDialog, DeleteDepositDialog, MovementDialog, RateDialog } from './DepositDialogs';
import {
  attention,
  capitalizedInterest,
  dateText,
  earlyCloseText,
  interestText,
  money,
  movementText,
  periodText,
  realOf,
  realRateText,
  statusText,
  statusTone,
  termText,
  toneClass,
} from './deposit-format';
import '../shell/shell-page.css';
import './deposits.css';

type Dialog = 'movement' | 'check' | 'rate' | 'delete' | null;

/** The interest posted so far, newest first, five periods a page: a daily deposit has many. */
function InterestPeriods({
  periods,
  currency,
  basis,
}: {
  periods: DepositDetail['periods'];
  currency: AccountingCurrency;
  basis: InflationBasis;
}) {
  // Absent in an answer saved before the figure existed: the column is left out, not filled with dashes.
  const inflated = periods.some((period) => period.afterInflation !== undefined);
  const paged = usePages([...periods].reverse(), (period) => period.to);
  const narrow = useNarrowScreen();
  const treatment = (period: DepositDetail['periods'][number]) =>
    period.treatment === 'capitalized' ? 'Added to the deposit' : 'Payable';
  if (narrow)
    return (
      <>
        <ol className="ui-rows deposit-rows" aria-label="Interest by period">
          {paged.rows.map((period) => {
            const real = period.afterInflation?.[basis] ?? null;
            return (
              <li key={period.to} className={rowClass()}>
                <ListRowText
                  title={treatment(period)}
                  detail={`${dateText(period.from)} – ${dateText(period.to)}`}
                  amount={money(period.interest, currency)}
                  value={
                    inflated ? (
                      <span className={toneClass(real)}>
                        {money(real, currency, true)} after inflation
                      </span>
                    ) : undefined
                  }
                />
              </li>
            );
          })}
        </ol>
        {paged.pager && <Pager {...paged.pager} label="periods" />}
      </>
    );
  return (
    <>
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>What happened to it</th>
              <th className="ui-num">Interest</th>
              {inflated && <th className="ui-num">After inflation</th>}
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((period) => (
              <tr key={period.to}>
                <td>{dateText(period.from)}</td>
                <td>{dateText(period.to)}</td>
                <td>{treatment(period)}</td>
                <td className="ui-num">{money(period.interest, currency)}</td>
                {inflated && (
                  <td
                    className={`ui-num ${toneClass(period.afterInflation?.[basis] ?? null) ?? ''}`}
                  >
                    {money(period.afterInflation?.[basis] ?? null, currency, true)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paged.pager && <Pager {...paged.pager} label="periods" />}
    </>
  );
}

/** Money put in and taken out, newest first, five a page. */
function Movements({
  movements,
  currency,
  onRemove,
}: {
  movements: DepositDetail['movements'];
  currency: AccountingCurrency;
  onRemove: (id: string) => void;
}) {
  // The first top-up is the deposit itself; it goes with the deposit, not on its own.
  const opening = movements[0]?.id;
  const paged = usePages([...movements].reverse(), (movement) => movement.id);
  const narrow = useNarrowScreen();
  const remove = (movement: DepositDetail['movements'][number]) =>
    movement.id !== opening && (
      <IconButton
        label={`Remove the ${movementText[movement.kind].toLowerCase()} of ${dateText(movement.date)}`}
        icon="trash"
        onClick={() => onRemove(movement.id)}
      />
    );
  if (narrow)
    return (
      <>
        <ol className="ui-rows deposit-rows" aria-label="Movements">
          {paged.rows.map((movement) => (
            <li key={movement.id} className={rowClass()}>
              <ListRowText
                title={movementText[movement.kind]}
                detail={[dateText(movement.date), movement.comment].filter(Boolean).join(' · ')}
                amount={money(movement.amount, currency)}
              />
              {remove(movement)}
            </li>
          ))}
        </ol>
        {paged.pager && <Pager {...paged.pager} label="movements" />}
      </>
    );
  return (
    <>
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>What</th>
              <th>Note</th>
              <th className="ui-num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((movement) => (
              <tr key={movement.id}>
                <td>{dateText(movement.date)}</td>
                <td>{movementText[movement.kind]}</td>
                <td>{movement.comment ?? ''}</td>
                <td className="ui-num">{money(movement.amount, currency)}</td>
                <td className="deposit-table__act">{remove(movement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paged.pager && <Pager {...paged.pager} label="movements" />}
    </>
  );
}

/** The bank balances entered against the app's figure, five a page. */
function Checks({
  checks,
  currency,
}: {
  checks: DepositDetail['checks'];
  currency: AccountingCurrency;
}) {
  const paged = usePages(checks, (check) => check.id);
  const narrow = useNarrowScreen();
  const difference = (row: DepositDetail['checks'][number]) =>
    Number(row.difference) === 0 ? '—' : money(row.difference, currency, true);
  if (narrow)
    return (
      <>
        <ol className="ui-rows deposit-rows" aria-label="Checks against the bank">
          {paged.rows.map((row) => (
            <li key={row.id} className={rowClass()}>
              <ListRowText
                title={dateText(row.checkedOn)}
                detail={`Bank ${money(row.bankBalance, currency)} · App ${money(row.calculated, currency)}`}
                amount={difference(row)}
                value="Difference"
              />
            </li>
          ))}
        </ol>
        {paged.pager && <Pager {...paged.pager} label="checks" />}
      </>
    );
  return (
    <>
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="ui-num">Bank</th>
              <th className="ui-num">App</th>
              <th className="ui-num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((row) => (
              <tr key={row.id}>
                <td>{dateText(row.checkedOn)}</td>
                <td className="ui-num">{money(row.bankBalance, currency)}</td>
                <td className="ui-num">{money(row.calculated, currency)}</td>
                <td className="ui-num">{difference(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paged.pager && <Pager {...paged.pager} label="checks" />}
    </>
  );
}

// DEP-DETAIL: one deposit with its computed interest, its movements and its checks.
export default function DepositPage() {
  const { depositId = '' } = useParams();
  const { data: deposit, error, replace, reload } = useCachedRead(cachedReads.deposit, depositId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removeFailed, setRemoveFailed] = useState<string | null>(null);
  const [asked] = useAskedCurrency();
  const [basis] = useInflationBasis();
  const [view] = useValueView();
  const { main } = useMainCurrency();
  const navigate = useNavigate();
  const toast = useToast();
  const shown = asked ?? main ?? 'USD';

  const missing = isAxiosError(error) && error.response?.status === 404;
  const failed = error !== null && !missing && deposit === null;

  const saved = (next: DepositDetail, title: string) => {
    replace(next);
    setDialog(null);
    toast.show({ tone: 'success', title });
  };
  const back = withCurrency('/deposits', asked);

  const removeMovement = async (id: string) => {
    setRemoveFailed(null);
    try {
      replace(await depositsApi.removeMovement(depositId, id));
      toast.show({ tone: 'success', title: 'Movement removed' });
    } catch (error) {
      const message = isAxiosError(error) ? error.response?.data?.message : null;
      setRemoveFailed(typeof message === 'string' ? message : 'Could not remove it. Try again.');
    }
  };

  if (missing)
    return (
      <div className="shell-page">
        <PageHeader title="Deposit" />
        <ErrorState>
          This deposit does not exist.{' '}
          <Link className="ui-link" to={back}>
            Back to deposits
          </Link>
        </ErrorState>
      </div>
    );

  const own = deposit?.currency;
  const note = deposit ? attention(deposit, deposit.asOf) : null;
  const check = deposit?.lastCheck ?? null;
  const real = deposit ? realOf(deposit, basis) : null;
  const rate = realRateText(real);

  return (
    <div className="shell-page">
      <PageHeader title={deposit ? deposit.name : 'Deposit'} valueSwitch />
      <Crumb to={back}>Banks</Crumb>
      {failed ? (
        <ErrorState onRetry={() => reload()}>
          Could not load the deposit. Try again later.
        </ErrorState>
      ) : deposit === null || own === undefined ? (
        <PageSkeleton label="Loading deposit" show={['cards']} />
      ) : (
        <>
          <PageHead
            icon={<Icon name="archive" />}
            title={deposit.bank}
            subtitle={
              <>
                <Badge tone={statusTone[deposit.status]}>{statusText[deposit.status]}</Badge>{' '}
                <span>{termText(deposit)}</span>
                {rate && real && (
                  <>
                    {' · '}
                    <span className={toneClass(real.ratePercent)}>{rate}</span>
                  </>
                )}
                {' · '}
                <span>
                  Started {dateText(deposit.startDate)}
                  {deposit.closedOn ? `, closed ${dateText(deposit.closedOn)}` : ''}
                </span>
              </>
            }
            aside={
              <div className="deposit-head__value">
                <strong className="ui-num">{money(deposit.values[shown], shown)}</strong>
                {shown !== own && <span className="ui-num">{money(deposit.balance, own)}</span>}
              </div>
            }
            actions={
              <>
                <Button variant="ghost" icon="plus" onClick={() => setDialog('movement')}>
                  Record movement
                </Button>
                <Button variant="secondary" icon="check" onClick={() => setDialog('check')}>
                  Check balance
                </Button>
              </>
            }
          />
          {note && (
            <Banner tone="warn" role="status">
              {note}
            </Banner>
          )}
          <Card>
            <Stats>
              <Stat label="In the deposit" value={money(deposit.principal, own)} />
              {deposit.interestEarned !== undefined && (
                <Stat
                  label="Interest earned"
                  value={money(deposit.interestEarned, own)}
                  hint={
                    real?.gain != null
                      ? `${money(real.gain, own, true)} after ${own} inflation, ${basisText(basis, real, own)}`
                      : `No ${own} inflation figures for the whole time yet`
                  }
                />
              )}
              <Stat
                label="Earned, not posted yet"
                value={money(deposit.accrued, own)}
                hint="Until the next interest date"
              />
              {deposit.capitalized && (
                <Stat
                  label="Interest added so far"
                  value={money(capitalizedInterest(deposit.periods), own)}
                  hint="Already part of the deposit"
                />
              )}
              {/* A capitalizing deposit closed early can still owe the interest it kept. */}
              {(!deposit.capitalized || /[1-9]/.test(deposit.due)) && (
                <Stat
                  label="Interest to be paid out"
                  value={money(deposit.due, own)}
                  hint="Posted by the bank, not recorded as paid"
                />
              )}
              {deposit.nextPayout && (
                <Stat
                  label={
                    deposit.nextPayout.treatment === 'capitalized' ? 'Next, added' : 'Next, paid'
                  }
                  value={money(deposit.nextPayout.interest, own)}
                  hint={dateText(deposit.nextPayout.date)}
                />
              )}
              {deposit.atMaturity && (
                <Stat
                  label="At the end of the term"
                  value={money(deposit.atMaturity.balance, own)}
                  hint={[
                    `${money(deposit.atMaturity.interest, own)} of interest by ${dateText(deposit.atMaturity.date)}`,
                    deposit.atMaturity.inTodaysMoney?.[basis] &&
                      `≈ ${money(deposit.atMaturity.inTodaysMoney[basis].amount, own)} in today's money${
                        deposit.atMaturity.inTodaysMoney[basis].estimated ? ' (estimated)' : ''
                      }`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                />
              )}
              {check && (
                <Stat
                  label="Last check"
                  value={
                    Number(check.difference) === 0 ? 'Matches' : money(check.difference, own, true)
                  }
                  hint={`${dateText(check.checkedOn)}: bank ${money(check.bankBalance, own)}, app ${money(check.calculated, own)}`}
                />
              )}
            </Stats>
          </Card>

          {deposit.chart && deposit.chart.length > 0 && (
            <DepositChart
              points={deposit.chart}
              currency={own}
              real={view === 'real'}
              basis={basis}
            />
          )}

          <div className="deposit-columns">
            <Card labelledBy="deposit-terms">
              <CardHeader id="deposit-terms" title="Terms" />
              <KeyValue>
                <KeyValueRow term="Bank">{deposit.bank}</KeyValueRow>
                <KeyValueRow term="Currency">{own}</KeyValueRow>
                <KeyValueRow term="Rate">
                  {deposit.rates.map((rate) => (
                    <span key={rate.effectiveFrom} className="deposit-terms__rate">
                      {rate.ratePercent}% a year from {dateText(rate.effectiveFrom)}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="ui-link"
                    aria-label="Change the rate"
                    onClick={() => setDialog('rate')}
                  >
                    Change
                  </button>
                </KeyValueRow>
                <KeyValueRow term="Interest">{interestText(deposit)}</KeyValueRow>
                <KeyValueRow term="Term">{periodText(deposit)}</KeyValueRow>
                <KeyValueRow term="Closing early">{earlyCloseText[deposit.earlyClose]}</KeyValueRow>
              </KeyValue>
            </Card>

            <Card labelledBy="deposit-periods">
              <CardHeader id="deposit-periods" title="Interest by period" />
              {deposit.periods.length === 0 ? (
                <p className="ui-muted">No interest has been posted yet.</p>
              ) : (
                <InterestPeriods periods={deposit.periods} currency={own} basis={basis} />
              )}
              {Number(deposit.interestForfeited) > 0 && (
                <Banner tone="info">
                  Closing the deposit early lost {money(deposit.interestForfeited, own)} of
                  interest.
                </Banner>
              )}
            </Card>
          </div>

          <Card labelledBy="deposit-movements">
            <CardHeader id="deposit-movements" title="Movements" />
            {removeFailed && <Banner tone="neg">{removeFailed}</Banner>}
            <Movements
              movements={deposit.movements}
              currency={own}
              onRemove={(id) => void removeMovement(id)}
            />
          </Card>

          <Card labelledBy="deposit-checks">
            <CardHeader id="deposit-checks" title="Checks against the bank" />
            {deposit.checks.length === 0 ? (
              <p className="ui-muted">
                Enter the balance the bank's app shows now and then. A difference means a missed
                payout or a different rate.
              </p>
            ) : (
              <Checks checks={deposit.checks} currency={own} />
            )}
          </Card>

          <div className="deposit-actions">
            <Button variant="ghost" destructive icon="trash" onClick={() => setDialog('delete')}>
              Delete deposit
            </Button>
            <span className="ui-sub">
              Removes the deposit with its movements, balance checks and rate changes.
            </span>
          </div>

          {dialog === 'movement' && (
            <MovementDialog
              id={deposit.id}
              currency={own}
              onClose={() => setDialog(null)}
              onSaved={(next) => saved(next, 'Movement recorded')}
            />
          )}
          {dialog === 'check' && (
            <CheckDialog
              id={deposit.id}
              currency={own}
              capitalized={deposit.capitalized}
              onClose={() => setDialog(null)}
              onSaved={(next) => saved(next, 'Check saved')}
            />
          )}
          {dialog === 'rate' && (
            <RateDialog
              id={deposit.id}
              onClose={() => setDialog(null)}
              onSaved={(next) => saved(next, 'Rate changed')}
            />
          )}
          {dialog === 'delete' && (
            <DeleteDepositDialog
              id={deposit.id}
              name={deposit.name}
              onClose={() => setDialog(null)}
              onDeleted={() => {
                toast.show({ tone: 'success', title: 'Deposit deleted' });
                navigate(back);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
