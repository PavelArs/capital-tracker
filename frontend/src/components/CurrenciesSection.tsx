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
  isSystem: boolean;
  contractAddress?: string;
}

type TabType = "active" | "hidden";

export default function CurrenciesSection() {
  const { t } = useTranslation();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [hiddenCurrencies, setHiddenCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("active");

  useEffect(() => {
    fetchCurrencies();
    fetchHiddenCurrencies();
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

  const fetchHiddenCurrencies = async () => {
    try {
      const response = await axios.get("/currencies/hidden");
      setHiddenCurrencies(response.data);
    } catch (error) {
      console.error("Error fetching hidden currencies:", error);
    }
  };

  const handleToggle = async (currencyId: string, isCurrentlyHidden: boolean) => {
    try {
      const endpoint = isCurrentlyHidden ? "/currencies/show" : "/currencies/hide";
      await axios.post(endpoint, {
        currencyId,
        isHidden: !isCurrentlyHidden,
      });
      
      // Refresh both lists
      await fetchCurrencies();
      await fetchHiddenCurrencies();
    } catch (error) {
      console.error("Error toggling currency:", error);
      alert(t('currencies.toggleError'));
    }
  };

  if (loading) {
    return <div className="loading">{t('common.loading')}</div>;
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

  const renderCurrencyTable = (currenciesList: Currency[], showContract: boolean = false, isHidden: boolean = false) => {
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
            {showContract && <th>Contract</th>}
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
              {showContract && (
                <td className="contract-address">
                  {currency.contractAddress ? (
                    <span title={currency.contractAddress}>
                      {currency.contractAddress.slice(0, 6)}...{currency.contractAddress.slice(-4)}
                    </span>
                  ) : (
                    <span className="no-contract">-</span>
                  )}
                </td>
              )}
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
                  onClick={() => handleToggle(currency.id, isHidden)}
                  className={isHidden ? "btn-show" : "btn-hide"}
                  title={isHidden ? t('currencies.show') : t('currencies.hide')}
                >
                  {isHidden ? "👁️ " + t('currencies.show') : "🚫 " + t('currencies.hide')}
                </button>
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
    <div className="currencies-section">
      <div className="currencies-header">
        <h2>{t('currencies.title')}</h2>
        <p className="currencies-description">
          {t('currencies.description')}
        </p>
      </div>

      <div className="currency-tabs">
        <button
          className={`currency-tab ${activeTab === "active" ? "active" : ""}`}
          onClick={() => setActiveTab("active")}
        >
          👁️ {t('currencies.activeCurrencies')} ({currencies.length})
        </button>
        <button
          className={`currency-tab ${activeTab === "hidden" ? "active" : ""}`}
          onClick={() => setActiveTab("hidden")}
        >
          🚫 {t('currencies.hiddenCurrencies')} ({hiddenCurrencies.length})
        </button>
      </div>

      <div className="currencies-list">
        {displayedCurrencies.fiat.length > 0 && (
          <div className="currency-group">
            <h3>{t('currencies.fiatCurrencies')} ({displayedCurrencies.fiat.length})</h3>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.fiat, false, isHiddenTab)}
            </div>
          </div>
        )}

        {displayedCurrencies.crypto.length > 0 && (
          <div className="currency-group">
            <h3>{t('currencies.cryptocurrencies')} ({displayedCurrencies.crypto.length})</h3>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.crypto, true, isHiddenTab)}
            </div>
          </div>
        )}

        {displayedCurrencies.stablecoin.length > 0 && (
          <div className="currency-group">
            <h3>{t('currencies.stablecoins')} ({displayedCurrencies.stablecoin.length})</h3>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.stablecoin, true, isHiddenTab)}
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
