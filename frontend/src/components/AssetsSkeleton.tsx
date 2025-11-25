import React from 'react';
import Skeleton from './Skeleton';
import './AssetsSkeleton.css';

export const AssetsSkeleton: React.FC = () => {
  return (
    <div className="assets-skeleton">
      <div className="page-header-skeleton">
        <Skeleton width="150px" height="36px" />
        <Skeleton width="120px" height="40px" variant="rounded" />
      </div>

      {/* Sub-navigation */}
      <div className="sub-nav-skeleton">
        <Skeleton width="100px" height="36px" variant="rounded" />
        <Skeleton width="120px" height="36px" variant="rounded" />
        <Skeleton width="110px" height="36px" variant="rounded" />
      </div>

      {/* View controls */}
      <div className="view-controls-skeleton">
        <Skeleton width="200px" height="36px" />
        <Skeleton width="200px" height="36px" />
      </div>

      {/* Content */}
      <div className="assets-content-skeleton">
        <div className="assets-list-skeleton">
          <Skeleton width="150px" height="28px" />
          <div className="assets-cards-skeleton">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="asset-card-skeleton">
                <div className="asset-card-left-skeleton">
                  <Skeleton width="150px" height="24px" />
                  <Skeleton width="200px" height="20px" />
                </div>
                <div className="asset-card-right-skeleton">
                  <Skeleton width="120px" height="24px" />
                  <Skeleton width="80px" height="32px" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className="chart-container-skeleton">
          <Skeleton width="180px" height="28px" />
          <div className="chart-skeleton">
            <Skeleton width="300px" height="300px" variant="circular" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetsSkeleton;



