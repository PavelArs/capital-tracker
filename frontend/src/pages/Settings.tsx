import CurrenciesSection from '@components/CurrenciesSection';
import LanguageSwitcher from '@components/LanguageSwitcher';
import ThemeSwitcher from '@components/ThemeSwitcher';
import { DisplayFxPanel } from '@features/display-fx/DisplayFxPanel';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './Settings.css';

type SettingsSection = 'general' | 'currencies' | 'display-fx';

export default function Settings() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  const handleSectionChange = useCallback((section: SettingsSection) => {
    setActiveSection(section);
  }, []);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>{t('settings.title')}</h1>
        <p className="settings-description">
          Параметры интерфейса, видимость прежнего списка валют и справочные курсы USD.
        </p>
      </div>

      <div className="settings-container">
        <div className="settings-sidebar" role="group" aria-label="Разделы настроек">
          <button
            type="button"
            id="settings-general"
            aria-pressed={activeSection === 'general'}
            aria-controls="settings-panel"
            className={`settings-nav-btn ${activeSection === 'general' ? 'active' : ''}`}
            onClick={() => handleSectionChange('general')}
          >
            {t('settings.general')}
          </button>
          <button
            type="button"
            id="settings-currencies"
            aria-pressed={activeSection === 'currencies'}
            aria-controls="settings-panel"
            className={`settings-nav-btn ${activeSection === 'currencies' ? 'active' : ''}`}
            onClick={() => handleSectionChange('currencies')}
          >
            {t('settings.currencies')}
          </button>
          <button
            type="button"
            id="settings-display-fx"
            aria-pressed={activeSection === 'display-fx'}
            aria-controls="settings-panel"
            className={`settings-nav-btn ${activeSection === 'display-fx' ? 'active' : ''}`}
            onClick={() => handleSectionChange('display-fx')}
          >
            Курсы для отображения
          </button>
        </div>

        <div
          className="settings-content"
          id="settings-panel"
          role="region"
          aria-labelledby={`settings-${activeSection}`}
        >
          {activeSection === 'general' && (
            <div className="settings-section">
              <h2>{t('settings.general')}</h2>

              <div className="settings-group">
                <h3>
                  <label htmlFor="settings-language">{t('settings.language')}</label>
                </h3>
                <p className="settings-description">{t('settings.languageDescription')}</p>
                <div className="settings-control">
                  <LanguageSwitcher id="settings-language" />
                </div>
              </div>

              <div className="settings-group">
                <h3>
                  <label htmlFor="settings-theme">{t('settings.theme')}</label>
                </h3>
                <p className="settings-description">{t('settings.themeDescription')}</p>
                <div className="settings-control">
                  <ThemeSwitcher id="settings-theme" />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'currencies' && (
            <div className="settings-section">
              <p className="settings-legacy-note">
                Прежний список валют: настройки видимости. Учёт инструментов и справочный пересчёт
                USD ведутся отдельно.
              </p>
              <CurrenciesSection />
            </div>
          )}
          {activeSection === 'display-fx' && <DisplayFxPanel />}
        </div>
      </div>
    </div>
  );
}
