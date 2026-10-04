import { Modal } from '@components/common';
import LoadingButton from '@components/LoadingButton';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ADDRESS_PLACEHOLDERS, WALLET_TYPES } from '../../constants';
import type { WalletFormProps, WalletType } from '../../types';
import './WalletForm.css';

export function WalletForm({
  isOpen,
  onClose,
  onSubmit,
  formData,
  onTypeChange,
  onAddressChange,
  submitting,
}: WalletFormProps) {
  const { t } = useTranslation();

  const addressPlaceholder = useMemo(() => ADDRESS_PLACEHOLDERS[formData.type], [formData.type]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('crypto.addWallet')}
      className="wallet-form-modal"
    >
      <form onSubmit={onSubmit} className="wallet-form">
        <div className="form-group">
          <label htmlFor="wallet-type">{t('crypto.walletType')}</label>
          <select
            id="wallet-type"
            value={formData.type}
            onChange={(e) => onTypeChange(e.target.value as WalletType)}
            required
          >
            {WALLET_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="wallet-address">{t('crypto.address')}</label>
          <input
            id="wallet-address"
            type="text"
            value={formData.address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder={addressPlaceholder}
            required
          />
        </div>

        <div className="form-actions">
          <LoadingButton
            type="submit"
            className="btn-primary"
            loading={submitting}
            loadingText={t('common.saving')}
          >
            {t('crypto.addWallet')}
          </LoadingButton>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={submitting}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
