import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    try {
      await register(email, password, firstName, lastName, invitationCode);
      setSuccess(true);
      // Auto-redirect after 3 seconds
    } catch (err: any) {
      setError(err.response?.data?.message || t('auth.registrationFailed'));
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>{t('common.loading')}</div>;
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
              <p style={{ fontSize: '14px', marginTop: '10px' }}>
                {t('auth.checkEmailToVerify')}
              </p>
              <p style={{ fontSize: '14px', marginTop: '10px', opacity: 0.8 }}>
                {t('auth.redirectingToLogin')}
              </p>
            </div>
            <p style={{ marginTop: '15px', fontSize: '14px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              {t('auth.didntReceiveEmail')} <Link to="/resend-verification">{t('auth.resendVerificationLink')}</Link>
            </p>
          </>
        )}
        {!success && <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('auth.invitationCode')}</label>
            <input
              type="text"
              value={invitationCode}
              onChange={(e) => setInvitationCode(e.target.value.toUpperCase())}
              required
              placeholder={t('auth.invitationCodePlaceholder')}
            />
          </div>
          <div className="form-group">
            <label>{t('common.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('common.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <div className="form-group">
            <label>{t('auth.firstName')}</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>{t('auth.lastName')}</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <button type="submit">{t('auth.register')}</button>
        </form>}
        <p style={{ marginTop: '20px' }}>
          {t('auth.alreadyHaveAccount')} <Link to="/login">{t('auth.login')}</Link>
        </p>
      </div>
    </div>
  );
}

