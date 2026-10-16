import { cachedReads } from '@api/cached-reads';
import { Link } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Icon } from '../shell/icons';
import { useCachedRead } from '../shell/useCachedRead';
import { GoalBar, GoalFigures } from './GoalProgress';
import { monthYear, ordered, statusText, statusTone, verdict } from './goal-format';
import '../shell/shell-page.css';
import './goals.css';

// GOAL-DASH: the goal that is due first and not yet reached, under the net worth. A failed read,
// no goals or only reached ones leave the dashboard as it was: this card is never what it waits for.
export default function NearestGoal() {
  const { data } = useCachedRead(cachedReads.goals);
  if (data === null) return null;
  const goal = ordered(data.items).find((item) => item.status !== 'reached');
  if (!goal) return null;
  return (
    // The shared card's class on a section of its own: Card has no name to give a region.
    <section className="ui-card goal-dash" aria-label="Nearest goal">
      <div className="goal-dash__head">
        <span className="goal-icon" aria-hidden="true">
          <Icon name="target" className="shell-icon shell-icon--sm" />
        </span>
        <div className="goal-card__title">
          <small>Nearest goal{goal.deadline ? ` · by ${monthYear(goal.deadline)}` : ''}</small>
          <Link to={`/goals/${goal.id}`} className="goal-card__name">
            {goal.name}
          </Link>
        </div>
      </div>
      <div className="goal-dash__progress">
        <GoalFigures goal={goal} />
        <GoalBar goal={goal} />
      </div>
      <div className="goal-dash__verdict">
        <Badge tone={statusTone[goal.status]} dot>
          {statusText[goal.status]}
        </Badge>
        <span>{verdict(goal)}</span>
        <span className="goal-dash__links">
          <Link to={`/goals/${goal.id}`} className="ui-link">
            Open goal
          </Link>
          <Link to="/goals" className="ui-link">
            All goals · {data.items.length}
          </Link>
        </span>
      </div>
    </section>
  );
}
