import { cachedReads } from '@api/cached-reads';
import type { Goal, GoalScenario } from '@api/goals.api';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { DeleteGoalDialog, GoalDialog } from './GoalDialogs';
import { GoalBar, GoalFigures } from './GoalsPage';
import {
  againstTarget,
  dateText,
  monthYear,
  rateText,
  scenarioText,
  span,
  statusText,
  statusTone,
  timeLeft,
  verdict,
  wholeMoney,
} from './goal-format';
import '../shell/shell-page.css';
import './goals.css';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="shell-card goal-stat">
      <span className="goal-stat__label">{label}</span>
      <strong className="goal-stat__value">{value}</strong>
      {hint && <span className="goal-stat__hint">{hint}</span>}
    </div>
  );
}

const bannerTone = {
  reached: 'pos',
  'on-track': 'pos',
  behind: 'warn',
  overdue: 'neg',
  open: 'info',
  unknown: 'info',
} as const;

/** The three return cases side by side: what the plan gives at each, and what it would take. */
function Cases({ goal }: { goal: Goal }) {
  const money = (value: string | null) => wholeMoney(value, goal.currency);
  const dated = goal.deadline !== null;
  const done = goal.status === 'reached';
  const reached = (scenario: GoalScenario) =>
    done ? 'Already' : scenario.reachedOn ? monthYear(scenario.reachedOn) : 'Over 100 years';
  return (
    <div className="ui-table-wrap">
      <table className="ui-table goal-cases">
        <thead>
          <tr>
            <th>Case</th>
            <th className="ui-num">Return a year</th>
            {dated ? (
              <>
                <th className="ui-num">At {monthYear(goal.deadline as string)}</th>
                <th className="ui-num">Against the sum</th>
                <th className="ui-num">Needed a month</th>
                <th className="ui-num">Reached</th>
              </>
            ) : (
              <>
                <th className="ui-num">Reached</th>
                <th className="ui-num">Takes</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {goal.scenarios.map((scenario) => {
            const against = againstTarget(scenario.gap, goal.currency);
            return (
              <tr key={scenario.key} className={scenario.key === 'base' ? 'goal-cases__base' : ''}>
                <td className="goal-cases__case">
                  <b>{scenarioText[scenario.key]}</b>
                </td>
                <td className="ui-num" data-label="Return a year">
                  {rateText(scenario.returnPercent)}%
                </td>
                {dated ? (
                  <>
                    <td className="ui-num" data-label={`At ${monthYear(goal.deadline as string)}`}>
                      {money(scenario.projectedAtDeadline)}
                    </td>
                    <td className="ui-num" data-label="Against the sum">
                      {against && (
                        <span className={against.short ? 'goal-neg' : 'goal-pos'}>
                          {against.text}
                        </span>
                      )}
                    </td>
                    <td className="ui-num" data-label="Needed a month">
                      {money(scenario.requiredMonthly)}
                    </td>
                    <td className="ui-num" data-label="Reached">
                      {reached(scenario)}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="ui-num" data-label="Reached">
                      {reached(scenario)}
                    </td>
                    <td className="ui-num" data-label="Takes">
                      {done || scenario.monthsToTarget === null
                        ? '—'
                        : span(scenario.monthsToTarget)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** How many points a year the pessimistic and optimistic cases sit below and above the base. */
function offsets(goal: Goal): { less: string; more: string } | null {
  const rate = (key: GoalScenario['key']) =>
    goal.scenarios.find((scenario) => scenario.key === key)?.returnPercent;
  const [low, base, high] = [rate('pessimistic'), rate('base'), rate('optimistic')];
  if (low === undefined || base === undefined || high === undefined) return null;
  return {
    less: rateText((Number(base) - Number(low)).toFixed(4)),
    more: rateText((Number(high) - Number(base)).toFixed(4)),
  };
}

// GOAL-PAGE: one goal with its figures, the verdict and the three return cases.
export default function GoalPage() {
  const { goalId = '' } = useParams();
  const { data: goal, error, replace } = useCachedRead(cachedReads.goal, goalId);
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const navigate = useNavigate();
  const missing = isAxiosError(error) && error.response?.status === 404;

  if (missing)
    return (
      <div className="shell-page">
        <PageHeader title="Goal" />
        <p className="shell-note" role="alert">
          This goal does not exist. <Link to="/goals">Back to goals</Link>
        </p>
      </div>
    );

  const money = (value: string | null) => (goal ? wholeMoney(value, goal.currency) : '');
  const base = goal?.scenarios.find((scenario) => scenario.key === 'base') ?? null;
  const planned = goal?.monthlyContribution && Number(goal.monthlyContribution) > 0;
  const left = goal?.deadline ? timeLeft(goal.deadline) : null;
  const percent = goal?.progress.percent == null ? null : Math.floor(Number(goal.progress.percent));
  const gap = goal ? offsets(goal) : null;
  const against = againstTarget(base?.gap ?? null, goal?.currency ?? 'USD');

  return (
    <div className="shell-page">
      <PageHeader
        title={goal ? goal.name : 'Goal'}
        actions={
          goal && (
            <>
              <button
                type="button"
                className="shell-button shell-button--secondary"
                onClick={() => setDialog('edit')}
              >
                <Icon name="edit" className="shell-icon shell-icon--sm" />
                Edit goal
              </button>
              <button
                type="button"
                className="shell-button shell-button--ghost"
                onClick={() => setDialog('delete')}
              >
                <Icon name="trash" className="shell-icon shell-icon--sm" />
                Delete
              </button>
            </>
          )
        }
      />
      <p className="goal-back">
        <Link to="/goals">← Goals</Link>
      </p>
      {error && goal === null ? (
        <p className="shell-note" role="alert">
          Could not load the goal. Try again later.
        </p>
      ) : goal === null ? (
        <PageSkeleton label="Loading goal" show={['cards']} />
      ) : (
        <>
          <section className="shell-card goal-head">
            <div className="goal-head__top">
              <Badge tone={statusTone[goal.status]}>{statusText[goal.status]}</Badge>
              <small>
                {goal.deadline ? `By ${dateText(goal.deadline)}` : 'No date'} · whole portfolio ·
                set {dateText(goal.createdAt.slice(0, 10))}
              </small>
            </div>
            <GoalFigures goal={goal} />
            <GoalBar goal={goal} />
          </section>
          <p className={`ui-banner ui-banner--${bannerTone[goal.status]}`} role="status">
            <Icon
              name={goal.status === 'behind' || goal.status === 'overdue' ? 'alert' : 'info'}
              className="shell-icon shell-icon--sm"
            />
            <span>{verdict(goal)}</span>
          </p>
          <div className="goal-stats">
            <Stat
              label="Portfolio now"
              value={money(goal.progress.current)}
              hint={
                percent === null
                  ? undefined
                  : `${percent}% of the sum${goal.progress.complete ? '' : '; some assets have no price'}`
              }
            />
            <Stat label="Sum to reach" value={money(goal.targetAmount)} />
            <Stat
              label="Time left"
              value={goal.deadline ? (left ?? 'The date has passed') : 'No date'}
              hint={
                goal.deadline
                  ? `Until ${dateText(goal.deadline)}`
                  : 'Add a date to get a monthly sum'
              }
            />
            <Stat
              label="You put in a month"
              value={planned ? money(goal.monthlyContribution) : 'Nothing'}
              hint={
                base?.requiredMonthly && goal.deadline && goal.status !== 'reached'
                  ? `Needed for the date: ${money(base.requiredMonthly)}`
                  : undefined
              }
            />
            <Stat
              label="Expected return"
              value={`${rateText(goal.expectedReturnPercent)}% a year`}
              hint="The base case"
            />
            {goal.deadline ? (
              <Stat
                label={`Forecast for ${monthYear(goal.deadline)}`}
                value={money(base?.projectedAtDeadline ?? null)}
                hint={
                  against ? `${against.text}${against.short ? '' : ' than the sum'}` : undefined
                }
              />
            ) : (
              <Stat
                label="Reached"
                value={
                  goal.status === 'reached'
                    ? 'Already'
                    : base?.reachedOn
                      ? monthYear(base.reachedOn)
                      : 'Over 100 years'
                }
                hint={
                  base?.monthsToTarget != null && goal.status !== 'reached'
                    ? `In ${span(base.monthsToTarget)}`
                    : undefined
                }
              />
            )}
          </div>
          {goal.scenarios.length > 0 && (
            <section className="shell-card" aria-labelledby="goal-cases">
              <h2 id="goal-cases">Three cases</h2>
              <p className="shell-note">
                The same plan at{' '}
                {gap
                  ? gap.less === gap.more
                    ? `${gap.less} points less and more`
                    : `${gap.less} points less and ${gap.more} more`
                  : 'other rates'}{' '}
                a year than the {rateText(goal.expectedReturnPercent)}% you expect.
              </p>
              <Cases goal={goal} />
              <p className="shell-note">
                <Icon name="info" className="shell-icon shell-icon--sm" /> A projection, not a
                promise: the same return every year on the whole portfolio, with{' '}
                {planned ? `${money(goal.monthlyContribution)} put in` : 'nothing put in'} once a
                month, the first a month from today.
              </p>
            </section>
          )}
          {dialog === 'edit' && (
            <GoalDialog
              goal={goal}
              defaultCurrency={goal.currency}
              onClose={() => setDialog(null)}
              onSaved={(saved) => {
                setDialog(null);
                replace(saved);
              }}
            />
          )}
          {dialog === 'delete' && (
            <DeleteGoalDialog
              goal={goal}
              onClose={() => setDialog(null)}
              onDeleted={() => navigate('/goals')}
            />
          )}
        </>
      )}
    </div>
  );
}
