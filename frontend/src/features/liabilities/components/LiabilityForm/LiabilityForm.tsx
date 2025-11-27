import { useTranslation } from 'react-i18next';
import { Modal } from '@components/common';
import LoadingButton from '@components/LoadingButton';
import type { LiabilityFormProps, FrequencyType } from '../../types';
import {
  LIABILITY_CATEGORIES,
  FREQUENCY_OPTIONS,
  REGULAR_CATEGORIES,
  NON_REGULAR_CATEGORIES,
} from '../../constants';
import './LiabilityForm.css';

export function LiabilityForm({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  currencies,
  editingId,
  submitting,
}: LiabilityFormProps) {
  const { t } = useTranslation();

  const isRegularCategory = REGULAR_CATEGORIES.includes(formData.category);
  const isNonRegularCategory = NON_REGULAR_CATEGORIES.includes(formData.category);

  const handleCategoryChange = (category: string) => {
    const isRegular = REGULAR_CATEGORIES.includes(category);
    const isNonRegular = NON_REGULAR_CATEGORIES.includes(category);

    setFormData((prev) => ({
      ...prev,
      category,
      frequency: isRegular ? prev.frequency || 'monthly' : '',
      deadline: isNonRegular ? prev.deadline || '' : '',
    }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingId ? t('liabilities.editLiability') : t('liabilities.addNewLiability')}
      className="liability-form-modal"
    >
      <form onSubmit={onSubmit} className="liability-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="liability-name">{t('common.name')}</label>
            <input
              id="liability-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="liability-category">{t('common.category')}</label>
            <select
              id="liability-category"
              value={formData.category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              required
            >
              {LIABILITY_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {t(cat.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="liability-amount">{t('common.amount')}</label>
            <input
              id="liability-amount"
              type="number"
              step="any"
              min="0"
              value={formData.amount}
              onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="liability-currency">{t('common.currency')}</label>
            <select
              id="liability-currency"
              value={formData.currencyId}
              onChange={(e) => setFormData((prev) => ({ ...prev, currencyId: e.target.value }))}
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
            <label htmlFor="liability-date">{t('common.date')}</label>
            <input
              id="liability-date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))}
              required
            />
          </div>
        </div>

        <div className="form-row">
          {isRegularCategory && (
            <div className="form-group">
              <label htmlFor="liability-frequency">{t('liabilities.frequency')}</label>
              <select
                id="liability-frequency"
                value={formData.frequency || 'monthly'}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, frequency: e.target.value as FrequencyType }))
                }
                required
              >
                {FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isNonRegularCategory && (
            <div className="form-group">
              <label htmlFor="liability-deadline">{t('liabilities.deadline')}</label>
              <input
                id="liability-deadline"
                type="date"
                value={formData.deadline}
                onChange={(e) => setFormData((prev) => ({ ...prev, deadline: e.target.value }))}
              />
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="liability-description">{t('common.description')}</label>
          <textarea
            id="liability-description"
            value={formData.description}
            onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
            rows={3}
          />
        </div>

        <div className="form-actions">
          <LoadingButton type="submit" loading={submitting} loadingText={t('common.saving')}>
            {editingId ? t('liabilities.updateLiability') : t('liabilities.createLiability')}
          </LoadingButton>
          <button type="button" onClick={onClose} className="cancel-btn" disabled={submitting}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
