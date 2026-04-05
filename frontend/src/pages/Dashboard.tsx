import { currenciesApi, metricsApi } from '@api';
import DashboardSkeleton from '@components/DashboardSkeleton';
import ErrorMessage from '@components/ErrorMessage';
import type { Currency, Metrics, MetricsHistory } from '@shared/types';
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { useTranslation } from 'react-i18next';
import './Dashboard.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export default function Dashboard() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [history, setHistory] = useState<MetricsHistory[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>('USD');

  // Track active requests to prevent duplicates
  const fetchingRef = useRef({ metrics: false, history: false });

  // Helper function to format category names
  const formatCategoryName = useCallback(
    (category: string): string => {
      const categoryMap: Record<string, string> = {
        // Stock assets
        real_estate: t('assets.categories.realEstate'),
        investments: t('assets.categories.investments'),
        savings: t('assets.categories.savings'),
        crypto: t('assets.categories.crypto'),
        vehicle: t('assets.categories.vehicle'),
        equipment: t('assets.categories.equipment'),
        // Flow assets
        salary: t('assets.categories.salary'),
        dividends: t('assets.categories.dividends'),
        freelance: t('assets.categories.freelance'),
        rent_income: t('assets.categories.rentIncome'),
        pension: t('assets.categories.pension'),
        // Liabilities
        subscriptions: t('liabilities.categories.subscriptions'),
        regular_expenses: t('liabilities.categories.regularExpenses'),
        loans: t('liabilities.categories.loans'),
        mortgage: t('liabilities.categories.mortgage'),
        credit_card: t('liabilities.categories.creditCard'),
        other: t('assets.categories.other'),
      };
      return (
        categoryMap[category] ||
        category.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
      );
    },
    [t],
  );

  const fetchMetrics = useCallback(async () => {
    // Prevent duplicate requests
    if (fetchingRef.current.metrics) {
      return;
    }

    try {
      fetchingRef.current.metrics = true;
      setError(null);
      const data = await metricsApi.getMetrics(currency);
      setMetrics(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('common.errorLoading');
      setError(errorMessage);
    } finally {
      setLoading(false);
      fetchingRef.current.metrics = false;
    }
  }, [currency, t]);

  const fetchHistory = useCallback(async () => {
    // Prevent duplicate requests
    if (fetchingRef.current.history) {
      return;
    }

    try {
      fetchingRef.current.history = true;
      const data = await metricsApi.getHistory(currency, 30);
      setHistory(data);
    } catch (err) {
      console.error('Error fetching history:', err);
      // Don't set error for history as it's not critical
    } finally {
      fetchingRef.current.history = false;
    }
  }, [currency]);

  useEffect(() => {
    currenciesApi
      .getList()
      .then(setCurrencies)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchMetrics();
    fetchHistory();
  }, [fetchMetrics, fetchHistory]);

  const chartData = useMemo(
    () => ({
      labels: history.map((h) => h.date),
      datasets: [
        {
          label: t('dashboard.netWorth'),
          data: history.map((h) => h.netWorth),
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          tension: 0.1,
        },
        {
          label: t('dashboard.stockAssets'),
          data: history.map((h) => h.totalAssets),
          borderColor: 'rgb(54, 162, 235)',
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          tension: 0.1,
        },
        {
          label: t('dashboard.totalLiabilities'),
          data: history.map((h) => h.totalLiabilities),
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          tension: 0.1,
        },
      ],
    }),
    [history, t],
  );

  const chartOptions = useMemo(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const isSmallMobile = typeof window !== 'undefined' && window.innerWidth < 480;

    return {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: isMobile ? 1.2 : 2,
      plugins: {
        legend: {
          display: true,
          position: isMobile ? ('bottom' as const) : ('top' as const),
          labels: {
            boxWidth: isMobile ? 12 : 40,
            padding: isMobile ? 8 : 10,
            font: {
              size: isSmallMobile ? 10 : isMobile ? 11 : 12,
            },
          },
        },
        tooltip: {
          mode: 'index' as const,
          intersect: false,
          bodyFont: {
            size: isMobile ? 11 : 12,
          },
          titleFont: {
            size: isMobile ? 12 : 13,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxRotation: isMobile ? 45 : 0,
            minRotation: isMobile ? 45 : 0,
            font: {
              size: isSmallMobile ? 9 : isMobile ? 10 : 11,
            },
            maxTicksLimit: isSmallMobile ? 6 : isMobile ? 8 : 10,
          },
          grid: {
            display: !isMobile,
          },
        },
        y: {
          ticks: {
            font: {
              size: isSmallMobile ? 9 : isMobile ? 10 : 11,
            },
            maxTicksLimit: isMobile ? 6 : 8,
          },
          grid: {
            display: true,
          },
        },
      },
      interaction: {
        mode: 'nearest' as const,
        axis: 'x' as const,
        intersect: false,
      },
    };
  }, []);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchMetrics();
    fetchHistory();
  }, [fetchMetrics, fetchHistory]);

  const handleCurrencyChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrency(e.target.value);
  }, []);

  const formatCurrency = useCallback((value: number | undefined, currencyCode: string) => {
    if (value === undefined) return '-';
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: currencyCode,
    });
  }, []);

  if (loading) {
    return <DashboardSkeleton />;
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

  const displayCurrency = metrics?.currency || 'USD';

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>{t('dashboard.title')}</h1>
        <div className="currency-selector">
          <label htmlFor="currency-select">{t('common.currency')}:</label>
          <select id="currency-select" value={currency} onChange={handleCurrencyChange}>
            {currencies.length > 0 ? (
              currencies.map((curr) => (
                <option key={curr.id} value={curr.code}>
                  {curr.code}
                </option>
              ))
            ) : (
              <option value="USD">USD</option>
            )}
          </select>
        </div>
      </div>

      {metrics && (
        <>
          <div className="metrics-grid">
            <div className="metric-card">
              <h3>{t('dashboard.netWorth')}</h3>
              <p className="metric-value">{formatCurrency(metrics.netWorth, displayCurrency)}</p>
              <p className="metric-description">{t('dashboard.netWorthDescription')}</p>
            </div>

            <div className="metric-card stock-assets">
              <h3>{t('dashboard.stockAssets')}</h3>
              <p className="metric-value">
                {formatCurrency(metrics.totalStockAssets, displayCurrency)}
              </p>
              <p className="metric-description">{t('dashboard.stockAssetsDescription')}</p>
            </div>

            <div className="metric-card flow-income">
              <h3>{t('dashboard.flowIncome')}</h3>
              <p className="metric-value">
                {formatCurrency(metrics.totalFlowIncome, displayCurrency)}
              </p>
              <p className="metric-description">{t('dashboard.flowIncomeDescription')}</p>
            </div>

            <div className="metric-card">
              <h3>{t('dashboard.cryptoValue')}</h3>
              <p className="metric-value">{formatCurrency(metrics.cryptoValue, displayCurrency)}</p>
              <p className="metric-description">{t('dashboard.cryptoValueDescription')}</p>
            </div>

            <div className="metric-card">
              <h3>{t('dashboard.totalLiabilities')}</h3>
              <p className="metric-value">
                {formatCurrency(metrics.totalLiabilities, displayCurrency)}
              </p>
            </div>

            <div className="metric-card">
              <h3>{t('dashboard.monthlyExpenses')}</h3>
              <p className="metric-value">
                {formatCurrency(metrics.monthlyExpenses, displayCurrency)}
              </p>
            </div>

            {metrics.runway !== undefined && metrics.runway !== null && (
              <div className="metric-card">
                <h3>{t('dashboard.runway')}</h3>
                <p className="metric-value">
                  {metrics.runway.toFixed(1)} {t('dashboard.months')}
                </p>
                <p className="metric-description">{t('dashboard.runwayDescription')}</p>
              </div>
            )}

            {metrics.totalActiveIncome !== undefined && (
              <div className="metric-card">
                <h3>{t('dashboard.activeIncome')}</h3>
                <p className="metric-value">
                  {formatCurrency(metrics.totalActiveIncome, displayCurrency)}
                </p>
                <p className="metric-description">{t('dashboard.activeIncomeDescription')}</p>
              </div>
            )}

            {metrics.totalPassiveIncome !== undefined && (
              <div className="metric-card">
                <h3>{t('dashboard.passiveIncome')}</h3>
                <p className="metric-value">
                  {formatCurrency(metrics.totalPassiveIncome, displayCurrency)}
                </p>
                <p className="metric-description">{t('dashboard.passiveIncomeDescription')}</p>
              </div>
            )}

            {metrics.flRatio !== null && metrics.flRatio !== undefined && (
              <div className="metric-card">
                <h3>{t('dashboard.flRatio')}</h3>
                <p className="metric-value">{(metrics.flRatio * 100).toFixed(2)}%</p>
                <p className="metric-description">{t('dashboard.flRatioDescription')}</p>
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="chart-container">
              <h2>{t('dashboard.capitalHistory')}</h2>
              <Line data={chartData} options={chartOptions} />
            </div>
          )}

          <div className="distribution-container">
            <div className="distribution-card">
              <h2>{t('dashboard.stockAssetsDistribution')}</h2>
              {Object.keys(metrics.stockAssetDistribution || {}).length > 0 ? (
                <ul>
                  {Object.entries(metrics.stockAssetDistribution || {}).map(
                    ([category, percentage]) => (
                      <li key={category}>
                        <span className="category-name">{formatCategoryName(category)}:</span>
                        <span className="category-percentage">
                          {(percentage as number).toFixed(2)}%
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="no-data">{t('dashboard.noStockAssetsData')}</p>
              )}
            </div>

            <div className="distribution-card">
              <h2>{t('dashboard.flowIncomeDistribution')}</h2>
              {Object.keys(metrics.flowIncomeDistribution || {}).length > 0 ? (
                <ul>
                  {Object.entries(metrics.flowIncomeDistribution || {}).map(
                    ([category, percentage]) => (
                      <li key={category}>
                        <span className="category-name">{formatCategoryName(category)}:</span>
                        <span className="category-percentage">
                          {(percentage as number).toFixed(2)}%
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="no-data">{t('dashboard.noFlowIncomeData')}</p>
              )}
            </div>

            <div className="distribution-card">
              <h2>{t('dashboard.liabilityDistribution')}</h2>
              {Object.keys(metrics.liabilityDistribution || {}).length > 0 ? (
                <ul>
                  {Object.entries(metrics.liabilityDistribution || {}).map(
                    ([category, percentage]) => (
                      <li key={category}>
                        <span className="category-name">{formatCategoryName(category)}:</span>
                        <span className="category-percentage">
                          {(percentage as number).toFixed(2)}%
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="no-data">{t('dashboard.noLiabilitiesData')}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
