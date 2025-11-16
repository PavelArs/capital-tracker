import { useEffect, useState } from 'react';
import axios from 'axios';
import { Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import './Liabilities.css';

ChartJS.register(ArcElement, Tooltip, Legend);

interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  type: string;
}

export default function Liabilities() {
  const [liabilities, setLiabilities] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    category: 'subscriptions',
    amount: '',
    currencyId: '',
    date: new Date().toISOString().split('T')[0],
    description: '',
    frequency: 'monthly' as 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | '',
    deadline: '',
  });

  useEffect(() => {
    fetchCurrencies();
    fetchLiabilities();
  }, []);

  useEffect(() => {
    // Set default currencyId when currencies are loaded
    if (currencies.length > 0 && !formData.currencyId) {
      const usdCurrency = currencies.find((c) => c.code === 'USD');
      if (usdCurrency) {
        setFormData((prev) => ({ ...prev, currencyId: usdCurrency.id }));
      } else {
        setFormData((prev) => ({ ...prev, currencyId: currencies[0].id }));
      }
    }
  }, [currencies]);

  const fetchCurrencies = async () => {
    try {
      const response = await axios.get('/currencies/list');
      if (response.data && response.data.length > 0) {
        setCurrencies(response.data);
      }
    } catch (error) {
      console.error('Error fetching currencies:', error);
    }
  };

  const fetchLiabilities = async () => {
    try {
      const response = await axios.get('/liabilities');
      setLiabilities(response.data);
    } catch (error) {
      console.error('Error fetching liabilities:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Find currency code from currencyId
      const selectedCurrencyObj = currencies.find((c) => c.id === formData.currencyId);
      const currencyCode = selectedCurrencyObj?.code || 'USD';

      const payload: any = {
        name: formData.name,
        category: formData.category,
        amount: parseFloat(formData.amount),
        currency: currencyCode,
        date: formData.date,
        description: formData.description,
      };

      // Add frequency for regular categories
      const regularCategories = ['subscriptions', 'regular_expenses'];
      if (regularCategories.includes(formData.category)) {
        payload.frequency = formData.frequency || 'monthly'; // Default to monthly if not set
      } else {
        payload.frequency = null;
      }

      // Add deadline for non-regular categories
      const nonRegularCategories = ['loans', 'mortgage', 'credit_card', 'other'];
      if (nonRegularCategories.includes(formData.category)) {
        payload.deadline = formData.deadline || null;
      } else {
        payload.deadline = null;
      }

      if (editingId) {
        // Update existing liability
        await axios.patch(`/liabilities/${editingId}`, payload);
      } else {
        // Create new liability
        await axios.post('/liabilities', payload);
      }
      setShowForm(false);
      setEditingId(null);
      const usdCurrency = currencies.find((c) => c.code === 'USD');
      setFormData({
        name: '',
        category: 'subscriptions',
        amount: '',
        currencyId: usdCurrency?.id || currencies[0]?.id || '',
        date: new Date().toISOString().split('T')[0],
        description: '',
        frequency: 'monthly', // Default for regular categories
        deadline: '',
      });
      fetchLiabilities();
    } catch (error) {
      console.error('Error saving liability:', error);
    }
  };

  const handleEdit = (liability: any) => {
    try {
      console.log("handleEdit called with liability:", liability);
      console.log("Available currencies:", currencies);
      
      // Use fallback currencies if API currencies not loaded yet
      const availableCurrencies = currencies.length > 0 ? currencies : [
        { id: "1", code: "USD", name: "US Dollar", symbol: "$", type: "fiat" },
        { id: "2", code: "EUR", name: "Euro", symbol: "€", type: "fiat" },
        { id: "3", code: "RUB", name: "Russian Ruble", symbol: "₽", type: "fiat" },
        { id: "4", code: "BTC", name: "Bitcoin", symbol: "₿", type: "crypto" },
        { id: "5", code: "ETH", name: "Ethereum", symbol: "Ξ", type: "crypto" },
        { id: "6", code: "USDT", name: "Tether", symbol: "₮", type: "stablecoin" },
      ];

      setEditingId(liability.id);
      
      // Handle both currency object and currency string
      const liabilityCurrencyCode = liability.currency?.code || liability.currency || 'USD';
      console.log("Liability currency code:", liabilityCurrencyCode);
      
      const liabilityCurrencyId = availableCurrencies.find((c) => c.code === liabilityCurrencyCode)?.id ||
        availableCurrencies.find((c) => c.code === 'USD')?.id ||
        availableCurrencies[0]?.id ||
        '';
      
      console.log("Found currency ID:", liabilityCurrencyId);
      
      const category = liability.category || "subscriptions";
      const isRegular = ['subscriptions', 'regular_expenses'].includes(category);
      
      setFormData({
        name: liability.name || "",
        category: category,
        amount: liability.amount?.toString() || "0",
        currencyId: liabilityCurrencyId,
        date: liability.date ? new Date(liability.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        description: liability.description || '',
        frequency: isRegular ? (liability.frequency || 'monthly') : '',
        deadline: !isRegular && liability.deadline ? new Date(liability.deadline).toISOString().split('T')[0] : '',
      });
      
      console.log("Form data set, opening form. editingId:", liability.id);
      setShowForm(true);
      console.log("showForm should be true now");
    } catch (error) {
      console.error("Error in handleEdit:", error);
      alert("Error editing liability: " + (error as Error).message);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    const usdCurrency = currencies.find((c) => c.code === 'USD');
    setFormData({
      name: '',
      category: 'subscriptions',
      amount: '',
      currencyId: usdCurrency?.id || currencies[0]?.id || '',
      date: new Date().toISOString().split('T')[0],
      description: '',
      frequency: 'monthly', // Default for regular categories
      deadline: '',
    });
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this liability?')) {
      try {
        await axios.delete(`/liabilities/${id}`);
        fetchLiabilities();
      } catch (error) {
        console.error('Error deleting liability:', error);
      }
    }
  };

  const chartData = {
    labels: Object.keys(
      liabilities.reduce((acc, liability) => {
        acc[liability.category] = (acc[liability.category] || 0) + parseFloat(liability.amount);
        return acc;
      }, {} as Record<string, number>)
    ),
    datasets: [
      {
        data: Object.values(
          liabilities.reduce((acc, liability) => {
            acc[liability.category] = (acc[liability.category] || 0) + parseFloat(liability.amount);
            return acc;
          }, {} as Record<string, number>)
        ),
        backgroundColor: [
          '#FF6384',
          '#36A2EB',
          '#FFCE56',
          '#4BC0C0',
          '#9966FF',
          '#FF9F40',
        ],
      },
    ],
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="liabilities-page">
      <div className="page-header">
        <h1>Liabilities</h1>
        <button onClick={() => {
          if (showForm) {
            handleCancel();
          } else {
            setShowForm(true);
          }
        }}>
          {showForm ? 'Cancel' : 'Add Liability'}
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Liability' : 'Add New Liability'}</h2>
              <button className="modal-close" onClick={handleCancel}>×</button>
            </div>
            <form onSubmit={handleSubmit} className="liability-form">
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select
                value={formData.category}
                onChange={(e) => {
                  const category = e.target.value;
                  // Reset frequency/deadline when switching between regular and non-regular categories
                  const isRegular = ['subscriptions', 'regular_expenses'].includes(category);
                  const isNonRegular = ['loans', 'mortgage', 'credit_card', 'other'].includes(category);
                  
                  setFormData({ 
                    ...formData, 
                    category,
                    frequency: isRegular ? (formData.frequency || 'monthly') : '',
                    deadline: isNonRegular ? (formData.deadline || '') : '',
                  });
                }}
                required
              >
                <option value="subscriptions">Subscriptions</option>
                <option value="regular_expenses">Regular Expenses</option>
                <option value="loans">Loans</option>
                <option value="mortgage">Mortgage</option>
                <option value="credit_card">Credit Card</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Amount</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Currency</label>
              <select
                value={formData.currencyId}
                onChange={(e) =>
                  setFormData({ ...formData, currencyId: e.target.value })
                }
                required
              >
                {currencies.map((curr) => (
                  <option key={curr.id} value={curr.id}>
                    {curr.code} - {curr.name} ({curr.symbol})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="form-row">
            {/* Show frequency for regular categories */}
            {(['subscriptions', 'regular_expenses'].includes(formData.category)) && (
              <div className="form-group">
                <label>Frequency</label>
                <select
                  value={formData.frequency || 'monthly'}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as any })}
                  required
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            )}
            {/* Show deadline for non-regular categories */}
            {(['loans', 'mortgage', 'credit_card', 'other'].includes(formData.category)) && (
              <div className="form-group">
                <label>Deadline</label>
                <input
                  type="date"
                  value={formData.deadline}
                  onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                />
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
              <div className="form-actions">
                <button type="submit">{editingId ? 'Update Liability' : 'Create Liability'}</button>
                <button type="button" onClick={handleCancel} className="cancel-btn">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {liabilities.length > 0 && (
        <div className="chart-container">
          <h2>Liability Distribution</h2>
          <Pie data={chartData} />
        </div>
      )}

      <div className="liabilities-list">
        <h2>All Liabilities</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Currency</th>
              <th>Date</th>
              <th>Frequency</th>
              <th>Deadline</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {liabilities.map((liability) => (
              <tr key={liability.id}>
                <td>{liability.name}</td>
                <td>{liability.category}</td>
                <td>{parseFloat(liability.amount).toLocaleString()}</td>
                <td>{liability.currency?.code || liability.currency || 'USD'}</td>
                <td>{new Date(liability.date).toLocaleDateString()}</td>
                <td>
                  {liability.frequency ? (
                    <span className="frequency-badge">
                      {liability.frequency === 'daily' && 'Daily'}
                      {liability.frequency === 'weekly' && 'Weekly'}
                      {liability.frequency === 'monthly' && 'Monthly'}
                      {liability.frequency === 'quarterly' && 'Quarterly'}
                      {liability.frequency === 'yearly' && 'Yearly'}
                    </span>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td>
                  {liability.deadline ? (
                    <span className={new Date(liability.deadline) < new Date() ? 'deadline-overdue' : 'deadline-date'}>
                      {new Date(liability.deadline).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td>
                  <button
                    className="edit-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log("Edit button clicked for liability:", liability.id);
                      handleEdit(liability);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(liability.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

