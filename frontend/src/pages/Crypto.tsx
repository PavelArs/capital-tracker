import { useEffect, useState } from 'react';
import axios from 'axios';
import './Crypto.css';

interface CryptoPrice {
  [symbol: string]: {
    usd: number;
  };
}

export default function Crypto() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [cryptoPrices, setCryptoPrices] = useState<CryptoPrice>({});
  const [formData, setFormData] = useState({
    type: 'ethereum',
    address: '',
  });

  useEffect(() => {
    fetchWallets();
    fetchCryptoPrices();
  }, []);

  const fetchCryptoPrices = async () => {
    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd'
      );
      const prices: CryptoPrice = {
        ETH: { usd: response.data.ethereum?.usd || 0 },
        BTC: { usd: response.data.bitcoin?.usd || 0 },
      };
      setCryptoPrices(prices);
    } catch (error) {
      console.error('Error fetching crypto prices:', error);
    }
  };

  const fetchWallets = async () => {
    try {
      const response = await axios.get('/crypto');
      setWallets(response.data);
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

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this wallet?')) {
      try {
        await axios.delete(`/crypto/${id}`);
        fetchWallets();
      } catch (error) {
        console.error('Error deleting wallet:', error);
      }
    }
  };

  const handleUpdateBalance = async (id: string) => {
    try {
      await axios.patch(`/crypto/${id}/update-balance`);
      fetchWallets();
      fetchCryptoPrices(); // Update prices as well
    } catch (error) {
      console.error('Error updating balance:', error);
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
      // Note: Token prices would need to be fetched from an API
      // For now, we'll just show them without USD value
    }
    
    return totalValue;
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="crypto-page">
      <div className="page-header">
        <h1>Crypto Wallets</h1>
        <button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Add Wallet'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="crypto-form">
          <div className="form-group">
            <label>Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              required
            >
              <option value="ethereum">Ethereum</option>
              <option value="bitcoin">Bitcoin</option>
            </select>
          </div>
          <div className="form-group">
            <label>Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="0x..."
              required
            />
          </div>
          <button type="submit">Add Wallet</button>
        </form>
      )}

      <div className="wallets-list">
        <h2>Your Wallets</h2>
        {wallets.length === 0 ? (
          <p>No wallets added yet.</p>
        ) : (
          <div className="wallets-grid">
            {wallets.map((wallet) => (
              <div key={wallet.id} className="wallet-card">
                <div className="wallet-header">
                  <h3>{wallet.type.toUpperCase()}</h3>
                  <span className="wallet-address">{wallet.address}</span>
                </div>
                <div className="wallet-balance">
                  <p className="balance-label">Balance</p>
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
                    <p className="tokens-label">Tokens:</p>
                    <ul className="tokens-list">
                      {wallet.tokens.map((token: any, index: number) => (
                        <li key={index} className="token-item">
                          <span className="token-symbol">{token.symbol}</span>
                          <span className="token-balance">
                            {parseFloat(token.balance.toString()).toFixed(4)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="wallet-actions">
                  <button
                    className="update-btn"
                    onClick={() => handleUpdateBalance(wallet.id)}
                  >
                    Update Balance
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(wallet.id)}
                  >
                    Delete
                  </button>
                </div>
                {wallet.lastUpdated && (
                  <p className="last-updated">
                    Last updated: {new Date(wallet.lastUpdated).toLocaleString()}
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

