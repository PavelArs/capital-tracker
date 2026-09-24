import { describe, expect, it } from 'vitest';
import {
  formatValuationTooltip,
  toValuationChartData,
  valuationChartOptions,
} from './valuation-chart';

describe('historical valuation chart boundary', () => {
  const points = [
    {
      at: '2025-01-01T00:00:00.000Z',
      completeness: 'complete',
      missingPriceCount: 0,
      totalValueUsd: '0',
      pricedSubtotalUsd: '0',
    },
    {
      at: '2025-01-02T00:00:00.000Z',
      completeness: 'incomplete',
      missingPriceCount: 1,
      totalValueUsd: null,
      pricedSubtotalUsd: '999',
    },
    {
      at: '2025-01-03T00:00:00.000Z',
      completeness: 'complete',
      missingPriceCount: 0,
      totalValueUsd: '0.000000000000000000000000000000000000000000000000000000000001',
      pricedSubtotalUsd: '0.000000000000000000000000000000000000000000000000000000000001',
    },
    {
      at: '2025-01-03T12:00:00.000Z',
      completeness: 'complete',
      missingPriceCount: 0,
      totalValueUsd: '123456789012345678901234567890.12345678901234567890123456789',
      pricedSubtotalUsd: '123456789012345678901234567890.12345678901234567890123456789',
    },
  ] as const;

  it('plots complete zero and large/tiny values, but never an incomplete subtotal', () => {
    const chart = toValuationChartData(points);
    const dataset = chart.datasets[0];
    expect(dataset.showLine).toBe(false);
    expect(dataset.data.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: Date.parse(points[0].at), y: 0 },
      { x: Date.parse(points[2].at), y: 1e-60 },
      { x: Date.parse(points[3].at), y: Number(points[3].totalValueUsd) },
    ]);
    expect(dataset.data).toHaveLength(3);
    expect(chart.labels).toBeUndefined();
  });

  it('retains exact UTC instants and decimal strings in tooltip text', () => {
    expect(formatValuationTooltip(points[2])).toContain(points[2].at);
    expect(formatValuationTooltip(points[2])).toContain(points[2].totalValueUsd);
    expect(formatValuationTooltip(points[3])).toContain(points[3].totalValueUsd);
  });

  it('uses a linear timestamp axis and never bridges missing dates', () => {
    expect(valuationChartOptions.scales?.x).toMatchObject({ type: 'linear' });
    expect(valuationChartOptions).toMatchObject({
      spanGaps: false,
      plugins: { decimation: { enabled: false } },
    });
    expect(toValuationChartData([points[1]]).datasets[0].data).toEqual([]);
  });
});
