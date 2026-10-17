import { cachedReads } from '@api/cached-reads';
import { Card } from '@/ui/Card';
import { Bone } from '../shell/Skeleton';
import './dashboard.css';

// Fixed keys for the grey rows: they never reorder.
const ROWS = ['first', 'second', 'third', 'fourth', 'fifth'];
const SLICES = ROWS.slice(0, 4);

/** Five grey rows where the top assets will appear. */
export function AssetRowsLoading() {
  return (
    <div className="dashboard-loading__rows" aria-hidden="true">
      {ROWS.map((row) => (
        <div key={row} className="dashboard-loading__row">
          <Bone height={32} />
        </div>
      ))}
    </div>
  );
}

/** A grey bar and rows where the allocation will appear. */
export function AllocationLoading() {
  return (
    <Card as="div">
      <div aria-hidden="true" className="dashboard-loading__allocation">
        <Bone width={220} height={16} />
        <Bone height={10} />
        {SLICES.map((slice) => (
          <Bone key={slice} height={22} />
        ))}
      </div>
    </Card>
  );
}

// An owner known to have no open goal gets no goal block, so nothing jumps when the page lands.
const hasNoGoal = () =>
  cachedReads.goals.last()?.items.every((goal) => goal.status === 'reached') ?? false;

// Grey blocks where the whole page will appear: net worth, goal, chart, top assets and
// allocation (prototype "Loading" state).
export default function DashboardLoading() {
  return (
    <section
      className="dashboard-loading"
      role="status"
      aria-busy="true"
      aria-label="Loading your capital"
    >
      <div className="dashboard-loading__hero">
        <Bone width={140} height={14} />
        <Bone width="min(340px, 80%)" height={52} />
        <Bone width="min(240px, 60%)" height={18} />
      </div>
      {!hasNoGoal() && (
        <div className="dashboard-loading__goal">
          <Bone height={76} />
        </div>
      )}
      <Card as="div" className="dashboard-loading__card">
        <div className="dashboard-loading__toolbar">
          <Bone width={220} height={16} />
          <Bone width="min(260px, 45%)" height={30} />
        </div>
        <div className="dashboard-loading__chart">
          <Bone height={290} />
        </div>
      </Card>
      <div className="dashboard-bottom">
        <Card as="div" className="dashboard-loading__card">
          <AssetRowsLoading />
        </Card>
        <AllocationLoading />
      </div>
    </section>
  );
}
