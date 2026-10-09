import { useAuth } from '@contexts/AuthContext';
import AuthFrame, { FieldError, Notice } from '@features/password-reset/AuthFrame';
import PasswordField from '@features/password-reset/PasswordField';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

type FactorKind = 'totp' | 'recovery';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const recoveryPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/i;

// Each factor step opens with the cursor in its code field.
const focusOnMount = (input: HTMLInputElement | null) => {
  input?.focus();
};

const status = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);

function passwordFailure(error: unknown): string {
  const code = status(error);
  if (code === 401) return 'Email or password is incorrect. Check both and try again.';
  if (code === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (code === 403) return 'The sign-in page expired. Try again.';
  return "Couldn't sign in. Check your connection and try again.";
}

function factorFailure(error: unknown, kind: FactorKind): { field?: string; notice?: string } {
  const code = status(error);
  if (code === 401)
    return {
      field:
        kind === 'totp'
          ? "That code didn't work. Enter the current one; if it keeps failing, sign in again."
          : "That recovery code didn't work. Each code works once; check it and try again.",
    };
  if (code === 429) return { notice: 'Too many attempts. Wait 10 minutes and try again.' };
  if (code === 403) return { notice: 'The sign-in took too long. Go back and sign in again.' };
  return { notice: "Couldn't check the code. Check your connection and try again." };
}

/** BR 2.1, prototype Sign-in tab: password first, then a TOTP or a single-use recovery code. */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [kind, setKind] = useState<FactorKind>('totp');
  const [code, setCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    code?: string;
  }>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, verifyFactor, restartPassword, mfaPending, user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate('/');
  }, [user, loading, navigate]);

  const reset = (nextKind: FactorKind = 'totp') => {
    setFieldErrors({});
    setFailure('');
    setCode('');
    setKind(nextKind);
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    const errors = {
      email: emailPattern.test(address) ? undefined : 'Enter your email',
      password: password ? undefined : 'Enter your password',
    };
    setFieldErrors(errors);
    setFailure('');
    if (errors.email || errors.password) return;
    setBusy(true);
    try {
      await login(address, password);
      setPassword('');
      reset();
    } catch (error) {
      setFailure(passwordFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const submitFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const value = kind === 'totp' ? code : code.trim();
    const problem =
      kind === 'totp'
        ? /^[0-9]{6}$/.test(value)
          ? undefined
          : 'Enter all 6 digits'
        : recoveryPattern.test(value)
          ? undefined
          : 'Recovery codes look like 1a2b3c4d-5e6f7a8b-9c0d1e2f-3a4b5c6d';
    setFieldErrors({ code: problem });
    setFailure('');
    if (problem) return;
    setBusy(true);
    try {
      await verifyFactor(kind, value);
    } catch (error) {
      const refused = factorFailure(error, kind);
      setFieldErrors({ code: refused.field });
      setFailure(refused.notice ?? '');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setPassword('');
    reset();
    restartPassword();
  };

  if (loading) return <div className="loading-container">Loading…</div>;
  if (user) return null; // Redirects via the effect.

  if (!mfaPending) {
    return (
      <AuthFrame title="Sign in" onSubmit={submitPassword}>
        <p className="auth-sub">Only the owner account can sign in.</p>
        {failure && <Notice tone="neg">{failure}</Notice>}
        <div className="auth-field">
          <label htmlFor="login-email">Email</label>
          <input
            className="auth-input"
            id="login-email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
            disabled={busy}
            required
          />
          {fieldErrors.email && <FieldError id="login-email-error" message={fieldErrors.email} />}
        </div>
        <PasswordField
          id="login-password"
          label="Password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          disabled={busy}
          autoComplete="current-password"
          labelAside={
            <Link className="auth-link" to="/password-reset">
              Forgot password?
            </Link>
          }
        />
        <button className="auth-btn auth-btn--primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </AuthFrame>
    );
  }

  const back = (
    <button type="button" className="auth-link" onClick={startOver} disabled={busy}>
      Back to sign in
    </button>
  );
  const codeError = fieldErrors.code;

  if (kind === 'recovery') {
    return (
      <AuthFrame icon="lock" title="Use a recovery code" onSubmit={submitFactor} footer={back}>
        <p className="auth-sub">
          Each code works once. If you lost your phone, set up the authenticator again in Settings
          after signing in.
        </p>
        {failure && <Notice tone="neg">{failure}</Notice>}
        <div className="auth-field">
          <label htmlFor="login-recovery">Recovery code</label>
          <input
            key="recovery"
            ref={focusOnMount}
            className="auth-input auth-mono"
            id="login-recovery"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx"
            maxLength={40}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? 'login-recovery-error' : undefined}
            disabled={busy}
            required
          />
          {codeError && <FieldError id="login-recovery-error" message={codeError} />}
        </div>
        <button className="auth-btn auth-btn--primary" type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <button type="button" className="auth-link" onClick={() => reset('totp')} disabled={busy}>
          Back to authenticator code
        </button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      icon="shield"
      title="Two-factor authentication"
      onSubmit={submitFactor}
      footer={back}
    >
      <p className="auth-sub">Enter the 6-digit code from your authenticator app.</p>
      {failure && <Notice tone="neg">{failure}</Notice>}
      <div className="auth-field">
        <label className="auth-sr" htmlFor="login-totp">
          Code from your authenticator app
        </label>
        <input
          key="totp"
          ref={focusOnMount}
          className="auth-input auth-otp"
          id="login-totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="······"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={codeError ? true : undefined}
          aria-describedby={codeError ? 'login-totp-error' : undefined}
          disabled={busy}
          required
        />
        {codeError && <FieldError id="login-totp-error" message={codeError} />}
      </div>
      <button className="auth-btn auth-btn--primary" type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Verify'}
      </button>
      <button type="button" className="auth-link" onClick={() => reset('recovery')} disabled={busy}>
        Use a recovery code instead
      </button>
    </AuthFrame>
  );
}
