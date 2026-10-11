import { Icon } from '@features/shell/icons';
import { type ReactNode, useState } from 'react';
import { FieldError } from './AuthFrame';

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
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="auth-field">
      {labelAside ? (
        <div className="auth-label-row">
          <label htmlFor={id}>{label}</label>
          {labelAside}
        </div>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
      <div className="auth-pw">
        <input
          className="auth-input"
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          disabled={disabled}
          required
        />
        <button
          type="button"
          className="auth-pw__toggle"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-controls={id}
          onClick={() => setVisible((shown) => !shown)}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      {hint && (
        <span className="auth-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && <FieldError id={`${id}-error`} message={error} />}
    </div>
  );
}
