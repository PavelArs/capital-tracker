import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@contexts/AuthContext';
import './Auth.css';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register, user, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (!loading && user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  // Auto-redirect after successful registration
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
      setIsSubmitting(true);

      try {
        await register(email, password, firstName, lastName, invitationCode);
        setSuccess(true);
      } catch (err: any) {
        setError(err.response?.data?.message || t('auth.registrationFailed'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, password, firstName, lastName, invitationCode, register, t]
  );

  const handleInvitationCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInvitationCode(e.target.value.toUpperCase());
  }, []);

  if (loading) {
    return <div className="loading-container">{t('common.loading')}</div>;
  }

  if (user) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{t('auth.register')}</h1>

        {error && <div className="error">{error}</div>}

        {success && (
          <>
            <div className="success-message">
              <p>{t('auth.registrationSuccess')}</p>
              <p className="success-subtitle">{t('auth.checkEmailToVerify')}</p>
              <p className="success-redirect">{t('auth.redirectingToLogin')}</p>
            </div>
            <p className="resend-verification">
              {t('auth.didntReceiveEmail')}{' '}
              <Link to="/resend-verification">{t('auth.resendVerificationLink')}</Link>
            </p>
          </>
        )}

        {!success && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="invitationCode">{t('auth.invitationCode')}</label>
              <input
                id="invitationCode"
                type="text"
                value={invitationCode}
                onChange={handleInvitationCodeChange}
                required
                placeholder={t('auth.invitationCodePlaceholder')}
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">{t('common.email')}</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="firstName">{t('auth.firstName')}</label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="lastName">{t('auth.lastName')}</label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                disabled={isSubmitting}
              />
            </div>

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.loading') : t('auth.register')}
            </button>
          </form>
        )}

        <p className="auth-switch">
          {t('auth.alreadyHaveAccount')} <Link to="/login">{t('auth.login')}</Link>
        </p>
      </div>
    </div>
  );
}
