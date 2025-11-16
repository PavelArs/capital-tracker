import { useEffect, useState } from "react";
import axios from "axios";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import "./Dashboard.css";

// Helper function to format category names
const formatCategoryName = (category: string): string => {
  const categoryMap: Record<string, string> = {
    // Stock assets
    real_estate: "Real Estate",
    investments: "Investments",
    savings: "Savings",
    crypto: "Crypto",
    vehicle: "Vehicle",
    equipment: "Equipment",
    // Flow assets
    salary: "Salary",
    dividends: "Dividends",
    freelance: "Freelance",
    rent_income: "Rent Income",
    pension: "Pension",
    // Liabilities
    subscriptions: "Subscriptions",
    regular_expenses: "Regular Expenses",
    loans: "Loans",
    mortgage: "Mortgage",
    credit_card: "Credit Card",
    other: "Other",
  };
  return (
    categoryMap[category] ||
    category.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
  );
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export default function Dashboard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    fetchMetrics();
    fetchHistory();
  }, [currency]);

  const fetchMetrics = async () => {
    try {
      const response = await axios.get("/metrics", {
        params: { currency },
      });
      setMetrics(response.data);
    } catch (error) {
      console.error("Error fetching metrics:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const response = await axios.get("/metrics/history", {
        params: { currency, days: 30 },
      });
      setHistory(response.data);
    } catch (error) {
      console.error("Error fetching history:", error);
    }
  };

  const chartData = {
    labels: history.map((h) => h.date),
    datasets: [
      {
        label: "Net Worth",
        data: history.map((h) => h.netWorth),
        borderColor: "rgb(75, 192, 192)",
        backgroundColor: "rgba(75, 192, 192, 0.2)",
        tension: 0.1,
      },
      {
        label: "Total Assets",
        data: history.map((h) => h.totalAssets),
        borderColor: "rgb(54, 162, 235)",
        backgroundColor: "rgba(54, 162, 235, 0.2)",
        tension: 0.1,
      },
      {
        label: "Total Liabilities",
        data: history.map((h) => h.totalLiabilities),
        borderColor: "rgb(255, 99, 132)",
        backgroundColor: "rgba(255, 99, 132, 0.2)",
        tension: 0.1,
      },
    ],
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <div className="currency-selector">
          <label>Currency:</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="RUB">RUB</option>
          </select>
        </div>
      </div>
      {metrics && (
        <>
          <div className="metrics-grid">
            <div className="metric-card">
              <h3>Net Worth</h3>
              <p className="metric-value">
                {metrics.netWorth?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
              <p className="metric-description">Stock Assets - Liabilities</p>
            </div>
            <div className="metric-card stock-assets">
              <h3>Stock Assets</h3>
              <p className="metric-value">
                {metrics.totalStockAssets?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
              <p className="metric-description">Balance sheet assets</p>
            </div>
            <div className="metric-card flow-income">
              <h3>Flow Income</h3>
              <p className="metric-value">
                {metrics.totalFlowIncome?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
              <p className="metric-description">Regular income streams</p>
            </div>
            <div className="metric-card">
              <h3>Crypto Value</h3>
              <p className="metric-value">
                {metrics.cryptoValue?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
              <p className="metric-description">Included in Stock Assets</p>
            </div>
            <div className="metric-card">
              <h3>Total Liabilities</h3>
              <p className="metric-value">
                {metrics.totalLiabilities?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
            </div>
            <div className="metric-card">
              <h3>Monthly Expenses</h3>
              <p className="metric-value">
                {metrics.monthlyExpenses?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
            </div>
            {metrics.runway && (
              <div className="metric-card">
                <h3>Runway</h3>
                <p className="metric-value">
                  {metrics.runway.toFixed(1)} months
                </p>
                <p className="metric-description">Based on Net Worth</p>
              </div>
            )}
            {metrics.totalActiveIncome !== undefined && (
              <div className="metric-card">
                <h3>Active Income</h3>
                <p className="metric-value">
                  {metrics.totalActiveIncome?.toLocaleString(undefined, {
                    style: "currency",
                    currency: metrics.currency || "USD",
                  })}
                </p>
                <p className="metric-description">Requires active work</p>
              </div>
            )}
            {metrics.totalPassiveIncome !== undefined && (
              <div className="metric-card">
                <h3>Passive Income</h3>
                <p className="metric-value">
                  {metrics.totalPassiveIncome?.toLocaleString(undefined, {
                    style: "currency",
                    currency: metrics.currency || "USD",
                  })}
                </p>
                <p className="metric-description">Passive income sources</p>
              </div>
            )}
            {metrics.flRatio !== null && metrics.flRatio !== undefined && (
              <div className="metric-card">
                <h3>FL-Ratio</h3>
                <p className="metric-value">
                  {(metrics.flRatio * 100).toFixed(2)}%
                </p>
                <p className="metric-description">
                  Passive Income Coverage (Passive Income / Monthly Expenses)
                </p>
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="chart-container">
              <h2>Capital History (30 days)</h2>
              <Line data={chartData} />
            </div>
          )}

          {metrics && (
            <div className="distribution-container">
              <div className="distribution-card">
                <h2>Stock Assets Distribution</h2>
                {Object.keys(metrics.stockAssetDistribution || {}).length >
                0 ? (
                  <ul>
                    {Object.entries(metrics.stockAssetDistribution || {}).map(
                      ([category, percentage]: [string, any]) => (
                        <li key={category}>
                          <span className="category-name">
                            {formatCategoryName(category)}:
                          </span>
                          <span className="category-percentage">
                            {percentage.toFixed(2)}%
                          </span>
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <p className="no-data">No stock assets data available</p>
                )}
              </div>
              <div className="distribution-card">
                <h2>Flow Income Distribution</h2>
                {Object.keys(metrics.flowIncomeDistribution || {}).length >
                0 ? (
                  <ul>
                    {Object.entries(metrics.flowIncomeDistribution || {}).map(
                      ([category, percentage]: [string, any]) => (
                        <li key={category}>
                          <span className="category-name">
                            {formatCategoryName(category)}:
                          </span>
                          <span className="category-percentage">
                            {percentage.toFixed(2)}%
                          </span>
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <p className="no-data">No flow income data available</p>
                )}
              </div>
              <div className="distribution-card">
                <h2>Liability Distribution</h2>
                {Object.keys(metrics.liabilityDistribution || {}).length > 0 ? (
                  <ul>
                    {Object.entries(metrics.liabilityDistribution || {}).map(
                      ([category, percentage]: [string, any]) => (
                        <li key={category}>
                          <span className="category-name">
                            {formatCategoryName(category)}:
                          </span>
                          <span className="category-percentage">
                            {percentage.toFixed(2)}%
                          </span>
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <p className="no-data">No liabilities data available</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
