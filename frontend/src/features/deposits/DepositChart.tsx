import type { DepositChartPoint } from '@api/deposits.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useEffect, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Card } from '@/ui/Card';
import {
  areaPath,
  chartCursor,
  evenTicks,
  linePath,
  observeWidth,
  runsOf,
  tipLeftOf,
  valueAxis,
} from '@/ui/chart';
import { Legend } from '@/ui/Legend';
import { useSegmentedTabs } from '@/ui/SegmentedTabs';
import { chartDateTicks, chartRightPad, compact, tickLabel } from '../dashboard/HistoryChart';
import type { InflationBasis } from '../shell/inflation-basis';
import { dateText, money } from './deposit-format';
import '@/ui/chart.css';

const HEIGHT = 260;
const PAD = { left: 4, right: 64, top: 12, bottom: 28 };

interface Plotted {
  index: number;
  time: number;
  value: number;
  invested: number;
  balance: string;
  paidIn: string;
  estimated: boolean;
}

/** The periods the chart can be cut to, in months back from its last day. */
const PERIODS = [
  ['3M', 3],
  ['6M', 6],
  ['1Y', 12],
] as const;
type Period = (typeof PERIODS)[number][0] | 'ALL';

/** A calendar date some months earlier, on the same day or the last day of a shorter month. */
function monthsBefore(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** The points of the last `months` months, up to the day asked. */
const lastMonths = (points: readonly DepositChartPoint[], months: number) => {
  const cutoff = monthsBefore(points[points.length - 1].date, months);
  return points.filter((point) => point.date >= cutoff);
};

/**
 * The periods worth offering: each must hold two points to draw a line and leave something out,
 * or it would only repeat the whole life (ALL, always last).
 */
function periodsOf(points: readonly DepositChartPoint[]): Period[] {
  if (points.length === 0) return ['ALL'];
  return [
    ...PERIODS.filter(([, months]) => {
      const kept = lastMonths(points, months).length;
      return kept >= 2 && kept < points.length;
    }).map(([name]) => name),
    'ALL',
  ];
}

/** The points with a figure in the reading shown: the bank's, or in today's money. */
function plottedOf(
  points: readonly DepositChartPoint[],
  real: boolean,
  basis: InflationBasis,
): Plotted[] {
  const figures = points.map((point) =>
    real
      ? point.real[basis]
      : { balance: point.balance, invested: point.invested, estimated: false },
  );
  return points.flatMap((point, index) => {
    const figure = figures[index];
    return figure === null
      ? []
      : [
          {
            index,
            time: Date.parse(`${point.date}T00:00:00Z`),
            value: Number(figure.balance),
            invested: Number(figure.invested),
            balance: figure.balance,
            paidIn: figure.invested,
            estimated: figure.estimated,
          },
        ];
  });
}

/** The box's scale: time across the period, value up over the value and the money put in. */
function scaleOf(width: number, points: readonly DepositChartPoint[], plotted: readonly Plotted[]) {
  const innerWidth = Math.max(1, width - PAD.left - chartRightPad(width));
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const times = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  const start = times[0];
  const end = times[times.length - 1];
  const span = Math.max(1, end - start);
  const x = (time: number) =>
    PAD.left + (points.length === 1 ? innerWidth / 2 : ((time - start) / span) * innerWidth);
  const values = plotted.flatMap((entry) => [entry.value, entry.invested]);
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = (high - low) * 0.08 || high * 0.02 || 1;
  // Money put in can fall below zero after a withdrawal of more than was put in: scale below zero then.
  low = low < 0 ? low - pad : Math.max(0, low - pad);
  high += pad;
  const { y, ticks } = valueAxis(low, high, PAD.top, innerHeight);
  return { innerWidth, innerHeight, start, end, span, x, y, ticks };
}

/**
 * The deposit's value and the money put in over its life, by month and on the day asked. Nominal
 * figures are the bank's; in today's money each figure is carried to the day asked by the
 * inflation of the chosen reading (INFL-DEPOSIT-CHART). A day with no figure breaks the lines.
 */
export default function DepositChart({
  points: life,
  currency,
  real,
  basis,
}: {
  points: DepositChartPoint[];
  currency: AccountingCurrency;
  real: boolean;
  basis: InflationBasis;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [active, setActive] = useState<number | null>(null);
  const [asked, setAsked] = useState<Period>('ALL');
  const offered = periodsOf(life);
  const period = offered.includes(asked) ? asked : 'ALL';
  const months = PERIODS.find(([name]) => name === period)?.[1];
  const points = months === undefined ? life : lastMonths(life, months);
  // The periods are tabs with arrow keys; the chart is the panel they control.
  const { tabs, panelProps } = useSegmentedTabs({
    label: 'Chart period',
    options: offered,
    value: period,
    onChange: (next) => {
      setActive(null);
      setAsked(next);
    },
    size: 'sm',
  });

  useEffect(() => {
    const element = box.current;
    if (element) return observeWidth(element, setWidth);
  }, []);

  const plotted = plottedOf(points, real, basis);
  const legend = real
    ? { value: "Value in today's money", paid: 'Money put in, grown by inflation' }
    : { value: 'Value', paid: 'Money put in' };
  const label = `${legend.value} and ${legend.paid.toLowerCase()} over the life of the deposit`;

  if (plotted.length === 0)
    return (
      <Card variant="chart" labelledBy="deposit-value-chart">
        <h2 id="deposit-value-chart" className="ui-sr">
          Value over time
        </h2>
        <p className="dashboard-chart__empty" role="note" aria-label={label}>
          {real
            ? 'Inflation figures do not reach the whole life of this deposit yet.'
            : `No figures for this deposit in ${currency}.`}
        </p>
      </Card>
    );

  const { innerWidth, innerHeight, start, end, span, x, y, ticks } = scaleOf(
    width,
    points,
    plotted,
  );

  const segments = runsOf(plotted);
  const base = PAD.top + innerHeight;
  const area = areaPath(segments, x, y, base);
  // Money put in changes on a day it is paid in or out: a step line, held until the next point.
  const paidPath = (run: Plotted[]) =>
    run
      .map((entry, index) => {
        const px = x(entry.time).toFixed(1);
        const py = y(entry.invested).toFixed(1);
        return index ? `H${px}V${py}` : `M${px} ${py}`;
      })
      .join('');
  const xTicks = evenTicks(start, end, chartDateTicks(width, points.length));
  const last = plotted[plotted.length - 1];

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
  const tipLeft = current ? tipLeftOf(x(current.time), width) : 0;

  return (
    <Card variant="chart" className="dashboard-chart-card" labelledBy="deposit-value-chart">
      <h2 id="deposit-value-chart" className="ui-sr">
        Value over time
      </h2>
      <div className="ui-toolbar">
        <div role="group" aria-label="Chart legend">
          <Legend
            items={[
              { key: 'value', label: legend.value, swatch: 'line', color: 'var(--accent)' },
              { key: 'paid', label: legend.paid, swatch: 'line', color: 'var(--ink-3)' },
            ]}
          />
        </div>
        {offered.length > 1 && tabs}
      </div>
      <div {...(offered.length > 1 ? panelProps : {})}>
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
              <linearGradient id="deposit-area" x1="0" y1="0" x2="0" y2="1">
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
                <text
                  x={width - 4}
                  y={y(value) + 4}
                  textAnchor="end"
                  className="dashboard-chart__tick"
                >
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
                {tickLabel(time, 'ALL')}
              </text>
            ))}
            <path d={area} fill="url(#deposit-area)" />
            {segments.map((run) => (
              <path key={run[0].index} d={paidPath(run)} className="dashboard-chart__invested" />
            ))}
            {segments.map((run) => (
              <path
                key={`value-${run[0].index}`}
                d={linePath(run, x, y)}
                className="dashboard-chart__line"
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
              <div>{dateText(points[current.index].date)}</div>
              <div className="dashboard-tip__value">{money(current.balance, currency)}</div>
              <div className="dashboard-tip__row">
                <span>{legend.paid}</span>
                <span>{money(current.paidIn, currency)}</span>
              </div>
              {current.estimated && <div className="dashboard-tip__flow">Estimated</div>}
            </div>
          )}
        </div>
        {real && plotted.some((entry) => entry.estimated) && (
          <Banner tone="info">
            Estimated after the latest published inflation month, or at your own rate.
          </Banner>
        )}
      </div>
    </Card>
  );
}
