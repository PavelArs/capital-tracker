import { useAuth } from '@contexts/AuthContext';
import { useError } from '@contexts/ErrorContext';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import './Layout.css';

const accountingLinks = [
  ['/manual-accounts', 'Ручные счета'],
  ['/owned-transfers', 'Переводы между счетами'],
  ['/capital-flows', 'Вводы и выводы'],
  ['/manual-prices', 'Ручные цены'],
  ['/wallet-addresses', 'Адреса кошельков'],
  ['/period-profit', 'Прибыль за период'],
  ['/settings', 'Настройки'],
] as const;

const legacyLinks = [
  ['/legacy-overview', 'Прежний обзор'],
  ['/assets', 'Активы'],
  ['/crypto', 'Криптокошельки'],
] as const;

function isLegacyPath(pathname: string) {
  return legacyLinks.some(([path]) => pathname === path || pathname.startsWith(`${path}/`));
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { showError } = useError();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(() => isLegacyPath(pathname));
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

  return (
    <div className="layout">
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <nav
        className="app-navigation"
        aria-label="Основная навигация"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && mobileMenuOpen) {
            event.preventDefault();
            setMobileMenuOpen(false);
            menuToggleRef.current?.focus();
          }
        }}
      >
        <div className="app-navigation__header">
          <div className="app-navigation__identity">
            <div className="app-navigation__brand">Capital Tracker</div>
            <div className="app-navigation__email">{user?.email}</div>
          </div>
          <button
            ref={menuToggleRef}
            type="button"
            className="app-navigation__toggle"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-expanded={mobileMenuOpen}
            aria-controls="application-menu"
          >
            Меню
          </button>
        </div>
        <div
          id="application-menu"
          className={`app-navigation__menu${mobileMenuOpen ? ' is-open' : ''}`}
        >
          <p className="app-navigation__label">Учет капитала</p>
          <ul className="app-navigation__links">
            {accountingLinks.map(([path, label]) => (
              <li key={path}>
                <NavLink to={path} onClick={followLink}>
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
          <details
            className="app-navigation__legacy"
            open={legacyOpen}
            onToggle={(event) => setLegacyOpen(event.currentTarget.open)}
          >
            <summary>Прежние данные</summary>
            <ul className="app-navigation__links">
              {legacyLinks.map(([path, label]) => (
                <li key={path}>
                  <NavLink to={path} onClick={followLink}>
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </details>
          <div className="app-navigation__session">
            <button type="button" onClick={handleLogout} disabled={isLoggingOut}>
              {isLoggingOut ? t('common.loading') : t('auth.logout')}
            </button>
          </div>
        </div>
      </nav>
      <main id="main-content" ref={mainRef} className="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
