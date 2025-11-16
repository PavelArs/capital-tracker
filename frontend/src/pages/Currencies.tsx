import { useEffect, useState } from "react";
import axios from "axios";
import "./Currencies.css";

interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  type: "fiat" | "crypto" | "stablecoin";
  isActive: boolean;
  isDefault: boolean;
}

export default function Currencies() {
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
    if (window.confirm("Are you sure you want to delete this currency?")) {
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
    return <div className="loading">Loading currencies...</div>;
  }

  const groupedCurrencies = {
    fiat: currencies.filter((c) => c.type === "fiat"),
    crypto: currencies.filter((c) => c.type === "crypto"),
    stablecoin: currencies.filter((c) => c.type === "stablecoin"),
  };

  return (
    <div className="currencies-page">
      <div className="currencies-header">
        <h1>Currencies</h1>
        <div className="currencies-actions">
          <button onClick={() => setShowForm(true)} className="btn-add">
            Add Currency
          </button>
        </div>
      </div>

      {showForm && (
        <div className="currency-form-container">
          <form onSubmit={handleSubmit} className="currency-form">
            <h2>{editingId ? "Edit Currency" : "Add New Currency"}</h2>
            
            <div className="form-group">
              <label>Code *</label>
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
              <label>Name *</label>
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
              <label>Symbol *</label>
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
              <label>Type *</label>
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
                <option value="fiat">Fiat</option>
                <option value="crypto">Cryptocurrency</option>
                <option value="stablecoin">Stablecoin</option>
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
                Active
              </label>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {editingId ? "Update" : "Create"}
              </button>
              <button type="button" onClick={handleCancel} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="currencies-list">
        <div className="currency-group">
          <h2>Fiat Currencies ({groupedCurrencies.fiat.length})</h2>
          <div className="currency-table">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                        {currency.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleEdit(currency)}
                        className="btn-edit"
                      >
                        Edit
                      </button>
                      {!currency.isDefault && (
                        <button
                          onClick={() => handleDelete(currency.id)}
                          className="btn-delete"
                        >
                          Delete
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
          <h2>Cryptocurrencies ({groupedCurrencies.crypto.length})</h2>
          <div className="currency-table">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                        {currency.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleEdit(currency)}
                        className="btn-edit"
                      >
                        Edit
                      </button>
                      {!currency.isDefault && (
                        <button
                          onClick={() => handleDelete(currency.id)}
                          className="btn-delete"
                        >
                          Delete
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
          <h2>Stablecoins ({groupedCurrencies.stablecoin.length})</h2>
          <div className="currency-table">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                        {currency.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleEdit(currency)}
                        className="btn-edit"
                      >
                        Edit
                      </button>
                      {!currency.isDefault && (
                        <button
                          onClick={() => handleDelete(currency.id)}
                          className="btn-delete"
                        >
                          Delete
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

