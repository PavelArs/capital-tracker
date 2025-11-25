import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
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
import DashboardSkeleton from "../components/DashboardSkeleton";
import ErrorMessage from "../components/ErrorMessage";
import "./Dashboard.css";

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
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");

  // Track active requests to prevent duplicates
  const fetchingRef = useRef({ metrics: false, history: false });

  // Helper function to format category names
  const formatCategoryName = (category: string): string => {
    const categoryMap: Record<string, string> = {
      // Stock assets
      real_estate: t("assets.categories.realEstate"),
      investments: t("assets.categories.investments"),
      savings: t("assets.categories.savings"),
      crypto: t("assets.categories.crypto"),
      vehicle: t("assets.categories.vehicle"),
      equipment: t("assets.categories.equipment"),
      // Flow assets
      salary: t("assets.categories.salary"),
      dividends: t("assets.categories.dividends"),
      freelance: t("assets.categories.freelance"),
      rent_income: t("assets.categories.rentIncome"),
      pension: t("assets.categories.pension"),
      // Liabilities
      subscriptions: t("liabilities.categories.subscriptions"),
      regular_expenses: t("liabilities.categories.regularExpenses"),
      loans: t("liabilities.categories.loans"),
      mortgage: t("liabilities.categories.mortgage"),
      credit_card: t("liabilities.categories.creditCard"),
      other: t("assets.categories.other"),
    };
    return (
      categoryMap[category] ||
      category.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
    );
  };

  const fetchMetrics = useCallback(async () => {
    // Prevent duplicate requests
    if (fetchingRef.current.metrics) {
      console.log("⏳ Metrics request already in progress, skipping");
      return;
    }

    try {
      fetchingRef.current.metrics = true;
      setError(null);
      console.log("↓ Fetching metrics for currency:", currency);
      const response = await axios.get("/metrics", {
        params: { currency },
      });
      setMetrics(response.data);
    } catch (error: any) {
      console.error("Error fetching metrics:", error);
      setError(error.response?.data?.message || t("common.errorLoading"));
    } finally {
      setLoading(false);
      fetchingRef.current.metrics = false;
    }
  }, [currency, t]);

  const fetchHistory = useCallback(async () => {
    // Prevent duplicate requests
    if (fetchingRef.current.history) {
      console.log("⏳ History request already in progress, skipping");
      return;
    }

    try {
      fetchingRef.current.history = true;
      console.log("↓ Fetching history for currency:", currency);
      const response = await axios.get("/metrics/history", {
        params: { currency, days: 30 },
      });
      setHistory(response.data);
    } catch (error: any) {
      console.error("Error fetching history:", error);
      // Don't set error for history as it's not critical
    } finally {
      fetchingRef.current.history = false;
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
        label: t("dashboard.netWorth"),
        data: history.map((h) => h.netWorth),
        borderColor: "rgb(75, 192, 192)",
        backgroundColor: "rgba(75, 192, 192, 0.2)",
        tension: 0.1,
      },
      {
        label: t("dashboard.stockAssets"),
        data: history.map((h) => h.totalAssets),
        borderColor: "rgb(54, 162, 235)",
        backgroundColor: "rgba(54, 162, 235, 0.2)",
        tension: 0.1,
      },
      {
        label: t("dashboard.totalLiabilities"),
        data: history.map((h) => h.totalLiabilities),
        borderColor: "rgb(255, 99, 132)",
        backgroundColor: "rgba(255, 99, 132, 0.2)",
        tension: 0.1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: window.innerWidth < 768 ? 1.2 : 2,
    plugins: {
      legend: {
        display: true,
        position:
          window.innerWidth < 768 ? ("bottom" as const) : ("top" as const),
        labels: {
          boxWidth: window.innerWidth < 768 ? 12 : 40,
          padding: window.innerWidth < 768 ? 8 : 10,
          font: {
            size:
              window.innerWidth < 480 ? 10 : window.innerWidth < 768 ? 11 : 12,
          },
        },
      },
      tooltip: {
        mode: "index" as const,
        intersect: false,
        bodyFont: {
          size: window.innerWidth < 768 ? 11 : 12,
        },
        titleFont: {
          size: window.innerWidth < 768 ? 12 : 13,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxRotation: window.innerWidth < 768 ? 45 : 0,
          minRotation: window.innerWidth < 768 ? 45 : 0,
          font: {
            size:
              window.innerWidth < 480 ? 9 : window.innerWidth < 768 ? 10 : 11,
          },
          maxTicksLimit:
            window.innerWidth < 480 ? 6 : window.innerWidth < 768 ? 8 : 10,
        },
        grid: {
          display: window.innerWidth >= 768,
        },
      },
      y: {
        ticks: {
          font: {
            size:
              window.innerWidth < 480 ? 9 : window.innerWidth < 768 ? 10 : 11,
          },
          maxTicksLimit: window.innerWidth < 768 ? 6 : 8,
        },
        grid: {
          display: true,
        },
      },
    },
    interaction: {
      mode: "nearest" as const,
      axis: "x" as const,
      intersect: false,
    },
  };

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    fetchMetrics();
    fetchHistory();
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <ErrorMessage
        type="page"
        title={t("common.error")}
        message={error}
        onRetry={handleRetry}
        retryText={t("common.retry")}
      />
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>{t("dashboard.title")}</h1>
        <div className="currency-selector">
          <label>{t("common.currency")}:</label>
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
              <h3>{t("dashboard.netWorth")}</h3>
              <p className="metric-value">
                {metrics.netWorth?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
              <p className="metric-description">
                {t("dashboard.netWorthDescription")}
              </p>
            </div>
            <div className="metric-card stock-assets">
              <h3>{t("dashboard.stockAssets")}</h3>
              <p className="metric-value">
                {metrics.totalStockAssets?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
              <p className="metric-description">
                {t("dashboard.stockAssetsDescription")}
              </p>
            </div>
            <div className="metric-card flow-income">
              <h3>{t("dashboard.flowIncome")}</h3>
              <p className="metric-value">
                {metrics.totalFlowIncome?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
              <p className="metric-description">
                {t("dashboard.flowIncomeDescription")}
              </p>
            </div>
            <div className="metric-card">
              <h3>{t("dashboard.cryptoValue")}</h3>
              <p className="metric-value">
                {metrics.cryptoValue?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
              <p className="metric-description">
                {t("dashboard.cryptoValueDescription")}
              </p>
            </div>
            <div className="metric-card">
              <h3>{t("dashboard.totalLiabilities")}</h3>
              <p className="metric-value">
                {metrics.totalLiabilities?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
            </div>
            <div className="metric-card">
              <h3>{t("dashboard.monthlyExpenses")}</h3>
              <p className="metric-value">
                {metrics.monthlyExpenses?.toLocaleString(undefined, {
                  style: "currency",
                  currency: metrics.currency || "USD",
                })}
              </p>
            </div>
            {metrics.runway && (
              <div className="metric-card">
                <h3>{t("dashboard.runway")}</h3>
                <p className="metric-value">
                  {metrics.runway.toFixed(1)} {t("dashboard.months")}
                </p>
                <p className="metric-description">
                  {t("dashboard.runwayDescription")}
                </p>
              </div>
            )}
            {metrics.totalActiveIncome !== undefined && (
              <div className="metric-card">
                <h3>{t("dashboard.activeIncome")}</h3>
                <p className="metric-value">
                  {metrics.totalActiveIncome?.toLocaleString(undefined, {
                    style: "currency",
                    currency: metrics.currency || "USD",
                  })}
                </p>
                <p className="metric-description">
                  {t("dashboard.activeIncomeDescription")}
                </p>
              </div>
            )}
            {metrics.totalPassiveIncome !== undefined && (
              <div className="metric-card">
                <h3>{t("dashboard.passiveIncome")}</h3>
                <p className="metric-value">
                  {metrics.totalPassiveIncome?.toLocaleString(undefined, {
                    style: "currency",
                    currency: metrics.currency || "USD",
                  })}
                </p>
                <p className="metric-description">
                  {t("dashboard.passiveIncomeDescription")}
                </p>
              </div>
            )}
            {metrics.flRatio !== null && metrics.flRatio !== undefined && (
              <div className="metric-card">
                <h3>{t("dashboard.flRatio")}</h3>
                <p className="metric-value">
                  {(metrics.flRatio * 100).toFixed(2)}%
                </p>
                <p className="metric-description">
                  {t("dashboard.flRatioDescription")}
                </p>
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="chart-container">
              <h2>{t("dashboard.capitalHistory")}</h2>
              <Line data={chartData} options={chartOptions} />
            </div>
          )}

          {metrics && (
            <div className="distribution-container">
              <div className="distribution-card">
                <h2>{t("dashboard.stockAssetsDistribution")}</h2>
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
                  <p className="no-data">{t("dashboard.noStockAssetsData")}</p>
                )}
              </div>
              <div className="distribution-card">
                <h2>{t("dashboard.flowIncomeDistribution")}</h2>
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
                  <p className="no-data">{t("dashboard.noFlowIncomeData")}</p>
                )}
              </div>
              <div className="distribution-card">
                <h2>{t("dashboard.liabilityDistribution")}</h2>
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
                  <p className="no-data">{t("dashboard.noLiabilitiesData")}</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
