import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { LiabilityCard } from '../LiabilityCard';
import type { Liability } from '@shared/types';
import './LiabilityList.css';

interface LiabilityListProps {
  liabilities: Liability[];
  onEdit: (liability: Liability) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}

export const LiabilityList = memo(function LiabilityList({
  liabilities,
  onEdit,
  onDelete,
  deletingId,
}: LiabilityListProps) {
  const { t } = useTranslation();

  return (
    <div className="liability-list">
      <h2 className="liability-list__title">{t('liabilities.allLiabilities')}</h2>

      {liabilities.length === 0 ? (
        <div className="liability-list__empty">
          <p>{t('liabilities.noLiabilities')}</p>
        </div>
      ) : (
        <div className="liability-list__cards">
          {liabilities.map((liability) => (
            <LiabilityCard
              key={liability.id}
              liability={liability}
              onEdit={onEdit}
              onDelete={onDelete}
              isDeleting={deletingId === liability.id}
            />
          ))}
        </div>
      )}
    </div>
  );
});
