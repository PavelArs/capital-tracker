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
import GoalChart from './GoalChart';
import { DeleteGoalDialog, GoalDialog } from './GoalDialogs';
import GoalInsights from './GoalInsights';
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

/** When a case reaches the target: already, by a month, or not within the horizon. */
function reachedText(goal: Goal, scenario: GoalScenario): string {
  if (goal.status === 'reached') return 'Already';
  const date = reachedDate(goal, scenario);
  return date ? monthYear(date) : 'Over 100 years';
}

/** Red for a shortfall, green for a surplus, plain on the sum. */
const againstClass = { short: 'goal-neg', more: 'goal-pos', level: '' } as const;

/** The three return cases side by side: what the plan gives at each, and what it would take. */
function Cases({ goal }: { goal: Goal }) {
  const money = (value: string | null) => flooredText(value, goal.currency);
  const needed = (value: string | null) => neededText(value, goal.currency);
  const dated = goal.deadline !== null;
  const done = goal.status === 'reached';
  const reached = (scenario: GoalScenario) => reachedText(goal, scenario);
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
                        <span className={againstClass[against.tone]}>{against.text}</span>
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

/** The base case, the one the expected return gives. */
const baseCase = (goal: Goal) => goal.scenarios.find((scenario) => scenario.key === 'base') ?? null;

/** Whether the owner puts money in every month. */
const plannedOf = (goal: Goal) => goal.monthlyContribution && Number(goal.monthlyContribution) > 0;

/** "42% of the target", and whether some assets are left out for want of a price. */
function progressHint(goal: Goal): string | undefined {
  if (goal.progress.percent == null) return undefined;
  const percent = Math.floor(Number(goal.progress.percent));
  return `${percent}% of the target${goal.progress.complete ? '' : '; some assets have no price or rate'}`;
}

/** The monthly sum the base case needs to meet the date, while that can be known. */
function neededHint(goal: Goal, base: GoalScenario | null, known: boolean): string | undefined {
  if (!known || !base?.requiredMonthly || !goal.deadline || goal.status === 'reached')
    return undefined;
  return `Needed for the date: ${neededText(base.requiredMonthly, goal.currency)}`;
}

/** When the base case reaches a goal with no date. */
function reachedOnText(goal: Goal, base: GoalScenario | null, known: boolean): string {
  if (goal.status === 'reached') return 'Already';
  if (!known) return 'Not known';
  return base?.reachedOn ? monthYear(base.reachedOn) : 'Over 100 years';
}

/** The forecast for the date, or for a goal with no date when it is reached. */
function OutcomeStat({
  goal,
  base,
  known,
}: {
  goal: Goal;
  base: GoalScenario | null;
  known: boolean;
}) {
  if (goal.deadline) {
    const against = known ? againstTarget(base?.gap ?? null, goal.currency) : null;
    return (
      <Stat
        label={`Forecast for ${monthYear(goal.deadline)}`}
        value={known ? flooredText(base?.projectedAtDeadline ?? null, goal.currency) : '—'}
        hint={against?.hint}
      />
    );
  }
  return (
    <Stat
      label="Reached"
      value={reachedOnText(goal, base, known)}
      hint={
        known && base?.monthsToTarget != null && goal.status !== 'reached'
          ? `In ${span(base.monthsToTarget)}`
          : undefined
      }
    />
  );
}

/** The goal's figures: where it stands, the plan and the forecast of the base case. */
function GoalStats({ goal }: { goal: Goal }) {
  const base = baseCase(goal);
  const left = goal.deadline ? timeLeft(goal.deadline, goal.asOf) : null;
  // With assets that have no price the value is understated, so projections are estimates
  // for the priced subset, even for a goal that is already reached.
  const known = goal.progress.current != null;
  return (
    <Card>
      <Stats label="Goal figures">
        <Stat
          label="Portfolio now"
          value={flooredText(goal.progress.current, goal.currency)}
          hint={progressHint(goal)}
        />
        <Stat label="Target" value={enteredText(goal.targetAmount, goal.currency)} />
        <Stat
          label="Time left"
          value={goal.deadline ? (left ?? 'The date has passed') : 'No date'}
          hint={
            goal.deadline ? `Until ${dateText(goal.deadline)}` : 'Add a date to get a monthly sum'
          }
        />
        <Stat
          label="You put in a month"
          value={plannedOf(goal) ? enteredText(goal.monthlyContribution, goal.currency) : 'Nothing'}
          hint={neededHint(goal, base, known)}
        />
        <Stat
          label="Expected return"
          value={`${rateText(goal.expectedReturnPercent)}% a year`}
          hint="The base case"
        />
        <OutcomeStat goal={goal} base={base} known={known} />
      </Stats>
    </Card>
  );
}

/** "1.5 points less and more", both offsets when they differ, or other rates without them. */
function offsetsText(goal: Goal): string {
  const gap = offsets(goal);
  if (!gap) return 'other rates';
  return gap.less === gap.more
    ? `${gap.less} points less and more`
    : `${gap.less} points less and ${gap.more} more`;
}

/** The three return cases with what they assume, once the portfolio's value is known. */
function CasesCard({ goal, id }: { goal: Goal; id: string }) {
  if (goal.scenarios.length === 0 || goal.progress.current == null) return null;
  return (
    <Card labelledBy={id}>
      <CardHeader id={id} title="Three cases" />
      <p className="goal-note">
        The same plan at {offsetsText(goal)} a year than the {rateText(goal.expectedReturnPercent)}%
        you expect.
      </p>
      <Cases goal={goal} />
      <Banner tone="neutral" icon="info">
        A projection, not a promise: the same return every year on the whole portfolio, with{' '}
        {plannedOf(goal)
          ? `${enteredText(goal.monthlyContribution, goal.currency)} put in`
          : 'nothing put in'}{' '}
        once a month, the first a month from {dateText(goal.asOf)}, and interest compounded monthly.
        Bank deposits count at the same rate for now. Markets do not move in a straight line.
      </Banner>
    </Card>
  );
}

// GOAL-PAGE: one goal with its figures, the verdict, its chart (GOAL-CHART) and the three
// return cases.
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
    said.current = toast.show({ tone: 'success', title: 'Goal added', detail: verdict(goal) });
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

  const stale = goal ? staleText(goal.progress.stalePrices) : null;

  return (
    <div className="shell-page">
      <PageHeader title="Goals" />
      <Crumb to="/goals">Goals</Crumb>
      {error && goal === null ? (
        <ErrorState what="this goal" onRetry={() => reload()} />
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
          <GoalStats goal={goal} />
          <GoalChart goal={goal} />
          <CasesCard goal={goal} id={cases} />
          <GoalInsights goal={goal} />
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
                  title: 'Goal saved',
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
