import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import LoadingButton from '@components/LoadingButton';
import type { CryptoToken } from '@shared/types';
import type { WalletCardProps } from '../../types';
import './WalletCard.css';

export const WalletCard = memo(function WalletCard({
  wallet,
  cryptoPrices,
  tokenPrices,
  onUpdateBalance,
  onDelete,
  isUpdating,
  isDeleting,
}: WalletCardProps) {
  const { t } = useTranslation();

  const symbol = wallet.type === 'ethereum' ? 'ETH' : 'BTC';
  const price = cryptoPrices[symbol]?.usd || 0;
  const balance = parseFloat(wallet.balance.toString());

  const walletValue = useMemo(() => {
    let totalValue = balance * price;

    if (wallet.type === 'ethereum' && wallet.tokens && Array.isArray(wallet.tokens)) {
      wallet.tokens.forEach((token: CryptoToken) => {
        if (token.contractAddress) {
          const tokenPrice = tokenPrices[token.contractAddress.toLowerCase()] || 0;
          const tokenBalance = parseFloat(token.balance.toString());
          totalValue += tokenBalance * tokenPrice;
        }
      });
    }

    return totalValue;
  }, [wallet, balance, price, tokenPrices]);

  const formatUSD = (value: number) =>
    value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="wallet-card">
      <div className="wallet-card__header">
        <h3 className="wallet-card__type">{wallet.type.toUpperCase()}</h3>
        <span className="wallet-card__address" title={wallet.address}>
          {wallet.address}
        </span>
      </div>

      <div className="wallet-card__balance">
        <p className="wallet-card__balance-label">{t('crypto.balance')}</p>
        <p className="wallet-card__balance-value">
          {balance.toFixed(8)} {symbol}
        </p>
        {price > 0 && (
          <p className="wallet-card__balance-usd">≈ ${formatUSD(walletValue)} USD</p>
        )}
      </div>

      {wallet.type === 'ethereum' &&
        wallet.tokens &&
        Array.isArray(wallet.tokens) &&
        wallet.tokens.length > 0 && (
          <div className="wallet-card__tokens">
            <p className="wallet-card__tokens-label">{t('crypto.tokens')}</p>
            <ul className="wallet-card__tokens-list">
              {wallet.tokens.map((token: CryptoToken, index: number) => {
                const tokenPrice = token.contractAddress
                  ? tokenPrices[token.contractAddress.toLowerCase()] || 0
                  : 0;
                const tokenBalance = parseFloat(token.balance.toString());
                const tokenValueUSD = tokenPrice * tokenBalance;

                return (
                  <li key={index} className="wallet-card__token">
                    <div className="wallet-card__token-info">
                      <span className="wallet-card__token-symbol">{token.symbol}</span>
                      <span className="wallet-card__token-balance">
                        {tokenBalance.toFixed(4)}
                      </span>
                    </div>
                    {tokenPrice > 0 && (
                      <span className="wallet-card__token-usd">
                        ≈ ${formatUSD(tokenValueUSD)} USD
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

      <div className="wallet-card__actions">
        <LoadingButton
          className="wallet-card__update-btn"
          onClick={() => onUpdateBalance(wallet.id)}
          loading={isUpdating}
          loadingText={t('common.loading')}
          disabled={isDeleting}
        >
          {t('crypto.updateBalance')}
        </LoadingButton>
        <LoadingButton
          className="wallet-card__delete-btn"
          onClick={() => onDelete(wallet.id)}
          loading={isDeleting}
          disabled={isUpdating}
          variant="danger"
        >
          {t('common.delete')}
        </LoadingButton>
      </div>

      {wallet.lastUpdated && (
        <p className="wallet-card__last-updated">
          {t('crypto.lastUpdated')} {new Date(wallet.lastUpdated).toLocaleString()}
        </p>
      )}
    </div>
  );
});

