import React from 'react';
import Skeleton from './Skeleton';
import './DashboardSkeleton.css';

export const DashboardSkeleton: React.FC = () => {
  return (
    <div className="dashboard-skeleton">
      <div className="dashboard-header-skeleton">
        <Skeleton width="200px" height="36px" />
        <Skeleton width="150px" height="40px" variant="rounded" />
      </div>

      {/* Metrics Grid */}
      <div className="metrics-grid-skeleton">
        {[...Array(6)].map((_, index) => (
          <div key={index} className="metric-card-skeleton">
            <Skeleton width="120px" height="24px" />
            <Skeleton width="100%" height="40px" />
            <Skeleton width="80%" height="16px" />
          </div>
        ))}
      </div>

      {/* Chart Container */}
      <div className="chart-container-skeleton">
        <Skeleton width="180px" height="28px" />
        <div className="chart-skeleton">
          <Skeleton width="100%" height="300px" variant="rounded" />
        </div>
      </div>

      {/* Distribution Cards */}
      <div className="distribution-container-skeleton">
        {[...Array(3)].map((_, index) => (
          <div key={index} className="distribution-card-skeleton">
            <Skeleton width="200px" height="28px" />
            <div className="distribution-list-skeleton">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="distribution-item-skeleton">
                  <Skeleton width="70%" height="20px" />
                  <Skeleton width="60px" height="20px" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DashboardSkeleton;



