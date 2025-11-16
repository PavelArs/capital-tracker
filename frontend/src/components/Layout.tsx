import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import SubscriptionBadge from './SubscriptionBadge';
import './Layout.css';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="nav-brand">Capital Tracker</div>
        <div className="nav-links">
          <Link to="/">{t('navigation.dashboard')}</Link>
          <Link to="/assets">{t('navigation.assets')}</Link>
          <Link to="/liabilities">{t('navigation.liabilities')}</Link>
          <Link to="/crypto">{t('navigation.crypto')}</Link>
          <Link to="/settings">{t('navigation.settings')}</Link>
        </div>
        <div className="nav-user">
          <div className="nav-user-info">
            <span className="nav-user-email">{user?.email}</span>
            {user?.subscriptionType && (
              <SubscriptionBadge type={user.subscriptionType} />
            )}
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

