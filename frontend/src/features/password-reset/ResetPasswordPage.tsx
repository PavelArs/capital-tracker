import { passwordResetApi, type ResetLinkState } from '@api';
import { setCsrfToken } from '@api/client';
import { useAuth } from '@contexts/AuthContext';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner } from '@/ui/Banner';
import { Button, ButtonLink } from '@/ui/Button';
import AuthFrame, { focusOnMount, useFocusAfterAnswer } from './AuthFrame';
import PasswordField from './PasswordField';

type Screen = 'checking' | ResetLinkState | 'done';

// The emailed link carries the token in the fragment, which never reaches a server log.
function linkToken(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
}

function forgetLink() {
  window.history.replaceState(window.history.state, '', window.location.pathname);
}

// Same policy as the backend (owner-cli and confirm): 15 to 128 code points.
function passwordProblem(password: string): string {
  const length = Array.from(password).length;
  if (length < 15) return 'Use at least 15 characters';
  if (length > 128) return 'Use at most 128 characters';
  if (/[\r\n]/.test(password)) return "Line breaks aren't allowed";
  return '';
}

function refusedState(error: unknown): ResetLinkState | null {
  if (!isAxiosError(error) || error.response?.status !== 410) return null;
  return error.response.data?.error === 'expired' ? 'expired' : 'invalid';
}

/** What is wrong with the fields, before anything is sent. */
function fieldErrors(password: string, confirmation: string) {
  const problem = passwordProblem(password);
  return {
    password: problem || undefined,
    confirmation: !problem && password !== confirmation ? "Passwords don't match" : undefined,
  };
}

/** The first field with a problem, for the keyboard to go to; null when both are fine. */
function problemField(errors: ReturnType<typeof fieldErrors>) {
  if (errors.password) return 'reset-password';
  return errors.confirmation ? 'reset-confirmation' : null;
}

/** A reset the server refused or did not answer: said under the password, or above the form. */
function resetFailure(error: unknown): { password: string } | { failure: string } {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 400) return { password: 'Use 15 to 128 characters without line breaks' };
  if (status === 429) return { failure: 'Too many attempts. Wait a minute and try again.' };
  return { failure: "Couldn't reset the password. Check your connection and try again." };
}

/** PR-AUTH-3: one link sets one new password and signs every device out. */
export default function ResetPasswordPage() {
  const [token] = useState(linkToken);
  const [screen, setScreen] = useState<Screen>(token ? 'checking' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const { restartPassword } = useAuth();
  const focusAfterAnswer = useFocusAfterAnswer();

  useEffect(() => {
    if (!token) return;
    let active = true;
    passwordResetApi
      .status(token)
      .then((state) => {
        if (active) setScreen(state);
      })
      .catch((error) => {
        if (!active) return;
        setScreen('valid');
        setFailure(
          isAxiosError(error) && error.response?.status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : "Couldn't check the link. Check your connection and try again.",
        );
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (screen === 'done' || screen === 'expired' || screen === 'invalid') forgetLink();
  }, [screen]);

  // A refused link closes the form; any other failure is said and the keyboard goes back to it.
  const answerFailure = (error: unknown) => {
    const refused = refusedState(error);
    if (refused) {
      setScreen(refused);
      return;
    }
    const answer = resetFailure(error);
    if ('password' in answer) setErrors(answer);
    else setFailure(answer.failure);
    focusAfterAnswer('reset-password');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const next = fieldErrors(password, confirmation);
    setErrors(next);
    const field = problemField(next);
    if (field) {
      focusAfterAnswer(field);
      return;
    }
    setBusy(true);
    setFailure('');
    try {
      await passwordResetApi.confirm(token, password);
      // Every session, this browser's included, ended with the old password.
      setCsrfToken(null);
      restartPassword();
      setPassword('');
      setConfirmation('');
      setScreen('done');
    } catch (error) {
      answerFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Link className="ui-link auth-link" to="/login">
      Back to sign in
    </Link>
  );
  const newLink = (
    <ButtonLink variant="primary" size="lg" block to="/password-reset">
      Send a new link
    </ButtonLink>
  );

  if (screen === 'checking') {
    return (
      <AuthFrame icon="lock" title="Set a new password">
        <p className="auth-sub" role="status">
          Checking the link…
        </p>
      </AuthFrame>
    );
  }

  if (screen === 'expired') {
    return (
      <AuthFrame icon="clock" tone="warn" title="This link has expired">
        <p className="auth-sub">
          Reset links work once and only for 30 minutes. Your password hasn't changed; request a new
          link.
        </p>
        {newLink}
        {back}
      </AuthFrame>
    );
  }

  if (screen === 'invalid') {
    return (
      <AuthFrame icon="alert" tone="warn" title="This link no longer works">
        <p className="auth-sub">
          It was already used, or a newer link replaced it. Request a new link if you still need to
          reset your password.
        </p>
        {newLink}
        {back}
      </AuthFrame>
    );
  }

  if (screen === 'done') {
    return (
      <AuthFrame icon="check" tone="pos" title="Password changed">
        <p className="auth-sub">
          You were signed out on all devices. Sign in with the new password and your 2FA code.
        </p>
        <ButtonLink variant="primary" size="lg" block to="/login">
          Sign in
        </ButtonLink>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame icon="lock" title="Set a new password" onSubmit={handleSubmit}>
      <p className="auth-sub">Use at least 15 characters. A few random words work well.</p>
      {failure && <Banner tone="neg">{failure}</Banner>}
      <PasswordField
        id="reset-password"
        label="New password"
        inputRef={focusOnMount}
        value={password}
        onChange={setPassword}
        error={errors.password}
        disabled={busy}
      />
      <PasswordField
        id="reset-confirmation"
        label="Confirm password"
        value={confirmation}
        onChange={setConfirmation}
        error={errors.confirmation}
        disabled={busy}
      />
      <Button type="submit" variant="primary" size="lg" block busy={busy}>
        {busy ? 'Saving…' : 'Reset password'}
      </Button>
    </AuthFrame>
  );
}
