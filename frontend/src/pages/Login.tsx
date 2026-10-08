import { useAuth } from '@contexts/AuthContext';
import type { FactorCredentials } from '@shared/types';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import './Auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [factorKind, setFactorKind] = useState<FactorCredentials['kind']>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, verifyFactor, restartPassword, mfaPending, user, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (!loading && user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (isSubmitting) return;
      setError('');
      setIsSubmitting(true);

      try {
        if (mfaPending) {
          await verifyFactor(factorKind, code);
        } else {
          await login(email, password);
          setPassword('');
          setCode('');
          setFactorKind('totp');
        }
      } catch (err) {
        const status = isAxiosError(err) ? err.response?.status : undefined;
        if (status === 429) setError(t('auth.tooManyAttempts'));
        else if (status === 403) setError(t('auth.sessionExpired'));
        else setError(t(mfaPending ? 'auth.factorFailed' : 'auth.loginFailed'));
      } finally {
        if (mfaPending) setCode('');
        setIsSubmitting(false);
      }
    },
    [email, password, code, factorKind, mfaPending, isSubmitting, login, verifyFactor, t],
  );

  const handleRestartPassword = useCallback(() => {
    setError('');
    setPassword('');
    setCode('');
    setFactorKind('totp');
    restartPassword();
  }, [restartPassword]);

  const handleSwitchFactor = useCallback(() => {
    setError('');
    setCode('');
    setFactorKind((kind) => (kind === 'totp' ? 'recovery' : 'totp'));
  }, []);

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
  }, []);

  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  }, []);

  if (loading) {
    return <div className="loading-container">{t('common.loading')}</div>;
  }

  if (user) {
    return null; // Will redirect via useEffect
  }

  return (
    <main className="auth-container">
      <section className="auth-card" aria-labelledby="login-heading">
        <div className="auth-brand">Capital Tracker</div>
        <h1 id="login-heading">{t(mfaPending ? 'auth.confirmLogin' : 'auth.login')}</h1>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        {mfaPending ? (
          <form onSubmit={handleSubmit}>
            <p>
              {t(factorKind === 'totp' ? 'auth.authenticatorGuidance' : 'auth.recoveryGuidance')}
            </p>
            <div className="form-group">
              <label htmlFor="factor-code">
                {t(factorKind === 'totp' ? 'auth.authenticatorCode' : 'auth.recoveryCode')}
              </label>
              <input
                id="factor-code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode={factorKind === 'totp' ? 'numeric' : 'text'}
                pattern={factorKind === 'totp' ? '[0-9]{6}' : undefined}
                maxLength={factorKind === 'totp' ? 6 : 35}
                autoComplete={factorKind === 'totp' ? 'one-time-code' : 'off'}
                autoCapitalize="none"
                spellCheck={false}
                required
                disabled={isSubmitting}
              />
            </div>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.loading') : t('auth.confirm')}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleSwitchFactor}
              disabled={isSubmitting}
            >
              {t(factorKind === 'totp' ? 'auth.useRecoveryCode' : 'auth.useAuthenticator')}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleRestartPassword}
              disabled={isSubmitting}
            >
              {t('auth.backToPassword')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">{t('common.email')}</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={handleEmailChange}
                required
                autoComplete="email"
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group">
              <div className="form-group__label-row">
                <label htmlFor="password">{t('common.password')}</label>
                <Link className="auth-inline-link" to="/password-reset">
                  {t('auth.forgotPassword')}
                </Link>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={handlePasswordChange}
                required
                autoComplete="current-password"
                disabled={isSubmitting}
              />
            </div>

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.loading') : t('auth.login')}
            </button>
          </form>
        )}

        <p>{t('auth.ownerAccessGuidance')}</p>
      </section>
    </main>
  );
}
