import { useAuth } from '@contexts/AuthContext';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import './Auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, user, loading } = useAuth();
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
      setError('');
      setIsSubmitting(true);

      try {
        await login(email, password);
        navigate('/');
      } catch (err: any) {
        const errorMessage = err.response?.data?.message || t('auth.loginFailed');
        setError(errorMessage);
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, password, login, navigate, t],
  );

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
  }, []);

  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  }, []);

  // Check if error is email verification related
  const isEmailVerificationError =
    error.toLowerCase().includes('verify') || error.toLowerCase().includes('верифиц');

  if (loading) {
    return <div className="loading-container">{t('common.loading')}</div>;
  }

  if (user) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{t('auth.login')}</h1>

        {error && (
          <div className="error">
            {error}
            {isEmailVerificationError && (
              <div className="verification-link">
                <Link to="/resend-verification">{t('auth.resendVerificationLink')}</Link>
              </div>
            )}
          </div>
        )}

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
            <label htmlFor="password">{t('common.password')}</label>
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

          <div className="forgot-password-link">
            <Link to="/forgot-password">{t('auth.forgotPassword')}</Link>
          </div>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('common.loading') : t('auth.login')}
          </button>
        </form>

        <p className="auth-switch">
          {t('auth.dontHaveAccount')} <Link to="/register">{t('auth.register')}</Link>
        </p>
      </div>
    </div>
  );
}
