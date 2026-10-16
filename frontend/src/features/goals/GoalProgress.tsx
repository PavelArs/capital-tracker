import type { Goal } from '@api/goals.api';
import { Progress } from '@/ui/Progress';
import { enteredText, flooredText } from './goal-format';
import './goals.css';

// Shared by the goal list, the goal page and the dashboard card. Kept apart from the pages so the
// dashboard, which loads with the app, does not pull the lazy Goals screens into the first bundle.

/** The bar under a goal's figures: how much of the sum the portfolio already is. */
export function GoalBar({ goal }: { goal: Goal }) {
  const share = goal.progress.percent === null ? 0 : Math.min(Number(goal.progress.percent), 100);
  return (
    <Progress
      value={share}
      label={`Progress toward ${goal.name}`}
      tone={goal.status === 'reached' ? 'pos' : 'accent'}
    />
  );
}

/** "$51,000 of $220,000   23%": where the portfolio stands against the sum. */
export function GoalFigures({ goal }: { goal: Goal }) {
  const percent = goal.progress.percent === null ? null : Math.floor(Number(goal.progress.percent));
  return (
    <span className="goal-figures">
      <b>{flooredText(goal.progress.current, goal.currency)}</b>
      <span>of {enteredText(goal.targetAmount, goal.currency)}</span>
      {percent !== null && <span className="goal-figures__share">{percent}%</span>}
    </span>
  );
}
