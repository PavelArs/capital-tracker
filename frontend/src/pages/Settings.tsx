import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@contexts/AuthContext';
import type { InvitationCode } from '@shared/types';
import LanguageSwitcher from '@components/LanguageSwitcher';
import ThemeSwitcher from '@components/ThemeSwitcher';
import CurrenciesSection from '@components/CurrenciesSection';
import LoadingButton from '@components/LoadingButton';
import Skeleton from '@components/Skeleton';
import './Settings.css';

type SettingsSection = 'general' | 'currencies' | 'invitation';

export default function Settings() {
  const { t } = useTranslation();
  const { user, generateInvitationCode, getMyInvitationCode } = useAuth();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [invitationCode, setInvitationCode] = useState<InvitationCode | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [error, setError] = useState('');

  const isFreeUser = user?.subscriptionType === 'free';

  const loadInvitationCode = useCallback(async () => {
    setLoadingCode(true);
    try {
      const code = await getMyInvitationCode();
      setInvitationCode(code);
    } catch (err) {
      console.error('Failed to load invitation code:', err);
    } finally {
      setLoadingCode(false);
    }
  }, [getMyInvitationCode]);

  useEffect(() => {
    if (activeSection === 'invitation') {
      loadInvitationCode();
    }
  }, [activeSection, loadInvitationCode]);

  const handleGenerateCode = useCallback(async () => {
    setGeneratingCode(true);
    setError('');
    try {
      const newCode = await generateInvitationCode();
      setInvitationCode(newCode);
    } catch (err: any) {
      setError(err.response?.data?.message || t('settings.invitationCodeGenerateError'));
    } finally {
      setGeneratingCode(false);
    }
  }, [generateInvitationCode, t]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleSectionChange = useCallback((section: SettingsSection) => {
    setActiveSection(section);
  }, []);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>{t('settings.title')}</h1>
      </div>

      <div className="settings-container">
        <div className="settings-sidebar">
          <button
            className={`settings-nav-btn ${activeSection === 'general' ? 'active' : ''}`}
            onClick={() => handleSectionChange('general')}
          >
            {t('settings.general')}
          </button>
          <button
            className={`settings-nav-btn ${activeSection === 'currencies' ? 'active' : ''}`}
            onClick={() => handleSectionChange('currencies')}
          >
            {t('settings.currencies')}
          </button>
          <button
            className={`settings-nav-btn ${activeSection === 'invitation' ? 'active' : ''}`}
            onClick={() => handleSectionChange('invitation')}
          >
            {t('settings.invitationCode')}
          </button>
        </div>

        <div className="settings-content">
          {activeSection === 'general' && (
            <div className="settings-section">
              <h2>{t('settings.general')}</h2>

              <div className="settings-group">
                <h3>{t('settings.language')}</h3>
                <p className="settings-description">{t('settings.languageDescription')}</p>
                <div className="settings-control">
                  <LanguageSwitcher />
                </div>
              </div>

              <div className="settings-group">
                <h3>{t('settings.theme')}</h3>
                <p className="settings-description">{t('settings.themeDescription')}</p>
                <div className="settings-control">
                  <ThemeSwitcher />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'currencies' && (
            <div className="settings-section">
              <CurrenciesSection />
            </div>
          )}

          {activeSection === 'invitation' && (
            <div className="settings-section">
              <h2>{t('settings.invitationCode')}</h2>

              <div className="settings-group">
                <h3>{t('settings.yourInvitationCode')}</h3>
                <p className="settings-description">{t('settings.invitationCodeDescription')}</p>

                {isFreeUser && (
                  <div className="info-box">
                    <strong>🎁 {t('settings.proFeature')}</strong>
                    <p>{t('settings.invitationCodeProOnly')}</p>
                  </div>
                )}

                {error && <div className="error-box">{error}</div>}

                {!isFreeUser && loadingCode ? (
                  <div className="invitation-loading">
                    <Skeleton width="100%" height="48px" variant="rounded" />
                    <div className="invitation-loading-status">
                      <Skeleton width="150px" height="24px" />
                    </div>
                  </div>
                ) : !isFreeUser && invitationCode ? (
                  <div className="invitation-code-section">
                    <div className="invitation-code-display">
                      <div className="code-box">
                        <code>{invitationCode.code}</code>
                      </div>
                      <button
                        className="copy-btn"
                        onClick={() => copyToClipboard(invitationCode.code)}
                      >
                        {t('common.copy')}
                      </button>
                    </div>
                    <div className={`code-status ${invitationCode.isUsed ? 'used' : 'active'}`}>
                      {invitationCode.isUsed ? (
                        <span>
                          ✓ {t('settings.codeUsed')}
                          {invitationCode.usedAt && (
                            <span className="used-date">
                              {' '}
                              ({new Date(invitationCode.usedAt).toLocaleDateString()})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span>● {t('settings.codeActive')}</span>
                      )}
                    </div>
                  </div>
                ) : !isFreeUser ? (
                  <div className="no-invitation-code">
                    <p className="no-code-message">{t('settings.noInvitationCode')}</p>
                    <LoadingButton
                      className="generate-btn"
                      onClick={handleGenerateCode}
                      loading={generatingCode}
                      loadingText={t('common.loading')}
                    >
                      {t('settings.generateInvitationCode')}
                    </LoadingButton>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
