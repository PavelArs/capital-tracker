import { Modal } from '@components/common';
import LoadingButton from '@components/LoadingButton';
import { useTranslation } from 'react-i18next';
import {
  ACTIVE_INCOME_CATEGORIES,
  FLOW_CATEGORIES,
  PASSIVE_INCOME_CATEGORIES,
  STOCK_CATEGORIES,
} from '../../constants';
import type { AssetFormProps, IncomeType } from '../../types';
import './AssetForm.css';

export function AssetForm({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  currencies,
  editingId,
  submitting,
}: AssetFormProps) {
  const { t } = useTranslation();

  const categories = formData.assetType === 'stock' ? STOCK_CATEGORIES : FLOW_CATEGORIES;

  const handleAssetTypeChange = (assetType: string) => {
    setFormData({
      ...formData,
      assetType,
      category: assetType === 'stock' ? 'investments' : 'salary',
      incomeType: assetType === 'flow' ? 'active' : '',
    });
  };

  const handleCategoryChange = (category: string) => {
    let incomeType = formData.incomeType;
    if (formData.assetType === 'flow') {
      if (ACTIVE_INCOME_CATEGORIES.includes(category)) {
        incomeType = 'active';
      } else if (PASSIVE_INCOME_CATEGORIES.includes(category)) {
        incomeType = 'passive';
      }
    }
    setFormData({ ...formData, category, incomeType });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingId ? t('assets.editAsset') : t('assets.addNewAsset')}
      className="asset-form-modal"
    >
      <form onSubmit={onSubmit} className="asset-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="asset-name">{t('common.name')}</label>
            <input
              id="asset-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="asset-type">{t('assets.assetType')}</label>
            <select
              id="asset-type"
              value={formData.assetType}
              onChange={(e) => handleAssetTypeChange(e.target.value)}
              required
            >
              <option value="stock">{t('assets.stockType')}</option>
              <option value="flow">{t('assets.flowType')}</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="asset-category">{t('common.category')}</label>
            <select
              id="asset-category"
              value={formData.category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              required
            >
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {t(cat.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {formData.assetType === 'flow' && (
            <div className="form-group">
              <label htmlFor="income-type">{t('assets.incomeType')}</label>
              <select
                id="income-type"
                value={formData.incomeType}
                onChange={(e) =>
                  setFormData({ ...formData, incomeType: e.target.value as IncomeType })
                }
                required
              >
                <option value="active">{t('assets.activeIncome')}</option>
                <option value="passive">{t('assets.passiveIncome')}</option>
              </select>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="asset-amount">{t('common.amount')}</label>
            <input
              id="asset-amount"
              type="number"
              step="any"
              min="0"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="asset-currency">{t('common.currency')}</label>
            <select
              id="asset-currency"
              value={formData.currencyId}
              onChange={(e) => setFormData({ ...formData, currencyId: e.target.value })}
              required
            >
              {currencies.map((curr) => (
                <option key={curr.id} value={curr.id}>
                  {curr.code} - {curr.name} ({curr.symbol})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="asset-date">{t('common.date')}</label>
            <input
              id="asset-date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="asset-description">{t('common.description')}</label>
          <textarea
            id="asset-description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
          />
        </div>

        <div className="form-actions">
          <LoadingButton type="submit" loading={submitting} loadingText={t('common.saving')}>
            {editingId ? t('assets.updateAsset') : t('assets.createAsset')}
          </LoadingButton>
          <button type="button" onClick={onClose} className="cancel-btn" disabled={submitting}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
