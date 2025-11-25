import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import CurrenciesSkeleton from "../components/CurrenciesSkeleton";
import ErrorMessage from "../components/ErrorMessage";
import LoadingButton from "../components/LoadingButton";
import "./Currencies.css";

interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  type: "fiat" | "crypto" | "stablecoin";
  isActive: boolean;
  isDefault: boolean;
  isSystem: boolean;
}

type TabType = "active" | "hidden";

export default function Currencies() {
  const { t } = useTranslation();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [hiddenCurrencies, setHiddenCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrencies();
    fetchHiddenCurrencies();
  }, []);

  const fetchCurrencies = async () => {
    try {
      setError(null);
      const response = await axios.get("/currencies/list");
      setCurrencies(response.data);
    } catch (error: any) {
      console.error("Error fetching currencies:", error);
      setError(error.response?.data?.message || t('common.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const fetchHiddenCurrencies = async () => {
    try {
      const response = await axios.get("/currencies/hidden");
      setHiddenCurrencies(response.data);
    } catch (error) {
      console.error("Error fetching hidden currencies:", error);
    }
  };

  const handleToggle = async (currencyId: string, isCurrentlyHidden: boolean) => {
    setTogglingId(currencyId);
    try {
      const endpoint = isCurrentlyHidden ? "/currencies/show" : "/currencies/hide";
      await axios.post(endpoint, {
        currencyId,
        isHidden: !isCurrentlyHidden,
      });
      
      // Refresh both lists
      await fetchCurrencies();
      await fetchHiddenCurrencies();
    } catch (error: any) {
      console.error("Error toggling currency:", error);
      alert(error.response?.data?.message || t('currencies.toggleError'));
    } finally {
      setTogglingId(null);
    }
  };

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    fetchCurrencies();
    fetchHiddenCurrencies();
  };

  if (loading) {
    return <CurrenciesSkeleton />;
  }

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

  const groupedCurrencies = {
    fiat: currencies.filter((c) => c.type === "fiat"),
    crypto: currencies.filter((c) => c.type === "crypto"),
    stablecoin: currencies.filter((c) => c.type === "stablecoin"),
  };

  const groupedHidden = {
    fiat: hiddenCurrencies.filter((c) => c.type === "fiat"),
    crypto: hiddenCurrencies.filter((c) => c.type === "crypto"),
    stablecoin: hiddenCurrencies.filter((c) => c.type === "stablecoin"),
  };

  const renderCurrencyTable = (currenciesList: Currency[], isHidden: boolean = false) => {
    if (currenciesList.length === 0) {
      return <p className="no-data">{t('currencies.noData')}</p>;
    }

    return (
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
          {currenciesList.map((currency) => (
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
                <LoadingButton
                  onClick={() => handleToggle(currency.id, isHidden)}
                  className={isHidden ? "btn-show" : "btn-hide"}
                  title={isHidden ? t('currencies.show') : t('currencies.hide')}
                  loading={togglingId === currency.id}
                >
                  {isHidden ? "👁️ " + t('currencies.show') : "🚫 " + t('currencies.hide')}
                </LoadingButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const displayedCurrencies = activeTab === "active" ? groupedCurrencies : groupedHidden;
  const isHiddenTab = activeTab === "hidden";

  return (
    <div className="currencies-page">
      <div className="currencies-header">
        <div>
          <h1>{t('currencies.title')}</h1>
          <p className="currencies-description">
            {t('currencies.description')}
          </p>
        </div>
      </div>

      <div className="tabs-container">
        <button
          className={`tab-button ${activeTab === "active" ? "active" : ""}`}
          onClick={() => setActiveTab("active")}
        >
          👁️ {t('currencies.activeCurrencies')} ({currencies.length})
        </button>
        <button
          className={`tab-button ${activeTab === "hidden" ? "active" : ""}`}
          onClick={() => setActiveTab("hidden")}
        >
          🚫 {t('currencies.hiddenCurrencies')} ({hiddenCurrencies.length})
        </button>
      </div>

      <div className="currencies-list">
        {displayedCurrencies.fiat.length > 0 && (
          <div className="currency-group">
            <h2>{t('currencies.fiatCurrencies')} ({displayedCurrencies.fiat.length})</h2>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.fiat, isHiddenTab)}
            </div>
          </div>
        )}

        {displayedCurrencies.crypto.length > 0 && (
          <div className="currency-group">
            <h2>{t('currencies.cryptocurrencies')} ({displayedCurrencies.crypto.length})</h2>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.crypto, isHiddenTab)}
            </div>
          </div>
        )}

        {displayedCurrencies.stablecoin.length > 0 && (
          <div className="currency-group">
            <h2>{t('currencies.stablecoins')} ({displayedCurrencies.stablecoin.length})</h2>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.stablecoin, isHiddenTab)}
            </div>
          </div>
        )}

        {displayedCurrencies.fiat.length === 0 && 
         displayedCurrencies.crypto.length === 0 && 
         displayedCurrencies.stablecoin.length === 0 && (
          <div className="empty-state">
            <p>{isHiddenTab ? t('currencies.noHiddenCurrencies') : t('currencies.noCurrencies')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
