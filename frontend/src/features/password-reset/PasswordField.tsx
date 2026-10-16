import type { ReactNode, Ref } from 'react';
import { PasswordInput } from '@/ui/PasswordInput';
import { AuthField as Field } from './AuthField';

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
}: PasswordFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} labelAside={labelAside}>
      {(control) => (
        <PasswordInput
          {...control}
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
