import { Icon } from '@features/shell/icons';
import { useState } from 'react';
import { FieldError } from './AuthFrame';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-pw">
        <input
          className="auth-input"
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
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
