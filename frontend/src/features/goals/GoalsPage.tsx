import { cachedReads } from '@api/cached-reads';
import type { Goal } from '@api/goals.api';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '@/ui/Badge';
import EmptyState from '@/ui/EmptyState';
import { Icon } from '../shell/icons';
import { useMainCurrency } from '../shell/main-currency';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { DeleteGoalDialog, GoalDialog } from './GoalDialogs';
import {
  dateText,
  ordered,
  rateText,
  statusText,
  statusTone,
  verdict,
  wholeMoney,
} from './goal-format';
import '../shell/shell-page.css';
import './goals.css';

/** The bar under a goal's figures: how much of the sum the portfolio already is. */
export function GoalBar({ goal }: { goal: Goal }) {
  const share = goal.progress.percent === null ? 0 : Math.min(Number(goal.progress.percent), 100);
  return (
    <span
      className={`goal-bar${goal.status === 'reached' ? ' goal-bar--done' : ''}`}
      role="progressbar"
      aria-label={`Progress toward ${goal.name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share)}
    >
      <i style={{ width: `${share}%` }} />
    </span>
  );
}

/** "$51,000 of $220,000   23%": where the portfolio stands against the sum. */
export function GoalFigures({ goal }: { goal: Goal }) {
  const percent = goal.progress.percent === null ? null : Math.floor(Number(goal.progress.percent));
  return (
    <span className="goal-figures">
      <b>{wholeMoney(goal.progress.current, goal.currency)}</b>
      <span>of {wholeMoney(goal.targetAmount, goal.currency)}</span>
      {percent !== null && <span className="goal-figures__share">{percent}%</span>}
    </span>
  );
}

function GoalCard({
  goal,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
}) {
  return (
    <li className="goal-card">
      <div className="goal-card__head">
        <span className="goal-card__icon" aria-hidden="true">
          <Icon name="target" className="shell-icon shell-icon--sm" />
        </span>
        <div className="goal-card__title">
          <Link to={`/goals/${goal.id}`} className="goal-card__name">
            {goal.name}
          </Link>
          <small>
            {goal.deadline ? `By ${dateText(goal.deadline)}` : 'No date'} ·{' '}
            {rateText(goal.expectedReturnPercent)}% a year
          </small>
        </div>
        <Badge tone={statusTone[goal.status]}>{statusText[goal.status]}</Badge>
      </div>
      <GoalFigures goal={goal} />
      <GoalBar goal={goal} />
      <p className="goal-card__verdict">{verdict(goal)}</p>
      <div className="goal-card__actions">
        <button type="button" className="goal-link" onClick={() => onEdit(goal)}>
          Edit
        </button>
        <button type="button" className="goal-link" onClick={() => onDelete(goal)}>
          Delete
        </button>
      </div>
    </li>
  );
}

// GOAL-LIST: every goal with where the portfolio stands against it and what it takes.
export default function GoalsPage() {
  const { data: list, error, reload } = useCachedRead(cachedReads.goals);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const { main } = useMainCurrency();

  const add = (
    <button
      type="button"
      className="shell-button shell-button--secondary"
      onClick={() => setEditing('new')}
    >
      <Icon name="plus" className="shell-icon shell-icon--sm" />
      Add goal
    </button>
  );

  return (
    <div className="shell-page">
      <PageHeader title="Goals" actions={add} />
      {error && list === null ? (
        <p className="shell-note" role="alert">
          Could not load the goals. Try again later.
        </p>
      ) : list === null ? (
        <PageSkeleton label="Loading goals" show={['cards']} />
      ) : list.items.length === 0 ? (
        <EmptyState
          id="goals-empty"
          title="No goals yet"
          icon={<Icon name="target" />}
          actions={
            <button
              type="button"
              className="shell-button shell-button--primary"
              onClick={() => setEditing('new')}
            >
              Add goal
            </button>
          }
        >
          Set a sum you want to reach, with a date if you have one. The app works out how much to
          put in each month, or when you get there.
        </EmptyState>
      ) : (
        <>
          <p className="goal-intro">
            A goal is a sum to reach, with a date if you have one. Every goal is measured against
            your whole portfolio, in the currency the goal was set in.
          </p>
          <ul className="goal-list">
            {ordered(list.items).map((goal) => (
              <GoalCard key={goal.id} goal={goal} onEdit={setEditing} onDelete={setDeleting} />
            ))}
          </ul>
          <p className="shell-note">
            <Icon name="info" className="shell-icon shell-icon--sm" /> Projections, not promises:
            they assume the same return every year.
          </p>
        </>
      )}
      {editing !== null && (
        <GoalDialog
          goal={editing === 'new' ? undefined : editing}
          defaultCurrency={main ?? 'USD'}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {deleting !== null && (
        <DeleteGoalDialog
          goal={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
