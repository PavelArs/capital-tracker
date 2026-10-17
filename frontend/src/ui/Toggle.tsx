import type { ReactNode } from 'react';
import './toggle.css';

/**
 * An on/off choice drawn as a switch (prototype .toggle). Underneath it is a native checkbox,
 * so its role, its label and the keyboard stay the browser's own.
 */
export function Toggle({
  checked,
  onChange,
  children,
  describedBy,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The label. */
  children: ReactNode;
  describedBy?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label className="ui-toggle">
      <input
        id={id}
        type="checkbox"
        className="ui-toggle__input"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-toggle__label">{children}</span>
    </label>
  );
}
