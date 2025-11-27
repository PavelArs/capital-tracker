import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@api';
import './Auth.css';

const REDIRECT_DELAY = 3000;

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const hasVerified = useRef(false);

  const token = searchParams.get('token');

  useEffect(() => {
    // Prevent double verification (React StrictMode or re-renders)
    if (hasVerified.current) return;
    hasVerified.current = true;

    const verifyEmail = async () => {
      if (!token) {
        setError(t('auth.invalidVerificationToken'));
        setLoading(false);
        return;
      }

      try {
        await authApi.verifyEmail(token);
        setSuccess(true);
        
        setTimeout(() => {
          navigate('/login');
        }, REDIRECT_DELAY);
      } catch (err: any) {
        setError(err.response?.data?.message || t('auth.emailVerificationFailed'));
      } finally {
        setLoading(false);
      }
    };

    verifyEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  if (loading) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>{t('auth.verifyingEmail')}</h1>
          <p className="loading-text">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{t('auth.emailVerification')}</h1>
        
        {success ? (
          <div className="success-message">
            <p>{t('auth.emailVerifiedSuccess')}</p>
            <p className="success-subtitle">{t('auth.redirectingToLogin')}</p>
          </div>
        ) : (
          <>
            <div className="error">{error}</div>
            <p className="auth-switch">
              <Link to="/login">{t('auth.backToLogin')}</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
