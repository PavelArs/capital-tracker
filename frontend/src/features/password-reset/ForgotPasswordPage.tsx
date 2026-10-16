import { passwordResetApi } from '@api';
import { isAxiosError } from 'axios';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/inputs';
import { AuthField as Field } from './AuthField';
import AuthFrame, { focusOnMount, useFocusAfterAnswer } from './AuthFrame';

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
  const focusAfterAnswer = useFocusAfterAnswer();

  /** `retry` is the control the owner tries again with after a refusal. */
  const send = async (address: string, retry: string) => {
    setBusy(true);
    setFailure('');
    try {
      await passwordResetApi.request(address);
      return true;
    } catch (error) {
      setFailure(requestFailure(error));
      focusAfterAnswer(retry);
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
      focusAfterAnswer('reset-email');
      return;
    }
    setFieldError('');
    if (await send(address, 'reset-email')) setSentTo(address);
  };

  const handleResend = async () => {
    if (busy || sentTo === null) return;
    setResent(false);
    if (await send(sentTo, 'reset-resend')) {
      setResent(true);
      focusAfterAnswer('reset-resend');
    }
  };

  const back = (
    <Link className="ui-link auth-link" to="/login">
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
          <Banner tone="neg">{failure}</Banner>
        ) : resent ? (
          <Banner tone="pos">Sent again. Check your inbox and spam folder.</Banner>
        ) : (
          <Banner tone="info">Nothing after a few minutes? Check spam, or send it again.</Banner>
        )}
        <Button
          id="reset-resend"
          variant="secondary"
          size="lg"
          block
          onClick={handleResend}
          busy={busy}
        >
          {busy ? 'Sending…' : 'Send again'}
        </Button>
        {back}
      </AuthFrame>
    );
  }

  return (
    <AuthFrame icon="mail" title="Reset your password" onSubmit={handleSubmit}>
      <p className="auth-sub">
        Enter the email you sign in with. We'll send a link to set a new password.
      </p>
      {failure && <Banner tone="neg">{failure}</Banner>}
      <Field id="reset-email" label="Email" error={fieldError}>
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
      <Button type="submit" variant="primary" size="lg" block busy={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </Button>
      {back}
    </AuthFrame>
  );
}
