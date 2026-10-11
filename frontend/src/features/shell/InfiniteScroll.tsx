import { useEffect, useRef, useState } from 'react';
import './infinite-scroll.css';

/** Rows added each time the owner reaches the end of a list. */
export const PAGE_SIZE = 20;

export interface MoreProps {
  /** Rows on screen. */
  shown: number;
  /** Rows in the whole list; absent when a list is read piece by piece and the end is not known. */
  total?: number;
  onMore: () => void;
  /** More rows are on their way. */
  busy?: boolean;
}

export interface Infinite<T> {
  /** The rows on screen: the first twenty, then twenty more each time the end is reached. */
  rows: T[];
  /** Props for LoadMore; null when every row is already on screen. */
  more: MoreProps | null;
  /** Brings the row at this index of `items` onto the screen. */
  reveal: (index: number) => void;
}

/**
 * Shows a long list twenty rows at a time. The list grows as the owner reaches its end and
 * never shrinks while it is open, so a row opened in a drawer and the scroll position stay where
 * they are when more rows arrive; a changed `resetKey` (a filter, a search) starts again at twenty.
 */
export function useInfinite<T>(
  items: T[],
  options: { size?: number; resetKey?: string } = {},
): Infinite<T> {
  const { size = PAGE_SIZE, resetKey = '' } = options;
  const [grown, setGrown] = useState({ count: size, key: resetKey });
  const count = grown.key === resetKey ? grown.count : size;
  const grow = (to: (current: number) => number) =>
    setGrown((kept) => {
      const current = kept.key === resetKey ? kept.count : size;
      const next = to(current);
      return next === current && kept.key === resetKey ? kept : { key: resetKey, count: next };
    });
  const rows = items.slice(0, count);
  return {
    rows,
    more:
      items.length > count
        ? { shown: rows.length, total: items.length, onMore: () => grow((now) => now + size) }
        : null,
    reveal: (index) => grow((now) => Math.max(now, Math.ceil((index + 1) / size) * size)),
  };
}

/**
 * The end of a list that grows: nearing it adds the next rows, and a button does the same for
 * a keyboard, a screen reader or a browser without IntersectionObserver.
 */
export default function LoadMore({
  shown,
  total,
  onMore,
  busy = false,
  label,
}: MoreProps & {
  /** What the rows are, for a screen reader: "transactions". */
  label: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  latest.current = onMore;
  // Each batch of rows is followed by a fresh look, so a short screen keeps filling.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shown` says a batch has arrived.
  useEffect(() => {
    const node = end.current;
    if (busy || !node || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: '480px 0px' },
    );
    watch.observe(node);
    return () => watch.disconnect();
  }, [busy, shown]);
  return (
    <div className="more" ref={end}>
      <span className="more__count" role="status">
        Showing {shown}
        {total === undefined ? '' : ` of ${total}`} {label}
      </span>
      <button type="button" className="shell-button more__button" disabled={busy} onClick={onMore}>
        {busy ? 'Loading…' : 'Show more'}
      </button>
    </div>
  );
}
