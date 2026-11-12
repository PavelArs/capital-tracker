import { cachedReads } from '@api/cached-reads';
import {
  type DepositCheck,
  type DepositDetail,
  type DepositReal,
  depositsApi,
} from '@api/deposits.api';
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
import { DASH } from '../portfolio/format';
import { basisText } from '../shell/basis-text';
import { type InflationBasis, useInflationBasis } from '../shell/inflation-basis';
import { useMainCurrency } from '../shell/main-currency';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { useValueView } from '../shell/value-view';
import DepositChart from './DepositChart';
import { CheckDialog, DeleteDepositDialog, MovementDialog, RateDialog } from './DepositDialogs';
import DepositIcon from './DepositIcon';
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
import './deposits.css';

type Dialog = 'movement' | 'check' | 'rate' | 'delete' | null;

/** The interest posted so far, newest first, five periods a page: a daily deposit has many. */
function InterestPeriods({
  periods,
  currency,
  basis,
  showReal,
  interestMissing,
}: {
  periods: DepositDetail['periods'];
  currency: AccountingCurrency;
  basis: InflationBasis;
  showReal: boolean;
  interestMissing: boolean;
}) {
  // One reading at a time: Real shows the interest after inflation instead of the bank's figure,
  // a dash where a period has none (an answer saved before the figure existed).
  const missingReason = interestMissing
    ? 'Earlier interest is missing'
    : 'No inflation figures for this period';
  const paged = usePages([...periods].reverse(), (period) => period.to);
  const treatment = (period: DepositDetail['periods'][number]) =>
    period.treatment === 'capitalized' ? 'Added to the deposit' : 'Payable';
  return (
    <>
      <ol className="ui-rows deposit-rows" aria-label="Interest by period">
        {paged.rows.map((period) => {
          const real = period.afterInflation?.[basis] ?? null;
          return (
            <li key={period.to} className={rowClass()}>
              <ListRowText
                title={`${dateText(period.from)} – ${dateText(period.to)}`}
                detail={treatment(period)}
                amount={
                  showReal ? (
                    <span className={toneClass(real)}>{money(real, currency, true)}</span>
                  ) : (
                    money(period.interest, currency)
                  )
                }
                value={showReal ? (real === null ? missingReason : 'after inflation') : undefined}
              />
            </li>
          );
        })}
      </ol>
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
                amount={money(movement.amount, currency, false, 'exact')}
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
                <td className="ui-num">{money(movement.amount, currency, false, 'exact')}</td>
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
                detail={`Bank ${money(row.bankBalance, currency, false, 'exact')} · App ${money(row.calculated, currency)}`}
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
                <td className="ui-num">{money(row.bankBalance, currency, false, 'exact')}</td>
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

/** Why the interest is not counted: no rate at all, or none for the first days. */
function missingInterestText(deposit: DepositDetail): string {
  if (deposit.ratePercent === null)
    return `No rate entered, so the interest is not counted. The balance is what you put in, less what you took out. Enter the rate from ${dateText(deposit.startDate)} to count it.`;
  return `Interest before ${dateText(firstRateDate(deposit.rates))} is not counted: no rate was entered for those days.${deposit.capitalized ? ' Later interest also depends on those missing amounts.' : ''} Enter the rate from ${dateText(deposit.startDate)} to count them.`;
}

/** What needs the owner's attention, and why the interest is not counted. */
function DepositNotes({ deposit }: { deposit: DepositDetail }) {
  const note = attention(deposit, deposit.asOf);
  return (
    <>
      {note && (
        <Banner tone="warn" role="status">
          {note}
        </Banner>
      )}
      {deposit.interestMissing && (
        <Banner tone="warn" role="note">
          {missingInterestText(deposit)}
        </Banner>
      )}
    </>
  );
}

/** The bank, the status, the term, the real rate under Real and the dates. */
function DepositSubtitle({
  deposit,
  rate,
  real,
}: {
  deposit: DepositDetail;
  rate: string | null;
  real: DepositReal | null;
}) {
  return (
    <>
      <span>{deposit.bank}</span>
      {' · '}
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
  );
}

interface FigureProps {
  deposit: DepositDetail;
  own: AccountingCurrency;
  basis: InflationBasis;
  showReal: boolean;
}

/** The interest earned, or under Real the interest after inflation. */
function InterestStat({
  deposit,
  own,
  basis,
  showReal,
  real,
}: FigureProps & { real: DepositReal | null }) {
  if (deposit.interestEarned == null) return null;
  if (!showReal)
    return (
      <Stat
        label="Interest earned"
        value={money(deposit.interestEarned, own)}
        hint={
          deposit.accrued !== null && /[1-9]/.test(deposit.accrued)
            ? `${money(deposit.accrued, own)} not posted yet`
            : undefined
        }
      />
    );
  if (real?.gain == null)
    return (
      <Stat
        label="Interest after inflation"
        value={DASH}
        hint={`No ${own} inflation figures for the whole time yet`}
      />
    );
  return (
    <Stat
      label="Interest after inflation"
      value={money(real.gain, own, true)}
      hint={`After ${own} inflation, ${basisText(basis, real, own)}`}
    />
  );
}

/** The end of the term: the bank's figures, or under Real the end balance in today's money. */
function MaturityStat({ deposit, own, basis, showReal }: FigureProps) {
  const end = deposit.atMaturity;
  if (!end) return null;
  if (!showReal)
    return (
      <Stat
        label="At the end of the term"
        value={money(end.balance, own)}
        hint={`${money(end.interest, own)} of interest by ${dateText(end.date)}`}
      />
    );
  const today = end.inTodaysMoney?.[basis];
  if (today)
    return (
      <Stat
        label="At the end, in today's money"
        value={money(today.amount, own)}
        hint={`By ${dateText(end.date)}${today.estimated ? ', estimated' : ''}`}
      />
    );
  return (
    <Stat
      label="At the end, in today's money"
      value={DASH}
      hint={
        end.date < deposit.asOf
          ? "The term has ended, so there is no figure in today's money"
          : 'No inflation figures for the term yet'
      }
    />
  );
}

function checkValue(check: DepositCheck, own: AccountingCurrency): string {
  if (check.difference === null) return 'Not compared';
  return Number(check.difference) === 0 ? 'Matches' : money(check.difference, own, true);
}

function checkHint(check: DepositCheck, own: AccountingCurrency): string {
  const bank = `${dateText(check.checkedOn)}: bank ${money(check.bankBalance, own, false, 'exact')}`;
  return check.calculated === null
    ? `${bank}. The app cannot say what the bank should show while the interest is missing.`
    : `${bank}, app ${money(check.calculated, own)}`;
}

/** The figures of the deposit, each only where the answer has it. */
function DepositStats({
  deposit,
  own,
  basis,
  showReal,
  real,
}: FigureProps & { real: DepositReal | null }) {
  const check = deposit.lastCheck ?? null;
  const principalRounding =
    !deposit.capitalized || deposit.interestPosted === '0.00' ? 'exact' : 'down';
  return (
    <Card>
      <Stats>
        <Stat
          label="In the deposit"
          value={money(deposit.principal, own, false, principalRounding)}
        />
        <InterestStat deposit={deposit} own={own} basis={basis} showReal={showReal} real={real} />
        {/* An answer saved before the interest earned was a figure still shows what it has not posted. */}
        {deposit.interestEarned == null && deposit.accrued !== null && (
          <Stat
            label="Earned, not posted yet"
            value={money(deposit.accrued, own)}
            hint="Until the next interest date"
          />
        )}
        {deposit.capitalized && !deposit.interestMissing && (
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
            label={deposit.nextPayout.treatment === 'capitalized' ? 'Next, added' : 'Next, paid'}
            value={money(deposit.nextPayout.interest, own)}
            hint={dateText(deposit.nextPayout.date)}
          />
        )}
        <MaturityStat deposit={deposit} own={own} basis={basis} showReal={showReal} />
        {check && (
          <Stat label="Last check" value={checkValue(check, own)} hint={checkHint(check, own)} />
        )}
      </Stats>
    </Card>
  );
}

/** The bank, the currency, the rates in force and the other terms. */
function DepositTerms({
  deposit,
  own,
  onChangeRate,
}: {
  deposit: DepositDetail;
  own: AccountingCurrency;
  onChangeRate: () => void;
}) {
  return (
    <Card labelledBy="deposit-terms">
      <CardHeader id="deposit-terms" title="Terms" />
      <KeyValue>
        <KeyValueRow term="Bank">{deposit.bank}</KeyValueRow>
        <KeyValueRow term="Currency">{own}</KeyValueRow>
        <KeyValueRow term="Rate">
          {deposit.rates.length === 0 && <span>No rate entered</span>}
          {deposit.rates.map((rate) => (
            <span key={rate.effectiveFrom} className="deposit-terms__rate">
              {rate.ratePercent}% a year from {dateText(rate.effectiveFrom)}
            </span>
          ))}
          <button
            type="button"
            className="ui-link ui-link--target"
            aria-label="Change the rate"
            onClick={onChangeRate}
          >
            Change
          </button>
        </KeyValueRow>
        <KeyValueRow term="Interest">{interestText(deposit)}</KeyValueRow>
        <KeyValueRow term="Term">{periodText(deposit)}</KeyValueRow>
        {deposit.kind !== 'account' && (
          <KeyValueRow term="Closing early">{earlyCloseText[deposit.earlyClose]}</KeyValueRow>
        )}
      </KeyValue>
    </Card>
  );
}

/** The interest posted by period, or why there is none, and what closing early lost. */
function PeriodsCard({ deposit, own, basis, showReal }: FigureProps) {
  return (
    <Card labelledBy="deposit-periods">
      <CardHeader id="deposit-periods" title="Interest by period" />
      {deposit.periods.length === 0 ? (
        <p className="ui-muted">
          {deposit.interestMissing
            ? `Interest periods are unavailable for days with no rate entered.${deposit.capitalized ? ' Later periods also depend on the missing interest.' : ''}`
            : 'No interest has been posted yet.'}
        </p>
      ) : (
        <InterestPeriods
          periods={deposit.periods}
          currency={own}
          basis={basis}
          showReal={showReal}
          interestMissing={deposit.interestMissing === true}
        />
      )}
      {deposit.interestMissing && deposit.periods.length > 0 && (
        <p className="ui-muted">
          Only periods covered by a rate are listed. After-inflation figures are unavailable while
          earlier interest is missing.
        </p>
      )}
      {Number(deposit.interestForfeited) > 0 && (
        <Banner tone="info">
          Closing the deposit early lost {money(deposit.interestForfeited, own, false, 'up')} of
          interest.
        </Banner>
      )}
    </Card>
  );
}

// What a saved check found: the bank and the app agree, or by how much they differ. Said only
// when that day has one check, so it is the one just saved.
function checkResult(next: DepositDetail, checkedOn: string) {
  const rows = next.checks.filter((row) => row.checkedOn === checkedOn);
  if (rows.length !== 1) return undefined;
  if (rows[0].difference === null) return 'Not compared: the interest is missing';
  return Number(rows[0].difference) === 0
    ? 'The bank and the app agree'
    : `Differs by ${money(rows[0].difference, next.currency, true)}`;
}

/** The bank balances entered, or how to start checking. */
function ChecksCard({ deposit, own }: { deposit: DepositDetail; own: AccountingCurrency }) {
  return (
    <Card labelledBy="deposit-checks">
      <CardHeader id="deposit-checks" title="Checks against the bank" />
      {deposit.checks.length === 0 ? (
        <p className="ui-muted">
          Enter the balance the bank's app shows now and then. A difference means a missed payout or
          a different rate.
        </p>
      ) : (
        <Checks checks={deposit.checks} currency={own} />
      )}
    </Card>
  );
}

/** The dialog open on the page, if any. */
function OpenDialog({
  dialog,
  deposit,
  own,
  onClose,
  onSaved,
  onDeleted,
}: {
  dialog: Dialog;
  deposit: DepositDetail;
  own: AccountingCurrency;
  onClose: () => void;
  onSaved: (next: DepositDetail, title: string, detail?: string) => void;
  onDeleted: () => void;
}) {
  if (dialog === 'movement')
    return (
      <MovementDialog
        id={deposit.id}
        currency={own}
        depositKind={deposit.kind}
        onClose={onClose}
        onSaved={(next) => onSaved(next, 'Movement recorded')}
      />
    );
  if (dialog === 'check')
    return (
      <CheckDialog
        id={deposit.id}
        currency={own}
        capitalized={deposit.capitalized}
        onClose={onClose}
        onSaved={(next, checkedOn) =>
          onSaved(next, 'Balance check saved', checkResult(next, checkedOn))
        }
      />
    );
  if (dialog === 'rate')
    return (
      <RateDialog
        id={deposit.id}
        onClose={onClose}
        onSaved={(next) => onSaved(next, 'Rate changed')}
      />
    );
  if (dialog === 'delete')
    return (
      <DeleteDepositDialog
        id={deposit.id}
        name={deposit.name}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
  return null;
}

/** The server's explanation of a movement it would not remove, or a plain retry note. */
function removeFailure(error: unknown): string {
  const message = isAxiosError(error) ? error.response?.data?.message : null;
  return typeof message === 'string' ? message : 'Could not remove it. Try again.';
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

  const saved = (next: DepositDetail, title: string, detail?: string) => {
    replace(next);
    setDialog(null);
    toast.show({ tone: 'success', title, ...(detail ? { detail } : {}) });
  };
  const back = withCurrency('/deposits', asked);

  const removeMovement = async (id: string) => {
    setRemoveFailed(null);
    try {
      replace(await depositsApi.removeMovement(depositId, id));
      toast.show({ tone: 'success', title: 'Movement removed' });
    } catch (error) {
      setRemoveFailed(removeFailure(error));
    }
  };

  if (missing)
    return (
      <div className="shell-page">
        <PageHeader title="Banks" />
        <ErrorState>
          This deposit does not exist.{' '}
          <Link className="ui-link" to={back}>
            Back to deposits
          </Link>
        </ErrorState>
      </div>
    );

  const own = deposit?.currency;
  const real = deposit ? realOf(deposit, basis) : null;
  // One reading at a time; an answer saved before real figures existed stays nominal.
  const showReal = view === 'real' && deposit?.real !== undefined;
  const rate = showReal ? realRateText(real) : null;

  return (
    <div className="shell-page">
      <PageHeader title={deposit?.name ?? 'Banks'} valueSwitch />
      <Crumb to={back}>Banks</Crumb>
      {failed ? (
        <ErrorState what="this deposit" onRetry={() => reload()} />
      ) : deposit === null || own === undefined ? (
        <PageSkeleton label="Loading deposit" show={['cards']} />
      ) : (
        <>
          <PageHead
            icon={<DepositIcon deposit={deposit} size="lg" />}
            title={deposit.name}
            subtitle={<DepositSubtitle deposit={deposit} rate={rate} real={real} />}
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
          <DepositNotes deposit={deposit} />
          <DepositStats deposit={deposit} own={own} basis={basis} showReal={showReal} real={real} />

          {deposit.chart && deposit.chart.length > 0 && (
            <DepositChart points={deposit.chart} currency={own} real={showReal} basis={basis} />
          )}

          <div className="deposit-columns">
            <DepositTerms deposit={deposit} own={own} onChangeRate={() => setDialog('rate')} />
            <PeriodsCard deposit={deposit} own={own} basis={basis} showReal={showReal} />
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

          <ChecksCard deposit={deposit} own={own} />

          <div className="deposit-actions">
            <Button variant="ghost" destructive icon="trash" onClick={() => setDialog('delete')}>
              Delete deposit
            </Button>
            <span className="ui-sub">
              Removes the deposit with its movements, balance checks and rate changes.
            </span>
          </div>

          <OpenDialog
            dialog={dialog}
            deposit={deposit}
            own={own}
            onClose={() => setDialog(null)}
            onSaved={saved}
            onDeleted={() => {
              toast.show({ tone: 'success', title: 'Deposit deleted' });
              navigate(back);
            }}
          />
        </>
      )}
    </div>
  );
}
