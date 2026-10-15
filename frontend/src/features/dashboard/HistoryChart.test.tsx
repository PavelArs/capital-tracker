import type { HistoryPoint } from '@api/portfolio-history.api';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistoryChart, { compact, pointLabel } from './HistoryChart';

const point = (day: number, value: string): HistoryPoint => ({
  at: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  value,
  invested: '100.00',
  complete: true,
});

describe('HistoryChart', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws at the width of its box from the first render, not at a default and then again', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1083,
      height: 290,
    } as DOMRect);
    const { container } = render(
      <HistoryChart
        points={[point(1, '100.00'), point(2, '120.00')]}
        period="1M"
        currency="USD"
        label="Value"
      />,
    );
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1083 290');
  });

  it('dashboard-20 writes axis amounts with a lowercase k and M', () => {
    expect(
      [0, 500, 1000, 1500, 2000, 148_000, 1_250_000, -3000].map((v) => compact(v, 'USD')),
    ).toEqual(['$0', '$500', '$1k', '$1.5k', '$2k', '$148k', '$1.25M', '-$3k']);
    expect(compact(850_000, 'RUB')).toBe('₽850k');
  });

  it('dashboard-20 puts the 24H date ticks on whole hours', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1083,
      height: 290,
    } as DOMRect);
    const hours: HistoryPoint[] = Array.from({ length: 7 }, (_, hour) => ({
      at: `2026-10-15T0${hour}:00:00.000Z`,
      value: String(100 + hour),
      invested: '100.00',
      complete: true,
    }));
    const now = {
      at: '2026-10-15T06:49:00.000Z',
      value: '107',
      invested: '100.00',
      complete: true,
    };
    const { container } = render(
      <HistoryChart points={[...hours, now]} period="24H" currency="USD" label="Value" />,
    );
    const dates = [...container.querySelectorAll('text.dashboard-chart__tick')]
      .filter((tick) => tick.getAttribute('y') === '284')
      .map((tick) => tick.textContent);
    expect(dates.length).toBeGreaterThan(1);
    for (const date of dates) expect(date).toMatch(/^\d\d:00$/);
  });

  it('dashboard-20 names the weekday in the tooltip date', () => {
    expect(pointLabel({ at: '2026-10-15T06:00:00.000Z' }, '24H', false)).toBe(
      'Thu, Oct 15, 06:00 UTC',
    );
    expect(pointLabel({ at: '2026-10-04T00:00:00.000Z' }, '1M', false)).toBe('Sun, Oct 4, 2026');
  });
});
