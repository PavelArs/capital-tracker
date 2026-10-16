import { Icon, type IconName } from '@features/shell/icons';
import type { ReactNode } from 'react';

export type BannerTone = 'info' | 'warn' | 'neg' | 'pos' | 'neutral';

const defaultIcon: Record<BannerTone, IconName | false> = {
  info: 'info',
  warn: 'alert',
  neg: 'alert',
  pos: 'check',
  neutral: false,
};

// A failure interrupts; a success is announced politely; guidance is a note read in place.
const defaultRole: Record<BannerTone, 'note' | 'status' | 'alert'> = {
  info: 'note',
  warn: 'note',
  neg: 'alert',
  pos: 'status',
  neutral: 'note',
};

/**
 * One banner for the prototype's .note and .banner: an icon, the text and an optional action at
 * the end. The colour always comes with an icon or a word. Default roles: neg `alert`, pos
 * `status`, the rest `note`; `role="none"` sets none (a banner inside another live region).
 */
export function Banner({
  tone,
  icon,
  title,
  action,
  role,
  id,
  label,
  busy = false,
  className,
  children,
}: {
  tone: BannerTone;
  /** An icon name, or false for none; by default the tone's own. */
  icon?: IconName | false;
  title?: ReactNode;
  /** A button or a link at the end (Try again, Retry now). */
  action?: ReactNode;
  role?: 'note' | 'status' | 'alert' | 'none';
  id?: string;
  /** A name for the banner (aria-label), such as the region it reports on. */
  label?: string;
  /** What it reports is still loading (aria-busy). */
  busy?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const name = icon === undefined ? defaultIcon[tone] : icon;
  const chosen = role ?? defaultRole[tone];
  const classes = ['ui-banner', `ui-banner--${tone}`, 'ui-banner--row', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      id={id}
      className={classes}
      role={chosen === 'none' ? undefined : chosen}
      aria-label={label}
      aria-busy={busy || undefined}
    >
      {name && <Icon name={name} className="shell-icon ui-banner__icon" />}
      <div className="ui-banner__text">
        {title && <b className="ui-banner__title">{title}</b>}
        {children}
      </div>
      {action && <div className="ui-banner__action">{action}</div>}
    </div>
  );
}
