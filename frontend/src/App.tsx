import { setErrorHandler } from '@api';
import ErrorNotification from '@components/ErrorNotification';
import Layout from '@components/Layout';
import { AuthProvider, useAuth } from '@contexts/AuthContext';
import { ErrorProvider, useError } from '@contexts/ErrorContext';
import { ThemeProvider } from '@contexts/ThemeContext';
import DashboardPage from '@features/dashboard/DashboardPage';
import ForgotPasswordPage from '@features/password-reset/ForgotPasswordPage';
import ResetPasswordPage from '@features/password-reset/ResetPasswordPage';
import AssetPage from '@features/portfolio/AssetPage';
import PortfolioPage from '@features/portfolio/PortfolioPage';
import { retiredPaths } from '@features/shell/navigation';
import SettingsPage from '@features/shell/SettingsPage';
import TransactionsPage from '@features/transactions/TransactionsPage';
import WalletPage from '@features/wallets/WalletPage';
import WalletsPage from '@features/wallets/WalletsPage';
import Login from '@pages/Login';
import ManualAccountDetail from '@pages/ManualAccountDetail';
import ManualAccounts from '@pages/ManualAccounts';
import ManualPrices from '@pages/ManualPrices';
import React, { useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';

interface PrivateRouteProps {
  children: React.ReactNode;
}

function PrivateRoute({ children }: PrivateRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-container" role="status">
        Загрузка…
      </div>
    );
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/password-reset" element={<ForgotPasswordPage />} />
      <Route path="/password-reset/new" element={<ResetPasswordPage />} />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="portfolio" element={<PortfolioPage />} />
        <Route path="portfolio/:assetId" element={<AssetPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="wallets" element={<WalletsPage />} />
        <Route path="wallets/:accountId" element={<WalletPage />} />
        <Route path="preferences" element={<SettingsPage />} />
        <Route path="manual-accounts" element={<ManualAccounts />} />
        <Route path="manual-accounts/:id" element={<ManualAccountDetail />} />
        <Route path="manual-prices" element={<ManualPrices />} />
        {retiredPaths.map(([from, to]) => (
          <Route key={from} path={`${from.slice(1)}/*`} element={<Navigate to={to} replace />} />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function AppContent() {
  const { showError } = useError();

  // Set error handler for axios interceptors
  useEffect(() => {
    setErrorHandler(showError);
  }, [showError]);

  return (
    <>
      <ErrorNotification />
      <Router>
        <AppRoutes />
      </Router>
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ErrorProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ErrorProvider>
    </ThemeProvider>
  );
}

export default App;
