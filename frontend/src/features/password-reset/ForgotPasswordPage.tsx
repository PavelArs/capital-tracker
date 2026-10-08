import { passwordResetApi } from '@api';
import { isAxiosError } from 'axios';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthFrame, { FieldError, Notice } from './AuthFrame';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requestFailure(error: unknown): string {
  if (isAxiosError(error) && error.response?.status === 429) {
    return 'Too many requests. Wait a minute and try again.';
  }
  return "Couldn't send the request. Check your connection and try again.";
}

/** BR 2.2: the owner asks for a reset link; the answer never says whether the email is known. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [failure, setFailure] = useState('');
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (address: string) => {
    setBusy(true);
    setFailure('');
    try {
      await passwordResetApi.request(address);
      return true;
    } catch (error) {
      setFailure(requestFailure(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!emailPattern.test(address)) {
      setFieldError('Enter the email you sign in with');
      return;
    }
    setFieldError('');
    if (await send(address)) setSentTo(address);
  };

  const handleResend = async () => {
    if (busy || sentTo === null) return;
    setResent(false);
    if (await send(sentTo)) setResent(true);
  };

  const back = (
    <Link className="auth-link" to="/login">
      Back to sign in
    </Link>
  );

  if (sentTo !== null) {
    return (
      <AuthFrame icon="mail" title="Check your email">
        <p className="auth-sub">
          If an account exists for <b>{sentTo}</b>, a reset link is on its way. It works once and
          expires in 30 minutes.
        </p>
        {failure ? (
          <Notice tone="neg">{failure}</Notice>
        ) : resent ? (
          <Notice tone="pos">Sent again. Check your inbox and spam folder.</Notice>
        ) : (
          <Notice tone="info">Nothing after a few minutes? Check spam, or send it again.</Notice>
        )}
        <button
          type="button"
          className="auth-btn auth-btn--secondary"
          onClick={handleResend}
          disabled={busy}
        >
          {busy ? 'Sending…' : 'Send again'}
        </button>
        {back}
      </AuthFrame>
    );
  }

  return (
    <AuthFrame icon="mail" title="Reset your password" onSubmit={handleSubmit}>
      <p className="auth-sub">
        Enter the email you sign in with. We'll send a link to set a new password.
      </p>
      {failure && <Notice tone="neg">{failure}</Notice>}
      <div className="auth-field">
        <label htmlFor="reset-email">Email</label>
        <input
          className="auth-input"
          id="reset-email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'reset-email-error' : undefined}
          disabled={busy}
          required
        />
        {fieldError && <FieldError id="reset-email-error" message={fieldError} />}
      </div>
      <button className="auth-btn auth-btn--primary" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
      {back}
    </AuthFrame>
  );
}
