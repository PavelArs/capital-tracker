import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [liabilities, setLiabilities] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([
    // Default currencies - will be replaced if API succeeds
    { id: "1", code: "USD", name: "US Dollar", symbol: "$", type: "fiat" },
    { id: "2", code: "EUR", name: "Euro", symbol: "€", type: "fiat" },
    { id: "3", code: "RUB", name: "Russian Ruble", symbol: "₽", type: "fiat" },
    { id: "4", code: "BTC", name: "Bitcoin", symbol: "₿", type: "crypto" },
    { id: "5", code: "ETH", name: "Ethereum", symbol: "Ξ", type: "crypto" },
    { id: "6", code: "USDT", name: "Tether", symbol: "₮", type: "stablecoin" },
  ]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    category: 'subscriptions',
    amount: '',
    currencyId: '1', // Default to USD (id: "1")
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
  }, [currencies, formData.currencyId]);

  const fetchCurrencies = async () => {
    try {
      const response = await axios.get('/currencies/list');
      if (response.data && response.data.length > 0) {
        setCurrencies(response.data);
        console.log("✅ Loaded currencies from API:", response.data.length);
        
        // Update formData.currencyId if needed
        setFormData((prev) => {
          // Check if current currencyId is valid
          const currentIsValid = response.data.some((c: Currency) => c.id === prev.currencyId);
          if (currentIsValid) {
            return prev; // Keep current value
          }
          // Set to USD or first currency
          const usdCurrency = response.data.find((c: Currency) => c.code === 'USD');
          return {
            ...prev,
            currencyId: usdCurrency?.id || response.data[0]?.id || '1',
          };
        });
      } else {
        console.log("⚠️ API returned empty list, keeping default currencies");
      }
    } catch (error: any) {
      console.log(
        "⚠️ Could not load currencies from API, using defaults:",
        error?.message || "Unknown error"
      );
      // Keep default currencies that were set in useState
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
      // Ensure currencyId is set
      let currencyIdToUse = formData.currencyId;
      if (!currencyIdToUse && currencies.length > 0) {
        const usdCurrency = currencies.find((c) => c.code === 'USD');
        currencyIdToUse = usdCurrency?.id || currencies[0]?.id || '';
      }

      // Find currency code from currencyId
      const selectedCurrencyObj = currencies.find((c) => c.id === currencyIdToUse);
      const currencyCode = selectedCurrencyObj?.code || 'USD';

      const payload: any = {
        name: formData.name,
        category: formData.category,
        amount: parseFloat(formData.amount),
        currency: currencyCode,
        date: formData.date,
        description: formData.description,
      };

      console.log("Submitting liability with currency:", currencyCode, "from currencyId:", currencyIdToUse);

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
    if (window.confirm(t('liabilities.deleteConfirm'))) {
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
    return <div className="loading">{t('common.loading')}</div>;
  }

  return (
    <div className="liabilities-page">
      <div className="page-header">
        <h1>{t('liabilities.title')}</h1>
        <button onClick={() => {
          if (showForm) {
            handleCancel();
          } else {
            // Ensure currencyId is set before showing form
            if (!formData.currencyId && currencies.length > 0) {
              const usdCurrency = currencies.find((c) => c.code === 'USD');
              const defaultCurrencyId = usdCurrency?.id || currencies[0]?.id || '';
              setFormData((prev) => ({ ...prev, currencyId: defaultCurrencyId }));
            }
            setShowForm(true);
          }
        }}>
          {showForm ? t('common.cancel') : t('liabilities.addLiability')}
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? t('liabilities.editLiability') : t('liabilities.addNewLiability')}</h2>
              <button className="modal-close" onClick={handleCancel}>×</button>
            </div>
            <form onSubmit={handleSubmit} className="liability-form">
          <div className="form-row">
            <div className="form-group">
              <label>{t('common.name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('common.category')}</label>
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
                <option value="subscriptions">{t('liabilities.categories.subscriptions')}</option>
                <option value="regular_expenses">{t('liabilities.categories.regularExpenses')}</option>
                <option value="loans">{t('liabilities.categories.loans')}</option>
                <option value="mortgage">{t('liabilities.categories.mortgage')}</option>
                <option value="credit_card">{t('liabilities.categories.creditCard')}</option>
                <option value="other">{t('liabilities.categories.other')}</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('common.amount')}</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('common.currency')}</label>
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
              <label>{t('common.date')}</label>
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
                <label>{t('liabilities.frequency')}</label>
                <select
                  value={formData.frequency || 'monthly'}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as any })}
                  required
                >
                  <option value="daily">{t('liabilities.frequencies.daily')}</option>
                  <option value="weekly">{t('liabilities.frequencies.weekly')}</option>
                  <option value="monthly">{t('liabilities.frequencies.monthly')}</option>
                  <option value="quarterly">{t('liabilities.frequencies.quarterly')}</option>
                  <option value="yearly">{t('liabilities.frequencies.yearly')}</option>
                </select>
              </div>
            )}
            {/* Show deadline for non-regular categories */}
            {(['loans', 'mortgage', 'credit_card', 'other'].includes(formData.category)) && (
              <div className="form-group">
                <label>{t('liabilities.deadline')}</label>
                <input
                  type="date"
                  value={formData.deadline}
                  onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                />
              </div>
            )}
          </div>
          <div className="form-group">
            <label>{t('common.description')}</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
              <div className="form-actions">
                <button type="submit">{editingId ? t('liabilities.updateLiability') : t('liabilities.createLiability')}</button>
                <button type="button" onClick={handleCancel} className="cancel-btn">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="liabilities-content-wrapper">
        <div className="liabilities-list">
        <h2>{t('liabilities.allLiabilities')}</h2>
        <div className="liabilities-cards-list">
          {liabilities.map((liability) => (
            <div key={liability.id} className="liability-item">
              <div className="liability-item-left">
                <div className="liability-item-name">{liability.name}</div>
                <div className="liability-item-meta">
                  <span className="liability-item-category">{liability.category}</span>
                  {liability.frequency && (
                    <span className="frequency-badge">
                      {liability.frequency === 'daily' && t('liabilities.frequencies.daily')}
                      {liability.frequency === 'weekly' && t('liabilities.frequencies.weekly')}
                      {liability.frequency === 'monthly' && t('liabilities.frequencies.monthly')}
                      {liability.frequency === 'quarterly' && t('liabilities.frequencies.quarterly')}
                      {liability.frequency === 'yearly' && t('liabilities.frequencies.yearly')}
                    </span>
                  )}
                  {liability.deadline && (
                    <span className={new Date(liability.deadline) < new Date() ? 'deadline-overdue' : 'deadline-date'}>
                      {new Date(liability.deadline).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="liability-item-right">
                <div className="liability-item-amount">
                  {parseFloat(liability.amount).toLocaleString()} {liability.currency?.code || liability.currency || 'USD'}
                </div>
                <div className="liability-item-actions">
                  <button
                    className="edit-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log("Edit button clicked for liability:", liability.id);
                      handleEdit(liability);
                    }}
                    title={t('common.edit')}
                    aria-label={t('common.edit')}
                  >
                    <span className="icon-edit">✏️</span>
                  </button>
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(liability.id);
                    }}
                    title={t('common.delete')}
                    aria-label={t('common.delete')}
                  >
                    <span className="icon-delete">🗑️</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>

        {liabilities.length > 0 && (
          <div className="chart-container">
            <h2>{t('liabilities.liabilityDistribution')}</h2>
            <Pie data={chartData} />
          </div>
        )}
      </div>
    </div>
  );
}

