import type { Dispatch, KeyboardEvent, PointerEvent, SetStateAction } from 'react';

// Drawing helpers shared by the dashboard, asset, deposit and goal charts.

type Scale = (value: number) => number;

export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10) * power;
}

/**
 * The value axis: the range widened to round steps, where a value sits on a plot that starts
 * `top` px down and is `height` px high, and a tick at every step.
 */
export function valueAxis(low: number, high: number, top: number, height: number) {
  const step = niceStep((high - low) / 4);
  const bottom = Math.floor(low / step) * step;
  const ceiling = Math.ceil(high / step) * step;
  const y = (value: number) => top + height - ((value - bottom) / (ceiling - bottom)) * height;
  const ticks: number[] = [];
  for (let value = bottom; value <= ceiling + step / 2; value += step) ticks.push(value);
  return { y, ticks };
}

/** `count` times spread evenly from `start` to `end`, each once. */
export function evenTicks(start: number, end: number, count: number): number[] {
  return [
    ...new Set(
      Array.from({ length: count }, (_, index) =>
        count === 1 ? start : start + ((end - start) * index) / (count - 1),
      ),
    ),
  ];
}

/** Reports each width above zero the element takes; returns the stop, or nothing to stop. */
export function observeWidth(element: Element, report: (width: number) => void) {
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) report(entry.contentRect.width);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

/** The tip sits right of the point, or left of it where its `tip` px would run out of the box. */
export const tipLeftOf = (at: number, width: number, tip = 200) =>
  at + 14 + tip > width ? at - (tip + 14) : at + 14;

/** The points that have a value, with their place in the list, their time and the value to draw. */
export function valuedPoints<P extends { at: string; value: string | null }>(points: readonly P[]) {
  return points.flatMap((point, index) =>
    point.value === null
      ? []
      : [{ index, point, time: Date.parse(point.at), value: Number(point.value) }],
  );
}

/** Consecutive points, so a point without a figure breaks the line instead of joining. */
export function runsOf<T extends { index: number }>(plotted: readonly T[]): T[][] {
  const runs: T[][] = [];
  for (const entry of plotted) {
    const previous = runs.at(-1)?.at(-1);
    if (previous && previous.index === entry.index - 1) runs.at(-1)!.push(entry);
    else runs.push([entry]);
  }
  return runs;
}

interface Plotted {
  time: number;
  value: number;
}

/** The value line through one run of points. */
export const linePath = (run: readonly Plotted[], x: Scale, y: Scale) =>
  run
    .map(
      (entry, index) =>
        `${index ? 'L' : 'M'}${x(entry.time).toFixed(1)} ${y(entry.value).toFixed(1)}`,
    )
    .join('');

/** The area under each run of the value line, down to the axis at `base`. */
export const areaPath = (runs: readonly (readonly Plotted[])[], x: Scale, y: Scale, base: number) =>
  runs
    .map(
      (run) =>
        `${linePath(run, x, y)}L${x(run.at(-1)!.time).toFixed(1)} ${base}L${x(run[0].time).toFixed(1)} ${base}Z`,
    )
    .join('');

/**
 * What moves the cursor of a chart over its points: the pointer reads the point nearest it in
 * time, the arrow keys, Home and End step from the point read (or from `from` before any), and
 * Escape, leaving the box and losing focus clear it.
 */
export function chartCursor({
  points,
  from,
  left,
  innerWidth,
  start,
  span,
  setActive,
}: {
  points: readonly { time: number }[];
  from: number;
  /** The plot: where it starts in the box and its width, and the time at its start and across it. */
  left: number;
  innerWidth: number;
  start: number;
  span: number;
  setActive: Dispatch<SetStateAction<number | null>>;
}) {
  const pick = (event: PointerEvent<HTMLElement>) => {
    // A box that reports no left edge counts from 0, as each chart did on its own.
    const offset = event.clientX - (event.currentTarget.getBoundingClientRect().left ?? 0) - left;
    const time = start + (Math.min(Math.max(offset, 0), innerWidth) / innerWidth) * span;
    let nearest = 0;
    for (let index = 1; index < points.length; index++)
      if (Math.abs(points[index].time - time) < Math.abs(points[nearest].time - time))
        nearest = index;
    setActive(nearest);
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      Home: -points.length,
      End: points.length,
    };
    const move = moves[event.key];
    if (move === undefined) {
      if (event.key === 'Escape') setActive(null);
      return;
    }
    event.preventDefault();
    setActive((index) => Math.min(points.length - 1, Math.max(0, (index ?? from) + move)));
  };
  return {
    onPointerMove: pick,
    onPointerLeave: () => setActive(null),
    onKeyDown: onKey,
    onBlur: () => setActive(null),
  };
}

/** The fill under the value line: the accent fading out downwards. */
export function AreaGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
      <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
    </linearGradient>
  );
}

/** A grid line and its amount at each tick of the value axis, then the axis at `base`. */
export function ValueGrid({
  ticks,
  y,
  left,
  right,
  base,
  width,
  text,
}: {
  ticks: readonly number[];
  y: Scale;
  /** Where the plot starts and ends across the box, which is `width` wide. */
  left: number;
  right: number;
  base: number;
  width: number;
  text: (value: number) => string;
}) {
  return (
    <>
      {ticks.map((value) => (
        <g key={value}>
          <line
            x1={left}
            x2={right}
            y1={y(value)}
            y2={y(value)}
            className="dashboard-chart__grid"
          />
          <text x={width - 4} y={y(value) + 4} textAnchor="end" className="dashboard-chart__tick">
            {text(value)}
          </text>
        </g>
      ))}
      <line x1={left} x2={right} y1={base} y2={base} className="dashboard-chart__axis" />
    </>
  );
}

/** The cursor: a line down the plot at the point read, and a dot on it. */
export function PointCursor({
  cx,
  cy,
  top,
  base,
}: {
  cx: number;
  cy: number;
  top: number;
  base: number;
}) {
  return (
    <g>
      <line x1={cx} x2={cx} y1={top} y2={base} className="dashboard-chart__cursor" />
      <circle cx={cx} cy={cy} r={5} className="dashboard-chart__dot" />
    </g>
  );
}
