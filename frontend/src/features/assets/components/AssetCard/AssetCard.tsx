import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import LoadingButton from '@components/LoadingButton';
import { formatAmount } from '@utils/formatters';
import type { AssetCardProps } from '../../types';
import './AssetCard.css';

export const AssetCard = memo(function AssetCard({
  asset,
  onEdit,
  onDelete,
  isDeleting,
}: AssetCardProps) {
  const { t } = useTranslation();

  const currencyCode = (asset.currency as any)?.code || asset.currency || 'USD';
  const amount = parseFloat(String(asset.amount));

  return (
    <div className="asset-card">
      <div className="asset-card__left">
        <div className="asset-card__name">{asset.name}</div>
        <div className="asset-card__meta">
          <span className={`asset-card__type-badge ${asset.assetType}`}>
            {asset.assetType === 'stock' ? t('assets.stockAssets') : t('assets.flowAssets')}
          </span>
          <span className="asset-card__category">{asset.category}</span>
        </div>
      </div>

      <div className="asset-card__right">
        <div className="asset-card__amount">
          {formatAmount(amount, currencyCode)} {currencyCode}
        </div>
        <div className="asset-card__actions">
          <button
            className="asset-card__edit-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit(asset);
            }}
            title={t('common.edit')}
            aria-label={t('common.edit')}
            disabled={isDeleting}
          >
            <span className="icon">✏️</span>
          </button>
          <LoadingButton
            className="asset-card__delete-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(asset.id);
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

