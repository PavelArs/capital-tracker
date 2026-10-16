import { Icon, type IconName } from '@features/shell/icons';
import type { ComponentPropsWithRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'md' | 'sm' | 'lg';

interface Look {
  /** primary: the one main action; secondary: the others; ghost: quiet; danger: confirms a deletion. */
  variant?: ButtonVariant;
  /** md 36 px, sm 30 px (rows, cards), lg 42 px (sign-in screens). */
  size?: ButtonSize;
  /** A leading 15 px icon. */
  icon?: IconName;
  /** A ghost button in the negative colour: Delete, Remove wallet, Disconnect. */
  destructive?: boolean;
  /** Takes the full width of its container. */
  block?: boolean;
}

/** The class list of a button with this look; for the rare element that cannot be a Button. */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  destructive = false,
  block = false,
  className,
}: Look & { className?: string | undefined }): string {
  return [
    'ui-btn',
    `ui-btn--${variant}`,
    size === 'md' || variant === 'link' ? '' : `ui-btn--${size}`,
    destructive ? 'ui-btn--destructive' : '',
    block ? 'ui-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export type ButtonProps = ComponentPropsWithRef<'button'> &
  Look & {
    /** The action is running: announced as busy and not pressable. The label says what runs. */
    busy?: boolean;
  };

/** The one button (prototype .btn). `type="button"` unless a form submit is asked for. */
export function Button({
  variant,
  size,
  icon,
  destructive,
  block,
  busy = false,
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, destructive, block, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} className="shell-icon ui-btn__icon" />}
      {children}
    </button>
  );
}

export type ButtonLinkProps = LinkProps & Look & { ref?: ComponentPropsWithRef<'a'>['ref'] };

/** A router link drawn as a button: "Add wallet" in an empty state, "Open goal". */
export function ButtonLink({
  variant,
  size,
  icon,
  destructive,
  block,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClass({ variant, size, destructive, block, className })} {...rest}>
      {icon && <Icon name={icon} className="shell-icon ui-btn__icon" />}
      {children}
    </Link>
  );
}
