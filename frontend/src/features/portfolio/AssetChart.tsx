import type { AssetHistoryPoint } from '@api/asset-history.api';
import type { HistoryPeriod } from '@api/portfolio-history.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  chartDateTicks,
  chartRightPad,
  compact,
  niceStep,
  pointLabel,
  tickLabel,
} from '../dashboard/HistoryChart';
import { money, quantity } from './format';
import '../dashboard/dashboard.css';

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
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotted: Plotted[] = points.flatMap((point, index) =>
    point.value === null
      ? []
      : [{ index, point, time: Date.parse(point.at), value: Number(point.value) }],
  );
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
  const costs = points.map((point) => Number(point.cost));
  const values = [...plotted.map((entry) => entry.value), ...costs];
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = (high - low) * 0.08 || high * 0.02 || 1;
  low = Math.max(0, low - pad);
  high += pad;
  const step = niceStep((high - low) / 4);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  const y = (value: number) => PAD.top + innerHeight - ((value - low) / (high - low)) * innerHeight;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) ticks.push(value);

  // A point without a price or rate breaks the line instead of dropping to zero.
  const segments: Plotted[][] = [];
  for (const entry of plotted) {
    const previous = segments.at(-1)?.at(-1);
    if (previous && previous.index === entry.index - 1) segments.at(-1)!.push(entry);
    else segments.push([entry]);
  }
  const path = (segment: Plotted[]) =>
    segment
      .map(
        (entry, index) =>
          `${index ? 'L' : 'M'}${x(entry.time).toFixed(1)} ${y(entry.value).toFixed(1)}`,
      )
      .join('');
  const line = segments.map(path).join('');
  const base = PAD.top + innerHeight;
  const area = segments
    .map(
      (segment) =>
        `${path(segment)}L${x(segment.at(-1)!.time).toFixed(1)} ${base}L${x(segment[0].time).toFixed(1)} ${base}Z`,
    )
    .join('');
  // Cost basis changes only when coins are bought or sold: a step line.
  const costLine = points
    .map((_, index) => {
      const px = x(timeOf[index]).toFixed(1);
      const py = y(costs[index]).toFixed(1);
      return index ? `H${px}V${py}` : `M${px} ${py}`;
    })
    .join('');
  // Each purchase sits on the cost basis it raised.
  const bought = purchasesByPoint(points, purchases);
  const tickCount = chartDateTicks(width, points.length);
  const xTicks = [
    ...new Set(
      Array.from({ length: tickCount }, (_, index) =>
        tickCount === 1 ? start : start + ((end - start) * index) / (tickCount - 1),
      ),
    ),
  ];

  const current = active === null ? null : plotted[active];
  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    const offset = clientX - (rect?.left ?? 0) - PAD.left;
    const time = start + (Math.min(Math.max(offset, 0), innerWidth) / innerWidth) * span;
    let nearest = 0;
    for (let index = 1; index < plotted.length; index++)
      if (Math.abs(plotted[index].time - time) < Math.abs(plotted[nearest].time - time))
        nearest = index;
    setActive(nearest);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      Home: -plotted.length,
      End: plotted.length,
    };
    const move = moves[event.key];
    if (move === undefined) {
      if (event.key === 'Escape') setActive(null);
      return;
    }
    event.preventDefault();
    setActive((index) =>
      Math.min(plotted.length - 1, Math.max(0, (index ?? plotted.length - 1) + move)),
    );
  };
  const tipLeft = current
    ? x(current.time) + 14 + 200 > width
      ? x(current.time) - 214
      : x(current.time) + 14
    : 0;
  const purchasesHere = current ? (bought.get(current.index) ?? []) : [];

  return (
    <div
      ref={box}
      className="dashboard-chart"
      tabIndex={0}
      role="group"
      aria-label={`${label}. Use the arrow keys to read each point.`}
      onPointerMove={(event) => pick(event.clientX)}
      onPointerLeave={() => setActive(null)}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
    >
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={label}>
        <defs>
          <linearGradient id="asset-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerWidth}
              y1={y(value)}
              y2={y(value)}
              className="dashboard-chart__grid"
            />
            <text x={width - 4} y={y(value) + 4} textAnchor="end" className="dashboard-chart__tick">
              {compact(value, currency)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={PAD.left + innerWidth}
          y1={base}
          y2={base}
          className="dashboard-chart__axis"
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
        <path d={costLine} className="dashboard-chart__invested" />
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
          <g>
            <line
              x1={x(current.time)}
              x2={x(current.time)}
              y1={PAD.top}
              y2={base}
              className="dashboard-chart__cursor"
            />
            <circle
              cx={x(current.time)}
              cy={y(current.value)}
              r={5}
              className="dashboard-chart__dot"
            />
          </g>
        )}
      </svg>
      {current && (
        <div
          className="dashboard-tip"
          role="status"
          style={{
            left: Math.max(0, tipLeft),
            top: Math.max(0, Math.min(y(current.value) - 40, HEIGHT - 110)),
          }}
        >
          <div>{pointLabel(current.point, period, current.index === points.length - 1)}</div>
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
              {money(current.point.cost, currency)}
              {!current.point.costComplete && ' known'}
            </span>
          </div>
          {purchasesHere.map((purchase) => (
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
      )}
    </div>
  );
}
