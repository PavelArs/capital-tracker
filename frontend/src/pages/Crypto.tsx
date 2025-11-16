import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import './Crypto.css';

interface CryptoPrice {
  [symbol: string]: {
    usd: number;
  };
}

export default function Crypto() {
  const { t } = useTranslation();
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [cryptoPrices, setCryptoPrices] = useState<CryptoPrice>({});
  const [tokenPrices, setTokenPrices] = useState<{ [address: string]: number }>({});
  const [updatingWalletId, setUpdatingWalletId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    type: 'ethereum',
    address: '',
  });

  useEffect(() => {
    fetchWallets();
    fetchCryptoPrices();
  }, []);

  useEffect(() => {
    // Fetch token prices when wallets are loaded
    if (wallets.length > 0) {
      fetchTokenPrices();
    }
  }, [wallets]);

  const fetchCryptoPrices = async () => {
    try {
      // Use backend endpoint instead of direct CoinGecko API call
      const response = await axios.get('/crypto/prices');
      const prices: CryptoPrice = {
        ETH: { usd: response.data.ETH?.usd || 0 },
        BTC: { usd: response.data.BTC?.usd || 0 },
      };
      setCryptoPrices(prices);
    } catch (error) {
      console.error('Error fetching crypto prices:', error);
    }
  };

  const fetchTokenPrices = async () => {
    try {
      // Collect all token contract addresses from Ethereum wallets
      const contractAddresses: string[] = [];
      wallets.forEach((wallet) => {
        if (wallet.type === 'ethereum' && wallet.tokens && Array.isArray(wallet.tokens)) {
          wallet.tokens.forEach((token: any) => {
            if (token.contractAddress && !contractAddresses.includes(token.contractAddress.toLowerCase())) {
              contractAddresses.push(token.contractAddress.toLowerCase());
            }
          });
        }
      });

      if (contractAddresses.length > 0) {
        const response = await axios.post('/crypto/token-prices', {
          contractAddresses,
        });
        setTokenPrices(response.data);
      }
    } catch (error) {
      console.error('Error fetching token prices:', error);
    }
  };

  const fetchWallets = async () => {
    try {
      const response = await axios.get('/crypto');
      // Sort wallets by creation date to maintain consistent order
      const sortedWallets = [...response.data].sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateA - dateB; // Oldest first
      });
      setWallets(sortedWallets);
    } catch (error) {
      console.error('Error fetching wallets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post('/crypto', formData);
      setShowForm(false);
      setFormData({ type: 'ethereum', address: '' });
      fetchWallets();
    } catch (error) {
      console.error('Error creating wallet:', error);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setFormData({ type: 'ethereum', address: '' });
  };

  const getAddressPlaceholder = () => {
    return formData.type === 'bitcoin' ? 'bc1... or 1... or 3...' : '0x...';
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('crypto.deleteConfirm'))) {
      try {
        await axios.delete(`/crypto/${id}`);
        fetchWallets();
      } catch (error) {
        console.error('Error deleting wallet:', error);
      }
    }
  };

  const handleUpdateBalance = async (id: string) => {
    setUpdatingWalletId(id);
    try {
      // Update only the specific wallet
      const response = await axios.patch(`/crypto/${id}/update-balance`);
      const updatedWallet = response.data;
      
      // Update only the specific wallet in the list without reordering
      setWallets(prevWallets => {
        return prevWallets.map(wallet => 
          wallet.id === id ? updatedWallet : wallet
        );
      });
      
      // Fetch token prices if this is an Ethereum wallet with tokens
      if (updatedWallet.type === 'ethereum' && updatedWallet.tokens && Array.isArray(updatedWallet.tokens)) {
        const contractAddresses = updatedWallet.tokens
          .map((token: any) => token.contractAddress)
          .filter((addr: string) => addr);
        
        if (contractAddresses.length > 0) {
          try {
            const tokenPricesResponse = await axios.post('/crypto/token-prices', {
              contractAddresses: contractAddresses.map((addr: string) => addr.toLowerCase()),
            });
            setTokenPrices(prevPrices => ({
              ...prevPrices,
              ...tokenPricesResponse.data,
            }));
          } catch (error) {
            console.error('Error fetching token prices:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error updating balance:', error);
    } finally {
      setUpdatingWalletId(null);
    }
  };

  const calculateWalletValue = (wallet: any): number => {
    let totalValue = 0;
    const symbol = wallet.type === 'ethereum' ? 'ETH' : 'BTC';
    const price = cryptoPrices[symbol]?.usd || 0;
    
    // Add native currency value
    totalValue += parseFloat(wallet.balance.toString()) * price;
    
    // Add token values (for Ethereum only)
    if (wallet.type === 'ethereum' && wallet.tokens && Array.isArray(wallet.tokens)) {
      wallet.tokens.forEach((token: any) => {
        if (token.contractAddress) {
          const tokenPrice = tokenPrices[token.contractAddress.toLowerCase()] || 0;
          const tokenBalance = parseFloat(token.balance.toString());
          totalValue += tokenBalance * tokenPrice;
        }
      });
    }
    
    return totalValue;
  };

  if (loading) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  return (
    <div className="crypto-page">
      <div className="page-header">
        <h1>{t('crypto.title')}</h1>
        <button onClick={() => setShowForm(true)}>
          {t('crypto.addWallet')}
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('crypto.addWallet')}</h2>
              <button className="modal-close" onClick={handleCancel}>
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="crypto-form">
              <div className="form-group">
                <label>{t('crypto.walletType')}</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value, address: '' })}
                  required
                >
                  <option value="ethereum">Ethereum</option>
                  <option value="bitcoin">Bitcoin</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('crypto.address')}</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder={getAddressPlaceholder()}
                  required
                />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  {t('crypto.addWallet')}
                </button>
                <button type="button" onClick={handleCancel} className="btn-secondary">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="wallets-list">
        <h2>{t('crypto.yourWallets')}</h2>
        {wallets.length === 0 ? (
          <p>{t('crypto.noWallets')}</p>
        ) : (
          <div className="wallets-grid">
            {wallets.map((wallet) => (
              <div key={wallet.id} className="wallet-card">
                <div className="wallet-header">
                  <h3>{wallet.type.toUpperCase()}</h3>
                  <span className="wallet-address">{wallet.address}</span>
                </div>
                <div className="wallet-balance">
                  <p className="balance-label">{t('crypto.balance')}</p>
                  <p className="balance-value">
                    {parseFloat(wallet.balance.toString()).toFixed(8)}{' '}
                    {wallet.type === 'ethereum' ? 'ETH' : 'BTC'}
                  </p>
                  {cryptoPrices[wallet.type === 'ethereum' ? 'ETH' : 'BTC']?.usd > 0 && (
                    <p className="balance-usd">
                      ≈ ${calculateWalletValue(wallet).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} USD
                    </p>
                  )}
                </div>
                {wallet.type === 'ethereum' && wallet.tokens && Array.isArray(wallet.tokens) && wallet.tokens.length > 0 && (
                  <div className="wallet-tokens">
                    <p className="tokens-label">{t('crypto.tokens')}</p>
                    <ul className="tokens-list">
                      {wallet.tokens.map((token: any, index: number) => {
                        const tokenPrice = token.contractAddress 
                          ? tokenPrices[token.contractAddress.toLowerCase()] || 0 
                          : 0;
                        const tokenValueUSD = tokenPrice * parseFloat(token.balance.toString());
                        return (
                          <li key={index} className="token-item">
                            <div className="token-info">
                              <span className="token-symbol">{token.symbol}</span>
                              <span className="token-balance">
                                {parseFloat(token.balance.toString()).toFixed(4)}
                              </span>
                            </div>
                            {tokenPrice > 0 && (
                              <div className="token-value">
                                <span className="token-usd">
                                  ≈ ${tokenValueUSD.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })} USD
                                </span>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className="wallet-actions">
                  <button
                    className="update-btn"
                    onClick={() => handleUpdateBalance(wallet.id)}
                    disabled={updatingWalletId === wallet.id}
                  >
                    {updatingWalletId === wallet.id 
                      ? t('common.loading') || 'Loading...' 
                      : t('crypto.updateBalance')}
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(wallet.id)}
                    disabled={updatingWalletId === wallet.id}
                  >
                    {t('common.delete')}
                  </button>
                </div>
                {wallet.lastUpdated && (
                  <p className="last-updated">
                    {t('crypto.lastUpdated')} {new Date(wallet.lastUpdated).toLocaleString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

