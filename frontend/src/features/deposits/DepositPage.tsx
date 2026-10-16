import { cachedReads } from '@api/cached-reads';
import { type DepositDetail, depositsApi } from '@api/deposits.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { ListRowText, rowClass } from '@/ui/ListRow';
import Pager, { usePages } from '@/ui/Pager';
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
  firstRateDate,
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
import '../portfolio/portfolio.css';
import './deposits.css';

type Dialog = 'movement' | 'check' | 'rate' | 'delete' | null;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="shell-card deposit-stat">
      <span className="deposit-stat__label">{label}</span>
      <strong className="deposit-stat__value">{value}</strong>
      {hint && <span className="deposit-stat__hint">{hint}</span>}
    </div>
  );
}

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
      <button
        type="button"
        className="shell-close"
        aria-label={`Remove the ${movementText[movement.kind].toLowerCase()} of ${dateText(movement.date)}`}
        onClick={() => onRemove(movement.id)}
      >
        <Icon name="trash" />
      </button>
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
    row.difference === null
      ? 'Not compared'
      : Number(row.difference) === 0
        ? '—'
        : money(row.difference, currency, true);
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
  const { data: deposit, error, replace } = useCachedRead(cachedReads.deposit, depositId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removeFailed, setRemoveFailed] = useState<string | null>(null);
  const [asked] = useAskedCurrency();
  const [basis] = useInflationBasis();
  const [view] = useValueView();
  const { main } = useMainCurrency();
  const navigate = useNavigate();
  const shown = asked ?? main ?? 'USD';

  const missing = isAxiosError(error) && error.response?.status === 404;
  const failed = error !== null && !missing && deposit === null;

  const saved = (next: DepositDetail) => {
    replace(next);
    setDialog(null);
  };
  const back = withCurrency('/deposits', asked);

  const removeMovement = async (id: string) => {
    setRemoveFailed(null);
    try {
      replace(await depositsApi.removeMovement(depositId, id));
    } catch (error) {
      const message = isAxiosError(error) ? error.response?.data?.message : null;
      setRemoveFailed(typeof message === 'string' ? message : 'Could not remove it. Try again.');
    }
  };

  if (missing)
    return (
      <div className="shell-page">
        <PageHeader title="Deposit" />
        <p className="shell-note" role="alert">
          This deposit does not exist. <Link to={back}>Back to deposits</Link>
        </p>
      </div>
    );

  const own = deposit?.currency;
  const note = deposit ? attention(deposit, deposit.asOf) : null;
  const check = deposit?.lastCheck ?? null;
  const real = deposit ? realOf(deposit, basis) : null;
  const rate = realRateText(real);

  return (
    <div className="shell-page">
      <PageHeader
        title={deposit ? deposit.name : 'Deposit'}
        valueSwitch
        actions={
          deposit && (
            <>
              <button
                type="button"
                className="shell-button shell-button--secondary"
                onClick={() => setDialog('movement')}
              >
                <Icon name="plus" className="shell-icon shell-icon--sm" />
                Record movement
              </button>
              <button
                type="button"
                className="shell-button shell-button--secondary"
                onClick={() => setDialog('check')}
              >
                <Icon name="check" className="shell-icon shell-icon--sm" />
                Check balance
              </button>
            </>
          )
        }
      />
      <p className="deposit-back">
        <Link to={back}>← Banks</Link>
      </p>
      {failed ? (
        <p className="shell-note" role="alert">
          Could not load the deposit. Try again later.
        </p>
      ) : deposit === null || own === undefined ? (
        <PageSkeleton label="Loading deposit" show={['cards']} />
      ) : (
        <>
          <section className="shell-card deposit-head">
            <div>
              <Badge tone={statusTone[deposit.status]}>{statusText[deposit.status]}</Badge>
              <h2>{deposit.bank}</h2>
              <p className="deposit-card__terms">{termText(deposit)}</p>
              {rate && real && (
                <p className="deposit-card__terms">
                  <span className={toneClass(real.ratePercent)}>{rate}</span>
                </p>
              )}
              <p className="deposit-card__terms">
                Started {dateText(deposit.startDate)}
                {deposit.closedOn ? `, closed ${dateText(deposit.closedOn)}` : ''}
              </p>
            </div>
            <div className="deposit-head__value">
              <strong>{money(deposit.values[shown], shown)}</strong>
              {shown !== own && <span>{money(deposit.balance, own)}</span>}
            </div>
          </section>
          {note && (
            <p className="ui-banner ui-banner--warn ui-banner--action" role="status">
              <Icon name="alert" className="shell-icon shell-icon--sm" />
              <span>{note}</span>
            </p>
          )}
          {deposit.interestMissing && (
            <p className="ui-banner ui-banner--warn" role="note">
              {deposit.ratePercent === null
                ? `No rate entered, so the interest is not counted. The balance is what you put in, less what you took out. Enter the rate from ${dateText(deposit.startDate)} to count it.`
                : `Interest before ${dateText(firstRateDate(deposit.rates))} is not counted: no rate was entered for those days. Enter the rate from ${dateText(deposit.startDate)} to count them.`}
            </p>
          )}
          <div className="deposit-stats">
            <Stat label="In the deposit" value={money(deposit.principal, own)} />
            {deposit.interestEarned != null && (
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
            {deposit.accrued !== null && (
              <Stat
                label="Earned, not posted yet"
                value={money(deposit.accrued, own)}
                hint="Until the next interest date"
              />
            )}
            {deposit.capitalized && (
              <Stat
                label="Interest added so far"
                value={money(capitalizedInterest(deposit.periods), own)}
                hint="Already part of the deposit"
              />
            )}
            {/* A capitalizing deposit closed early can still owe the interest it kept. */}
            {deposit.due !== null && (!deposit.capitalized || /[1-9]/.test(deposit.due)) && (
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
                  check.difference === null
                    ? 'Not compared'
                    : Number(check.difference) === 0
                      ? 'Matches'
                      : money(check.difference, own, true)
                }
                hint={
                  check.calculated === null
                    ? `${dateText(check.checkedOn)}: bank ${money(check.bankBalance, own)}. The app cannot say what the bank should show while the interest is missing.`
                    : `${dateText(check.checkedOn)}: bank ${money(check.bankBalance, own)}, app ${money(check.calculated, own)}`
                }
              />
            )}
          </div>

          {deposit.chart && deposit.chart.length > 0 && (
            <DepositChart
              points={deposit.chart}
              currency={own}
              real={view === 'real'}
              basis={basis}
            />
          )}

          <div className="deposit-columns">
            <section className="shell-card" aria-labelledby="deposit-terms">
              <h2 id="deposit-terms">Terms</h2>
              <dl className="deposit-terms">
                <div>
                  <dt>Bank</dt>
                  <dd>{deposit.bank}</dd>
                </div>
                <div>
                  <dt>Currency</dt>
                  <dd>{own}</dd>
                </div>
                <div>
                  <dt>Rate</dt>
                  <dd>
                    {deposit.rates.length === 0 && <span>No rate entered</span>}
                    {deposit.rates.map((rate) => (
                      <span key={rate.effectiveFrom} className="deposit-terms__rate">
                        {rate.ratePercent}% a year from {dateText(rate.effectiveFrom)}
                      </span>
                    ))}
                    <button
                      type="button"
                      className="deposit-link"
                      aria-label="Change the rate"
                      onClick={() => setDialog('rate')}
                    >
                      Change
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Interest</dt>
                  <dd>{interestText(deposit)}</dd>
                </div>
                <div>
                  <dt>Term</dt>
                  <dd>{periodText(deposit)}</dd>
                </div>
                {deposit.kind !== 'account' && (
                  <div>
                    <dt>Closing early</dt>
                    <dd>{earlyCloseText[deposit.earlyClose]}</dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="shell-card" aria-labelledby="deposit-periods">
              <h2 id="deposit-periods">Interest by period</h2>
              {deposit.periods.length === 0 ? (
                <p className="shell-note">No interest has been posted yet.</p>
              ) : (
                <InterestPeriods periods={deposit.periods} currency={own} basis={basis} />
              )}
              {Number(deposit.interestForfeited) > 0 && (
                <p className="shell-note">
                  Closing the deposit early lost {money(deposit.interestForfeited, own)} of
                  interest.
                </p>
              )}
            </section>
          </div>

          <section className="shell-card" aria-labelledby="deposit-movements">
            <h2 id="deposit-movements">Movements</h2>
            {removeFailed && (
              <p className="ui-banner ui-banner--neg" role="alert">
                {removeFailed}
              </p>
            )}
            <Movements
              movements={deposit.movements}
              currency={own}
              onRemove={(id) => void removeMovement(id)}
            />
          </section>

          <section className="shell-card" aria-labelledby="deposit-checks">
            <h2 id="deposit-checks">Checks against the bank</h2>
            {deposit.checks.length === 0 ? (
              <p className="shell-note">
                Enter the balance the bank's app shows now and then. A difference means a missed
                payout or a different rate.
              </p>
            ) : (
              <Checks checks={deposit.checks} currency={own} />
            )}
          </section>

          <div className="deposit-actions">
            <button
              type="button"
              className="shell-button shell-button--ghost"
              onClick={() => setDialog('delete')}
            >
              <Icon name="trash" className="shell-icon shell-icon--sm" />
              Delete deposit
            </button>
          </div>

          {dialog === 'movement' && (
            <MovementDialog
              id={deposit.id}
              currency={own}
              depositKind={deposit.kind}
              onClose={() => setDialog(null)}
              onSaved={saved}
            />
          )}
          {dialog === 'check' && (
            <CheckDialog
              id={deposit.id}
              currency={own}
              capitalized={deposit.capitalized}
              onClose={() => setDialog(null)}
              onSaved={saved}
            />
          )}
          {dialog === 'rate' && (
            <RateDialog id={deposit.id} onClose={() => setDialog(null)} onSaved={saved} />
          )}
          {dialog === 'delete' && (
            <DeleteDepositDialog
              id={deposit.id}
              name={deposit.name}
              onClose={() => setDialog(null)}
              onDeleted={() => navigate(back)}
            />
          )}
        </>
      )}
    </div>
  );
}
