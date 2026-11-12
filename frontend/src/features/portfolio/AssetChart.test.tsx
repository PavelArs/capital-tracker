import type { AssetHistoryPoint } from '@api/asset-history.api';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetChart from './AssetChart';

// Synthetic points only: three days of a position in USD.
const point = (at: string, changes: Partial<AssetHistoryPoint> = {}): AssetHistoryPoint => ({
  at,
  quantity: '1',
  value: '80000',
  complete: true,
  cost: '60000',
  costComplete: true,
  ...changes,
});

const points = [
  point('2026-03-01T00:00:00.000Z', { complete: false }),
  point('2026-03-02T00:00:00.000Z', {
    quantity: '1.5',
    value: '120000',
    cost: '90000',
    costComplete: false,
  }),
  point('2026-03-03T00:00:00.000Z', { quantity: '1.5', value: '126000', cost: '90000' }),
];

const draw = (shown: AssetHistoryPoint[]) =>
  render(
    <AssetChart
      points={shown}
      period="1M"
      currency="USD"
      symbol="BTC"
      purchases={[{ at: '2026-03-02T00:00:00.000Z', quantity: '0.5' }]}
      label="Bitcoin value"
    />,
  );

describe('ASSET-CHART-TIP the chart reads each point from the keyboard', () => {
  afterEach(cleanup);

  it('ASSET-CHART-TIP shows the value, amount, cost and purchases of the point in focus', async () => {
    const user = userEvent.setup();
    draw(points);
    const chart = screen.getByRole('group', { name: /^Bitcoin value\./ });
    chart.focus();
    await user.keyboard('{End}');
    const last = screen.getByRole('status');
    expect(last).toHaveTextContent('Now$126,000.00Amount1.5 BTCCost basis$90,000.00');
    // A tip near the right edge opens to the left of its point.
    expect(Number.parseFloat(last.style.left)).toBeLessThan(800 - 200);
    await user.keyboard('{ArrowLeft}');
    const bought = screen.getByRole('status');
    expect(within(bought).getByText('Purchase').parentElement).toHaveTextContent(
      'Purchase+0.5 BTC',
    );
    expect(bought).toHaveTextContent('Cost basis$90,000.00 known');
    await user.keyboard('{Home}');
    const first = screen.getByRole('status');
    expect(first).toHaveStyle({ left: '18px' });
    expect(first).toHaveTextContent('Incomplete: no price, rate or full history');
    await user.keyboard('a');
    expect(screen.getByRole('status')).toBe(first);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ASSET-CHART-TIP says the cost is unknown when no purchase price is known at all', async () => {
    const user = userEvent.setup();
    draw(points.map((entry) => ({ ...entry, cost: '0', costComplete: false })));
    screen.getByRole('group', { name: /^Bitcoin value\./ }).focus();
    await user.keyboard('{End}');
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('Cost basisunknown');
    expect(tip).not.toHaveTextContent('known Purchase');
    expect(within(tip).queryByText('Purchase')).toBeNull();
  });
});

describe('ASSET-CHART cursor, drawing and width', () => {
  // Five days with no price on Mar 3; buys on Mar 2 and on Mar 4 at noon, which Mar 5 shows.
  const days = [
    point('2026-03-01T00:00:00.000Z', { complete: false }),
    point('2026-03-02T00:00:00.000Z', {
      quantity: '1.5',
      value: '120000',
      cost: '90000',
      costComplete: false,
    }),
    point('2026-03-03T00:00:00.000Z', {
      quantity: '1.5',
      value: null,
      complete: false,
      cost: '90000',
    }),
    point('2026-03-04T00:00:00.000Z', { quantity: '1.5', value: '126000', cost: '90000' }),
    point('2026-03-05T00:00:00.000Z', { quantity: '2', value: '170000', cost: '130000' }),
  ];
  /** The box sits 100 px from the left; it keeps its first 800 px, a plot 732 px wide from x = 4. */
  const show = () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 1068,
      height: 290,
    } as DOMRect);
    const view = render(
      <AssetChart
        points={days}
        period="1M"
        currency="USD"
        symbol="BTC"
        purchases={[
          { at: '2026-03-02T00:00:00.000Z', quantity: '0.5' },
          { at: '2026-03-04T12:00:00.000Z', quantity: '0.5' },
        ]}
        label="Bitcoin value"
      />,
    );
    return { ...view, chart: screen.getByRole('group', { name: /^Bitcoin value\./ }) };
  };
  const tipDate = () => screen.queryByRole('status')?.firstElementChild?.textContent ?? null;

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ASSET-CHART moves the cursor with the arrow keys, Home and End, stops at both ends and leaves other keys alone', () => {
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
      ['ArrowLeft', false, 'Wed, Mar 4, 2026'],
      ['ArrowLeft', false, 'Mon, Mar 2, 2026'],
      ['ArrowRight', false, 'Wed, Mar 4, 2026'],
      ['ArrowRight', false, 'Now'],
      ['ArrowRight', false, 'Now'],
      ['Home', false, 'Sun, Mar 1, 2026'],
      ['ArrowLeft', false, 'Sun, Mar 1, 2026'],
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

  it('ASSET-CHART reads the point nearest the pointer, held inside the plot, and clears it when the pointer leaves', () => {
    const { chart } = show();
    // Mar 1 is at x 0 of the plot, Mar 2 at 183, Mar 4 at 549 and Mar 5 at 732; the box adds 104.
    const read = (clientX: number) => {
      fireEvent.pointerMove(chart, { clientX });
      return tipDate();
    };
    expect([-50, 195, 196, 470, 471, 2000].map(read)).toEqual([
      'Sun, Mar 1, 2026',
      'Sun, Mar 1, 2026',
      'Mon, Mar 2, 2026',
      // Halfway between two points the earlier one is read.
      'Mon, Mar 2, 2026',
      'Wed, Mar 4, 2026',
      'Now',
    ]);
    fireEvent.pointerLeave(chart);
    expect(tipDate()).toBeNull();
  });

  it('ASSET-CHART draws the scale, the value broken where it has no price, its area, the cost basis, the purchases and the cursor', () => {
    const { chart } = show();
    const svg = chart.querySelector('svg') as SVGSVGElement;
    const attrs = (selector: string, names: string[]) =>
      [...svg.querySelectorAll(selector)].map((node) =>
        names.map((name) => node.getAttribute(name) ?? node.textContent).join(' '),
      );
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 290');
    expect(attrs('.dashboard-chart__grid', ['x1', 'x2', 'y1'])).toEqual([
      '4 736 262',
      '4 736 178.66666666666669',
      '4 736 95.33333333333334',
      '4 736 12',
    ]);
    expect(attrs('g > text.dashboard-chart__tick', ['x', 'y', 'text'])).toEqual([
      '796 266 $50k',
      '796 182.66666666666669 $100k',
      '796 99.33333333333334 $150k',
      '796 16 $200k',
    ]);
    expect(attrs('.dashboard-chart__axis', ['x1', 'x2', 'y1', 'y2'])).toEqual(['4 736 262 262']);
    expect(attrs('svg > text.dashboard-chart__tick', ['x', 'y', 'text-anchor', 'text'])).toEqual([
      '4 284 start Mar 1',
      '187 284 middle Mar 2',
      '370 284 middle Mar 3',
      '553 284 middle Mar 4',
      '736 284 end Mar 5',
    ]);
    expect(attrs('path[fill]', ['d', 'fill'])).toEqual([
      'M4.0 212.0L187.0 145.3L187.0 262L4.0 262ZM553.0 135.3L736.0 62.0L736.0 262L553.0 262Z url(#asset-area)',
    ]);
    expect(attrs('.dashboard-chart__invested', ['d'])).toEqual([
      'M4.0 245.3H187.0V195.3H370.0V195.3H553.0V195.3H736.0V128.7',
    ]);
    expect(attrs('.dashboard-chart__line', ['d'])).toEqual([
      'M4.0 212.0L187.0 145.3M553.0 135.3L736.0 62.0',
    ]);
    expect(attrs('circle', ['class', 'cx', 'cy', 'r'])).toEqual([
      'dashboard-chart__deposit 187 195.33333333333331 4',
      'dashboard-chart__deposit 736 128.66666666666666 4',
      'dashboard-chart__dot 736 62 4.5',
    ]);
    act(() => chart.focus());
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(attrs('.dashboard-chart__cursor', ['x1', 'x2', 'y1', 'y2'])).toEqual(['553 553 12 262']);
    expect(attrs('g > circle', ['class', 'cx', 'cy', 'r'])).toEqual([
      'dashboard-chart__dot 553 135.33333333333331 5',
    ]);
    expect(screen.getByRole('status').getAttribute('style')).toBe(
      'left: 567px; top: 95.33333333333331px;',
    );
    // Near the right edge the tip opens to the left of its point.
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByRole('status').getAttribute('style')).toBe('left: 522px; top: 22px;');
  });

  it('ASSET-CHART follows the width of its box, keeps the last width over a zero one and stops on unmount', () => {
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
    const { chart, container, unmount } = show();
    const resize = (width: number) =>
      act(() =>
        observed.report?.(
          [{ contentRect: { width } } as ResizeObserverEntry],
          {} as ResizeObserver,
        ),
      );
    expect(observed.box).toBe(chart);
    resize(600);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 600 290');
    resize(0);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 600 290');
    unmount();
    expect(observed.stopped).toBe(true);
  });
});
