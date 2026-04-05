import type { Currency } from '@shared/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupBy, ViewMode } from '../../types';
import './AssetViewControls.css';

interface AssetViewControlsProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  groupBy: GroupBy;
  setGroupBy: (group: GroupBy) => void;
  selectedCurrency: string;
  setSelectedCurrency: (currency: string) => void;
  currencies: Currency[];
}

export const AssetViewControls = memo(function AssetViewControls({
  viewMode,
  setViewMode,
  groupBy,
  setGroupBy,
  selectedCurrency,
  setSelectedCurrency,
  currencies,
}: AssetViewControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="asset-view-controls">
      <div className="asset-view-controls__group">
        <label className="asset-view-controls__label">{t('assets.viewMode')}</label>
        <div className="asset-view-controls__buttons">
          <button
            className={`asset-view-controls__btn ${viewMode === 'single' ? 'active' : ''}`}
            onClick={() => setViewMode('single')}
          >
            {t('assets.singleCurrency')}
          </button>
          <button
            className={`asset-view-controls__btn ${viewMode === 'all' ? 'active' : ''}`}
            onClick={() => setViewMode('all')}
          >
            {t('assets.allCurrencies')}
          </button>
        </div>
      </div>

      <div className="asset-view-controls__group">
        <label className="asset-view-controls__label">{t('assets.groupBy')}</label>
        <div className="asset-view-controls__buttons">
          <button
            className={`asset-view-controls__btn ${groupBy === 'name' ? 'active' : ''}`}
            onClick={() => setGroupBy('name')}
          >
            {t('assets.byName')}
          </button>
          <button
            className={`asset-view-controls__btn ${groupBy === 'category' ? 'active' : ''}`}
            onClick={() => setGroupBy('category')}
          >
            {t('assets.byCategory')}
          </button>
        </div>
      </div>

      {viewMode === 'single' && (
        <div className="asset-view-controls__group">
          <label className="asset-view-controls__label">{t('assets.displayCurrency')}</label>
          <select
            className="asset-view-controls__select"
            value={selectedCurrency}
            onChange={(e) => setSelectedCurrency(e.target.value)}
          >
            {currencies.map((curr) => (
              <option key={curr.id} value={curr.code}>
                {curr.code} ({curr.symbol})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
});
