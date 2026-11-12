import type { AssetHistoryPoint } from '@api/asset-history.api';
import type { HistoryPeriod } from '@api/portfolio-history.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useEffect, useRef, useState } from 'react';
import {
  AreaGradient,
  areaPath,
  chartCursor,
  evenTicks,
  linePath,
  observeWidth,
  PointCursor,
  runsOf,
  tipLeftOf,
  ValueGrid,
  valueAxis,
  valuedPoints,
} from '@/ui/chart';
import {
  chartDateTicks,
  chartRightPad,
  compact,
  pointLabel,
  tickLabel,
} from '../dashboard/HistoryChart';
import { money, quantity } from './format';
import '@/ui/chart.css';

const HEIGHT = 290;
const PAD = { left: 4, right: 64, top: 12, bottom: 28 };

/** A buy shown as a dot on the first chart point at or after it. */
export interface Purchase {
  at: string;
  quantity: string;
}

interface Plotted {
  index: number;
  point: AssetHistoryPoint;
  time: number;
  value: number;
}

/** Purchases per chart point: each goes to the first point at or after it within the period. */
export function purchasesByPoint(
  points: readonly AssetHistoryPoint[],
  purchases: readonly Purchase[],
): Map<number, Purchase[]> {
  const byPoint = new Map<number, Purchase[]>();
  const times = points.map((point) => Date.parse(point.at));
  for (const purchase of purchases) {
    const time = Date.parse(purchase.at);
    // A purchase before the first point happened before the period.
    const index = times.findIndex(
      (at, position) => at >= time && (position === 0 ? time === at : time > times[position - 1]),
    );
    if (index < 0) continue;
    byPoint.set(index, [...(byPoint.get(index) ?? []), purchase]);
  }
  return byPoint;
}

// True when coins were held but no purchase price is known at any point: a cost line at $0
// would read as "nothing invested", so the chart leaves it out.
export function costUnknown(points: readonly AssetHistoryPoint[]): boolean {
  const held = points.filter((point) => Number(point.quantity) > 0);
  return held.length > 0 && held.every((point) => !point.costComplete && Number(point.cost) === 0);
}

// The position's value against its cost basis over the period, with its purchases (prototype
// asset page; ASSET-CHART).
export default function AssetChart({
  points,
  period,
  currency,
  symbol,
  purchases,
  label,
}: {
  points: AssetHistoryPoint[];
  period: HistoryPeriod;
  currency: AccountingCurrency;
  symbol: string;
  purchases: readonly Purchase[];
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (element) return observeWidth(element, setWidth);
  }, []);

  const plotted: Plotted[] = valuedPoints(points);
  if (plotted.length === 0)
    return (
      <p className="dashboard-chart__empty" role="note">
        No value can be shown for this period in {currency}.
      </p>
    );

  const innerWidth = Math.max(1, width - PAD.left - chartRightPad(width));
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  // The period spans every point: cost basis is known even while the price is not.
  const timeOf = points.map((point) => Date.parse(point.at));
  const start = timeOf[0];
  const end = timeOf[timeOf.length - 1];
  const span = Math.max(1, end - start);
  const x = (time: number) =>
    PAD.left + (points.length === 1 ? innerWidth / 2 : ((time - start) / span) * innerWidth);
  const last = plotted[plotted.length - 1];
  const noCost = costUnknown(points);
  const costs = points.map((point) => Number(point.cost));
  const values = [...plotted.map((entry) => entry.value), ...(noCost ? [] : costs)];
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = (high - low) * 0.08 || high * 0.02 || 1;
  low = Math.max(0, low - pad);
  high += pad;
  const { y, ticks } = valueAxis(low, high, PAD.top, innerHeight);

  // A point without a price or rate breaks the line instead of dropping to zero.
  const segments = runsOf(plotted);
  const line = segments.map((segment) => linePath(segment, x, y)).join('');
  const base = PAD.top + innerHeight;
  const area = areaPath(segments, x, y, base);
  // Cost basis changes only when coins are bought or sold: a step line.
  const costLine = points
    .map((_, index) => {
      const px = x(timeOf[index]).toFixed(1);
      const py = y(costs[index]).toFixed(1);
      return index ? `H${px}V${py}` : `M${px} ${py}`;
    })
    .join('');
  // Each purchase sits on the cost basis it raised.
  const bought = noCost ? new Map<number, Purchase[]>() : purchasesByPoint(points, purchases);
  const xTicks = evenTicks(start, end, chartDateTicks(width, points.length));

  const current = active === null ? null : plotted[active];
  const cursor = chartCursor({
    points: plotted,
    from: plotted.length - 1,
    left: PAD.left,
    innerWidth,
    start,
    span,
    setActive,
  });

  return (
    <div
      ref={box}
      className="dashboard-chart"
      tabIndex={0}
      role="group"
      aria-label={`${label}. Use the arrow keys to read each point.`}
      {...cursor}
    >
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={label}>
        <defs>
          <AreaGradient id="asset-area" />
        </defs>
        <ValueGrid
          ticks={ticks}
          y={y}
          left={PAD.left}
          right={PAD.left + innerWidth}
          base={base}
          width={width}
          text={(value) => compact(value, currency)}
        />
        {xTicks.map((time, index) => (
          <text
            key={time}
            x={x(time)}
            y={HEIGHT - 6}
            textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
            className="dashboard-chart__tick"
          >
            {tickLabel(time, period)}
          </text>
        ))}
        <path d={area} fill="url(#asset-area)" />
        {!noCost && <path d={costLine} className="dashboard-chart__invested" />}
        <path d={line} className="dashboard-chart__line" />
        {[...bought.keys()].map((index) => (
          <circle
            key={index}
            cx={x(timeOf[index])}
            cy={y(costs[index])}
            r={4}
            className="dashboard-chart__deposit"
          />
        ))}
        <circle cx={x(last.time)} cy={y(last.value)} r={4.5} className="dashboard-chart__dot" />
        {current && (
          <PointCursor cx={x(current.time)} cy={y(current.value)} top={PAD.top} base={base} />
        )}
      </svg>
      {current && (
        <ChartTip
          current={current}
          last={current.index === points.length - 1}
          period={period}
          currency={currency}
          symbol={symbol}
          noCost={noCost}
          purchases={bought.get(current.index) ?? []}
          cx={x(current.time)}
          cy={y(current.value)}
          width={width}
        />
      )}
    </div>
  );
}

/** The point in focus: its value, amount and cost basis, and the purchases it holds. */
function ChartTip({
  current,
  last,
  period,
  currency,
  symbol,
  noCost,
  purchases,
  cx,
  cy,
  width,
}: {
  current: Plotted;
  last: boolean;
  period: HistoryPeriod;
  currency: AccountingCurrency;
  symbol: string;
  noCost: boolean;
  purchases: readonly Purchase[];
  /** Where the point is drawn, and the chart's width. */
  cx: number;
  cy: number;
  width: number;
}) {
  // Near the right edge the tip opens to the left of its point.
  const tipLeft = tipLeftOf(cx, width);
  return (
    <div
      className="dashboard-tip"
      role="status"
      style={{
        left: Math.max(0, tipLeft),
        top: Math.max(0, Math.min(cy - 40, HEIGHT - 110)),
      }}
    >
      <div>{pointLabel(current.point, period, last)}</div>
      <div className="dashboard-tip__value">{money(current.point.value, currency)}</div>
      <div className="dashboard-tip__row">
        <span>Amount</span>
        <span>
          {quantity(current.point.quantity)} {symbol}
        </span>
      </div>
      <div className="dashboard-tip__row">
        <span>Cost basis</span>
        <span>
          {noCost ? 'unknown' : money(current.point.cost, currency)}
          {!noCost && !current.point.costComplete && ' known'}
        </span>
      </div>
      {purchases.map((purchase) => (
        <div className="dashboard-tip__flow" key={`${purchase.at}:${purchase.quantity}`}>
          <span>Purchase</span>
          <span>
            +{quantity(purchase.quantity)} {symbol}
          </span>
        </div>
      ))}
      {!current.point.complete && (
        <div className="dashboard-tip__note">Incomplete: no price, rate or full history</div>
      )}
    </div>
  );
}
