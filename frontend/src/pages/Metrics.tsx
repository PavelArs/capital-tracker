import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { metricsApi } from '@api';
import type { Metrics as MetricsType, MetricsHistory } from '@shared/types';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import './Metrics.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export default function Metrics() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<MetricsType | null>(null);
  const [history, setHistory] = useState<MetricsHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('USD');

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await metricsApi.getMetrics(currency);
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  }, [currency]);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await metricsApi.getHistory(currency, 30);
      setHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  }, [currency]);

  useEffect(() => {
    fetchMetrics();
    fetchHistory();
  }, [fetchMetrics, fetchHistory]);

  const chartData = {
    labels: history.map((h) => h.date),
    datasets: [
      {
        label: t('metrics.netWorth'),
        data: history.map((h) => h.netWorth),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.1,
      },
      {
        label: t('metrics.totalAssets'),
        data: history.map((h) => h.totalAssets),
        borderColor: 'rgb(54, 162, 235)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        tension: 0.1,
      },
      {
        label: t('metrics.totalLiabilities'),
        data: history.map((h) => h.totalLiabilities),
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        tension: 0.1,
      },
    ],
  };

  if (loading) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  return (
    <div className="metrics-page">
      <div className="page-header">
        <h1>{t('metrics.title')}</h1>
        <div className="currency-selector">
          <label>{t('metrics.currency')}:</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="RUB">RUB</option>
          </select>
        </div>
      </div>

      {metrics && (
        <div className="metrics-summary">
          <div className="metric-item">
            <h3>{t('metrics.netWorth')}</h3>
            <p>
              {metrics.netWorth?.toLocaleString(undefined, {
                style: 'currency',
                currency: metrics.currency || 'USD',
              })}
            </p>
          </div>
          <div className="metric-item">
            <h3>{t('metrics.totalAssets')}</h3>
            <p>
              {metrics.totalStockAssets?.toLocaleString(undefined, {
                style: 'currency',
                currency: metrics.currency || 'USD',
              })}
            </p>
          </div>
          <div className="metric-item">
            <h3>{t('metrics.totalLiabilities')}</h3>
            <p>
              {metrics.totalLiabilities?.toLocaleString(undefined, {
                style: 'currency',
                currency: metrics.currency || 'USD',
              })}
            </p>
          </div>
          {metrics.totalActiveIncome !== undefined && (
            <div className="metric-item">
              <h3>{t('metrics.activeIncome')}</h3>
              <p>
                {metrics.totalActiveIncome?.toLocaleString(undefined, {
                  style: 'currency',
                  currency: metrics.currency || 'USD',
                })}
              </p>
            </div>
          )}
          {metrics.totalPassiveIncome !== undefined && (
            <div className="metric-item">
              <h3>{t('metrics.passiveIncome')}</h3>
              <p>
                {metrics.totalPassiveIncome?.toLocaleString(undefined, {
                  style: 'currency',
                  currency: metrics.currency || 'USD',
                })}
              </p>
            </div>
          )}
          {metrics.runway && (
            <div className="metric-item">
              <h3>{t('metrics.runway')}</h3>
              <p>
                {metrics.runway.toFixed(1)} {t('metrics.months')}
              </p>
            </div>
          )}
          {metrics.flRatio !== null && metrics.flRatio !== undefined && (
            <div className="metric-item">
              <h3>{t('metrics.flRatio')}</h3>
              <p>{(metrics.flRatio * 100).toFixed(2)}%</p>
              <p style={{ fontSize: '0.9em', color: '#666', marginTop: '5px' }}>
                {t('metrics.flRatioDescription')}
              </p>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="chart-container">
          <h2>{t('metrics.capitalHistory')}</h2>
          <Line data={chartData} />
        </div>
      )}

      {metrics && (
        <div className="distribution-container">
          <div className="distribution-card">
            <h2>{t('metrics.assetDistribution')}</h2>
            <ul>
              {Object.entries(metrics.stockAssetDistribution || {}).map(
                ([category, percentage]) => (
                  <li key={category}>
                    <span className="category-name">{category}:</span>
                    <span className="category-percentage">{percentage.toFixed(2)}%</span>
                  </li>
                )
              )}
            </ul>
          </div>
          <div className="distribution-card">
            <h2>{t('metrics.liabilityDistribution')}</h2>
            <ul>
              {Object.entries(metrics.liabilityDistribution || {}).map(
                ([category, percentage]) => (
                  <li key={category}>
                    <span className="category-name">{category}:</span>
                    <span className="category-percentage">{percentage.toFixed(2)}%</span>
                  </li>
                )
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
