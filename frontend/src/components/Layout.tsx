import { useAuth } from '@contexts/AuthContext';
import { useError } from '@contexts/ErrorContext';
import { BrandMark, Icon } from '@features/shell/icons';
import { isLegacyPath, legacyLinks, shellSections } from '@features/shell/navigation';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import '@features/shell/tokens.css';
import './Layout.css';

export default function Layout() {
  const { user, logout } = useAuth();
  const { showError } = useError();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Open by default: the owner still works in these screens until they are replaced.
  const [legacyOpen, setLegacyOpen] = useState(true);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
    if (isLegacyPath(pathname)) setLegacyOpen(true);
  }, [pathname]);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      showError(
        isAxiosError(error) && error.response?.status === 403
          ? t('auth.sessionExpired')
          : t('auth.logoutFailed'),
      );
    } finally {
      setIsLoggingOut(false);
    }
  }, [logout, navigate, showError, t]);

  function followLink() {
    setMobileMenuOpen(false);
    mainRef.current?.focus();
  }

  const email = user?.email ?? '';

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <nav
        className="shell-nav"
        aria-label="Main navigation"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && mobileMenuOpen) {
            event.preventDefault();
            setMobileMenuOpen(false);
            menuToggleRef.current?.focus();
          }
        }}
      >
        <div className="shell-nav__header">
          <div className="shell-brand">
            <BrandMark />
            Capital
          </div>
          <button
            ref={menuToggleRef}
            type="button"
            className="shell-nav__toggle"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-expanded={mobileMenuOpen}
            aria-controls="application-menu"
          >
            Menu
          </button>
        </div>
        <div id="application-menu" className={`shell-nav__menu${mobileMenuOpen ? ' is-open' : ''}`}>
          <ul className="shell-nav__sections" data-nav-group="sections">
            {shellSections.map((section) => (
              <li key={section.path}>
                <NavLink to={section.path} onClick={followLink}>
                  <Icon name={section.icon} />
                  {section.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <details
            className="shell-nav__legacy"
            open={legacyOpen}
            onToggle={(event) => setLegacyOpen(event.currentTarget.open)}
          >
            <summary>Legacy</summary>
            <ul>
              {legacyLinks.map(([path, label]) => (
                <li key={path}>
                  <NavLink to={path} onClick={followLink}>
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </details>
          <div className="shell-sync" data-sync-status>
            <span className="shell-sync__dot" aria-hidden="true" />
            <span>
              <b>Sync not set up</b>
              Automatic updates come in a later step
            </span>
          </div>
        </div>
        <div className="shell-owner">
          <span className="shell-owner__avatar" aria-hidden="true">
            {email.charAt(0).toUpperCase()}
          </span>
          <span className="shell-owner__who">
            <span className="shell-owner__email" title={email}>
              {email}
            </span>
            <small>Owner · 2FA on</small>
          </span>
          <button
            type="button"
            className="shell-owner__logout"
            onClick={handleLogout}
            disabled={isLoggingOut}
            aria-label="Log out"
            title="Log out"
          >
            <Icon name="logout" />
          </button>
        </div>
      </nav>
      <main id="main-content" ref={mainRef} className="shell-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
