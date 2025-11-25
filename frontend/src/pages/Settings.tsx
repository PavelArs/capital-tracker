import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeSwitcher from "../components/ThemeSwitcher";
import CurrenciesSection from "../components/CurrenciesSection";
import LoadingButton from "../components/LoadingButton";
import Skeleton from "../components/Skeleton";
import "./Settings.css";

interface InvitationCode {
  id: string;
  code: string;
  isUsed: boolean;
  usedAt: Date | null;
  createdAt: Date;
}

export default function Settings() {
  const { t } = useTranslation();
  const { user, generateInvitationCode, getMyInvitationCode } = useAuth();
  const [activeSection, setActiveSection] = useState<
    "general" | "currencies" | "invitation"
  >("general");
  const [invitationCode, setInvitationCode] = useState<InvitationCode | null>(
    null
  );
  const [loadingCode, setLoadingCode] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [error, setError] = useState("");

  const isFreeUser = user?.subscriptionType === 'free';

  useEffect(() => {
    if (activeSection === "invitation") {
      loadInvitationCode();
    }
  }, [activeSection]);

  const loadInvitationCode = async () => {
    setLoadingCode(true);
    try {
      const code = await getMyInvitationCode();
      setInvitationCode(code);
    } catch (err) {
      console.error("Failed to load invitation code:", err);
    } finally {
      setLoadingCode(false);
    }
  };

  const handleGenerateCode = async () => {
    setGeneratingCode(true);
    setError("");
    try {
      const newCode = await generateInvitationCode();
      setInvitationCode(newCode);
    } catch (err: any) {
      setError(
        err.response?.data?.message || t("settings.invitationCodeGenerateError")
      );
    } finally {
      setGeneratingCode(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>{t("settings.title")}</h1>
      </div>

      <div className="settings-container">
        <div className="settings-sidebar">
          <button
            className={`settings-nav-btn ${
              activeSection === "general" ? "active" : ""
            }`}
            onClick={() => setActiveSection("general")}
          >
            {t("settings.general")}
          </button>
          <button
            className={`settings-nav-btn ${
              activeSection === "currencies" ? "active" : ""
            }`}
            onClick={() => setActiveSection("currencies")}
          >
            {t("settings.currencies")}
          </button>
          <button
            className={`settings-nav-btn ${
              activeSection === "invitation" ? "active" : ""
            }`}
            onClick={() => setActiveSection("invitation")}
          >
            {t("settings.invitationCode")}
          </button>
        </div>

        <div className="settings-content">
          {activeSection === "general" && (
            <div className="settings-section">
              <h2>{t("settings.general")}</h2>

              <div className="settings-group">
                <h3>{t("settings.language")}</h3>
                <p className="settings-description">
                  {t("settings.languageDescription")}
                </p>
                <div className="settings-control">
                  <LanguageSwitcher />
                </div>
              </div>

              <div className="settings-group">
                <h3>{t("settings.theme")}</h3>
                <p className="settings-description">
                  {t("settings.themeDescription")}
                </p>
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

          {activeSection === "invitation" && (
            <div className="settings-section">
              <h2>{t("settings.invitationCode")}</h2>

              <div className="settings-group">
                <h3>{t("settings.yourInvitationCode")}</h3>
                <p className="settings-description">
                  {t("settings.invitationCodeDescription")}
                </p>

                {isFreeUser && (
                  <div
                    className="info-box"
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      backgroundColor: "var(--primary-color-light, #e3f2fd)",
                      color: "var(--text-color)",
                      borderRadius: "8px",
                      border: "1px solid var(--primary-color, #2196F3)",
                    }}
                  >
                    <strong>🎁 {t("settings.proFeature")}</strong>
                    <p style={{ marginTop: "0.5rem", marginBottom: "0" }}>
                      {t("settings.invitationCodeProOnly")}
                    </p>
                  </div>
                )}

                {error && (
                  <div
                    className="error"
                    style={{
                      marginBottom: "1rem",
                      padding: "0.75rem",
                      backgroundColor: "var(--error-bg, #fee)",
                      color: "var(--error-color, #c33)",
                      borderRadius: "4px",
                    }}
                  >
                    {error}
                  </div>
                )}

                {!isFreeUser && loadingCode ? (
                  <div>
                    <Skeleton width="100%" height="48px" variant="rounded" />
                    <div style={{ marginTop: "1rem" }}>
                      <Skeleton width="150px" height="24px" />
                    </div>
                  </div>
                ) : !isFreeUser && invitationCode ? (
                  <div>
                    <div className="invitation-code-display">
                      <div className="code-box">
                        <code>{invitationCode.code}</code>
                      </div>
                      <button
                        className="copy-btn"
                        onClick={() => copyToClipboard(invitationCode.code)}
                      >
                        {t("common.copy")}
                      </button>
                    </div>
                    <div
                      className={`code-status ${
                        invitationCode.isUsed ? "used" : "active"
                      }`}
                    >
                      {invitationCode.isUsed ? (
                        <span>
                          ✓ {t("settings.codeUsed")}
                          {invitationCode.usedAt && (
                            <span className="used-date">
                              {" "}
                              (
                              {new Date(
                                invitationCode.usedAt
                              ).toLocaleDateString()}
                              )
                            </span>
                          )}
                        </span>
                      ) : (
                        <span>● {t("settings.codeActive")}</span>
                      )}
                    </div>
                  </div>
                ) : !isFreeUser ? (
                  <div>
                    <p
                      style={{
                        marginBottom: "1rem",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {t("settings.noInvitationCode")}
                    </p>
                    <LoadingButton
                      className="generate-btn"
                      onClick={handleGenerateCode}
                      loading={generatingCode}
                      loadingText={t("common.loading")}
                    >
                      {t("settings.generateInvitationCode")}
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
