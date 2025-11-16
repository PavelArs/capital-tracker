import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Layout.css';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="nav-brand">Capital Tracker</div>
        <div className="nav-links">
          <Link to="/">Dashboard</Link>
          <Link to="/assets">Assets</Link>
          <Link to="/liabilities">Liabilities</Link>
          <Link to="/crypto">Crypto</Link>
          <Link to="/currencies">Currencies</Link>
        </div>
        <div className="nav-user">
          <span>{user?.email}</span>
          <button onClick={handleLogout}>Logout</button>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

