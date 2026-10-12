import './dashboard.css';

// Grey blocks where the net worth and the chart will appear (prototype "Loading" state).
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
      <div className="shell-card dashboard-loading__card">
        <div className="dashboard-loading__toolbar">
          <i className="dashboard-loading__block dashboard-loading__legend" />
          <i className="dashboard-loading__block dashboard-loading__periods" />
        </div>
        <i className="dashboard-loading__block dashboard-loading__chart" />
      </div>
    </section>
  );
}
