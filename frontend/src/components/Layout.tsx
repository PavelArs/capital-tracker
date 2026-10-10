import { useAuth } from '@contexts/AuthContext';
import { useError } from '@contexts/ErrorContext';
import { useAskedCurrency, withCurrency } from '@features/portfolio/currency';
import { AttentionProvider } from '@features/shell/attention-context';
import { BrandMark, Icon } from '@features/shell/icons';
import { MainCurrencyProvider } from '@features/shell/main-currency';
import { isOlderScreenPath, shellSections } from '@features/shell/navigation';
import SyncIndicator from '@features/shell/SyncIndicator';
import { useNeedsClassification } from '@features/transactions/useNeedsClassification';
import { isAxiosError } from 'axios';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/onest';
import '@features/shell/tokens.css';
import './Layout.css';

/** A section link; `current` marks it on a page that belongs to the section without being it. */
function SectionLink({
  to,
  current,
  onClick,
  children,
}: {
  to: string;
  current: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return current ? (
    <Link to={to} aria-current="page" onClick={onClick}>
      {children}
    </Link>
  ) : (
    <NavLink to={to} onClick={onClick}>
      {children}
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { showError } = useError();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The header's display currency follows the owner from page to page.
  const [asked] = useAskedCurrency();
  const { t } = useTranslation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // CLS-COUNT: blockchain transactions waiting for an answer, next to Transactions.
  const toClassify = useNeedsClassification();
  const menuRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Phones show the sections as a swipeable strip: keep the current one in view, also after a
  // turn of the device.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path decides which link is current.
  useEffect(() => {
    const center = () => {
      const strip = menuRef.current;
      const current = strip?.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!strip || !current || strip.scrollWidth <= strip.clientWidth) return;
      strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
    };
    center();
    window.addEventListener('resize', center);
    return () => window.removeEventListener('resize', center);
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
    mainRef.current?.focus();
  }

  const email = user?.email ?? '';

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <nav className="shell-nav" aria-label="Main navigation">
        <div className="shell-nav__header">
          <div className="shell-brand">
            <BrandMark />
            Capital
          </div>
        </div>
        <div id="application-menu" ref={menuRef} className="shell-nav__menu">
          <ul className="shell-nav__sections" data-nav-group="sections">
            {shellSections.map((section) => (
              <li key={section.path}>
                <SectionLink
                  to={withCurrency(section.path, asked)}
                  // The older screens Settings lists are part of it.
                  current={section.path === '/preferences' && isOlderScreenPath(pathname)}
                  onClick={followLink}
                >
                  <Icon name={section.icon} />
                  {section.label}
                  {section.path === '/transactions' && toClassify !== null && toClassify > 0 && (
                    <span
                      className="shell-nav__count"
                      title={`${toClassify} to classify`}
                      aria-label={`${toClassify} to classify`}
                    >
                      {toClassify}
                    </span>
                  )}
                </SectionLink>
              </li>
            ))}
          </ul>
          <SyncIndicator onFollow={followLink} />
        </div>
        <div className="shell-owner">
          <span className="shell-owner__avatar" aria-hidden="true" title={email}>
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
        <MainCurrencyProvider>
          <AttentionProvider>
            <Outlet />
          </AttentionProvider>
        </MainCurrencyProvider>
      </main>
    </div>
  );
}
