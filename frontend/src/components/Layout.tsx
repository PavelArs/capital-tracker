import { useAuth } from '@contexts/AuthContext';
import { useError } from '@contexts/ErrorContext';
import { useAskedCurrency, withCurrency } from '@features/portfolio/currency';
import { AttentionProvider } from '@features/shell/attention-context';
import { BellSlotContext } from '@features/shell/bell-slot';
import { BrandMark, Icon } from '@features/shell/icons';
import { MainCurrencyProvider } from '@features/shell/main-currency';
import { appTitle, pageTitle, shellSections } from '@features/shell/navigation';
import { prefetchSection, warmPages } from '@features/shell/prefetch';
import SyncIndicator from '@features/shell/SyncIndicator';
import { useHeldClasses } from '@features/shell/useHeldClasses';
import { useNeedsClassification } from '@features/transactions/useNeedsClassification';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/onest';
import '@features/shell/tokens.css';
import './Layout.css';

export default function Layout() {
  const { user, logout } = useAuth();
  const { showError } = useError();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The header's display currency follows the owner from page to page.
  const [asked] = useAskedCurrency();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // CLS-COUNT: blockchain transactions waiting for an answer, next to Transactions.
  const toClassify = useNeedsClassification();
  // v8: Real estate (and later Brokers) appear once the owner holds something there.
  const held = useHeldClasses(pathname);
  const sections = shellSections.filter(
    (section) => !section.held || held.has(section.held) || pathname.startsWith(section.path),
  );
  const menuRef = useRef<HTMLDivElement>(null);
  // The other screens' files are fetched in the background once this one has settled.
  useEffect(() => warmPages(), []);
  const mainRef = useRef<HTMLElement>(null);
  // PHONE-BELL: where the page header draws the notifications bell on a phone.
  const [bellSlot, setBellSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    document.title = pageTitle(pathname);
  }, [pathname]);
  // Signed out, the tab names only the app again.
  useEffect(
    () => () => {
      document.title = appTitle;
    },
    [],
  );

  // Phones show the sections as a swipeable strip: keep the current one in view, also after a
  // turn of the device and when a held section arrives before it (shell-05).
  const sectionPaths = sections.map((section) => section.path).join(' ');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path and the listed sections decide where the current link is.
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
  }, [pathname, sectionPaths]);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      showError(
        isAxiosError(error) && error.response?.status === 403
          ? 'Your session has changed. Please try again.'
          : 'Unable to log out. Please try again.',
      );
    } finally {
      setIsLoggingOut(false);
    }
  }, [logout, navigate, showError]);

  function followLink() {
    mainRef.current?.focus();
  }

  const email = user?.email ?? '';

  return (
    <BellSlotContext.Provider value={bellSlot}>
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
              {sections.map((section) => (
                <li key={section.path}>
                  <NavLink
                    to={withCurrency(section.path, asked)}
                    onClick={followLink}
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'mouse') prefetchSection(section.path, asked);
                    }}
                    onPointerDown={() => prefetchSection(section.path, asked)}
                    onFocus={() => prefetchSection(section.path, asked)}
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
                  </NavLink>
                </li>
              ))}
            </ul>
            <SyncIndicator onFollow={followLink} />
          </div>
          <div className="shell-owner">
            <div className="shell-owner__bell" ref={setBellSlot} />
            <span className="shell-owner__avatar" aria-hidden="true">
              {email.charAt(0).toUpperCase()}
            </span>
            <span className="shell-owner__who">
              <span className="shell-owner__name" title={email}>
                Owner
              </span>
              <small>2FA on</small>
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
    </BellSlotContext.Provider>
  );
}
