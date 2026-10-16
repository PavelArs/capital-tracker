import { cachedReads } from '@api/cached-reads';
import './dashboard.css';

// Fixed keys for the grey rows: they never reorder.
const ROWS = ['first', 'second', 'third', 'fourth', 'fifth'];
const SLICES = ROWS.slice(0, 4);

/** Five grey rows where the top assets will appear. */
export function AssetRowsLoading() {
  return (
    <div className="dashboard-loading__rows" aria-hidden="true">
      {ROWS.map((row) => (
        <i key={row} className="dashboard-loading__block dashboard-loading__row" />
      ))}
    </div>
  );
}

/** A grey bar and rows where the allocation will appear. */
export function AllocationLoading() {
  return (
    <div className="shell-card dashboard-loading__allocation" aria-hidden="true">
      <i className="dashboard-loading__block dashboard-loading__legend" />
      <i className="dashboard-loading__block dashboard-loading__bar" />
      {SLICES.map((slice) => (
        <i key={slice} className="dashboard-loading__block dashboard-loading__slice" />
      ))}
    </div>
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
        <i className="dashboard-loading__block dashboard-loading__label" />
        <i className="dashboard-loading__block dashboard-loading__value" />
        <i className="dashboard-loading__block dashboard-loading__delta" />
      </div>
      {!hasNoGoal() && <i className="dashboard-loading__block dashboard-loading__goal" />}
      <div className="shell-card dashboard-loading__card">
        <div className="dashboard-loading__toolbar">
          <i className="dashboard-loading__block dashboard-loading__legend" />
          <i className="dashboard-loading__block dashboard-loading__periods" />
        </div>
        <i className="dashboard-loading__block dashboard-loading__chart" />
      </div>
      <div className="dashboard-bottom">
        <div className="shell-card dashboard-loading__card">
          <AssetRowsLoading />
        </div>
        <AllocationLoading />
      </div>
    </section>
  );
}
