import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import './Auth.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
        await axios.post(`${API_URL}/auth/verify-email`, { token });
        setSuccess(true);
        
        // Redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/login');
        }, 3000);
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
          <p>{t('common.loading')}</p>
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
            <p style={{ fontSize: '14px', marginTop: '10px' }}>
              {t('auth.redirectingToLogin')}
            </p>
          </div>
        ) : (
          <>
            <div className="error">{error}</div>
            <p style={{ marginTop: '20px' }}>
              <Link to="/login">{t('auth.backToLogin')}</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

