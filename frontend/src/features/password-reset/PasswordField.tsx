import type { ReactNode, Ref } from 'react';
import { Field } from '@/ui/Field';
import { PasswordInput } from '@/ui/PasswordInput';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  autoComplete?: 'new-password' | 'current-password';
  /** Shown at the end of the label row, such as "Forgot password?". */
  labelAside?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  /** The id of a message that says this value was refused (no error of its own): marks it invalid. */
  refusedBy?: string;
}

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  autoComplete = 'new-password',
  labelAside,
  inputRef,
  refusedBy,
}: PasswordFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} labelAside={labelAside} liveError>
      {(control) => (
        <PasswordInput
          {...control}
          {...(refusedBy && !error
            ? { 'aria-invalid': true as const, 'aria-describedby': refusedBy }
            : {})}
          ref={inputRef}
          showLabel={`Show ${label.toLowerCase()}`}
          hideLabel={`Hide ${label.toLowerCase()}`}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          required
        />
      )}
    </Field>
  );
}
