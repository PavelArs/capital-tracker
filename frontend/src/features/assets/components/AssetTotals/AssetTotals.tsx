import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAmount } from '@utils/formatters';
import type { TotalAmount, ViewMode, AssetTab } from '../../types';
import './AssetTotals.css';

interface AssetTotalsProps {
  totalAmount: TotalAmount;
  viewMode: ViewMode;
  activeTab: AssetTab;
}

export const AssetTotals = memo(function AssetTotals({
  totalAmount,
  viewMode,
  activeTab,
}: AssetTotalsProps) {
  const { t } = useTranslation();

  const showStock = activeTab === 'overview' || activeTab === 'stock';
  const showFlow = activeTab === 'overview' || activeTab === 'flow';
  const hasStockTotals = totalAmount.stock.length > 0;
  const hasFlowTotals = totalAmount.flow.length > 0;

  if (viewMode === 'single') {
    if (!hasStockTotals && !hasFlowTotals) return null;

    return (
      <div className="asset-totals asset-totals--single">
        {showStock && hasStockTotals && (
          <div className="asset-totals__item asset-totals__item--stock">
            <span className="asset-totals__label">{t('assets.stockAssetsTotal')}</span>
            <span className="asset-totals__value">
              {formatAmount(totalAmount.stock[0].amount, totalAmount.stock[0].currency)}{' '}
              {totalAmount.stock[0].currency}
            </span>
          </div>
        )}
        {showFlow && hasFlowTotals && (
          <div className="asset-totals__item asset-totals__item--flow">
            <span className="asset-totals__label">{t('assets.flowIncomeTotal')}</span>
            <span className="asset-totals__value">
              {formatAmount(totalAmount.flow[0].amount, totalAmount.flow[0].currency)}{' '}
              {totalAmount.flow[0].currency}
            </span>
          </div>
        )}
      </div>
    );
  }

  // viewMode === 'all'
  if (!hasStockTotals && !hasFlowTotals) return null;

  return (
    <div className="asset-totals asset-totals--all">
      {showStock && hasStockTotals && (
        <div className="asset-totals__section">
          <span className="asset-totals__section-label">{t('assets.stockAssetsTotal')}:</span>
          <div className="asset-totals__amounts">
            {totalAmount.stock.map((item, index) => (
              <span key={index} className="asset-totals__amount asset-totals__amount--stock">
                {formatAmount(item.amount, item.currency)} {item.currency}
              </span>
            ))}
          </div>
        </div>
      )}
      {showFlow && hasFlowTotals && (
        <div className="asset-totals__section">
          <span className="asset-totals__section-label">{t('assets.flowIncomeTotal')}:</span>
          <div className="asset-totals__amounts">
            {totalAmount.flow.map((item, index) => (
              <span key={index} className="asset-totals__amount asset-totals__amount--flow">
                {formatAmount(item.amount, item.currency)} {item.currency}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

