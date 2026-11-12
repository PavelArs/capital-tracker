import type { HistoryPoint } from '@api/portfolio-history.api';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

describe('HistoryChart cursor, drawing and width', () => {
  // Synthetic: five days, a deposit on day 2, no value on day 3, a withdrawal on day 4.
  const day = (at: number, value: string | null, invested: string, complete = true) => ({
    at: `2026-10-0${at}T00:00:00.000Z`,
    value,
    invested,
    complete,
  });
  const points: HistoryPoint[] = [
    day(1, '100.00', '100.00'),
    day(2, '150.00', '150.00', false),
    day(3, null, '150.00', false),
    day(4, '160.00', '120.00'),
    day(5, '170.00', '120.00'),
  ];
  /** The box sits 100 px from the left and is 1068 px wide: the plot is 1000 px from x = 4. */
  const draw = () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 1068,
      height: 290,
    } as DOMRect);
    const view = render(<HistoryChart points={points} period="1M" currency="USD" label="Value" />);
    return { ...view, chart: screen.getByRole('group', { name: /Use the arrow keys/ }) };
  };
  const tipDate = () => screen.queryByRole('status')?.firstElementChild?.textContent ?? null;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('moves the cursor with the arrow keys, Home and End, stops at both ends and leaves other keys alone', () => {
    const { chart } = draw();
    act(() => chart.focus());
    const keys = [
      'ArrowLeft',
      'ArrowLeft',
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'Home',
      'ArrowLeft',
      'End',
      'a',
      'ArrowUp',
      'Escape',
      'ArrowRight',
      'toString',
    ];
    // [key, whether the page keeps the key (not prevented), the point in the tip after it]
    expect(keys.map((key) => [key, fireEvent.keyDown(chart, { key }), tipDate()])).toEqual([
      ['ArrowLeft', false, 'Sun, Oct 4, 2026'],
      ['ArrowLeft', false, 'Fri, Oct 2, 2026'],
      ['ArrowRight', false, 'Sun, Oct 4, 2026'],
      ['ArrowRight', false, 'Now'],
      ['ArrowRight', false, 'Now'],
      ['Home', false, 'Thu, Oct 1, 2026'],
      ['ArrowLeft', false, 'Thu, Oct 1, 2026'],
      ['End', false, 'Now'],
      ['a', true, 'Now'],
      ['ArrowUp', true, 'Now'],
      ['Escape', true, null],
      ['ArrowRight', false, 'Now'],
      // React reads a key named after an Object member as that member: not a move.
      ['toString', true, 'Now'],
    ]);
    fireEvent.blur(chart);
    expect(tipDate()).toBeNull();
  });

  it('reads the point nearest the pointer, held inside the plot, and clears it when the pointer leaves', () => {
    const { chart } = draw();
    // Day 1 is at x 0 of the plot, day 2 at 250, day 4 at 750 and day 5 at 1000; the box adds 104.
    const read = (clientX: number) => {
      fireEvent.pointerMove(chart, { clientX });
      return tipDate();
    };
    expect([-50, 228, 229, 230, 604, 605, 2000].map(read)).toEqual([
      'Thu, Oct 1, 2026',
      'Thu, Oct 1, 2026',
      // Halfway between two points the earlier one is read.
      'Thu, Oct 1, 2026',
      'Fri, Oct 2, 2026',
      'Fri, Oct 2, 2026',
      'Sun, Oct 4, 2026',
      'Now',
    ]);
    fireEvent.pointerLeave(chart);
    expect(tipDate()).toBeNull();
  });

  it('draws the scale, the value broken where it is missing, its area, net invested and the cursor', () => {
    const { chart } = draw();
    const svg = chart.querySelector('svg') as SVGSVGElement;
    const attrs = (selector: string, names: string[]) =>
      [...svg.querySelectorAll(selector)].map((node) =>
        names.map((name) => node.getAttribute(name) ?? node.textContent).join(' '),
      );
    expect(attrs('.dashboard-chart__grid', ['x1', 'x2', 'y1'])).toEqual([
      '4 1004 262',
      '4 1004 212',
      '4 1004 162',
      '4 1004 112',
      '4 1004 62',
      '4 1004 12',
    ]);
    expect(attrs('g > text.dashboard-chart__tick', ['x', 'y', 'text'])).toEqual([
      '1064 266 $80',
      '1064 216 $100',
      '1064 166 $120',
      '1064 116 $140',
      '1064 66 $160',
      '1064 16 $180',
    ]);
    expect(attrs('.dashboard-chart__axis', ['x1', 'x2', 'y1', 'y2'])).toEqual(['4 1004 262 262']);
    expect(attrs('svg > text.dashboard-chart__tick', ['x', 'y', 'text-anchor', 'text'])).toEqual([
      '4 284 start Oct 1',
      '337.3333333333333 284 middle Oct 2',
      '670.6666666666666 284 middle Oct 3',
      '1004 284 end Oct 5',
    ]);
    expect(attrs('path[fill]', ['d', 'fill'])).toEqual([
      'M4.0 212.0L254.0 87.0L254.0 262L4.0 262ZM754.0 62.0L1004.0 37.0L1004.0 262L754.0 262Z url(#dashboard-area)',
    ]);
    expect(attrs('.dashboard-chart__invested', ['d'])).toEqual([
      'M4.0 212.0H254.0V87.0H504.0V87.0H754.0V162.0H1004.0V162.0',
    ]);
    expect(attrs('.dashboard-chart__line', ['d'])).toEqual([
      'M4.0 212.0L254.0 87.0M754.0 62.0L1004.0 37.0',
    ]);
    expect(attrs('circle', ['class', 'cx', 'cy', 'r'])).toEqual([
      'dashboard-chart__deposit 254 87 4',
      'dashboard-chart__incomplete 254 87 2',
      'dashboard-chart__dot 1004 37 4.5',
    ]);
    act(() => chart.focus());
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(attrs('.dashboard-chart__cursor', ['x1', 'x2', 'y1', 'y2'])).toEqual(['754 754 12 262']);
    expect(attrs('g > circle', ['class', 'cx', 'cy', 'r'])).toEqual([
      'dashboard-chart__dot 754 62 5',
    ]);
    expect(screen.getByRole('status').getAttribute('style')).toBe('left: 768px; top: 22px;');
    // Near the right edge the tip opens to the left of its point.
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByRole('status').getAttribute('style')).toBe('left: 790px; top: 0px;');
  });

  it('follows the width of its box, keeps the last width over a zero one and stops on unmount', () => {
    const observed: { report?: ResizeObserverCallback; box?: Element; stopped: boolean } = {
      stopped: false,
    };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(report: ResizeObserverCallback) {
          observed.report = report;
        }
        observe(box: Element) {
          observed.box = box;
        }
        disconnect() {
          observed.stopped = true;
        }
      },
    );
    const { chart, container, unmount } = draw();
    const resize = (width: number) =>
      act(() =>
        observed.report?.(
          [{ contentRect: { width } } as ResizeObserverEntry],
          {} as ResizeObserver,
        ),
      );
    expect(observed.box).toBe(chart);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1068 290');
    resize(600);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 600 290');
    resize(0);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 600 290');
    unmount();
    expect(observed.stopped).toBe(true);
  });
});
