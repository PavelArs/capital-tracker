import type { ReactNode } from 'react';
import './badge.css';

export type BadgeTone = 'neutral' | 'muted' | 'pos' | 'neg' | 'warn' | 'info';

/** A 22 px status pill. A dot marks a live state (sync, "On"); the colour always comes with a word. */
export default function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = ['ui-badge', `ui-badge--${tone}`, dot && 'ui-badge--dot', className];
  return <span className={classes.filter(Boolean).join(' ')}>{children}</span>;
}
