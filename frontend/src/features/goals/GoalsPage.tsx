import { cachedReads } from '@api/cached-reads';
import type { Goal } from '@api/goals.api';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import EmptyState from '@/ui/EmptyState';
import { Icon } from '../shell/icons';
import { useMainCurrency } from '../shell/main-currency';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { DeleteGoalDialog, GoalDialog } from './GoalDialogs';
import { GoalBar, GoalFigures } from './GoalProgress';
import {
  dateText,
  ordered,
  rateText,
  staleText,
  statusText,
  statusTone,
  verdict,
} from './goal-format';
import '../shell/shell-page.css';
import './goals.css';

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
        <Badge tone={statusTone[goal.status]} dot>
          {statusText[goal.status]}
        </Badge>
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
  const navigate = useNavigate();
  const location = useLocation();
  // goals-08, goals-09: a line that says what was just done. A goal deleted on its own page
  // arrives here with word of it, said once; going back to this entry does not say it again.
  const [notice, setNotice] = useState<{ text: string; focus: boolean } | null>(() =>
    (location.state as { notice?: string } | null)?.notice === 'deleted'
      ? { text: 'Goal deleted.', focus: true }
      : null,
  );
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the arrival is cleared.
  useEffect(() => {
    if (notice) navigate({ pathname: location.pathname }, { replace: true });
  }, []);
  // After a delete the button that opened the dialog is gone: the keyboard goes to the line
  // that says the goal was deleted, not to the page body.
  useEffect(() => {
    if (notice?.focus) noticeRef.current?.focus();
  }, [notice]);
  // goals-35: the most prices behind any goal's figures that are older than 2 hours.
  const stale = staleText(
    Math.max(0, ...(list?.items ?? []).map((goal) => goal.progress.stalePrices ?? 0)),
  );

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
      {notice && (
        <p
          ref={noticeRef}
          className="ui-banner ui-banner--pos"
          role="status"
          tabIndex={-1}
          key={notice.text}
        >
          {notice.text}
        </p>
      )}
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
          {stale && (
            <p className="ui-banner ui-banner--warn" role="note">
              {stale}
            </p>
          )}
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
          onSaved={(saved) => {
            // A new goal opens on its own page, which says it was added.
            if (editing === 'new') {
              navigate(`/goals/${saved.id}`, { state: { notice: 'added' } });
              return;
            }
            setEditing(null);
            setNotice({ text: 'Goal saved.', focus: false });
            reload(true);
          }}
        />
      )}
      {deleting !== null && (
        <DeleteGoalDialog
          goal={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            setNotice({ text: 'Goal deleted.', focus: true });
            // The other goals stay on screen while the list is asked for again.
            reload(true);
          }}
        />
      )}
    </div>
  );
}
