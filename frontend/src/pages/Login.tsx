import { useAuth } from '@contexts/AuthContext';
import { AuthField as Field } from '@features/password-reset/AuthField';
import AuthFrame, { focusOnMount, useFocusAfterAnswer } from '@features/password-reset/AuthFrame';
import PasswordField from '@features/password-reset/PasswordField';
import { tooManyAttempts } from '@features/security/attempts';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/inputs';

type FactorKind = 'totp' | 'recovery';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const recoveryPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/i;

// The server ends a pending sign-in step five minutes after the password
// (backend/src/auth/session.service.ts) or at its fifth wrong code (mfa.service.ts complete()),
// and then answers every code with the same 401 as a wrong one. These limits tell the two apart
// only when the step has surely ended: the clock starts when the password answer arrives, after
// the server started its own, and a 401 is either a counted wrong code or an ended step.
const PENDING_STEP_MS = 5 * 60 * 1000;
const PENDING_STEP_TRIES = 5;

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
  if (code === 429) return { notice: tooManyAttempts(error) };
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
  const focusAfterAnswer = useFocusAfterAnswer();
  // When the code step began: the password answer, or this form's first paint when it opens on a
  // step already pending, never earlier than the server's own start of the step.
  const pendingSince = useRef(performance.now());
  const refusedCodes = useRef(0);

  useEffect(() => {
    if (!loading && user) navigate('/');
  }, [user, loading, navigate]);

  const reset = (nextKind: FactorKind = 'totp') => {
    setFieldErrors({});
    setFailure('');
    setCode('');
    setKind(nextKind);
  };

  const startOver = () => {
    setPassword('');
    reset();
    restartPassword();
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
    if (errors.email || errors.password) {
      focusAfterAnswer(errors.email ? 'login-email' : 'login-password');
      return;
    }
    setBusy(true);
    try {
      await login(address, password);
      pendingSince.current = performance.now();
      refusedCodes.current = 0;
      setPassword('');
      reset();
    } catch (error) {
      setFailure(passwordFailure(error));
      focusAfterAnswer('login-password');
    } finally {
      setBusy(false);
    }
  };

  // After a 401: why the pending step surely ended, or null while the code may simply be wrong.
  const endedStep = (sentAt: number) => {
    refusedCodes.current += 1;
    if (sentAt - pendingSince.current >= PENDING_STEP_MS)
      return 'The sign-in took too long. Enter your password again.';
    if (refusedCodes.current >= PENDING_STEP_TRIES)
      return 'Too many wrong codes, so this sign-in ended. Enter your password again.';
    return null;
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
    const field = kind === 'totp' ? 'login-totp' : 'login-recovery';
    setFieldErrors({ code: problem });
    setFailure('');
    if (problem) {
      focusAfterAnswer(field);
      return;
    }
    setBusy(true);
    const sentAt = performance.now();
    try {
      await verifyFactor(kind, value);
    } catch (error) {
      const ended = status(error) === 401 ? endedStep(sentAt) : null;
      if (ended) {
        startOver();
        setFailure(ended);
        focusAfterAnswer('login-password');
        return;
      }
      const refused = factorFailure(error, kind);
      setFieldErrors({ code: refused.field });
      setFailure(refused.notice ?? '');
      setCode('');
      focusAfterAnswer(field);
    } finally {
      setBusy(false);
    }
  };

  // The answer to the sign-in check is not known yet: show the empty page, not a sentence.
  if (loading) return null;
  if (user) return null; // Redirects via the effect.

  if (!mfaPending) {
    return (
      <AuthFrame title="Sign in" onSubmit={submitPassword}>
        <p className="auth-sub">Only the owner account can sign in.</p>
        {failure && <Banner tone="neg">{failure}</Banner>}
        <Field id="login-email" label="Email" error={fieldErrors.email}>
          {(control) => (
            <Input
              {...control}
              ref={focusOnMount}
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              required
            />
          )}
        </Field>
        <PasswordField
          id="login-password"
          label="Password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          disabled={busy}
          autoComplete="current-password"
          labelAside={
            <Link className="ui-link" to="/password-reset">
              Forgot password?
            </Link>
          }
        />
        <Button type="submit" variant="primary" size="lg" block busy={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </AuthFrame>
    );
  }

  const back = (
    <button type="button" className="ui-link auth-link" onClick={startOver} disabled={busy}>
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
        {failure && <Banner tone="neg">{failure}</Banner>}
        <Field id="login-recovery" label="Recovery code" error={codeError}>
          {(control) => (
            <Input
              {...control}
              key="recovery"
              ref={focusOnMount}
              mono
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx"
              maxLength={40}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={busy}
              required
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block busy={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
        <button
          type="button"
          className="ui-link auth-link"
          onClick={() => reset('totp')}
          disabled={busy}
        >
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
      {failure && <Banner tone="neg">{failure}</Banner>}
      <Field
        id="login-totp"
        label={<span className="ui-sr">Code from your authenticator app</span>}
        error={codeError}
      >
        {(control) => (
          <Input
            {...control}
            key="totp"
            ref={focusOnMount}
            className="auth-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="······"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={busy}
            required
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" block busy={busy}>
        {busy ? 'Checking…' : 'Verify'}
      </Button>
      <button
        type="button"
        className="ui-link auth-link"
        onClick={() => reset('recovery')}
        disabled={busy}
      >
        Use a recovery code instead
      </button>
    </AuthFrame>
  );
}
