import { cachedReads } from '@api/cached-reads';
import type { Goal } from '@api/goals.api';
import { useToast } from '@contexts/ToastContext';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import PageIntro from '@/ui/PageIntro';
import { Icon } from '../shell/icons';
import { useMainCurrency } from '../shell/main-currency';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { useCachedRead } from '../shell/useCachedRead';
import { GoalDialog } from './GoalDialogs';
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

function GoalCard({ goal }: { goal: Goal }) {
  return (
    <Card as="li" className="goal-card">
      <div className="goal-card__head">
        <span className="goal-icon" aria-hidden="true">
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
    </Card>
  );
}

// GOAL-LIST: every goal with where the portfolio stands against it and what it takes. The whole
// card opens the goal; changing or deleting one is done on its page.
export default function GoalsPage() {
  const { data: list, error, reload } = useCachedRead(cachedReads.goals);
  const [adding, setAdding] = useState(false);
  const { main } = useMainCurrency();
  const navigate = useNavigate();
  const location = useLocation();
  // goals-09: a toast says what was just done. A goal deleted on its own page arrives here with
  // word of it, said once; going back to this entry does not say it again.
  const toast = useToast();
  const page = useRef<HTMLDivElement>(null);
  const arrivedDeleted = useRef(
    (location.state as { notice?: string } | null)?.notice === 'deleted',
  );
  // After a delete the page the keyboard was on is gone: it goes to this page's heading, not to
  // the page body.
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus > 0) page.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [refocus]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the arrival is said and cleared.
  useEffect(() => {
    if (!arrivedDeleted.current) return;
    toast.show({ tone: 'success', title: 'Goal deleted' });
    setRefocus((count) => count + 1);
    navigate({ pathname: location.pathname }, { replace: true });
  }, []);
  // goals-35: the most prices behind any goal's figures that are older than 2 hours.
  const stale = staleText(
    Math.max(0, ...(list?.items ?? []).map((goal) => goal.progress.stalePrices ?? 0)),
  );

  const add = (
    <Button icon="plus" onClick={() => setAdding(true)}>
      Add goal
    </Button>
  );

  return (
    <div className="shell-page" ref={page}>
      <PageHeader title="Goals" actions={add} />
      {error && list === null ? (
        <ErrorState onRetry={() => reload()}>Could not load the goals. Try again later.</ErrorState>
      ) : list === null ? (
        <PageSkeleton label="Loading goals" show={['cards']} />
      ) : list.items.length === 0 ? (
        <EmptyState
          id="goals-empty"
          title="No goals yet"
          icon={<Icon name="target" />}
          actions={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add goal
            </Button>
          }
        >
          Set a sum you want to reach, with a date if you have one. The app works out how much to
          put in each month, or when you get there.
        </EmptyState>
      ) : (
        <>
          <PageIntro>
            A goal is a sum to reach, with a date if you have one. Every goal is measured against
            your whole portfolio, in the currency the goal was set in.
          </PageIntro>
          {stale && <Banner tone="warn">{stale}</Banner>}
          <ul className="goal-list">
            {ordered(list.items).map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </ul>
          <Banner tone="neutral" icon="info">
            Projections, not promises: they assume the same return every year.
          </Banner>
        </>
      )}
      {adding && (
        <GoalDialog
          defaultCurrency={main ?? 'USD'}
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            // A new goal opens on its own page, which says it was added.
            navigate(`/goals/${saved.id}`, { state: { notice: 'added' } });
          }}
        />
      )}
    </div>
  );
}
