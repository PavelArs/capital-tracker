import type { CryptoWallet } from '@shared/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CryptoPrice, TokenPrices } from '../../types';
import { WalletCard } from '../WalletCard';
import './WalletList.css';

interface WalletListProps {
  wallets: CryptoWallet[];
  cryptoPrices: CryptoPrice;
  tokenPrices: TokenPrices;
  onUpdateBalance: (id: string) => void;
  onDelete: (id: string) => void;
  updatingWalletId: string | null;
  deletingId: string | null;
}

export const WalletList = memo(function WalletList({
  wallets,
  cryptoPrices,
  tokenPrices,
  onUpdateBalance,
  onDelete,
  updatingWalletId,
  deletingId,
}: WalletListProps) {
  const { t } = useTranslation();

  return (
    <div className="wallet-list">
      <h2 className="wallet-list__title">{t('crypto.yourWallets')}</h2>

      {wallets.length === 0 ? (
        <div className="wallet-list__empty">
          <p>{t('crypto.noWallets')}</p>
        </div>
      ) : (
        <div className="wallet-list__grid">
          {wallets.map((wallet) => (
            <WalletCard
              key={wallet.id}
              wallet={wallet}
              cryptoPrices={cryptoPrices}
              tokenPrices={tokenPrices}
              onUpdateBalance={onUpdateBalance}
              onDelete={onDelete}
              isUpdating={updatingWalletId === wallet.id}
              isDeleting={deletingId === wallet.id}
            />
          ))}
        </div>
      )}
    </div>
  );
});
