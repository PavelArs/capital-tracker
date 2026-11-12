import type { DepositChartPoint } from '@api/deposits.api';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DepositChart from './DepositChart';

// Synthetic monthly figures in the shape GET /deposits/:id returns them in `chart`. The money put
// in goes below zero after a large withdrawal; the official real figure is missing in March.
const month = (
  date: string,
  balance: string,
  invested: string,
  official: DepositChartPoint['real']['official'] = null,
): DepositChartPoint => ({ date, balance, invested, real: { official, personal: null } });
const months: DepositChartPoint[] = [
  month('2026-01-11', '100000.00', '100000.00', {
    balance: '100000.00',
    invested: '100000.00',
    estimated: false,
  }),
  month('2026-02-11', '101000.00', '100000.00', {
    balance: '100500.00',
    invested: '100400.00',
    estimated: false,
  }),
  month('2026-03-11', '102000.00', '100000.00'),
  month('2026-04-11', '103000.00', '110000.00', {
    balance: '102000.00',
    invested: '108000.00',
    estimated: true,
  }),
  month('2026-05-11', '104000.00', '-5000.00', {
    balance: '103000.00',
    invested: '-4000.00',
    estimated: true,
  }),
  month('2026-06-11', '105000.00', '-5000.00', {
    balance: '104000.00',
    invested: '-4000.00',
    estimated: true,
  }),
];

/** The box sits 100 px from the left; it keeps its first 800 px, a plot 732 px wide from x = 4. */
const show = (real = false) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    width: 1068,
    height: 260,
  } as DOMRect);
  const view = render(<DepositChart points={months} currency="RUB" real={real} basis="official" />);
  return { ...view, chart: screen.getByRole('group', { name: /Use the arrow keys/ }) };
};
const tipDate = () => screen.queryByRole('status')?.firstElementChild?.textContent ?? null;
const attrs = (chart: HTMLElement, selector: string, names: string[]) =>
  [...(chart.querySelector('svg')?.querySelectorAll(selector) ?? [])].map((node) =>
    names.map((name) => node.getAttribute(name) ?? node.textContent).join(' '),
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('INFL-DEPOSIT-CHART cursor, drawing and width', () => {
  it('INFL-DEPOSIT-CHART moves the cursor with the arrow keys, Home and End, stops at both ends and leaves other keys alone', () => {
    const { chart } = show();
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
      ['ArrowLeft', false, 'May 11, 2026'],
      ['ArrowLeft', false, 'Apr 11, 2026'],
      ['ArrowRight', false, 'May 11, 2026'],
      ['ArrowRight', false, 'Jun 11, 2026'],
      ['ArrowRight', false, 'Jun 11, 2026'],
      ['Home', false, 'Jan 11, 2026'],
      ['ArrowLeft', false, 'Jan 11, 2026'],
      ['End', false, 'Jun 11, 2026'],
      ['a', true, 'Jun 11, 2026'],
      ['ArrowUp', true, 'Jun 11, 2026'],
      ['Escape', true, null],
      ['ArrowRight', false, 'Jun 11, 2026'],
      // React reads a key named after an Object member as that member: not a move.
      ['toString', true, 'Jun 11, 2026'],
    ]);
    fireEvent.blur(chart);
    expect(tipDate()).toBeNull();
    // Another period clears the point read.
    fireEvent.keyDown(chart, { key: 'End' });
    fireEvent.click(screen.getByRole('tab', { name: '3M' }));
    expect(tipDate()).toBeNull();
  });

  it('INFL-DEPOSIT-CHART reads the point nearest the pointer, held inside the plot, and clears it when the pointer leaves', () => {
    const { chart } = show();
    // Over 151 days, Jan 11 is at x 0 of the plot, Feb 11 at 150.3, Apr 11 at 436.3, May 11 at
    // 581.7 and Jun 11 at 732; the box adds 104.
    const read = (clientX: number) => {
      fireEvent.pointerMove(chart, { clientX });
      return tipDate();
    };
    expect([-50, 179, 180, 613, 614, 2000].map(read)).toEqual([
      'Jan 11, 2026',
      'Jan 11, 2026',
      'Feb 11, 2026',
      'Apr 11, 2026',
      'May 11, 2026',
      'Jun 11, 2026',
    ]);
    fireEvent.pointerLeave(chart);
    expect(tipDate()).toBeNull();
  });

  it('INFL-DEPOSIT-CHART draws the scale below zero, the value, its area, the money put in and the cursor', () => {
    const { chart } = show();
    expect(chart.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 800 260');
    expect(attrs(chart, '.dashboard-chart__grid', ['x1', 'x2', 'y1'])).toEqual([
      '4 736 232',
      '4 736 177',
      '4 736 122',
      '4 736 67',
      '4 736 12',
    ]);
    expect(attrs(chart, 'g > text.dashboard-chart__tick', ['x', 'y', 'text'])).toEqual([
      '796 236 -₽50k',
      '796 181 ₽0',
      '796 126 ₽50k',
      '796 71 ₽100k',
      '796 16 ₽150k',
    ]);
    expect(attrs(chart, '.dashboard-chart__axis', ['x1', 'x2', 'y1', 'y2'])).toEqual([
      '4 736 232 232',
    ]);
    expect(
      attrs(chart, 'svg > text.dashboard-chart__tick', ['x', 'y', 'text-anchor', 'text']),
    ).toEqual([
      '4 254 start Jan 2026',
      '187 254 middle Feb 2026',
      '370 254 middle Mar 2026',
      '553 254 middle May 2026',
      '736 254 end Jun 2026',
    ]);
    expect(attrs(chart, 'path[fill]', ['d', 'fill'])).toEqual([
      'M4.0 67.0L154.3 65.9L290.0 64.8L440.3 63.7L585.7 62.6L736.0 61.5L736.0 232L4.0 232Z url(#deposit-area)',
    ]);
    expect(attrs(chart, '.dashboard-chart__invested', ['d'])).toEqual([
      'M4.0 67.0H154.3V67.0H290.0V67.0H440.3V56.0H585.7V182.5H736.0V182.5',
    ]);
    expect(attrs(chart, '.dashboard-chart__line', ['d'])).toEqual([
      'M4.0 67.0L154.3 65.9L290.0 64.8L440.3 63.7L585.7 62.6L736.0 61.5',
    ]);
    expect(attrs(chart, 'circle', ['class', 'cx', 'cy', 'r'])).toEqual([
      'dashboard-chart__dot 736 61.5 4.5',
    ]);
    act(() => chart.focus());
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(attrs(chart, '.dashboard-chart__cursor', ['x1', 'x2', 'y1', 'y2'])).toEqual([
      '585.7218543046357 585.7218543046357 12 232',
    ]);
    expect(attrs(chart, 'g > circle', ['class', 'cx', 'cy', 'r'])).toEqual([
      'dashboard-chart__dot 585.7218543046357 62.599999999999994 5',
    ]);
    expect(screen.getByRole('status').getAttribute('style')).toBe(
      'left: 599.7218543046357px; top: 22.599999999999994px;',
    );
    // Near the right edge the tip opens to the left of its point.
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByRole('status').getAttribute('style')).toBe('left: 522px; top: 21.5px;');
  });

  it('INFL-DEPOSIT-CHART breaks both lines and the area at a month with no figure in today money', () => {
    const { chart } = show(true);
    expect(attrs(chart, 'path[fill]', ['d'])).toEqual([
      'M4.0 67.0L154.3 66.5L154.3 232L4.0 232ZM440.3 64.8L585.7 63.7L736.0 62.6L736.0 232L440.3 232Z',
    ]);
    expect(attrs(chart, '.dashboard-chart__invested', ['d'])).toEqual([
      'M4.0 67.0H154.3V66.6',
      'M440.3 58.2H585.7V181.4H736.0V181.4',
    ]);
    expect(attrs(chart, '.dashboard-chart__line', ['d'])).toEqual([
      'M4.0 67.0L154.3 66.5',
      'M440.3 64.8L585.7 63.7L736.0 62.6',
    ]);
    act(() => chart.focus());
    expect(
      ['Home', 'ArrowRight', 'ArrowRight'].map((key) => {
        fireEvent.keyDown(chart, { key });
        return tipDate();
      }),
    ).toEqual(['Jan 11, 2026', 'Feb 11, 2026', 'Apr 11, 2026']);
  });

  it('INFL-DEPOSIT-CHART follows the width of its box, keeps the last width over a zero one and stops on unmount', () => {
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
    const { chart, unmount } = show();
    const resize = (width: number) =>
      act(() =>
        observed.report?.(
          [{ contentRect: { width } } as ResizeObserverEntry],
          {} as ResizeObserver,
        ),
      );
    expect(observed.box).toBe(chart);
    resize(600);
    expect(chart.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 600 260');
    resize(0);
    expect(chart.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 600 260');
    unmount();
    expect(observed.stopped).toBe(true);
  });
});
