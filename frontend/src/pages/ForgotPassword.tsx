import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import './Auth.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    try {
      await axios.post(`${API_URL}/auth/forgot-password`, { email });
      setSuccess(true);
      setEmail('');
    } catch (err: any) {
      setError(err.response?.data?.message || t('auth.forgotPasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{t('auth.forgotPassword')}</h1>
        
        {success ? (
          <div className="success-message">
            <p>{t('auth.resetLinkSent')}</p>
            <p style={{ fontSize: '14px', marginTop: '10px' }}>
              {t('auth.checkYourEmail')}
            </p>
          </div>
        ) : (
          <>
            <p style={{ marginBottom: '20px', color: 'var(--text-secondary)' }}>
              {t('auth.forgotPasswordDescription')}
            </p>
            {error && <div className="error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>{t('common.email')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <button type="submit" disabled={loading}>
                {loading ? t('common.loading') : t('auth.sendResetLink')}
              </button>
            </form>
          </>
        )}
        
        <p style={{ marginTop: '20px' }}>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}

