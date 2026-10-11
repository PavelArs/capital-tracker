import { type DepositDetail, depositsApi } from '@api/deposits.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { useAskedCurrency, withCurrency } from '../portfolio/currency';
import { Icon } from '../shell/icons';
import { useMainCurrency } from '../shell/main-currency';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { CheckDialog, DeleteDepositDialog, MovementDialog, RateDialog } from './DepositDialogs';
import {
  attention,
  dateText,
  money,
  movementText,
  statusText,
  statusTone,
  termText,
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

// DEP-DETAIL: one deposit with its computed interest, its movements and its checks.
export default function DepositPage() {
  const { depositId = '' } = useParams();
  const [deposit, setDeposit] = useState<DepositDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removeFailed, setRemoveFailed] = useState<string | null>(null);
  const [asked] = useAskedCurrency();
  const { main } = useMainCurrency();
  const navigate = useNavigate();
  const shown = asked ?? main ?? 'USD';

  const load = useCallback(() => {
    depositsApi
      .get(depositId)
      .then(setDeposit)
      .catch((error) => {
        if (isAxiosError(error) && error.response?.status === 404) setMissing(true);
        else setFailed(true);
      });
  }, [depositId]);
  useEffect(load, [load]);

  const saved = (next: DepositDetail) => {
    setDeposit(next);
    setDialog(null);
  };
  const back = withCurrency('/deposits', asked);

  const removeMovement = async (id: string) => {
    setRemoveFailed(null);
    try {
      setDeposit(await depositsApi.removeMovement(depositId, id));
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

  return (
    <div className="shell-page">
      <PageHeader
        title={deposit ? deposit.name : 'Deposit'}
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
        <Link to={back}>← Deposits</Link>
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
          <div className="deposit-stats">
            <Stat label="In the deposit" value={money(deposit.principal, own)} />
            <Stat
              label="Earned, not posted yet"
              value={money(deposit.accrued, own)}
              hint="Until the next interest date"
            />
            {deposit.capitalized ? (
              <Stat
                label="Interest added so far"
                value={money(deposit.interestPosted, own)}
                hint="Already part of the deposit"
              />
            ) : (
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
                hint={`${money(deposit.atMaturity.interest, own)} of interest by ${dateText(deposit.atMaturity.date)}`}
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
          </div>

          <section className="shell-card" aria-labelledby="deposit-periods">
            <h2 id="deposit-periods">Interest by period</h2>
            {deposit.periods.length === 0 ? (
              <p className="shell-note">No interest has been posted yet.</p>
            ) : (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>To</th>
                      <th>What happened to it</th>
                      <th className="ui-num">Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...deposit.periods].reverse().map((period) => (
                      <tr key={period.to}>
                        <td>{dateText(period.from)}</td>
                        <td>{dateText(period.to)}</td>
                        <td>
                          {period.treatment === 'capitalized' ? 'Added to the deposit' : 'Payable'}
                        </td>
                        <td className="ui-num">{money(period.interest, own)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {Number(deposit.interestForfeited) > 0 && (
              <p className="shell-note">
                Closing the deposit early lost {money(deposit.interestForfeited, own)} of interest.
              </p>
            )}
          </section>

          <section className="shell-card" aria-labelledby="deposit-movements">
            <h2 id="deposit-movements">Movements</h2>
            {removeFailed && (
              <p className="ui-banner ui-banner--neg" role="alert">
                {removeFailed}
              </p>
            )}
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
                  {[...deposit.movements].reverse().map((movement, position, all) => (
                    <tr key={movement.id}>
                      <td>{dateText(movement.date)}</td>
                      <td>{movementText[movement.kind]}</td>
                      <td>{movement.comment ?? ''}</td>
                      <td className="ui-num">{money(movement.amount, own)}</td>
                      <td className="deposit-table__act">
                        {position !== all.length - 1 && (
                          <button
                            type="button"
                            className="shell-close"
                            aria-label={`Remove the ${movementText[movement.kind].toLowerCase()} of ${dateText(movement.date)}`}
                            onClick={() => void removeMovement(movement.id)}
                          >
                            <Icon name="trash" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="shell-card" aria-labelledby="deposit-checks">
            <h2 id="deposit-checks">Checks against the bank</h2>
            {deposit.checks.length === 0 ? (
              <p className="shell-note">
                Enter the balance the bank's app shows now and then. A difference means a missed
                payout or a different rate.
              </p>
            ) : (
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
                    {deposit.checks.map((row) => (
                      <tr key={row.id}>
                        <td>{dateText(row.checkedOn)}</td>
                        <td className="ui-num">{money(row.bankBalance, own)}</td>
                        <td className="ui-num">{money(row.calculated, own)}</td>
                        <td className="ui-num">
                          {Number(row.difference) === 0 ? '—' : money(row.difference, own, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="shell-card" aria-labelledby="deposit-rates">
            <h2 id="deposit-rates">Rate</h2>
            <ul className="deposit-rates">
              {deposit.rates.map((rate) => (
                <li key={rate.effectiveFrom}>
                  <span>From {dateText(rate.effectiveFrom)}</span>
                  <strong>{rate.ratePercent}% a year</strong>
                </li>
              ))}
            </ul>
            <div className="deposit-actions">
              <button
                type="button"
                className="shell-button shell-button--secondary"
                onClick={() => setDialog('rate')}
              >
                Change the rate
              </button>
              <button
                type="button"
                className="shell-button shell-button--ghost"
                onClick={() => setDialog('delete')}
              >
                <Icon name="trash" className="shell-icon shell-icon--sm" />
                Delete deposit
              </button>
            </div>
          </section>

          {dialog === 'movement' && (
            <MovementDialog
              id={deposit.id}
              currency={own}
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
