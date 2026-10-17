import type { ReactNode } from 'react';

/**
 * A card (prototype .card): the surface with a hairline border. As a `section` with
 * `labelledBy` (or a `label` when it has no heading of its own) it is a named region; `busy`
 * says its content is still loading.
 */
export function Card({
  as: Tag = 'section',
  labelledBy,
  label,
  busy = false,
  variant = 'default',
  className,
  children,
}: {
  as?: 'section' | 'div' | 'article' | 'li';
  /** The id of the heading that names the card (CardHeader's `id`). */
  labelledBy?: string;
  /** The card's name when no heading in it names it (aria-label). */
  label?: string;
  /** Its content is loading (aria-busy). */
  busy?: boolean;
  /** flush: no padding (account cards with rows to the edge); chart: the chart card's padding. */
  variant?: 'default' | 'flush' | 'chart';
  className?: string;
  children: ReactNode;
}) {
  const classes = ['ui-card', variant === 'default' ? '' : `ui-card--${variant}`, className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <Tag
      className={classes}
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-busy={busy || undefined}
    >
      {children}
    </Tag>
  );
}

/** A card's header row: the 16 px title, a muted caption beside it and actions at the right. */
export function CardHeader({
  id,
  title,
  level = 2,
  sub,
  actions,
}: {
  id?: string;
  title: ReactNode;
  level?: 2 | 3;
  /** A caption or a count beside the title, 13 px muted. */
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div className="ui-card-h">
      <Heading id={id} className="ui-card-h__title">
        {title}
      </Heading>
      {sub !== undefined && sub !== null && <span className="ui-card-h__sub">{sub}</span>}
      {actions && <div className="ui-card-h__actions">{actions}</div>}
    </div>
  );
}
