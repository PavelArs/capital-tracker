import type { MouseEventHandler, ReactNode } from 'react';
import './filters.css';

/**
 * A pill button (prototype .chip): a filter or a quick pick. `pressed` makes it a toggle
 * (aria-pressed); left out, it is a plain action ("Use your 6-month average"). A count follows
 * the label, amber by default ("needs you"); `countLabel` is read in its place ("3 to classify").
 */
export function Chip({
  pressed,
  count,
  countLabel,
  countTone = 'warn',
  onClick,
  icon,
  disabled,
  children,
}: {
  pressed?: boolean;
  count?: number;
  countLabel?: string;
  /** warn: an amber pill (Needs classification); muted: a plain number (how many in a class). */
  countTone?: 'warn' | 'muted';
  onClick: MouseEventHandler<HTMLButtonElement>;
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="ui-chip"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && (
        <span className="ui-chip__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
      {/* Read right after the label ("Needs classification, 3 to classify"); the pill is then
          only drawn. */}
      {count !== undefined && countLabel && <span className="ui-sr">, {countLabel}</span>}
      {count !== undefined && (
        <>
          {' '}
          <span
            className={
              countTone === 'warn' ? 'ui-chip__count ui-chip__count--warn' : 'ui-chip__count'
            }
            aria-hidden={countLabel ? true : undefined}
          >
            {count}
          </span>
        </>
      )}
    </button>
  );
}

/** A row of chips that belong together, named for screen readers. */
export function ChipGroup({
  label,
  labelledBy,
  children,
}: {
  label?: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <div className="ui-chips" role="group" aria-label={label} aria-labelledby={labelledBy}>
      {children}
    </div>
  );
}
