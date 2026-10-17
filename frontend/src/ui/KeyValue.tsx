import type { ReactNode } from 'react';
import './key-value.css';

/**
 * Facts as a description list (prototype dl.kv): terms on the left, values on the right. Every
 * row is a real `dt` followed by its `dd`, so "the dd after Last sync" finds the value.
 */
export function KeyValue({
  label,
  variant = 'plain',
  className,
  children,
}: {
  /** Names the list when the page has more than one. */
  label?: string;
  /** panel: tinted and padded (a summary before saving). */
  variant?: 'plain' | 'panel';
  className?: string;
  children: ReactNode;
}) {
  const classes = ['ui-kv', variant === 'panel' ? 'ui-kv--panel' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <dl className={classes} aria-label={label}>
      {children}
    </dl>
  );
}

/** One fact: the term and its value, as siblings. */
export function KeyValueRow({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}
