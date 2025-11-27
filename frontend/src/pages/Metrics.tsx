import { useEffect, useState } from 'react';
import axios from 'axios';
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
  const [metrics, setMetrics] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    fetchMetrics();
    fetchHistory();
  }, [currency]);

  const fetchMetrics = async () => {
    try {
      const response = await axios.get('/metrics', {
        params: { currency },
      });
      setMetrics(response.data);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const response = await axios.get('/metrics/history', {
        params: { currency, days: 30 },
      });
      setHistory(response.data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const chartData = {
    labels: history.map((h) => h.date),
    datasets: [
      {
        label: 'Net Worth',
        data: history.map((h) => h.netWorth),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.1,
      },
      {
        label: 'Total Assets',
        data: history.map((h) => h.totalAssets),
        borderColor: 'rgb(54, 162, 235)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        tension: 0.1,
      },
      {
        label: 'Total Liabilities',
        data: history.map((h) => h.totalLiabilities),
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        tension: 0.1,
      },
    ],
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="metrics-page">
      <div className="page-header">
        <h1>Metrics & Analytics</h1>
        <div className="currency-selector">
          <label>Currency:</label>
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
            <h3>Net Worth</h3>
            <p>
              {metrics.netWorth?.toLocaleString(undefined, {
                style: 'currency',
                currency: metrics.currency || 'USD',
              })}
            </p>
          </div>
          <div className="metric-item">
            <h3>Total Assets</h3>
            <p>
              {metrics.totalAssets?.toLocaleString(undefined, {
                style: 'currency',
                currency: metrics.currency || 'USD',
              })}
            </p>
          </div>
          <div className="metric-item">
            <h3>Total Liabilities</h3>
            <p>
              {metrics.totalLiabilities?.toLocaleString(undefined, {
                style: 'currency',
                currency: metrics.currency || 'USD',
              })}
            </p>
          </div>
          {metrics.totalActiveIncome !== undefined && (
            <div className="metric-item">
              <h3>Active Income</h3>
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
              <h3>Passive Income</h3>
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
              <h3>Runway</h3>
              <p>{metrics.runway.toFixed(1)} months</p>
            </div>
          )}
          {metrics.flRatio !== null && metrics.flRatio !== undefined && (
            <div className="metric-item">
              <h3>FL-Ratio</h3>
              <p>{(metrics.flRatio * 100).toFixed(2)}%</p>
              <p style={{ fontSize: '0.9em', color: '#666', marginTop: '5px' }}>
                Passive Income / Monthly Expenses
              </p>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="chart-container">
          <h2>Capital History (30 days)</h2>
          <Line data={chartData} />
        </div>
      )}

      {metrics && (
        <div className="distribution-container">
          <div className="distribution-card">
            <h2>Asset Distribution</h2>
            <ul>
              {Object.entries(metrics.assetDistribution || {}).map(
                ([category, percentage]: [string, any]) => (
                  <li key={category}>
                    <span className="category-name">{category}:</span>
                    <span className="category-percentage">{percentage.toFixed(2)}%</span>
                  </li>
                )
              )}
            </ul>
          </div>
          <div className="distribution-card">
            <h2>Liability Distribution</h2>
            <ul>
              {Object.entries(metrics.liabilityDistribution || {}).map(
                ([category, percentage]: [string, any]) => (
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
