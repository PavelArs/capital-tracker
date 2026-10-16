import { Icon, type IconName } from '@features/shell/icons';
import type { ComponentPropsWithoutRef, MouseEventHandler, Ref } from 'react';

export type IconButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'children' | 'aria-label' | 'title' | 'onClick' | 'type'
> & {
  /** The accessible name and the tooltip; an icon alone never names a button. */
  label: string;
  icon: IconName;
  onClick: MouseEventHandler<HTMLButtonElement>;
  /** md 34 px; sm 24 px (a toast's dismiss). */
  size?: 'md' | 'sm';
  /** A number on the icon (the bell). Hidden at 0. */
  count?: number;
  /** What the count means, added to the name: "Notifications, 3 need attention". */
  countLabel?: string;
  buttonRef?: Ref<HTMLButtonElement>;
};

/** A 34 px icon-only button (prototype .ibtn), named by `label`. */
export function IconButton({
  label,
  icon,
  onClick,
  size = 'md',
  count,
  countLabel,
  buttonRef,
  className,
  ...rest
}: IconButtonProps) {
  const shown = count !== undefined && count > 0;
  const name = shown && countLabel ? `${label}, ${countLabel}` : label;
  const classes = ['ui-ibtn', size === 'sm' ? 'ui-ibtn--sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={buttonRef}
      type="button"
      className={classes}
      aria-label={name}
      title={label}
      onClick={onClick}
      {...rest}
    >
      <Icon name={icon} />
      {shown && (
        <span className="ui-ibtn__count" aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  );
}
