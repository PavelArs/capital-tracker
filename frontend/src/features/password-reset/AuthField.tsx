import type { ReactNode } from 'react';
import { Field, type FieldControl } from '@/ui/Field';

/**
 * A shared Field whose error is also a live alert. The sign-in, reset and password forms put
 * the cursor on the first wrong field and announce the problem there; `Field` alone leaves the
 * announcing to the focus move, so the error goes in its hint slot with role="alert" and the
 * control is marked invalid here.
 */
export function AuthField({
  id,
  label,
  hint,
  error,
  labelAside,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  labelAside?: ReactNode;
  children: (control: FieldControl) => ReactNode;
}) {
  return (
    <Field
      id={id}
      label={label}
      labelAside={labelAside}
      hint={
        error ? (
          <span role="alert" className="ui-field__error">
            {error}
          </span>
        ) : (
          hint
        )
      }
    >
      {(control) => children(error ? { ...control, 'aria-invalid': true } : control)}
    </Field>
  );
}
