import { useState } from 'react';
import './pager.css';

/** Rows on one page of a short list inside a card. */
export const SHORT_PAGE = 5;

export interface PagerProps {
  /** The page on screen, from 0. */
  page: number;
  pages: number;
  /** The first and last row on screen, counted from 1, and how many rows there are. */
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
}

export interface Pages<T> {
  /** The rows of the page on screen. */
  rows: T[];
  /** Props for Pager; null when every row fits on one page. */
  pager: PagerProps | null;
}

/**
 * Shows a list inside a card five rows at a time, so a long one (a deposit's daily interest,
 * its payouts) does not stretch the page; Previous and Next turn the pages. A row added opens
 * the page it landed on, wherever its date puts it; a list that shrinks stays on the same page,
 * or its last one. `keyOf` names each row, as its React key does.
 */
export function usePages<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  size = SHORT_PAGE,
): Pages<T> {
  const keys = items.map(keyOf);
  const [seen, setSeen] = useState(() => ({ page: 0, keys }));
  let wanted = seen.page;
  if (keys.length !== seen.keys.length || keys.some((key, index) => key !== seen.keys[index])) {
    const known = new Set(seen.keys);
    const added = keys.findIndex((key) => !known.has(key));
    if (added >= 0) wanted = Math.floor(added / size);
    setSeen({ page: wanted, keys });
  }
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(wanted, pages - 1);
  const start = page * size;
  const rows = items.slice(start, start + size);
  return {
    rows,
    pager:
      items.length > size
        ? {
            page,
            pages,
            from: start + 1,
            to: start + rows.length,
            total: items.length,
            onPage: (next) => setSeen({ page: next, keys }),
          }
        : null,
  };
}

/** Previous and Next under a short list, with which rows are on screen: "6–10 of 42 periods". */
export default function Pager({
  page,
  pages,
  from,
  to,
  total,
  onPage,
  label,
}: PagerProps & {
  /** What the rows are: "periods". */
  label: string;
}) {
  return (
    <nav className="ui-pager" aria-label={`Pages of ${label}`}>
      <button
        type="button"
        className="shell-button ui-pager__button"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span className="ui-pager__count" role="status">
        {from}–{to} of {total} {label}
      </span>
      <button
        type="button"
        className="shell-button ui-pager__button"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
