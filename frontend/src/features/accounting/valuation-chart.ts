import type { ValuationHistoryPoint } from '@api/valuation-history.api';
import type { ChartData, ChartOptions, ScatterDataPoint } from 'chart.js';

interface ValuationChartPoint extends ScatterDataPoint {
  at: string;
  exactTotalUsd: string;
}

export function formatValuationTooltip(
  point: Pick<ValuationHistoryPoint, 'at' | 'totalValueUsd'>,
): string {
  return `${point.at} — ${point.totalValueUsd} USD (точно)`;
}

export function toValuationChartData(
  points: readonly ValuationHistoryPoint[],
): ChartData<'scatter', ValuationChartPoint[]> {
  const data: ValuationChartPoint[] = points.flatMap((point) =>
    point.completeness === 'complete' && point.totalValueUsd !== null
      ? [
          {
            x: Date.parse(point.at),
            y: Number(point.totalValueUsd),
            at: point.at,
            exactTotalUsd: point.totalValueUsd,
          },
        ]
      : [],
  );
  return {
    datasets: [
      {
        label: 'Стоимость позиций, USD (приближённо)',
        data,
        showLine: false,
        pointRadius: 5,
        pointHoverRadius: 7,
        backgroundColor: '#2563eb',
      },
    ],
  };
}

export const valuationChartOptions: ChartOptions<'scatter'> = {
  responsive: true,
  maintainAspectRatio: false,
  parsing: false,
  spanGaps: false,
  scales: {
    x: {
      type: 'linear',
      title: { display: true, text: 'Момент UTC' },
      ticks: {
        callback: (value) => new Date(Number(value)).toISOString(),
        maxRotation: 0,
      },
    },
    y: { type: 'linear', title: { display: true, text: 'USD (приближённо)' } },
  },
  plugins: {
    decimation: { enabled: false },
    tooltip: {
      callbacks: {
        label: (context) => {
          const point = context.raw as ValuationChartPoint;
          return formatValuationTooltip({ at: point.at, totalValueUsd: point.exactTotalUsd });
        },
      },
    },
  },
};
