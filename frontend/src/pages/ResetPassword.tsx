import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@api';
import './Auth.css';

const MIN_PASSWORD_LENGTH = 6;
const REDIRECT_DELAY = 2000;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError(t('auth.invalidResetToken'));
    }
  }, [token, t]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(t('auth.passwordTooShort'));
        return;
      }

      if (password !== confirmPassword) {
        setError(t('auth.passwordsDoNotMatch'));
        return;
      }

      if (!token) {
        setError(t('auth.invalidResetToken'));
        return;
      }

      setLoading(true);

      try {
        await authApi.resetPassword(token, password);
        setSuccess(true);

        setTimeout(() => {
          navigate('/login');
        }, REDIRECT_DELAY);
      } catch (err: any) {
        setError(err.response?.data?.message || t('auth.resetPasswordFailed'));
      } finally {
        setLoading(false);
      }
    },
    [password, confirmPassword, token, navigate, t]
  );

  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  }, []);

  const handleConfirmPasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setConfirmPassword(e.target.value);
  }, []);

  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>{t('auth.resetPassword')}</h1>
          <div className="error">{t('auth.invalidResetToken')}</div>
          <p className="auth-switch">
            <Link to="/forgot-password">{t('auth.requestNewLink')}</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{t('auth.resetPassword')}</h1>

        {success ? (
          <div className="success-message">
            <p>{t('auth.passwordResetSuccess')}</p>
            <p className="success-subtitle">{t('auth.redirectingToLogin')}</p>
          </div>
        ) : (
          <>
            {error && <div className="error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="password">{t('auth.newPassword')}</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={handlePasswordChange}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label htmlFor="confirmPassword">{t('auth.confirmPassword')}</label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={handleConfirmPasswordChange}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
              <button type="submit" disabled={loading}>
                {loading ? t('common.loading') : t('auth.resetPassword')}
              </button>
            </form>
          </>
        )}

        <p className="auth-switch">
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}
