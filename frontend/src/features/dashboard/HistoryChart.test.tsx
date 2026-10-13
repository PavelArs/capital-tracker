import type { HistoryPoint } from '@api/portfolio-history.api';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistoryChart from './HistoryChart';

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
});
