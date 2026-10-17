import { type ReactNode, useId } from 'react';
import './form.css';

/** What a Field hands its control so the label, the hint and the error belong to it. */
export interface FieldControl {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/**
 * A form field (prototype .field): the label over the control, a hint or, once the value is
 * wrong, the error in its place. The control is drawn by `children` with the id and ARIA it is
 * given. Ids: the control `id`, the hint `${id}-hint`, the error `${id}-error`. By default the
 * error has no role of its own: the dialog's banner, or the focus moved to the first wrong field,
 * announces it. `liveError` makes it an alert, for a form with no banner (sign-in, password).
 */
export function Field({
  label,
  hint,
  error,
  id,
  labelAside,
  liveError = false,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** The control's id; generated when left out. */
  id?: string;
  /** At the right end of the label row, such as "Forgot password?". */
  labelAside?: ReactNode;
  /** The error is announced as an alert when it appears. */
  liveError?: boolean;
  className?: string;
  children: (control: FieldControl) => ReactNode;
}) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const control: FieldControl = { id: controlId };
  if (error) {
    control['aria-describedby'] = errorId;
    control['aria-invalid'] = true;
  } else if (hint) {
    control['aria-describedby'] = hintId;
  }
  const labelElement = (
    <label className="ui-field__label" htmlFor={controlId}>
      {label}
    </label>
  );
  return (
    <div className={className ? `ui-field ${className}` : 'ui-field'}>
      {labelAside ? (
        <div className="ui-field__label-row">
          {labelElement}
          {labelAside}
        </div>
      ) : (
        labelElement
      )}
      {children(control)}
      {error ? (
        <span id={errorId} className="ui-field__error" role={liveError ? 'alert' : undefined}>
          {error}
        </span>
      ) : (
        hint && (
          <span id={hintId} className="ui-field__hint">
            {hint}
          </span>
        )
      )}
    </div>
  );
}
