import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { formatAmount } from '@utils/formatters';
import type { ViewMode, AssetChartData } from '../../types';
import './AssetChart.css';

ChartJS.register(ArcElement, Tooltip, Legend);

interface AssetChartProps {
  chartData: AssetChartData | null;
  selectedCurrency: string;
  viewMode: ViewMode;
}

export const AssetChart = memo(function AssetChart({
  chartData,
  selectedCurrency,
  viewMode,
}: AssetChartProps) {
  const { t } = useTranslation();

  const chartOptions = useMemo(
    () => ({
      plugins: {
        tooltip: {
          callbacks: {
            label: function (context: any) {
              const label = context.label || '';
              let currency = '';
              let percentage = '';
              let displayValue = 0;

              const labelMatch = label.match(/^(.+?)\s*\(([\d.]+)%\)$/);
              let cleanLabel = labelMatch ? labelMatch[1] : label;
              const labelPercentage = labelMatch ? labelMatch[2] : null;

              if (chartData?._keys && chartData?._originalTotals) {
                const key = chartData._keys[context.dataIndex];
                displayValue = chartData._originalTotals[key] || 0;
              } else {
                displayValue = context.parsed || 0;
              }

              if (viewMode === 'single') {
                currency = selectedCurrency;
                if (labelPercentage) {
                  percentage = ` (${labelPercentage}%)`;
                } else if (chartData?._usdTotals && chartData?._totalUSD) {
                  const key = chartData._keys[context.dataIndex];
                  const usdValue = chartData._usdTotals[key] || 0;
                  const pct =
                    chartData._totalUSD > 0 ? (usdValue / chartData._totalUSD) * 100 : 0;
                  percentage = ` (${pct.toFixed(1)}%)`;
                }
              } else {
                const parenthesesMatches = cleanLabel.match(/\(([^)]+)\)/g);
                if (parenthesesMatches && parenthesesMatches.length > 0) {
                  const lastMatch = parenthesesMatches[parenthesesMatches.length - 1];
                  const currencyCandidate = lastMatch.replace(/[()]/g, '');
                  if (/^[A-Z0-9]{3,}$/.test(currencyCandidate)) {
                    currency = currencyCandidate;
                    cleanLabel = cleanLabel.replace(/\s*\([A-Z0-9]{3,}\)\s*$/, '');
                  }
                }
                if (labelPercentage) {
                  percentage = ` (${labelPercentage}%)`;
                }
              }

              return `${cleanLabel}: ${formatAmount(displayValue, currency)} ${currency}${percentage}`;
            },
          },
        },
        legend: {
          position: 'bottom' as const,
          labels: {
            boxWidth: 12,
            padding: 12,
            font: {
              size: 12,
            },
          },
        },
      },
      maintainAspectRatio: true,
      responsive: true,
    }),
    [chartData, selectedCurrency, viewMode]
  );

  if (!chartData) {
    return null;
  }

  return (
    <div className="asset-chart">
      <h2 className="asset-chart__title">
        {t('assets.assetDistribution')}
        {viewMode === 'single' && (
          <span className="asset-chart__currency-badge">({selectedCurrency})</span>
        )}
      </h2>
      <div className="asset-chart__container">
        <Pie data={chartData} options={chartOptions} />
      </div>
    </div>
  );
});

