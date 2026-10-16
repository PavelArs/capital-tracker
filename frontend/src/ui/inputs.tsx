import type { ComponentPropsWithRef, ReactNode } from 'react';
import './form.css';

const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

export type InputProps = Omit<ComponentPropsWithRef<'input'>, 'size'> & {
  /** Addresses, keys and codes. */
  mono?: boolean;
  /** An amount: a text field with the decimal keypad and tabular figures (never type=number). */
  numeric?: boolean;
  /** md 40 px; sm 36 px for toolbars and filters. */
  size?: 'md' | 'sm';
};

/** A text input (prototype .input); invalid styling follows aria-invalid. */
export function Input({ mono, numeric, size = 'md', className, inputMode, ...rest }: InputProps) {
  return (
    <input
      className={join(
        'ui-input',
        size === 'sm' && 'ui-input--sm',
        mono && 'ui-input--mono',
        numeric && 'ui-num',
        className,
      )}
      inputMode={numeric ? (inputMode ?? 'decimal') : inputMode}
      {...rest}
    />
  );
}

export type SelectProps = Omit<ComponentPropsWithRef<'select'>, 'size'> & { size?: 'md' | 'sm' };

/** A native select with the drawn chevron. */
export function Select({ size = 'md', className, ...rest }: SelectProps) {
  return (
    <select className={join('ui-input', size === 'sm' && 'ui-input--sm', className)} {...rest} />
  );
}

/** A multi-line text field (comments, notes). */
export function Textarea({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea className={join('ui-input', 'ui-textarea', className)} {...rest} />;
}

/**
 * An input with its unit at the right end: a currency, %, "USD per 1 BTC". `wide` leaves room
 * for a longer unit. The unit is part of what the field reads, so it is not hidden.
 */
export function Affix({
  suffix,
  wide = false,
  children,
}: {
  suffix: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={join('ui-affix', wide && 'ui-affix--wide')}>
      {children}
      <span className="ui-affix__suffix">{suffix}</span>
    </span>
  );
}
