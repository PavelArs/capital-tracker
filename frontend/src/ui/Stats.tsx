import type { ReactNode } from 'react';
import './stats.css';

/**
 * Figures side by side (prototype .stats): a description list whose rows wrap to the width.
 * `lg` is the 24 px summary of the portfolio and the class pages.
 */
export function Stats({
  label,
  size = 'md',
  children,
}: {
  label?: string;
  size?: 'md' | 'lg';
  children: ReactNode;
}) {
  return (
    <dl className={size === 'lg' ? 'ui-stats ui-stats--lg' : 'ui-stats'} aria-label={label}>
      {children}
    </dl>
  );
}

/**
 * One figure: its label, the value as the caller formatted it (missing stays "Unknown" or "—",
 * never 0) and an optional muted line under it. `tone` colours the value; the sign or a word
 * must say the same.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'pos' | 'neg' | 'warn';
}) {
  return (
    <div className="ui-stat">
      <dt className="ui-stat__label">{label}</dt>
      <dd className={tone ? `ui-stat__value ui-stat__value--${tone}` : 'ui-stat__value'}>
        {value}
      </dd>
      {hint && <dd className="ui-stat__hint">{hint}</dd>}
    </div>
  );
}
