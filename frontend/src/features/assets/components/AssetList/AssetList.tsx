import type { Asset } from '@shared/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AssetCard } from '../AssetCard';
import './AssetList.css';

interface AssetListProps {
  assets: Asset[];
  activeTab: 'stock' | 'flow' | 'overview';
  onEdit: (asset: Asset) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}

export const AssetList = memo(function AssetList({
  assets,
  activeTab,
  onEdit,
  onDelete,
  deletingId,
}: AssetListProps) {
  const { t } = useTranslation();

  const title =
    activeTab === 'stock'
      ? t('assets.stockAssets')
      : activeTab === 'flow'
        ? t('assets.flowAssets')
        : t('assets.allAssets');

  return (
    <div className="asset-list">
      <h2 className="asset-list__title">{title}</h2>

      {assets.length === 0 ? (
        <div className="asset-list__empty">
          <p>{t('assets.noAssets')}</p>
        </div>
      ) : (
        <div className="asset-list__cards">
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onEdit={onEdit}
              onDelete={onDelete}
              isDeleting={deletingId === asset.id}
            />
          ))}
        </div>
      )}
    </div>
  );
});
