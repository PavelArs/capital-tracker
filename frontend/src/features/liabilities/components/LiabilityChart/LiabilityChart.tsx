import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import type { Liability } from '@shared/types';
import { CHART_COLORS } from '../../constants';
import './LiabilityChart.css';

ChartJS.register(ArcElement, Tooltip, Legend);

interface LiabilityChartProps {
  liabilities: Liability[];
}

export const LiabilityChart = memo(function LiabilityChart({ liabilities }: LiabilityChartProps) {
  const { t } = useTranslation();

  const chartData = useMemo(() => {
    const categoryTotals = liabilities.reduce(
      (acc, liability) => {
        acc[liability.category] =
          (acc[liability.category] || 0) + parseFloat(String(liability.amount));
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      labels: Object.keys(categoryTotals),
      datasets: [
        {
          data: Object.values(categoryTotals),
          backgroundColor: CHART_COLORS,
        },
      ],
    };
  }, [liabilities]);

  const chartOptions = useMemo(
    () => ({
      plugins: {
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
    []
  );

  if (liabilities.length === 0) {
    return null;
  }

  return (
    <div className="liability-chart">
      <h2 className="liability-chart__title">{t('liabilities.liabilityDistribution')}</h2>
      <div className="liability-chart__container">
        <Pie data={chartData} options={chartOptions} />
      </div>
    </div>
  );
});
