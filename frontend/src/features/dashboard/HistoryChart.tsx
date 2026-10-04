import type { HistoryPeriod, HistoryPoint } from '@api/portfolio-history.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { currencySymbols, money, tone } from '../portfolio/format';

const HEIGHT = 290;
const PAD = { left: 4, right: 64, top: 12, bottom: 28 };

interface Plotted {
  index: number;
  point: HistoryPoint;
  time: number;
  value: number;
}

const hourly = (period: HistoryPeriod) => period === '24H' || period === '7D';
const dayFormat = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const hourFormat = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});
const tickDay = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const tickMonth = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const tickHour = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** "Oct 4, 13:00 UTC" for hourly periods, "Oct 4, 2026" otherwise; the last point is "Now". */
export function pointLabel(point: HistoryPoint, period: HistoryPeriod, last: boolean): string {
  if (last) return 'Now';
  const at = new Date(point.at);
  return hourly(period) ? `${hourFormat.format(at)} UTC` : dayFormat.format(at);
}

function tickLabel(time: number, period: HistoryPeriod): string {
  const at = new Date(time);
  if (period === '24H') return tickHour.format(at);
  if (period === '1Y' || period === 'ALL') return tickMonth.format(at);
  return tickDay.format(at);
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10) * power;
}

/** Axis amounts: $1.2M, ₽850K, €900. */
function compact(value: number, currency: AccountingCurrency): string {
  const formatted = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
  return `${currencySymbols[currency]}${formatted}`;
}

function signedDifference(value: string | null, start: string | null): string | null {
  if (value === null || start === null) return null;
  // Display only: the tooltip difference is rounded to cents like every shown amount.
  return (Number(value) - Number(start)).toFixed(2);
}

// Value of the portfolio over the period (record-portfolio-snapshots, CHART-PERIODS).
export default function HistoryChart({
  points,
  period,
  currency,
  label,
}: {
  points: HistoryPoint[];
  period: HistoryPeriod;
  currency: AccountingCurrency;
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

  const innerWidth = Math.max(1, width - PAD.left - PAD.right);
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  const span = Math.max(1, last.time - first.time);
  const x = (time: number) =>
    PAD.left + (plotted.length === 1 ? innerWidth / 2 : ((time - first.time) / span) * innerWidth);
  const values = plotted.map((entry) => entry.value);
  let low = period === 'ALL' ? 0 : Math.min(...values);
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

  // A point without a rate breaks the line instead of dropping to zero.
  const segments: Plotted[][] = [];
  for (const entry of plotted) {
    const previous = segments.at(-1)?.at(-1);
    if (previous && previous.index === entry.index - 1) segments.at(-1)!.push(entry);
    else segments.push([entry]);
  }
  const line = segments
    .map((segment) =>
      segment
        .map(
          (entry, index) =>
            `${index ? 'L' : 'M'}${x(entry.time).toFixed(1)} ${y(entry.value).toFixed(1)}`,
        )
        .join(''),
    )
    .join('');
  const base = PAD.top + innerHeight;
  const area = segments
    .map(
      (segment) =>
        `${segment
          .map(
            (entry, index) =>
              `${index ? 'L' : 'M'}${x(entry.time).toFixed(1)} ${y(entry.value).toFixed(1)}`,
          )
          .join(
            '',
          )}L${x(segment.at(-1)!.time).toFixed(1)} ${base}L${x(segment[0].time).toFixed(1)} ${base}Z`,
    )
    .join('');
  const tickCount = Math.min(5, plotted.length);
  const xTicks = [
    ...new Set(
      Array.from({ length: tickCount }, (_, index) =>
        tickCount === 1
          ? first.time
          : first.time + ((last.time - first.time) * index) / (tickCount - 1),
      ),
    ),
  ];

  const current = active === null ? null : plotted[active];
  const startValue = points.find((point) => point.value !== null)?.value ?? null;
  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    const offset = clientX - (rect?.left ?? 0) - PAD.left;
    const time = first.time + (Math.min(Math.max(offset, 0), innerWidth) / innerWidth) * span;
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
  const difference = current ? signedDifference(current.point.value, startValue) : null;
  const tipLeft = current
    ? x(current.time) + 14 + 200 > width
      ? x(current.time) - 214
      : x(current.time) + 14
    : 0;

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
          <linearGradient id="dashboard-area" x1="0" y1="0" x2="0" y2="1">
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
        <path d={area} fill="url(#dashboard-area)" />
        <path d={line} className="dashboard-chart__line" />
        {plotted
          .filter((entry) => !entry.point.complete)
          .map((entry) => (
            <circle
              key={entry.time}
              cx={x(entry.time)}
              cy={y(entry.value)}
              r={2}
              className="dashboard-chart__incomplete"
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
            <span>Change in period</span>
            <span className={tone(difference) ? `portfolio-${tone(difference)}` : undefined}>
              {money(difference, currency, true)}
            </span>
          </div>
          {!current.point.complete && (
            <div className="dashboard-tip__note">Incomplete: an asset had no price or rate</div>
          )}
        </div>
      )}
    </div>
  );
}
