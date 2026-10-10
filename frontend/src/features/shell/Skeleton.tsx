import type { CSSProperties } from 'react';

/** A grey block in the place of text, a number or a chart that has not arrived. */
export function Bone({
  width,
  height,
  round,
}: {
  width?: number | string;
  height?: number | string;
  round?: boolean;
}) {
  const style: CSSProperties = { width, height };
  return (
    <i
      className={`shell-bone${round ? ' shell-bone--round' : ''}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** Blocks laid out like the figures at the top of a page. */
function Stats({ count = 3 }: { count?: number }) {
  return (
    <div className="shell-skeleton__stats">
      {Array.from({ length: count }, (_, index) => (
        // The placeholders never reorder.
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <div className="shell-card shell-skeleton__stat" key={index}>
          <Bone width={90} height={12} />
          <Bone width="70%" height={28} />
        </div>
      ))}
    </div>
  );
}

function Chart() {
  return (
    <div className="shell-card shell-skeleton__card">
      <div className="shell-skeleton__toolbar">
        <Bone width={200} height={16} />
        <Bone width="min(240px, 45%)" height={30} />
      </div>
      <Bone height={260} />
    </div>
  );
}

/** Lines like the rows of a list: an icon, two lines of text and a figure. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="shell-skeleton__rows">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <div className="shell-skeleton__row" key={index}>
          <Bone width={32} height={32} round />
          <div className="shell-skeleton__lines">
            <Bone width="45%" height={14} />
            <Bone width="25%" height={11} />
          </div>
          <Bone width={80} height={16} />
        </div>
      ))}
    </div>
  );
}

function Rows({ rows }: { rows?: number }) {
  return (
    <div className="shell-card shell-skeleton__card">
      <div className="shell-skeleton__toolbar">
        <Bone width={120} height={20} />
        <Bone width="min(280px, 45%)" height={30} />
      </div>
      <SkeletonRows rows={rows} />
    </div>
  );
}

function Cards({ count = 3 }: { count?: number }) {
  return (
    <div className="shell-skeleton__cards">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <div className="shell-card shell-skeleton__card" key={index}>
          <div className="shell-skeleton__row">
            <Bone width={40} height={40} round />
            <div className="shell-skeleton__lines">
              <Bone width="50%" height={16} />
              <Bone width="30%" height={12} />
            </div>
          </div>
          <Bone width="40%" height={28} />
          <Bone width="80%" height={12} />
        </div>
      ))}
    </div>
  );
}

const parts = { stats: Stats, chart: Chart, rows: Rows, cards: Cards };

/**
 * Grey blocks in the layout of the page that is loading, instead of a sentence. `label` is
 * what a screen reader hears.
 */
export function PageSkeleton({
  label,
  show,
  rows,
}: {
  label: string;
  show: (keyof typeof parts)[];
  rows?: number;
}) {
  return (
    <div className="shell-skeleton" role="status" aria-busy="true" aria-label={label}>
      {show.map((part) => {
        const Part = parts[part];
        return part === 'rows' ? <Rows key={part} rows={rows} /> : <Part key={part} />;
      })}
    </div>
  );
}

/** Rows or a chart inside a card that is already on the page. */
export function InlineSkeleton({ label, chart }: { label: string; chart?: boolean }) {
  return (
    <div className="shell-skeleton" role="status" aria-busy="true" aria-label={label}>
      {chart ? <Bone height={260} /> : <SkeletonRows rows={4} />}
    </div>
  );
}
