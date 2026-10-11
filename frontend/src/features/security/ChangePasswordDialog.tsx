import { securityApi } from '@api/security.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useState } from 'react';
import SecurityDialog from './SecurityDialog';

const MIN_LENGTH = 15;
const MAX_LENGTH = 128;

type Field = 'current' | 'next' | 'again' | 'code';
type Problems = Partial<Record<Field, string>> & { form?: string };

// The same policy as the sign-in and reset screens: 15 to 128 characters, no line breaks.
export function passwordProblem(value: string): string | null {
  const length = Array.from(value).length;
  if (length < MIN_LENGTH || length > MAX_LENGTH || /[\r\n\0]/.test(value))
    return `Use ${MIN_LENGTH} to ${MAX_LENGTH} characters, without line breaks.`;
  return null;
}

function serverProblems(error: unknown): Problems {
  if (!isAxiosError(error)) return { form: 'Could not change the password. Nothing changed.' };
  const status = error.response?.status;
  if (status === undefined) return { form: 'Could not reach the server. Try again.' };
  if (status === 422) {
    const kind = (error.response?.data as { error?: unknown } | undefined)?.error;
    if (kind === 'password') return { current: 'That is not your current password.' };
    if (kind === 'same') return { next: 'Choose a password you do not use now.' };
    return { code: 'That code is not valid. Enter the current code from your authenticator app.' };
  }
  if (status === 400) return { form: 'Check the fields and try again.' };
  if (status === 429) return { form: 'Too many attempts. Wait a few minutes and try again.' };
  return { form: 'Could not change the password. Nothing changed.' };
}

interface Props {
  onChanged: () => void;
  onClose: () => void;
}

// SEC-PASSWORD, prototype "Change password": the current password, a new one and a fresh code.
export default function ChangePasswordDialog({ onChanged, onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [problems, setProblems] = useState<Problems>({});
  const [busy, setBusy] = useState(false);

  const check = (field: Field): string | undefined => {
    if (field === 'current') return current ? undefined : 'Enter your current password.';
    if (field === 'next') return passwordProblem(next) ?? undefined;
    if (field === 'again') return again === next ? undefined : 'The two passwords differ.';
    return /^[0-9]{6}$/.test(code.replace(/\s/g, ''))
      ? undefined
      : 'Enter the 6-digit code from your authenticator app.';
  };
  const blur = (field: Field) => () => setProblems((now) => ({ ...now, [field]: check(field) }));
  const typed = (field: Field, set: (value: string) => void) => (value: string) => {
    set(value);
    setProblems((now) => ({ ...now, [field]: undefined, form: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Problems = {};
    for (const field of ['current', 'next', 'again', 'code'] as const) {
      const problem = check(field);
      if (problem) found[field] = problem;
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await securityApi.changePassword({
        currentPassword: current,
        newPassword: next,
        code: code.replace(/\s/g, ''),
      });
      onChanged();
      onClose();
    } catch (caught) {
      setProblems(serverProblems(caught));
      // A code works once, so the next try needs a new one.
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const input = (
    field: Field,
    id: string,
    label: string,
    value: string,
    set: (value: string) => void,
    extra: { type?: string; autoComplete: string; hint?: string; otp?: boolean },
  ) => (
    <div className="portfolio-field">
      <label className="portfolio-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={extra.otp ? 'portfolio-input security-otp' : 'portfolio-input'}
        type={extra.type ?? 'password'}
        inputMode={extra.otp ? 'numeric' : undefined}
        maxLength={extra.otp ? 7 : 1024}
        autoComplete={extra.autoComplete}
        value={value}
        aria-invalid={problems[field] ? true : undefined}
        aria-describedby={problems[field] ? `${id}-error` : undefined}
        onChange={(event) => typed(field, set)(event.target.value)}
        onBlur={blur(field)}
      />
      {extra.hint && !problems[field] && <p className="shell-note">{extra.hint}</p>}
      {problems[field] && (
        <p id={`${id}-error`} className="portfolio-dialog__error" role="alert">
          {problems[field]}
        </p>
      )}
    </div>
  );

  return (
    <SecurityDialog
      title="Change password"
      titleId="security-password"
      onEscape={busy ? undefined : onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="portfolio-dialog__body">
          <p className="security-dialog__text">
            Every other browser is signed out. This one stays signed in.
          </p>
          {input('current', 'security-current', 'Current password', current, setCurrent, {
            autoComplete: 'current-password',
          })}
          {input('next', 'security-new', 'New password', next, setNext, {
            autoComplete: 'new-password',
            hint: `${MIN_LENGTH} to ${MAX_LENGTH} characters.`,
          })}
          {input('again', 'security-again', 'New password again', again, setAgain, {
            autoComplete: 'new-password',
          })}
          {input(
            'code',
            'security-password-code',
            'Code from your authenticator app',
            code,
            setCode,
            {
              type: 'text',
              autoComplete: 'one-time-code',
              otp: true,
            },
          )}
          {problems.form && (
            <p className="portfolio-dialog__error" role="alert">
              {problems.form}
            </p>
          )}
        </div>
        <div className="portfolio-dialog__foot">
          <button
            type="button"
            className="shell-button shell-button--ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="shell-button shell-button--primary" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </SecurityDialog>
  );
}
