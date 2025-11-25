import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import './Auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (!loading && user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || t('auth.loginFailed');
      setError(errorMessage);
    }
  };

  // Check if error is email verification related
  const isEmailVerificationError = error.toLowerCase().includes('verify') || error.toLowerCase().includes('верифиц');


  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>{t('common.loading')}</div>;
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
              <div style={{ marginTop: '10px', fontSize: '14px' }}>
                <Link to="/resend-verification" style={{ color: 'white', textDecoration: 'underline' }}>
                  {t('auth.resendVerificationLink')}
                </Link>
              </div>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit}>
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
            />
          </div>
          <div style={{ textAlign: 'right', marginBottom: '10px' }}>
            <Link to="/forgot-password" style={{ fontSize: '14px' }}>
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <button type="submit">{t('auth.login')}</button>
        </form>
        <p>
          {t('auth.dontHaveAccount')} <Link to="/register">{t('auth.register')}</Link>
        </p>
      </div>
    </div>
  );
}

