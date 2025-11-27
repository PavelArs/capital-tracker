import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cryptoApi } from '@api';
import type { CryptoWallet, CryptoToken } from '@shared/types';
import { PageHeader } from '@components/common';
import CryptoSkeleton from '@components/CryptoSkeleton';
import ErrorMessage from '@components/ErrorMessage';
import { WalletForm, WalletList, getInitialFormData } from '@features/crypto';
import type { WalletFormData, WalletType, CryptoPrice, TokenPrices } from '@features/crypto';
import './Crypto.css';

export default function Crypto() {
  const { t } = useTranslation();
  const [wallets, setWallets] = useState<CryptoWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [cryptoPrices, setCryptoPrices] = useState<CryptoPrice>({});
  const [tokenPrices, setTokenPrices] = useState<TokenPrices>({});
  const [updatingWalletId, setUpdatingWalletId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<WalletFormData>(getInitialFormData());

  const fetchingRef = useRef(false);

  const fetchCryptoPrices = useCallback(async () => {
    try {
      const prices = await cryptoApi.getPrices();
      // Handle both formats: { BTC: { usd: number } } and { BTC: number }
      const btcPrice =
        typeof prices.BTC === 'object' ? (prices.BTC as { usd: number }).usd : prices.BTC;
      const ethPrice =
        typeof prices.ETH === 'object' ? (prices.ETH as { usd: number }).usd : prices.ETH;
      setCryptoPrices({
        ETH: { usd: ethPrice || 0 },
        BTC: { usd: btcPrice || 0 },
      });
    } catch (err) {
      console.error('Error fetching crypto prices:', err);
    }
  }, []);

  const fetchTokenPrices = useCallback(async () => {
    try {
      const contractAddresses: string[] = [];
      wallets.forEach((wallet) => {
        if (wallet.type === 'ethereum' && wallet.tokens && Array.isArray(wallet.tokens)) {
          wallet.tokens.forEach((token: CryptoToken) => {
            if (
              token.contractAddress &&
              !contractAddresses.includes(token.contractAddress.toLowerCase())
            ) {
              contractAddresses.push(token.contractAddress.toLowerCase());
            }
          });
        }
      });

      if (contractAddresses.length > 0) {
        const prices = await cryptoApi.getTokenPrices(contractAddresses);
        setTokenPrices(prices);
      }
    } catch (err) {
      console.error('Error fetching token prices:', err);
    }
  }, [wallets]);

  const fetchWallets = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setError(null);
      const data = await cryptoApi.getAll();
      const sortedWallets = [...data].sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateA - dateB;
      });
      setWallets(sortedWallets);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.errorLoading');
      setError(message);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [t]);

  useEffect(() => {
    fetchWallets();
    fetchCryptoPrices();
  }, [fetchWallets, fetchCryptoPrices]);

  useEffect(() => {
    if (wallets.length > 0) {
      fetchTokenPrices();
    }
  }, [wallets, fetchTokenPrices]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await cryptoApi.create(formData);
      setShowForm(false);
      setFormData(getInitialFormData());
      fetchWallets();
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        t('common.errorSaving');
      alert(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setFormData(getInitialFormData());
  }, []);

  const handleTypeChange = useCallback((type: WalletType) => {
    setFormData({ type, address: '' });
  }, []);

  const handleAddressChange = useCallback((address: string) => {
    setFormData((prev) => ({ ...prev, address }));
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (window.confirm(t('crypto.deleteConfirm'))) {
        setDeletingId(id);
        try {
          await cryptoApi.delete(id);
          fetchWallets();
        } catch (err: unknown) {
          const errorMessage =
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
            t('common.errorDeleting');
          alert(errorMessage);
        } finally {
          setDeletingId(null);
        }
      }
    },
    [fetchWallets, t]
  );

  const handleUpdateBalance = useCallback(async (id: string) => {
    setUpdatingWalletId(id);
    try {
      const updatedWallet = await cryptoApi.updateBalance(id);

      setWallets((prevWallets) =>
        prevWallets.map((wallet) => (wallet.id === id ? updatedWallet : wallet))
      );

      if (
        updatedWallet.type === 'ethereum' &&
        updatedWallet.tokens &&
        Array.isArray(updatedWallet.tokens)
      ) {
        const contractAddresses = updatedWallet.tokens
          .map((token: CryptoToken) => token.contractAddress)
          .filter((addr: string | undefined): addr is string => !!addr);

        if (contractAddresses.length > 0) {
          try {
            const prices = await cryptoApi.getTokenPrices(
              contractAddresses.map((addr: string) => addr.toLowerCase())
            );
            setTokenPrices((prevPrices) => ({ ...prevPrices, ...prices }));
          } catch {
            console.error('Error fetching token prices');
          }
        }
      }
    } catch {
      console.error('Error updating balance');
    } finally {
      setUpdatingWalletId(null);
    }
  }, []);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchWallets();
  }, [fetchWallets]);

  if (loading) return <CryptoSkeleton />;

  if (error) {
    return (
      <ErrorMessage
        type="page"
        title={t('common.error')}
        message={error}
        onRetry={handleRetry}
        retryText={t('common.retry')}
      />
    );
  }

  return (
    <div className="crypto-page">
      <PageHeader
        title={t('crypto.title')}
        actionLabel={showForm ? t('common.cancel') : t('crypto.addWallet')}
        onAction={showForm ? handleCancel : () => setShowForm(true)}
      />

      <WalletForm
        isOpen={showForm}
        onClose={handleCancel}
        onSubmit={handleSubmit}
        formData={formData}
        onTypeChange={handleTypeChange}
        onAddressChange={handleAddressChange}
        submitting={submitting}
      />

      <WalletList
        wallets={wallets}
        cryptoPrices={cryptoPrices}
        tokenPrices={tokenPrices}
        onUpdateBalance={handleUpdateBalance}
        onDelete={handleDelete}
        updatingWalletId={updatingWalletId}
        deletingId={deletingId}
      />
    </div>
  );
}
