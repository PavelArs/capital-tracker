import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import "./CurrenciesSection.css";

interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  type: "fiat" | "crypto" | "stablecoin";
  isActive: boolean;
  isDefault: boolean;
}

export default function CurrenciesSection() {
  const { t } = useTranslation();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    symbol: "",
    type: "fiat" as "fiat" | "crypto" | "stablecoin",
    isActive: true,
  });

  useEffect(() => {
    fetchCurrencies();
  }, []);

  const fetchCurrencies = async () => {
    try {
      const response = await axios.get("/currencies/list");
      setCurrencies(response.data);
    } catch (error) {
      console.error("Error fetching currencies:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await axios.patch(`/currencies/${editingId}`, formData);
      } else {
        await axios.post("/currencies", formData);
      }
      setShowForm(false);
      setEditingId(null);
      setFormData({
        code: "",
        name: "",
        symbol: "",
        type: "fiat",
        isActive: true,
      });
      fetchCurrencies();
    } catch (error) {
      console.error("Error saving currency:", error);
    }
  };

  const handleEdit = (currency: Currency) => {
    setEditingId(currency.id);
    setFormData({
      code: currency.code,
      name: currency.name,
      symbol: currency.symbol,
      type: currency.type,
      isActive: currency.isActive,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('currencies.deleteConfirm'))) {
      try {
        await axios.delete(`/currencies/${id}`);
        fetchCurrencies();
      } catch (error) {
        console.error("Error deleting currency:", error);
      }
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({
      code: "",
      name: "",
      symbol: "",
      type: "fiat",
      isActive: true,
    });
  };

  if (loading) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  const groupedCurrencies = {
    fiat: currencies.filter((c) => c.type === "fiat"),
    crypto: currencies.filter((c) => c.type === "crypto"),
    stablecoin: currencies.filter((c) => c.type === "stablecoin"),
  };

  return (
    <div className="currencies-section">
      <div className="currencies-header">
        <h2>{t('currencies.title')}</h2>
        <div className="currencies-actions">
          <button onClick={() => setShowForm(true)} className="btn-add">
            {t('currencies.addCurrency')}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="currency-form-container">
          <form onSubmit={handleSubmit} className="currency-form">
            <h3>{editingId ? t('currencies.editCurrency') : t('currencies.addNewCurrency')}</h3>
            
            <div className="form-group">
              <label>{t('currencies.code')} *</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) =>
                  setFormData({ ...formData, code: e.target.value.toUpperCase() })
                }
                placeholder="USD, EUR, BTC"
                maxLength={10}
                required
                disabled={!!editingId}
              />
            </div>

            <div className="form-group">
              <label>{t('common.name')} *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="US Dollar"
                required
              />
            </div>

            <div className="form-group">
              <label>{t('currencies.symbol')} *</label>
              <input
                type="text"
                value={formData.symbol}
                onChange={(e) =>
                  setFormData({ ...formData, symbol: e.target.value })
                }
                placeholder="$"
                maxLength={10}
                required
              />
            </div>

            <div className="form-group">
              <label>{t('common.type')} *</label>
              <select
                value={formData.type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    type: e.target.value as "fiat" | "crypto" | "stablecoin",
                  })
                }
                required
              >
                <option value="fiat">{t('currencies.types.fiat')}</option>
                <option value="crypto">{t('currencies.types.crypto')}</option>
                <option value="stablecoin">{t('currencies.types.stablecoin')}</option>
              </select>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) =>
                    setFormData({ ...formData, isActive: e.target.checked })
                  }
                />
                {t('currencies.active')}
              </label>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {editingId ? t('common.update') : t('common.create')}
              </button>
              <button type="button" onClick={handleCancel} className="btn-secondary">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="currencies-list">
        <div className="currency-group">
          <h3>{t('currencies.fiatCurrencies')} ({groupedCurrencies.fiat.length})</h3>
          <div className="currency-table">
            <table>
              <thead>
                <tr>
                  <th>{t('currencies.code')}</th>
                  <th>{t('common.name')}</th>
                  <th>{t('currencies.symbol')}</th>
                  <th>{t('currencies.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {groupedCurrencies.fiat.map((currency) => (
                  <tr key={currency.id}>
                    <td className="currency-code">{currency.code}</td>
                    <td>{currency.name}</td>
                    <td className="currency-symbol">{currency.symbol}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          currency.isActive ? "active" : "inactive"
                        }`}
                      >
                        {currency.isActive ? t('currencies.active') : t('currencies.inactive')}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleEdit(currency)}
                        className="btn-edit"
                      >
                        {t('common.edit')}
                      </button>
                      {!currency.isDefault && (
                        <button
                          onClick={() => handleDelete(currency.id)}
                          className="btn-delete"
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="currency-group">
          <h3>{t('currencies.cryptocurrencies')} ({groupedCurrencies.crypto.length})</h3>
          <div className="currency-table">
            <table>
              <thead>
                <tr>
                  <th>{t('currencies.code')}</th>
                  <th>{t('common.name')}</th>
                  <th>{t('currencies.symbol')}</th>
                  <th>{t('currencies.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {groupedCurrencies.crypto.map((currency) => (
                  <tr key={currency.id}>
                    <td className="currency-code">{currency.code}</td>
                    <td>{currency.name}</td>
                    <td className="currency-symbol">{currency.symbol}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          currency.isActive ? "active" : "inactive"
                        }`}
                      >
                        {currency.isActive ? t('currencies.active') : t('currencies.inactive')}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleEdit(currency)}
                        className="btn-edit"
                      >
                        {t('common.edit')}
                      </button>
                      {!currency.isDefault && (
                        <button
                          onClick={() => handleDelete(currency.id)}
                          className="btn-delete"
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="currency-group">
          <h3>{t('currencies.stablecoins')} ({groupedCurrencies.stablecoin.length})</h3>
          <div className="currency-table">
            <table>
              <thead>
                <tr>
                  <th>{t('currencies.code')}</th>
                  <th>{t('common.name')}</th>
                  <th>{t('currencies.symbol')}</th>
                  <th>{t('currencies.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {groupedCurrencies.stablecoin.map((currency) => (
                  <tr key={currency.id}>
                    <td className="currency-code">{currency.code}</td>
                    <td>{currency.name}</td>
                    <td className="currency-symbol">{currency.symbol}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          currency.isActive ? "active" : "inactive"
                        }`}
                      >
                        {currency.isActive ? t('currencies.active') : t('currencies.inactive')}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleEdit(currency)}
                        className="btn-edit"
                      >
                        {t('common.edit')}
                      </button>
                      {!currency.isDefault && (
                        <button
                          onClick={() => handleDelete(currency.id)}
                          className="btn-delete"
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

