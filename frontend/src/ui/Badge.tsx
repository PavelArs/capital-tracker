import type { ReactNode } from 'react';
import './badge.css';

export type BadgeTone = 'neutral' | 'muted' | 'pos' | 'neg' | 'warn' | 'info';

/**
 * A 22 px status pill. A dot marks a state: a live one (sync, "On") or a goal's status, as the
 * prototype draws it; the colour always comes with a word.
 */
export default function Badge({
  tone = 'neutral',
  dot = false,
  pulse = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  /** Something runs right now (Syncing): the dot pulses. Implies the dot. */
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = [
    'ui-badge',
    `ui-badge--${tone}`,
    (dot || pulse) && 'ui-badge--dot',
    pulse && 'ui-badge--pulse',
    className,
  ];
  return <span className={classes.filter(Boolean).join(' ')}>{children}</span>;
}
