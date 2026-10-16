import { cachedReads } from '@api/cached-reads';
import type { Goal, GoalScenario } from '@api/goals.api';
import { useToast } from '@contexts/ToastContext';
import { isAxiosError } from 'axios';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { ErrorState } from '@/ui/ErrorState';
import { IconButton } from '@/ui/IconButton';
import { Crumb, PageHead } from '@/ui/PageHead';
import { Stat, Stats } from '@/ui/Stats';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { DeleteGoalDialog, GoalDialog } from './GoalDialogs';
import { GoalBar, GoalFigures } from './GoalProgress';
import {
  againstTarget,
  bannerTone,
  dateText,
  enteredText,
  exactDifference,
  flooredText,
  monthYear,
  moscowDay,
  neededText,
  rateText,
  reachedDate,
  scenarioText,
  span,
  staleText,
  statusText,
  statusTone,
  timeLeft,
  verdict,
} from './goal-format';
import '../shell/shell-page.css';
import './goals.css';

/** The three return cases side by side: what the plan gives at each, and what it would take. */
function Cases({ goal }: { goal: Goal }) {
  const money = (value: string | null) => flooredText(value, goal.currency);
  const needed = (value: string | null) => neededText(value, goal.currency);
  const dated = goal.deadline !== null;
  const done = goal.status === 'reached';
  const reached = (scenario: GoalScenario) => {
    const date = reachedDate(goal, scenario);
    return done ? 'Already' : date ? monthYear(date) : 'Over 100 years';
  };
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
                <th className="ui-num">Against the target</th>
                <th className="ui-num">Needed a month</th>
                <th className="ui-num">Reached</th>
              </>
            ) : (
              <>
                <th className="ui-num">Reached</th>
                <th className="ui-num">Takes</th>
                <th className="ui-num">In 10 years</th>
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
                    <td className="ui-num" data-label="Against the target">
                      {against && (
                        <span
                          className={
                            against.tone === 'short'
                              ? 'goal-neg'
                              : against.tone === 'more'
                                ? 'goal-pos'
                                : ''
                          }
                        >
                          {against.text}
                        </span>
                      )}
                    </td>
                    <td className="ui-num" data-label="Needed a month">
                      {needed(scenario.requiredMonthly)}
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
                    <td className="ui-num" data-label="In 10 years">
                      {money(scenario.projectedIn10Years ?? null)}
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
  const less = exactDifference(base, low);
  const more = exactDifference(high, base);
  return less === null || more === null ? null : { less: rateText(less), more: rateText(more) };
}

/** The icon of the verdict: a check when it is good news, an alert when it is not. */
const verdictIcon = (status: Goal['status']) =>
  status === 'behind' || status === 'overdue'
    ? 'alert'
    : status === 'reached' || status === 'on-track'
      ? 'check'
      : 'info';

// GOAL-PAGE: one goal with its figures, the verdict and the three return cases.
export default function GoalPage() {
  const { goalId = '' } = useParams();
  const { data: goal, error, replace, reload } = useCachedRead(cachedReads.goal, goalId);
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  // goals-08: a new goal opens here, once, with word that it was added; an edit says it saved.
  const toast = useToast();
  const arrivedAdded = useRef((location.state as { notice?: string } | null)?.notice === 'added');
  const said = useRef<number | null>(null);
  // The word is said once: going back to this entry, or reloading it, does not say it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the arrival is cleared.
  useEffect(() => {
    if (arrivedAdded.current) navigate({ pathname: location.pathname }, { replace: true });
  }, []);
  useEffect(() => {
    if (!arrivedAdded.current || !goal) return;
    arrivedAdded.current = false;
    said.current = toast.show({ tone: 'success', title: 'Goal added.', detail: verdict(goal) });
  }, [goal, toast]);
  const cases = useId();
  // A malformed id in the address names no goal either (goals-23).
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const missing = status === 404 || status === 400;

  if (missing)
    return (
      <div className="shell-page">
        <PageHeader title="Goals" />
        <ErrorState>
          This goal does not exist. <Link to="/goals">Back to goals</Link>
        </ErrorState>
      </div>
    );

  const money = (value: string | null) => (goal ? flooredText(value, goal.currency) : '');
  const needed = (value: string | null) => (goal ? neededText(value, goal.currency) : '');
  const entered = (value: string | null) => (goal ? enteredText(value, goal.currency) : '');
  const base = goal?.scenarios.find((scenario) => scenario.key === 'base') ?? null;
  const planned = goal?.monthlyContribution && Number(goal.monthlyContribution) > 0;
  const left = goal?.deadline ? timeLeft(goal.deadline, goal.asOf) : null;
  const percent = goal?.progress.percent == null ? null : Math.floor(Number(goal.progress.percent));
  const gap = goal ? offsets(goal) : null;
  // With assets that have no price the value is understated, so the projections from it are not
  // figures to act on, even for a goal that is already reached.
  const known = goal ? goal.progress.complete : false;
  const against = known ? againstTarget(base?.gap ?? null, goal?.currency ?? 'USD') : null;
  const stale = goal ? staleText(goal.progress.stalePrices) : null;

  return (
    <div className="shell-page">
      <PageHeader title="Goals" />
      <Crumb to="/goals">Goals</Crumb>
      {error && goal === null ? (
        <ErrorState onRetry={() => reload()}>Could not load the goal. Try again later.</ErrorState>
      ) : goal === null ? (
        <PageSkeleton label="Loading goal" show={['cards']} />
      ) : (
        <>
          <PageHead
            icon={
              <span className="goal-icon goal-icon--lg">
                <Icon name="target" className="shell-icon" />
              </span>
            }
            title={goal.name}
            actions={
              <>
                <Button icon="edit" onClick={() => setDialog('edit')}>
                  Edit goal
                </Button>
                <IconButton label="Delete goal" icon="trash" onClick={() => setDialog('delete')} />
              </>
            }
          />
          <Card className="goal-head">
            <div className="goal-head__top">
              <Badge tone={statusTone[goal.status]} dot>
                {statusText[goal.status]}
              </Badge>
              <small>
                {goal.deadline ? `By ${dateText(goal.deadline)}` : 'No date'} · whole portfolio ·
                set {dateText(moscowDay(goal.createdAt))}
              </small>
            </div>
            <GoalFigures goal={goal} />
            <GoalBar goal={goal} />
          </Card>
          <Banner tone={bannerTone[goal.status]} icon={verdictIcon(goal.status)} role="status">
            {verdict(goal)}
          </Banner>
          {stale && <Banner tone="warn">{stale}</Banner>}
          <Card>
            <Stats label="Goal figures">
              <Stat
                label="Portfolio now"
                value={money(goal.progress.current)}
                hint={
                  percent === null
                    ? undefined
                    : `${percent}% of the target${goal.progress.complete ? '' : '; some assets have no price'}`
                }
              />
              <Stat label="Target" value={entered(goal.targetAmount)} />
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
                value={planned ? entered(goal.monthlyContribution) : 'Nothing'}
                hint={
                  known && base?.requiredMonthly && goal.deadline && goal.status !== 'reached'
                    ? `Needed for the date: ${needed(base.requiredMonthly)}`
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
                  value={known ? money(base?.projectedAtDeadline ?? null) : '—'}
                  hint={against?.hint}
                />
              ) : (
                <Stat
                  label="Reached"
                  value={
                    goal.status === 'reached'
                      ? 'Already'
                      : !known
                        ? 'Not known'
                        : base?.reachedOn
                          ? monthYear(base.reachedOn)
                          : 'Over 100 years'
                  }
                  hint={
                    known && base?.monthsToTarget != null && goal.status !== 'reached'
                      ? `In ${span(base.monthsToTarget)}`
                      : undefined
                  }
                />
              )}
            </Stats>
          </Card>
          {goal.scenarios.length > 0 && !known && (
            <Banner tone="info">
              The three cases need every asset priced. Some have no price or rate yet, so no sum or
              date is worked out.
            </Banner>
          )}
          {goal.scenarios.length > 0 && known && (
            <Card labelledBy={cases}>
              <CardHeader id={cases} title="Three cases" />
              <p className="goal-note">
                The same plan at{' '}
                {gap
                  ? gap.less === gap.more
                    ? `${gap.less} points less and more`
                    : `${gap.less} points less and ${gap.more} more`
                  : 'other rates'}{' '}
                a year than the {rateText(goal.expectedReturnPercent)}% you expect.
              </p>
              <Cases goal={goal} />
              <Banner tone="neutral" icon="info">
                A projection, not a promise: the same return every year on the whole portfolio, with{' '}
                {planned ? `${entered(goal.monthlyContribution)} put in` : 'nothing put in'} once a
                month, the first a month from {dateText(goal.asOf)}, and interest compounded
                monthly. Bank deposits count at the same rate for now. Markets do not move in a
                straight line.
              </Banner>
            </Card>
          )}
          {dialog === 'edit' && (
            <GoalDialog
              goal={goal}
              defaultCurrency={goal.currency}
              onClose={() => setDialog(null)}
              onSaved={(saved) => {
                setDialog(null);
                replace(saved);
                if (said.current !== null) toast.dismiss(said.current);
                said.current = toast.show({
                  tone: 'success',
                  title: 'Goal saved.',
                  detail: verdict(saved),
                });
              }}
            />
          )}
          {dialog === 'delete' && (
            <DeleteGoalDialog
              goal={goal}
              onClose={() => setDialog(null)}
              onDeleted={() => navigate('/goals', { state: { notice: 'deleted' } })}
            />
          )}
        </>
      )}
    </div>
  );
}
