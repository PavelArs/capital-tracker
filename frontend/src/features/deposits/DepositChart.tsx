import type { DepositChartPoint } from '@api/deposits.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Card, CardHeader } from '@/ui/Card';
import { Legend } from '@/ui/Legend';
import {
  chartDateTicks,
  chartRightPad,
  compact,
  niceStep,
  tickLabel,
} from '../dashboard/HistoryChart';
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

/** Consecutive points that have a figure, so a missing one breaks the line instead of joining. */
function runs(plotted: readonly Plotted[]): Plotted[][] {
  const found: Plotted[][] = [];
  for (const entry of plotted) {
    const previous = found.at(-1)?.at(-1);
    if (previous && previous.index === entry.index - 1) found.at(-1)!.push(entry);
    else found.push([entry]);
  }
  return found;
}

/**
 * The deposit's value and the money put in over its life, by month and on the day asked. Nominal
 * figures are the bank's; in today's money each figure is carried to the day asked by the
 * inflation of the chosen reading (INFL-DEPOSIT-CHART). A day with no figure breaks the lines.
 */
export default function DepositChart({
  points,
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

  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const figures = points.map((point) =>
    real
      ? point.real[basis]
      : { balance: point.balance, invested: point.invested, estimated: false },
  );
  const plotted: Plotted[] = points.flatMap((point, index) => {
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
  const legend = real
    ? { value: "Value in today's money", paid: 'Money put in, grown by inflation' }
    : { value: 'Value', paid: 'Money put in' };
  const label = `${legend.value} and ${legend.paid.toLowerCase()} over the life of the deposit`;

  if (plotted.length === 0)
    return (
      <Card variant="chart" labelledBy="deposit-value-chart">
        <CardHeader id="deposit-value-chart" title="Value over time" />
        <p className="dashboard-chart__empty" role="note" aria-label={label}>
          {real
            ? 'Inflation figures do not reach the whole life of this deposit yet.'
            : `No figures for this deposit in ${currency}.`}
        </p>
      </Card>
    );

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
  const step = niceStep((high - low) / 4);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  const y = (value: number) => PAD.top + innerHeight - ((value - low) / (high - low)) * innerHeight;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) ticks.push(value);

  const segments = runs(plotted);
  const base = PAD.top + innerHeight;
  const valuePath = (run: Plotted[]) =>
    run
      .map(
        (entry, index) =>
          `${index ? 'L' : 'M'}${x(entry.time).toFixed(1)} ${y(entry.value).toFixed(1)}`,
      )
      .join('');
  const area = segments
    .map(
      (run) =>
        `${valuePath(run)}L${x(run.at(-1)!.time).toFixed(1)} ${base}L${x(run[0].time).toFixed(1)} ${base}Z`,
    )
    .join('');
  // Money put in changes on a day it is paid in or out: a step line, held until the next point.
  const paidPath = (run: Plotted[]) =>
    run
      .map((entry, index) => {
        const px = x(entry.time).toFixed(1);
        const py = y(entry.invested).toFixed(1);
        return index ? `H${px}V${py}` : `M${px} ${py}`;
      })
      .join('');
  const tickCount = chartDateTicks(width, points.length);
  const xTicks = [
    ...new Set(
      Array.from({ length: tickCount }, (_, index) =>
        tickCount === 1 ? start : start + ((end - start) * index) / (tickCount - 1),
      ),
    ),
  ];
  const last = plotted[plotted.length - 1];

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

  return (
    <Card variant="chart" labelledBy="deposit-value-chart">
      <CardHeader id="deposit-value-chart" title="Value over time" />
      <div role="group" aria-label="Chart legend">
        <Legend
          items={[
            { key: 'value', label: legend.value, swatch: 'line', color: 'var(--accent)' },
            { key: 'paid', label: legend.paid, swatch: 'line', color: 'var(--ink-3)' },
          ]}
        />
      </div>
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
              d={valuePath(run)}
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
    </Card>
  );
}
