import { currenciesApi } from '@api';
import type { Currency } from '@shared/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './CurrencyManager.css';

type TabType = 'active' | 'hidden';

interface GroupedCurrencies {
  fiat: Currency[];
  crypto: Currency[];
  stablecoin: Currency[];
}

interface CurrencyManagerProps {
  variant?: 'page' | 'section';
}

export default function CurrencyManager({ variant = 'section' }: CurrencyManagerProps) {
  const { t } = useTranslation();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [hiddenCurrencies, setHiddenCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('active');

  const isPage = variant === 'page';

  const fetchCurrencies = useCallback(async () => {
    try {
      const data = await currenciesApi.getList();
      setCurrencies(data);
    } catch (error) {
      console.error('Error fetching currencies:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHiddenCurrencies = useCallback(async () => {
    try {
      const data = await currenciesApi.getHidden();
      setHiddenCurrencies(data);
    } catch (error) {
      console.error('Error fetching hidden currencies:', error);
    }
  }, []);

  useEffect(() => {
    fetchCurrencies();
    fetchHiddenCurrencies();
  }, [fetchCurrencies, fetchHiddenCurrencies]);

  const handleToggle = useCallback(
    async (currencyId: string, isCurrentlyHidden: boolean) => {
      try {
        if (isCurrentlyHidden) {
          await currenciesApi.show(currencyId);
        } else {
          await currenciesApi.hide(currencyId);
        }

        // Refresh both lists
        await Promise.all([fetchCurrencies(), fetchHiddenCurrencies()]);
      } catch (error) {
        console.error('Error toggling currency:', error);
        alert(t('currencies.toggleError'));
      }
    },
    [fetchCurrencies, fetchHiddenCurrencies, t],
  );

  const groupedCurrencies = useMemo<GroupedCurrencies>(
    () => ({
      fiat: currencies.filter((c) => c.type === 'fiat'),
      crypto: currencies.filter((c) => c.type === 'crypto'),
      stablecoin: currencies.filter((c) => c.type === 'stablecoin'),
    }),
    [currencies],
  );

  const groupedHidden = useMemo<GroupedCurrencies>(
    () => ({
      fiat: hiddenCurrencies.filter((c) => c.type === 'fiat'),
      crypto: hiddenCurrencies.filter((c) => c.type === 'crypto'),
      stablecoin: hiddenCurrencies.filter((c) => c.type === 'stablecoin'),
    }),
    [hiddenCurrencies],
  );

  const renderCurrencyTable = useCallback(
    (currenciesList: Currency[], showContract = false, isHidden = false) => {
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
              {showContract && <th>{t('currencies.contract')}</th>}
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
                        {currency.contractAddress.slice(0, 6)}...
                        {currency.contractAddress.slice(-4)}
                      </span>
                    ) : (
                      <span className="no-contract">-</span>
                    )}
                  </td>
                )}
                <td>
                  <span className={`status-badge ${currency.isActive ? 'active' : 'inactive'}`}>
                    {currency.isActive ? t('currencies.active') : t('currencies.inactive')}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => handleToggle(currency.id, isHidden)}
                    className={isHidden ? 'btn-show' : 'btn-hide'}
                    title={isHidden ? t('currencies.show') : t('currencies.hide')}
                  >
                    {isHidden ? `👁️ ${t('currencies.show')}` : `🚫 ${t('currencies.hide')}`}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
    [handleToggle, t],
  );

  if (loading) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  const displayedCurrencies = activeTab === 'active' ? groupedCurrencies : groupedHidden;
  const isHiddenTab = activeTab === 'hidden';
  const totalDisplayed =
    displayedCurrencies.fiat.length +
    displayedCurrencies.crypto.length +
    displayedCurrencies.stablecoin.length;

  const TitleTag = isPage ? 'h1' : 'h2';
  const GroupTitleTag = isPage ? 'h2' : 'h3';
  const wrapperClass = isPage ? 'currencies-page' : 'currencies-section';

  return (
    <div className={wrapperClass}>
      <div className="currencies-header">
        <TitleTag>{t('currencies.title')}</TitleTag>
        <p className="currencies-description">{t('currencies.description')}</p>
      </div>

      <div className="currency-tabs">
        <button
          className={`currency-tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          👁️ {t('currencies.activeCurrencies')} ({currencies.length})
        </button>
        <button
          className={`currency-tab ${activeTab === 'hidden' ? 'active' : ''}`}
          onClick={() => setActiveTab('hidden')}
        >
          🚫 {t('currencies.hiddenCurrencies')} ({hiddenCurrencies.length})
        </button>
      </div>

      <div className="currencies-list">
        {displayedCurrencies.fiat.length > 0 && (
          <div className="currency-group">
            <GroupTitleTag>
              {t('currencies.fiatCurrencies')} ({displayedCurrencies.fiat.length})
            </GroupTitleTag>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.fiat, false, isHiddenTab)}
            </div>
          </div>
        )}

        {displayedCurrencies.crypto.length > 0 && (
          <div className="currency-group">
            <GroupTitleTag>
              {t('currencies.cryptocurrencies')} ({displayedCurrencies.crypto.length})
            </GroupTitleTag>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.crypto, true, isHiddenTab)}
            </div>
          </div>
        )}

        {displayedCurrencies.stablecoin.length > 0 && (
          <div className="currency-group">
            <GroupTitleTag>
              {t('currencies.stablecoins')} ({displayedCurrencies.stablecoin.length})
            </GroupTitleTag>
            <div className="currency-table">
              {renderCurrencyTable(displayedCurrencies.stablecoin, true, isHiddenTab)}
            </div>
          </div>
        )}

        {totalDisplayed === 0 && (
          <div className="empty-state">
            <p>{isHiddenTab ? t('currencies.noHiddenCurrencies') : t('currencies.noCurrencies')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
