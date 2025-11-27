import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@api';
import './Auth.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Auto-redirect after success
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        navigate('/login');
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [success, navigate]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setSuccess(false);
      setLoading(true);

      try {
        await authApi.forgotPassword(email);
        setSuccess(true);
        setEmail('');
      } catch (err: any) {
        setError(err.response?.data?.message || t('auth.forgotPasswordFailed'));
      } finally {
        setLoading(false);
      }
    },
    [email, t]
  );

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
  }, []);

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{t('auth.forgotPassword')}</h1>

        {success ? (
          <div className="success-message">
            <p>{t('auth.resetLinkSent')}</p>
            <p className="success-subtitle">{t('auth.checkYourEmail')}</p>
            <p className="success-redirect">{t('auth.redirectingToLogin')}</p>
          </div>
        ) : (
          <>
            <p className="auth-description">{t('auth.forgotPasswordDescription')}</p>
            {error && <div className="error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">{t('common.email')}</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
              <button type="submit" disabled={loading}>
                {loading ? t('common.loading') : t('auth.sendResetLink')}
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
