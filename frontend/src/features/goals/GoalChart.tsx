import { cachedReads } from '@api/cached-reads';
import type { Goal, GoalForecast, ScenarioKey } from '@api/goals.api';
import type { HistoryPoint } from '@api/portfolio-history.api';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { Legend, type LegendItem } from '@/ui/Legend';
import {
  chartDateTicks,
  chartRightPad,
  compact,
  niceStep,
  pointLabel,
  tickLabel,
} from '../dashboard/HistoryChart';
import { useCachedRead } from '../shell/useCachedRead';
import { dateText, enteredText, flooredText, monthYear, rateText, staleText } from './goal-format';

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
  complete: boolean;
}

interface Ahead {
  kind: 'forecast';
  time: number;
  on: string;
  value: number;
  figures: Record<ScenarioKey, string | null>;
}

/** A path through the points that have a figure, broken where one is missing. */
/** A step line: the value holds until the next point and changes there, never in between. */
function steps(points: readonly ([number, number] | null)[]): string {
  let path = '';
  let open = false;
  for (const point of points) {
    if (point === null) {
      open = false;
      continue;
    }
    const [px, py] = [point[0].toFixed(1), point[1].toFixed(1)];
    path += open ? `H${px}V${py}` : `M${px} ${py}`;
    open = true;
  }
  return path;
}

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

type Point = [number, number];
type Scale = (value: number) => number;

/** The portfolio's history, leaving out the days with no value. */
function pastOf(points: readonly HistoryPoint[]): Past[] {
  return points.flatMap((point) =>
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
            complete: point.complete,
          },
        ],
  );
}

/** The forecast after its first point, the portfolio now, where the base case has a figure. */
function aheadOf(forecast: GoalForecast): Ahead[] {
  return forecast.points.slice(1).flatMap((point) =>
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
  );
}

/** Why there is nothing to draw yet. */
function emptyText(historyError: unknown, loaded: boolean, currency: string): string {
  if (loaded) return `No portfolio figures in ${currency} yet.`;
  return historyError
    ? 'Could not load the portfolio history. Try again later.'
    : 'Loading the chart…';
}

/**
 * The box's scale: time across from the first point (or today) to the last, value up from zero
 * or below to above the sum and every case, in round steps.
 */
function scaleOf(
  width: number,
  plotted: readonly (Past | Ahead)[],
  past: readonly Past[],
  band: readonly Ahead[],
  today: number,
  target: number,
) {
  const innerWidth = Math.max(1, width - PAD.left - chartRightPad(width));
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const start = Math.min(plotted[0].time, today);
  const end = Math.max(plotted[plotted.length - 1].time, today);
  const span = Math.max(1, end - start);
  const x = (time: number) => PAD.left + ((time - start) / span) * innerWidth;
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
  let bottom = Math.min(
    0,
    ...past.map((entry) => entry.value),
    ...past.map((entry) => Number(entry.invested ?? 0)),
  );
  const step = niceStep((top - bottom) / 4);
  top = Math.ceil(top / step) * step;
  bottom = Math.floor(bottom / step) * step;
  const y = (value: number) =>
    PAD.top + innerHeight - ((value - bottom) / (top - bottom)) * innerHeight;
  const ticks: number[] = [];
  for (let value = bottom; value <= top + step / 2; value += step) ticks.push(value);
  return { innerWidth, innerHeight, start, span, x, y, ticks, floor: PAD.top + innerHeight };
}

/**
 * The portfolio line, the money put in as a step line, and the area under the portfolio. A day
 * without a value (no rate) breaks the portfolio line and its area instead of joining.
 */
function historyShapes(points: readonly HistoryPoint[], x: Scale, y: Scale, floor: number) {
  const valued = points.map((point): Point | null =>
    point.value === null ? null : [x(Date.parse(point.at)), y(Number(point.value))],
  );
  const investedPath = steps(
    points.map((point): Point | null =>
      point.invested === null ? null : [x(Date.parse(point.at)), y(Number(point.invested))],
    ),
  );
  const runs: Point[][] = [];
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
  return { valuePath: line(valued), investedPath, area };
}

/**
 * Where the drawn forecast starts: the value the server forecast from, which can differ from the
 * goal's own reading if the portfolio was revalued between the two requests, or the portfolio now.
 */
function originOf(
  first: GoalForecast['points'][number] | undefined,
  now: number | null,
  today: number,
  x: Scale,
  y: Scale,
): Point | null {
  if (first?.base != null) return [x(dayTime(first.on)), y(Number(first.base))];
  return now === null ? null : [x(today), y(now)];
}

/** Each case's line from the origin, and the band between the optimistic and pessimistic ones. */
function forecastShapes(band: readonly Ahead[], origin: Point | null, x: Scale, y: Scale) {
  const scenarioPath = (key: ScenarioKey) =>
    line([
      origin,
      ...band.map((entry): Point | null => {
        const figure = entry.figures[key];
        return figure === null ? null : [x(entry.time), y(Number(figure))];
      }),
    ]);
  const fan =
    band.length > 0 && origin
      ? `${scenarioPath('optimistic')}${line(
          [...band].reverse().map((entry): Point | null => {
            const figure = entry.figures.pessimistic;
            return figure === null ? null : [x(entry.time), y(Number(figure))];
          }),
        ).replace(/^M/, 'L')}L${origin[0].toFixed(1)} ${origin[1].toFixed(1)}Z`
      : '';
  return { scenarioPath, fan };
}

/** The legend: the forecast and its band only while a forecast is drawn. */
function legendItems(goal: Goal, forecastDrawn: boolean): LegendItem[] {
  const base = goal.scenarios.find((scenario) => scenario.key === 'base');
  const low = goal.scenarios.find((scenario) => scenario.key === 'pessimistic');
  const high = goal.scenarios.find((scenario) => scenario.key === 'optimistic');
  const rangeText =
    low && high ? `${rateText(low.returnPercent)}% to ${rateText(high.returnPercent)}%` : null;
  return [
    { key: 'value', label: 'Portfolio', swatch: 'line', color: 'var(--accent)' },
    { key: 'invested', label: 'Money put in', swatch: 'line', color: 'var(--ink-3)' },
    ...(forecastDrawn && base
      ? [
          {
            key: 'forecast',
            label: `Forecast at ${rateText(base.returnPercent)}%`,
            swatch: 'dash' as const,
            color: 'var(--accent)',
          },
        ]
      : []),
    ...(forecastDrawn && rangeText
      ? [{ key: 'band', label: rangeText, swatch: 'area' as const, color: 'var(--accent)' }]
      : []),
    { key: 'target', label: 'Sum to reach', swatch: 'dash', color: 'var(--pos)' },
  ];
}

const tickAnchor = (index: number, count: number) =>
  index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle';

/** The tip sits right of the point, or left of it where it would run out of the box. */
const tipLeftOf = (at: number, width: number) => (at + 14 + 210 > width ? at - 224 : at + 14);

/** What the tip says of one point: the portfolio that day, or the forecast for that month. */
function TipBody({
  current,
  goal,
  latestAt,
  share,
}: {
  current: Past | Ahead;
  goal: Goal;
  latestAt: string | undefined;
  share: string;
}) {
  const money = (value: string | null) => flooredText(value, goal.currency);
  if (current.kind === 'history')
    return (
      <>
        <div>{pointLabel(current, 'ALL', current.at === latestAt)}</div>
        <div className="goal-tip__value">{money(current.text)}</div>
        <div className="goal-tip__row">
          <span>Money put in</span>
          <span>{enteredText(current.invested, goal.currency)}</span>
        </div>
        <div className="goal-tip__row">
          <span>Of the sum</span>
          <span>{share}</span>
        </div>
        <div className="goal-tip__note">
          Money put in leaves out a deposit or withdrawal with no rate on its day.
        </div>
        {!current.complete && (
          <div className="goal-tip__note">Incomplete: an asset had no price or rate</div>
        )}
      </>
    );
  return (
    <>
      <div>
        {current.on === goal.deadline ? dateText(current.on) : monthYear(current.on)} · forecast
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
        <span>{share}</span>
      </div>
    </>
  );
}

/** A refresh that failed, a read that failed, stale prices, and assets left out. */
function ChartBanners({
  stale,
  historyFailed,
  forecastFailed,
  staleNote,
  estimated,
  onRetry,
  onRetryHistory,
  onRetryForecast,
}: {
  stale: boolean;
  historyFailed: boolean;
  forecastFailed: boolean;
  staleNote: string | null;
  estimated: boolean;
  onRetry: () => void;
  onRetryHistory: () => void;
  onRetryForecast: () => void;
}) {
  return (
    <>
      {stale && (
        <Banner
          tone="warn"
          role="alert"
          action={
            <Button size="sm" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          Could not refresh the chart. The figures below may be out of date.
        </Banner>
      )}
      {historyFailed && (
        <Banner
          tone="warn"
          role="alert"
          action={
            <Button size="sm" icon="refresh" onClick={onRetryHistory}>
              Try again
            </Button>
          }
        >
          Could not load the portfolio history, so only the forecast is drawn.
        </Banner>
      )}
      {forecastFailed && (
        <Banner
          tone="warn"
          role="alert"
          action={
            <Button size="sm" icon="refresh" onClick={onRetryForecast}>
              Try again
            </Button>
          }
        >
          Could not load the forecast, so only the portfolio so far is drawn.
        </Banner>
      )}
      {staleNote && <Banner tone="warn">{staleNote}</Banner>}
      {estimated && (
        <Banner tone="info">
          Estimated from priced assets only. Assets without a price or rate are excluded.
        </Banner>
      )}
    </>
  );
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

  // The server leaves the forecast out only when no current value can be estimated.
  const known = goal.progress.current !== null;
  // The forecast's own valuation, not the goal read's: the two requests can see other prices.
  const staleNote = staleText(forecast?.stalePrices);
  const target = Number(goal.targetAmount);
  const label = `${goal.name}: the portfolio so far and the forecast against the sum to reach`;

  // Chart coordinates only: every amount written out comes from the server's decimal strings.
  const past = pastOf(history?.points ?? []);
  const ahead = known && forecast?.currency === goal.currency ? aheadOf(forecast) : [];
  const plotted: (Past | Ahead)[] = [...past, ...ahead];
  // The drawn forecast is dated by its own day, which is later if it was read after midnight.
  const today = dayTime(ahead.length > 0 && forecast ? forecast.asOf : goal.asOf);
  const now = goal.progress.current === null ? null : Number(goal.progress.current);

  if (plotted.length === 0)
    return (
      <Card variant="chart" label={label}>
        <CardHeader title="Progress and forecast" />
        <p className="goal-chart__empty" role="note">
          {emptyText(historyError, history !== null, goal.currency)}
        </p>
        {!goal.progress.complete && (
          <Banner tone="info">
            Estimated from priced assets only. Assets without a price or rate are excluded.
          </Banner>
        )}
      </Card>
    );

  const band = ahead;
  const { innerWidth, innerHeight, start, span, x, y, ticks, floor } = scaleOf(
    width,
    plotted,
    past,
    band,
    today,
    target,
  );
  const { valuePath, investedPath, area } = historyShapes(history?.points ?? [], x, y, floor);
  // 'Now' names the final history point only; a missing value there leaves no point called Now.
  const latestAt = history?.points.at(-1)?.at;
  // The forecast starts at the portfolio now, the same figure the history ends on.
  const first = ahead.length > 0 ? forecast?.points[0] : undefined;
  const origin = originOf(first, now, today, x, y);
  const { scenarioPath, fan } = forecastShapes(band, origin, x, y);
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
  const tipLeft = current ? tipLeftOf(x(current.time), width) : 0;

  return (
    <Card variant="chart" labelledBy="goal-chart">
      <CardHeader id="goal-chart" title="Progress and forecast" sub={goal.currency} />
      <div aria-label="Chart legend" role="group">
        <Legend items={legendItems(goal, band.length > 0)} />
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
              textAnchor={tickAnchor(index, xTicks.length)}
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
          {past
            .filter((entry) => !entry.complete)
            .map((entry) => (
              <circle
                key={entry.time}
                cx={x(entry.time)}
                cy={y(entry.value)}
                r={2.5}
                className="goal-chart__incomplete"
              />
            ))}
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
            <TipBody
              current={current}
              goal={goal}
              latestAt={latestAt}
              share={share(current.value)}
            />
          </div>
        )}
      </div>
      <ChartBanners
        stale={historyStale || forecastStale}
        historyFailed={historyError !== null && history === null}
        forecastFailed={known && forecastError !== null && forecast === null}
        staleNote={staleNote}
        estimated={!goal.progress.complete || forecast?.complete === false}
        onRetry={() => {
          reloadHistory(true);
          reloadForecast(true);
        }}
        onRetryHistory={() => reloadHistory()}
        onRetryForecast={() => reloadForecast()}
      />
    </Card>
  );
}
