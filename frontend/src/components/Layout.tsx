import { useState, useRef, useEffect, useCallback } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@contexts/AuthContext';
import SubscriptionBadge from '@components/SubscriptionBadge';
import './Layout.css';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navLinksRef = useRef<HTMLDivElement>(null);
  const navUserRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  useEffect(() => {
    if (mobileMenuOpen && navLinksRef.current && navUserRef.current) {
      const updateNavUserPosition = () => {
        requestAnimationFrame(() => {
          const navLinksHeight = navLinksRef.current?.offsetHeight || 0;
          if (navUserRef.current && navLinksHeight > 0) {
            navUserRef.current.style.top = `calc(100% + ${navLinksHeight}px)`;
          }
        });
      };

      // Update position after a short delay to ensure nav-links is fully rendered
      const timeoutId = setTimeout(updateNavUserPosition, 50);

      // Update after transition completes
      const handleTransitionEnd = () => {
        updateNavUserPosition();
      };

      const navLinksElement = navLinksRef.current;
      navLinksElement.addEventListener('transitionend', handleTransitionEnd);

      // Also update on window resize
      window.addEventListener('resize', updateNavUserPosition);

      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', updateNavUserPosition);
        navLinksElement?.removeEventListener('transitionend', handleTransitionEnd);
      };
    } else if (navUserRef.current) {
      navUserRef.current.style.top = '';
    }
  }, [mobileMenuOpen]);

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="nav-brand">Capital Tracker</div>

        <button
          className="mobile-menu-toggle"
          onClick={toggleMobileMenu}
          aria-label="Toggle menu"
          aria-expanded={mobileMenuOpen}
        >
          <span />
          <span />
          <span />
        </button>

        <div ref={navLinksRef} className={`nav-links ${mobileMenuOpen ? 'open' : ''}`}>
          <Link to="/" onClick={closeMobileMenu}>
            {t('navigation.dashboard')}
          </Link>
          <Link to="/assets" onClick={closeMobileMenu}>
            {t('navigation.assets')}
          </Link>
          <Link to="/liabilities" onClick={closeMobileMenu}>
            {t('navigation.liabilities')}
          </Link>
          <Link to="/crypto" onClick={closeMobileMenu}>
            {t('navigation.crypto')}
          </Link>
          <Link to="/settings" onClick={closeMobileMenu}>
            {t('navigation.settings')}
          </Link>
        </div>

        <div ref={navUserRef} className={`nav-user ${mobileMenuOpen ? 'open' : ''}`}>
          <div className="nav-user-info">
            <span className="nav-user-email">{user?.email}</span>
            {user?.subscriptionType && <SubscriptionBadge type={user.subscriptionType} />}
          </div>
          <button onClick={handleLogout}>{t('auth.logout')}</button>
        </div>
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
