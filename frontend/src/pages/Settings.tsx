import { useState } from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeSwitcher from "../components/ThemeSwitcher";
import CurrenciesSection from "../components/CurrenciesSection";
import "./Settings.css";

export default function Settings() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<"general" | "currencies">("general");

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>{t('settings.title')}</h1>
      </div>

      <div className="settings-container">
        <div className="settings-sidebar">
          <button
            className={`settings-nav-btn ${activeSection === "general" ? "active" : ""}`}
            onClick={() => setActiveSection("general")}
          >
            {t('settings.general')}
          </button>
          <button
            className={`settings-nav-btn ${activeSection === "currencies" ? "active" : ""}`}
            onClick={() => setActiveSection("currencies")}
          >
            {t('settings.currencies')}
          </button>
        </div>

        <div className="settings-content">
          {activeSection === "general" && (
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

          {activeSection === "currencies" && (
            <div className="settings-section">
              <CurrenciesSection />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

