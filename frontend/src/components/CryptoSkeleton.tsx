import React from 'react';
import Skeleton from './Skeleton';
import './CryptoSkeleton.css';

export const CryptoSkeleton: React.FC = () => {
  return (
    <div className="crypto-skeleton">
      <div className="page-header-skeleton">
        <Skeleton width="180px" height="36px" />
        <Skeleton width="140px" height="40px" variant="rounded" />
      </div>

      <Skeleton width="150px" height="28px" />

      <div className="wallets-grid-skeleton">
        {[...Array(3)].map((_, index) => (
          <div key={index} className="wallet-card-skeleton">
            <div className="wallet-header-skeleton">
              <Skeleton width="100px" height="24px" />
              <Skeleton width="100%" height="16px" />
            </div>
            <div className="wallet-balance-skeleton">
              <Skeleton width="80px" height="20px" />
              <Skeleton width="150px" height="32px" />
              <Skeleton width="120px" height="20px" />
            </div>
            <div className="wallet-actions-skeleton">
              <Skeleton width="120px" height="36px" variant="rounded" />
              <Skeleton width="80px" height="36px" variant="rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CryptoSkeleton;
