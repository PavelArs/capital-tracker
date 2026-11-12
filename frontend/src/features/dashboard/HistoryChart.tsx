import type { HistoryPeriod, HistoryPoint } from '@api/portfolio-history.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  areaPath,
  chartCursor,
  evenTicks,
  linePath,
  observeWidth,
  runsOf,
  tipLeftOf,
  valueAxis,
  valuedPoints,
} from '@/ui/chart';
import { exactDifference } from '../goals/goal-format';
import { currencySymbols, money, tone } from '../portfolio/format';

const HEIGHT = 290;
const PAD = { left: 4, right: 64, top: 12, bottom: 28 };

/** Under this width (a phone) the value labels take less room and fewer dates are written. */
const NARROW = 520;

export const chartRightPad = (width: number) => (width < NARROW ? 46 : PAD.right);

export const chartDateTicks = (width: number, points: number) =>
  Math.min(width < NARROW ? 3 : 5, points);

interface Plotted {
  index: number;
  point: HistoryPoint;
  time: number;
  value: number;
}

const hourly = (period: HistoryPeriod) => period === '24H' || period === '7D';
const dayFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const hourFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
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

/** "Sun, Oct 4, 13:00 UTC" for hourly periods, "Sun, Oct 4, 2026" otherwise; the last is "Now". */
export function pointLabel(
  point: Pick<HistoryPoint, 'at'>,
  period: HistoryPeriod,
  last: boolean,
): string {
  if (last) return 'Now';
  const at = new Date(point.at);
  return hourly(period) ? `${hourFormat.format(at)} UTC` : dayFormat.format(at);
}

export function tickLabel(time: number, period: HistoryPeriod): string {
  const at = new Date(time);
  if (period === '24H') return tickHour.format(at);
  if (period === '1Y' || period === 'ALL') return tickMonth.format(at);
  return tickDay.format(at);
}

const axisNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** Axis amounts with a lowercase k and M, as the prototype writes them: $1.25M, ₽850k, €900. */
export function compact(value: number, currency: AccountingCurrency): string {
  const size = Math.abs(value);
  const [scaled, suffix] =
    size >= 1e9
      ? [size / 1e9, 'B']
      : size >= 1e6
        ? [size / 1e6, 'M']
        : size >= 1e3
          ? [size / 1e3, 'k']
          : [size, ''];
  return `${value < 0 ? '-' : ''}${currencySymbols[currency]}${axisNumber.format(scaled)}${suffix}`;
}

const HOUR_MS = 3_600_000;
/** A date label this close to an end of the plot is aligned to it instead of centred. */
const EDGE = 24;
const DAY_MS = 24 * HOUR_MS;

/**
 * Where the date labels go: evenly spread over the period. On hourly periods they sit on points
 * at a whole hour (24H) or at midnight (7D), never at the odd minute of the last snapshot.
 */
export function dateTicks(times: number[], period: HistoryPeriod, count: number): number[] {
  const first = times[0];
  const last = times[times.length - 1];
  if (count <= 1) return [first];
  if (hourly(period)) {
    const unit = period === '24H' ? HOUR_MS : DAY_MS;
    const whole = times.filter((time) => time % unit === 0);
    if (whole.length > 0) {
      const shown = Math.min(count, whole.length);
      return [
        ...new Set(
          Array.from({ length: shown }, (_, index) =>
            shown === 1 ? whole[0] : whole[Math.round((index * (whole.length - 1)) / (shown - 1))],
          ),
        ),
      ];
    }
  }
  return evenTicks(first, last, count);
}

/** Net invested added (+) or taken out (−) since the previous point; null when unchanged. */
function flowSince(points: HistoryPoint[], index: number): string | null {
  const now = points[index]?.invested ?? null;
  const before = index > 0 ? points[index - 1].invested : null;
  if (now === null || before === null) return null;
  // Exact, like the amounts it sits beside: no float error in a cent.
  const flow = exactDifference(now, before);
  return flow === '0' ? null : flow;
}

function signedDifference(value: string | null, start: string | null): string | null {
  if (value === null || start === null) return null;
  // Exact; the amount is rounded to cents only when it is shown.
  return exactDifference(value, start);
}

/**
 * The box's scale: time across the plotted points, value up over them and net invested, padded
 * and in round steps; from zero for the whole history unless something is below it.
 */
function scaleOf(
  width: number,
  plotted: readonly Plotted[],
  invested: readonly (number | null)[],
  period: HistoryPeriod,
) {
  const innerWidth = Math.max(1, width - PAD.left - chartRightPad(width));
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  const span = Math.max(1, last.time - first.time);
  const x = (time: number) =>
    PAD.left + (plotted.length === 1 ? innerWidth / 2 : ((time - first.time) / span) * innerWidth);
  const values = [
    ...plotted.map((entry) => entry.value),
    ...invested.filter((value): value is number => value !== null),
  ];
  const lowest = Math.min(...values);
  let low = period === 'ALL' ? Math.min(0, lowest) : lowest;
  let high = Math.max(...values);
  const pad = (high - low) * 0.08 || high * 0.02 || 1;
  low = lowest < 0 ? low - pad : Math.max(0, low - pad);
  high += pad;
  const { y, ticks } = valueAxis(low, high, PAD.top, innerHeight);
  return { innerWidth, innerHeight, first, last, span, x, y, ticks };
}

/** The value line and the area under it; a point without a rate breaks both instead of dropping to zero. */
function valueShapes(
  plotted: readonly Plotted[],
  x: (time: number) => number,
  y: (value: number) => number,
  base: number,
) {
  const segments = runsOf(plotted);
  const line = segments.map((segment) => linePath(segment, x, y)).join('');
  return { line, area: areaPath(segments, x, y, base) };
}

// Value of the portfolio over the period (record-portfolio-snapshots, CHART-PERIODS) and the
// net invested step line (split-market-and-flows).
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

  // Read the real width before the first paint: drawing at the default width and then redrawing
  // makes the chart jump (labels and lines change size) every time the Dashboard opens.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measured = element.getBoundingClientRect().width;
    if (measured > 0) setWidth(measured);
    return observeWidth(element, setWidth);
  }, []);

  const plotted: Plotted[] = valuedPoints(points);
  if (plotted.length === 0)
    return (
      <p className="dashboard-chart__empty" role="note">
        No value can be shown for this period in {currency}.
      </p>
    );

  // Net invested shares the scale; it can fall below zero after selling at a profit.
  const invested = points.map((point) => (point.invested === null ? null : Number(point.invested)));
  const { innerWidth, innerHeight, first, last, span, x, y, ticks } = scaleOf(
    width,
    plotted,
    invested,
    period,
  );

  const base = PAD.top + innerHeight;
  const { line, area } = valueShapes(plotted, x, y, base);
  // A step line: net invested changes only when money comes in or goes out.
  const timeOf = points.map((point) => Date.parse(point.at));
  const visible = (index: number) => timeOf[index] >= first.time && timeOf[index] <= last.time;
  let investedLine = '';
  let open = false;
  points.forEach((_, index) => {
    const amount = invested[index];
    if (amount === null || !visible(index)) {
      open = false;
      return;
    }
    const px = x(timeOf[index]).toFixed(1);
    const py = y(amount).toFixed(1);
    investedLine += open ? `H${px}V${py}` : `M${px} ${py}`;
    open = true;
  });
  const deposits = points.flatMap((_, index) => {
    const flow = flowSince(points, index);
    return flow !== null && Number(flow) > 0 && visible(index) && invested[index] !== null
      ? [{ index, cx: x(timeOf[index]), cy: y(invested[index]!) }]
      : [];
  });
  const xTicks = dateTicks(
    plotted.map((entry) => entry.time),
    period,
    chartDateTicks(width, plotted.length),
  );

  const current = active === null ? null : plotted[active];
  const startValue = points.find((point) => point.value !== null)?.value ?? null;
  const cursor = chartCursor({
    points: plotted,
    from: plotted.length - 1,
    left: PAD.left,
    innerWidth,
    start: first.time,
    span,
    setActive,
  });
  const difference = current ? signedDifference(current.point.value, startValue) : null;
  const flow = current ? flowSince(points, current.index) : null;
  const tipLeft = current ? tipLeftOf(x(current.time), width) : 0;

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
            textAnchor={
              index === 0 && x(time) - PAD.left < EDGE
                ? 'start'
                : index === xTicks.length - 1 && PAD.left + innerWidth - x(time) < EDGE
                  ? 'end'
                  : 'middle'
            }
            className="dashboard-chart__tick"
          >
            {tickLabel(time, period)}
          </text>
        ))}
        <path d={area} fill="url(#dashboard-area)" />
        {investedLine && <path d={investedLine} className="dashboard-chart__invested" />}
        {deposits.map((deposit) => (
          <circle
            key={deposit.index}
            cx={deposit.cx}
            cy={deposit.cy}
            r={4}
            className="dashboard-chart__deposit"
          />
        ))}
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
            <span className={tone(difference) ? `ui-${tone(difference)}` : undefined}>
              {money(difference, currency, true)}
            </span>
          </div>
          <div className="dashboard-tip__row">
            <span>Net invested</span>
            <span>{money(current.point.invested, currency)}</span>
          </div>
          {flow !== null && (
            <div className="dashboard-tip__flow">
              <span>{Number(flow) > 0 ? 'Deposit' : 'Withdrawal'}</span>
              <span>{money(flow, currency, true)}</span>
            </div>
          )}
          {!current.point.complete && (
            <div className="dashboard-tip__note">Incomplete: an asset had no price or rate</div>
          )}
        </div>
      )}
    </div>
  );
}
