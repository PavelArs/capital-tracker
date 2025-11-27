import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import LoadingButton from '@components/LoadingButton';
import { formatAmount } from '@utils/formatters';
import type { LiabilityCardProps } from '../../types';
import './LiabilityCard.css';

interface ExtendedLiability {
  frequency?: string;
  deadline?: string;
}

export const LiabilityCard = memo(function LiabilityCard({
  liability,
  onEdit,
  onDelete,
  isDeleting,
}: LiabilityCardProps) {
  const { t } = useTranslation();

  const currencyCode =
    typeof liability.currency === 'object' && liability.currency !== null
      ? (liability.currency as { code?: string }).code || 'USD'
      : String(liability.currency || 'USD');
  const amount = parseFloat(String(liability.amount));

  const extLiability = liability as unknown as ExtendedLiability;
  const isOverdue = extLiability.deadline && new Date(extLiability.deadline) < new Date();

  return (
    <div className="liability-card">
      <div className="liability-card__left">
        <div className="liability-card__name">{liability.name}</div>
        <div className="liability-card__meta">
          <span className="liability-card__category">{liability.category}</span>
          {extLiability.frequency && (
            <span className="liability-card__frequency">
              {t(`liabilities.frequencies.${extLiability.frequency}`)}
            </span>
          )}
          {extLiability.deadline && (
            <span className={`liability-card__deadline ${isOverdue ? 'overdue' : ''}`}>
              {new Date(extLiability.deadline).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      <div className="liability-card__right">
        <div className="liability-card__amount">
          {formatAmount(amount, currencyCode)} {currencyCode}
        </div>
        <div className="liability-card__actions">
          <button
            className="liability-card__edit-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit(liability);
            }}
            title={t('common.edit')}
            aria-label={t('common.edit')}
            disabled={isDeleting}
          >
            <span className="icon">✏️</span>
          </button>
          <LoadingButton
            className="liability-card__delete-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(liability.id);
            }}
            title={t('common.delete')}
            aria-label={t('common.delete')}
            loading={isDeleting}
            variant="danger"
          >
            <span className="icon">🗑️</span>
          </LoadingButton>
        </div>
      </div>
    </div>
  );
});
