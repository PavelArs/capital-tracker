import React from 'react';
import Skeleton from './Skeleton';
import './CurrenciesSkeleton.css';

export const CurrenciesSkeleton: React.FC = () => {
  return (
    <div className="currencies-skeleton">
      <div className="currencies-header-skeleton">
        <div>
          <Skeleton width="200px" height="36px" />
          <Skeleton width="300px" height="20px" style={{ marginTop: '0.5rem' }} />
        </div>
      </div>

      <div className="tabs-skeleton">
        <Skeleton width="150px" height="40px" variant="rounded" />
        <Skeleton width="150px" height="40px" variant="rounded" />
      </div>

      <div className="currency-group-skeleton">
        <Skeleton width="200px" height="28px" />
        <div className="currency-table-skeleton">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="currency-row-skeleton">
              <Skeleton width="80px" height="20px" />
              <Skeleton width="150px" height="20px" />
              <Skeleton width="60px" height="20px" />
              <Skeleton width="100px" height="24px" variant="rounded" />
              <Skeleton width="100px" height="32px" variant="rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CurrenciesSkeleton;
