import { useRef, useState } from 'react';
import './pager.css';

/** Rows on a page of any list. */
export const PAGE_SIZE = 20;

export interface PagerProps {
  /** The page shown, from 1. */
  page: number;
  /** Rows in the whole list; absent when a list is read page by page and the end is not known. */
  total?: number;
  size?: number;
  /** Whether a page after this one exists. */
  hasNext: boolean;
  onPage: (page: number) => void;
  /** What the pages are of, for a screen reader: "transactions". */
  label: string;
  busy?: boolean;
}

/** Previous and next, with where the owner is: "21–40 of 135 · Page 2 of 7". */
export default function Pager({
  page,
  total,
  size = PAGE_SIZE,
  hasNext,
  onPage,
  label,
  busy = false,
}: PagerProps) {
  const nav = useRef<HTMLElement>(null);
  const go = (next: number) => {
    onPage(next);
    // The new page starts at the top of its list, not at the foot of the old one.
    const list = nav.current?.closest('section, .shell-card');
    if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView?.({ block: 'start' });
  };
  const pages = total === undefined ? undefined : Math.max(1, Math.ceil(total / size));
  const first = (page - 1) * size + 1;
  const last = total === undefined ? page * size : Math.min(page * size, total);
  return (
    <nav className="pager" aria-label={`Pages of ${label}`} ref={nav}>
      <button
        type="button"
        className="shell-button pager__button"
        disabled={page <= 1 || busy}
        onClick={() => go(page - 1)}
      >
        Previous
      </button>
      <span className="pager__where" aria-live="polite">
        {total !== undefined && (
          <span className="pager__range">
            {first}–{last} of {total}
          </span>
        )}
        <span>{pages === undefined ? `Page ${page}` : `Page ${page} of ${pages}`}</span>
      </span>
      <button
        type="button"
        className="shell-button pager__button"
        disabled={!hasNext || busy}
        onClick={() => go(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

export interface Paged<T> {
  /** The rows of the page shown. */
  rows: T[];
  /** The page shown, from 1. */
  page: number;
  setPage: (page: number) => void;
  /** Props for a Pager; null when everything fits on one page. */
  pager: Omit<PagerProps, 'label'> | null;
  /** The page a row at this index of `items` falls on. */
  pageOf: (index: number) => number;
}

/**
 * Cuts a list into pages of 20. The page is the owner's own state, or, given `page` and
 * `onPage`, one kept elsewhere (the address). A list that changes (a filter, a search) goes
 * back to the first page when `resetKey` changes, and a page past the end falls back to the last.
 */
export function usePaged<T>(
  items: T[],
  options: {
    size?: number;
    resetKey?: string;
    page?: number;
    onPage?: (page: number) => void;
  } = {},
): Paged<T> {
  const { size = PAGE_SIZE, resetKey = '', page: controlled, onPage } = options;
  const [own, setOwn] = useState({ page: 1, key: resetKey });
  const wanted = controlled ?? (own.key === resetKey ? own.page : 1);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(1, Math.floor(wanted) || 1), pages);
  const setPage = (next: number) => {
    if (onPage) onPage(next);
    else setOwn({ page: next, key: resetKey });
  };
  return {
    rows: items.slice((page - 1) * size, page * size),
    page,
    setPage,
    pageOf: (index) => Math.floor(Math.max(0, index) / size) + 1,
    pager:
      items.length <= size
        ? null
        : { page, total: items.length, size, hasNext: page < pages, onPage: setPage },
  };
}
