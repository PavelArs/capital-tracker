import { cachedReads } from '@api/cached-reads';
import type { Goal, ScenarioKey } from '@api/goals.api';
import { type KeyboardEvent, useEffect, useState } from 'react';
import {
  chartDateTicks,
  chartRightPad,
  compact,
  niceStep,
  pointLabel,
  tickLabel,
} from '../dashboard/HistoryChart';
import { useCachedRead } from '../shell/useCachedRead';
import { dateText, enteredText, flooredText, monthYear, rateText } from './goal-format';

const HEIGHT = 290;
const PAD = { left: 4, right: 64, top: 24, bottom: 28 };
const CASES: readonly ScenarioKey[] = ['pessimistic', 'base', 'optimistic'];
const dayTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

interface Past {
  kind: 'history';
  time: number;
  at: string;
  value: number;
  text: string;
  invested: string | null;
}

interface Ahead {
  kind: 'forecast';
  time: number;
  on: string;
  value: number;
  figures: Record<ScenarioKey, string | null>;
}

/** A path through the points that have a figure, broken where one is missing. */
function line(points: readonly ([number, number] | null)[]): string {
  let path = '';
  let open = false;
  for (const point of points) {
    if (point === null) {
      open = false;
      continue;
    }
    path += `${open ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`;
    open = true;
  }
  return path;
}

/**
 * GOAL-CHART: the portfolio and the money put in so far, in the goal's currency, then the base
 * case to the deadline (or a year past the month it gets there) inside the band of the
 * pessimistic and optimistic cases, with the sum to reach. Projections are left out while an
 * asset has no price, as on the rest of the page.
 */
export default function GoalChart({ goal }: { goal: Goal }) {
  const {
    data: history,
    error: historyError,
    stale: historyStale,
    reload: reloadHistory,
  } = useCachedRead(cachedReads.history, 'ALL', goal.currency);
  const terms = JSON.stringify([
    goal.currency,
    goal.targetAmount,
    goal.deadline,
    goal.expectedReturnPercent,
    goal.monthlyContribution,
    goal.asOf,
  ]);
  const {
    data: forecast,
    error: forecastError,
    stale: forecastStale,
    reload: reloadForecast,
  } = useCachedRead(cachedReads.goalForecast, goal.id, terms);
  // The chart box appears once there are figures, so it is watched from the render that adds it.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);

  const known = goal.progress.complete;
  const base = goal.scenarios.find((scenario) => scenario.key === 'base');
  const low = goal.scenarios.find((scenario) => scenario.key === 'pessimistic');
  const high = goal.scenarios.find((scenario) => scenario.key === 'optimistic');
  const target = Number(goal.targetAmount);
  const money = (value: string | null) => flooredText(value, goal.currency);
  const label = `${goal.name}: the portfolio so far and the forecast against the sum to reach`;

  // Chart coordinates only: every amount written out comes from the server's decimal strings.
  const past: Past[] = (history?.points ?? []).flatMap((point) =>
    point.value === null
      ? []
      : [
          {
            kind: 'history' as const,
            time: Date.parse(point.at),
            at: point.at,
            value: Number(point.value),
            text: point.value,
            invested: point.invested,
          },
        ],
  );
  const ahead: Ahead[] =
    known && forecast?.currency === goal.currency
      ? forecast.points.slice(1).flatMap((point) =>
          point.base === null
            ? []
            : [
                {
                  kind: 'forecast' as const,
                  time: dayTime(point.on),
                  on: point.on,
                  value: Number(point.base),
                  figures: point,
                },
              ],
        )
      : [];
  const plotted: (Past | Ahead)[] = [...past, ...ahead];
  const today = dayTime(goal.asOf);
  const now = goal.progress.current === null ? null : Number(goal.progress.current);

  if (plotted.length === 0)
    return (
      <section className="shell-card goal-chart-card" aria-label={label}>
        <h2>Progress and forecast</h2>
        <p className="goal-chart__empty" role="note">
          {historyError && history === null
            ? 'Could not load the portfolio history. Try again later.'
            : history === null
              ? 'Loading the chart…'
              : `No portfolio figures in ${goal.currency} yet.`}
        </p>
      </section>
    );

  const innerWidth = Math.max(1, width - PAD.left - chartRightPad(width));
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const start = Math.min(plotted[0].time, today);
  const end = Math.max(plotted[plotted.length - 1].time, today);
  const span = Math.max(1, end - start);
  const x = (time: number) => PAD.left + ((time - start) / span) * innerWidth;
  const band = ahead;
  const topOf = [
    target,
    ...past.map((entry) => entry.value),
    ...past.map((entry) => Number(entry.invested ?? 0)),
    // Every case, so the optimistic one is not cut off above the box.
    ...band.flatMap((entry) =>
      CASES.flatMap((key) => (entry.figures[key] === null ? [] : [Number(entry.figures[key])])),
    ),
  ];
  let top = Math.max(...topOf.filter(Number.isFinite)) * 1.1 || 1;
  let bottom = Math.min(0, ...past.map((entry) => entry.value));
  const step = niceStep((top - bottom) / 4);
  top = Math.ceil(top / step) * step;
  bottom = Math.floor(bottom / step) * step;
  const y = (value: number) =>
    PAD.top + innerHeight - ((value - bottom) / (top - bottom)) * innerHeight;
  const ticks: number[] = [];
  for (let value = bottom; value <= top + step / 2; value += step) ticks.push(value);
  const floor = PAD.top + innerHeight;

  // A day without a value (no rate) breaks the portfolio line and its area instead of joining.
  const points = history?.points ?? [];
  const valued = points.map((point): [number, number] | null =>
    point.value === null ? null : [x(Date.parse(point.at)), y(Number(point.value))],
  );
  const valuePath = line(valued);
  const investedPath = line(
    points.map((point): [number, number] | null =>
      point.invested === null ? null : [x(Date.parse(point.at)), y(Number(point.invested))],
    ),
  );
  const runs: [number, number][][] = [];
  valued.forEach((point, index) => {
    if (point === null) return;
    if (index > 0 && valued[index - 1] !== null) runs.at(-1)?.push(point);
    else runs.push([point]);
  });
  const area = runs
    .filter((run) => run.length > 1)
    .map(
      (run) =>
        `${line(run)}L${run.at(-1)?.[0].toFixed(1)} ${floor}L${run[0][0].toFixed(1)} ${floor}Z`,
    )
    .join('');
  const last = past[past.length - 1];
  // The forecast starts at the portfolio now, the same figure the history ends on.
  const origin: [number, number] | null = now === null ? null : [x(today), y(now)];
  const scenarioPath = (key: ScenarioKey) =>
    line([
      origin,
      ...band.map((entry): [number, number] | null => {
        const figure = entry.figures[key];
        return figure === null ? null : [x(entry.time), y(Number(figure))];
      }),
    ]);
  const fan =
    band.length > 0 && origin
      ? `${scenarioPath('optimistic')}${line(
          [...band].reverse().map((entry): [number, number] | null => {
            const figure = entry.figures.pessimistic;
            return figure === null ? null : [x(entry.time), y(Number(figure))];
          }),
        ).replace(/^M/, 'L')}L${origin[0].toFixed(1)} ${origin[1].toFixed(1)}Z`
      : '';
  const deadline = goal.deadline && band.length > 0 ? x(dayTime(goal.deadline)) : null;
  const tickCount = chartDateTicks(width, plotted.length);
  const xTicks = [
    ...new Set(
      Array.from({ length: tickCount }, (_, index) =>
        tickCount === 1 ? start : start + (span * index) / (tickCount - 1),
      ),
    ),
  ];

  const current = active === null ? null : plotted[active];
  const pick = (clientX: number) => {
    const rect = box?.getBoundingClientRect();
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
      Math.min(plotted.length - 1, Math.max(0, (index ?? past.length - 1) + move)),
    );
  };
  const share = (value: number) => `${Math.max(0, Math.floor((value / target) * 100))}%`;
  const tipLeft = current
    ? x(current.time) + 14 + 210 > width
      ? x(current.time) - 224
      : x(current.time) + 14
    : 0;
  const rangeText =
    low && high ? `${rateText(low.returnPercent)}% to ${rateText(high.returnPercent)}%` : null;

  return (
    <section className="shell-card goal-chart-card" aria-labelledby="goal-chart">
      <div className="goal-chart__head">
        <h2 id="goal-chart">Progress and forecast</h2>
        <div className="goal-legend" aria-label="Chart legend">
          <span>
            <i className="goal-legend__line" aria-hidden="true" />
            Portfolio
          </span>
          <span>
            <i className="goal-legend__line goal-legend__line--invested" aria-hidden="true" />
            Money put in
          </span>
          {band.length > 0 && base && (
            <span>
              <i className="goal-legend__line goal-legend__line--forecast" aria-hidden="true" />
              Forecast at {rateText(base.returnPercent)}%
            </span>
          )}
          {band.length > 0 && rangeText && (
            <span>
              <i className="goal-legend__band" aria-hidden="true" />
              {rangeText}
            </span>
          )}
          <span>
            <i className="goal-legend__line goal-legend__line--target" aria-hidden="true" />
            Sum to reach
          </span>
        </div>
      </div>
      <div
        ref={setBox}
        className="goal-chart"
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
            <clipPath id="goal-chart-box">
              <rect x={PAD.left} y={PAD.top - 2} width={innerWidth} height={innerHeight + 2} />
            </clipPath>
            <linearGradient id="goal-chart-area" x1="0" y1="0" x2="0" y2="1">
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
                className="goal-chart__grid"
              />
              <text x={width - 4} y={y(value) + 4} textAnchor="end" className="goal-chart__tick">
                {compact(value, goal.currency)}
              </text>
            </g>
          ))}
          <line
            x1={PAD.left}
            x2={PAD.left + innerWidth}
            y1={floor}
            y2={floor}
            className="goal-chart__axis"
          />
          {xTicks.map((time, index) => (
            <text
              key={time}
              x={x(time)}
              y={HEIGHT - 6}
              textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
              className="goal-chart__tick"
            >
              {tickLabel(time, 'ALL')}
            </text>
          ))}
          <g clipPath="url(#goal-chart-box)">
            {area && <path d={area} fill="url(#goal-chart-area)" />}
            {fan && <path d={fan} className="goal-chart__band" />}
            {investedPath && <path d={investedPath} className="goal-chart__invested" />}
            {valuePath && <path d={valuePath} className="goal-chart__line" />}
            {band.length > 0 && (
              <>
                <path d={scenarioPath('pessimistic')} className="goal-chart__case" />
                <path d={scenarioPath('optimistic')} className="goal-chart__case" />
                <path d={scenarioPath('base')} className="goal-chart__forecast" />
              </>
            )}
          </g>
          <line
            x1={PAD.left}
            x2={PAD.left + innerWidth}
            y1={y(target)}
            y2={y(target)}
            className="goal-chart__target"
          />
          <text x={PAD.left + 6} y={y(target) - 6} className="goal-chart__target-label">
            Sum {compact(target, goal.currency)}
          </text>
          {band.length > 0 && (
            <>
              <line
                x1={x(today)}
                x2={x(today)}
                y1={PAD.top - 8}
                y2={floor}
                className="goal-chart__today"
              />
              <text
                x={x(today) + (x(today) > width - 140 ? -4 : 4)}
                y={PAD.top - 10}
                textAnchor={x(today) > width - 140 ? 'end' : 'start'}
                className="goal-chart__tick"
              >
                Today
              </text>
            </>
          )}
          {deadline !== null && goal.deadline && (
            <>
              <line
                x1={deadline}
                x2={deadline}
                y1={PAD.top - 8}
                y2={floor}
                className="goal-chart__deadline"
              />
              <text
                x={deadline - 4}
                y={PAD.top - 10}
                textAnchor="end"
                className="goal-chart__deadline-label"
              >
                {monthYear(goal.deadline)}
              </text>
            </>
          )}
          {origin && <circle cx={origin[0]} cy={origin[1]} r={4.5} className="goal-chart__dot" />}
          {current && (
            <g>
              <line
                x1={x(current.time)}
                x2={x(current.time)}
                y1={PAD.top}
                y2={floor}
                className="goal-chart__cursor"
              />
              <circle
                cx={x(current.time)}
                cy={y(current.value)}
                r={5}
                className="goal-chart__dot"
              />
            </g>
          )}
        </svg>
        {current && (
          <div
            className="goal-tip"
            role="status"
            style={{
              left: Math.max(0, tipLeft),
              top: Math.max(0, Math.min(y(current.value) - 40, HEIGHT - 130)),
            }}
          >
            {current.kind === 'history' ? (
              <>
                <div>{pointLabel(current, 'ALL', current === last)}</div>
                <div className="goal-tip__value">{money(current.text)}</div>
                <div className="goal-tip__row">
                  <span>Money put in</span>
                  <span>{enteredText(current.invested, goal.currency)}</span>
                </div>
                <div className="goal-tip__row">
                  <span>Of the sum</span>
                  <span>{share(current.value)}</span>
                </div>
              </>
            ) : (
              <>
                <div>
                  {current.on === goal.deadline ? dateText(current.on) : monthYear(current.on)} ·
                  forecast
                </div>
                <div className="goal-tip__value">{money(current.figures.base)}</div>
                <div className="goal-tip__row">
                  <span>Pessimistic</span>
                  <span>{money(current.figures.pessimistic)}</span>
                </div>
                <div className="goal-tip__row">
                  <span>Optimistic</span>
                  <span>{money(current.figures.optimistic)}</span>
                </div>
                <div className="goal-tip__row">
                  <span>Of the sum</span>
                  <span>{share(current.value)}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {(historyStale || forecastStale) && (
        <div className="ui-banner ui-banner--warn goal-chart__note" role="alert">
          <p>Could not refresh the chart. The figures below may be out of date.</p>
          <button
            type="button"
            className="shell-button"
            onClick={() => {
              reloadHistory(true);
              reloadForecast(true);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {known && forecastError !== null && forecast === null && (
        <div className="ui-banner ui-banner--warn goal-chart__note" role="alert">
          <p>Could not load the forecast, so only the portfolio so far is drawn.</p>
          <button type="button" className="shell-button" onClick={() => reloadForecast()}>
            Try again
          </button>
        </div>
      )}
      {!known && (
        <p className="shell-note" role="note">
          The forecast needs every asset priced, so only the portfolio so far is drawn.
        </p>
      )}
    </section>
  );
}
