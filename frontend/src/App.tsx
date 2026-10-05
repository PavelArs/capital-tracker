import { setErrorHandler } from '@api';
import ErrorNotification from '@components/ErrorNotification';
import Layout from '@components/Layout';
import { AuthProvider, useAuth } from '@contexts/AuthContext';
import { ErrorProvider, useError } from '@contexts/ErrorContext';
import { ThemeProvider } from '@contexts/ThemeContext';
import DashboardPage from '@features/dashboard/DashboardPage';
import AssetPage from '@features/portfolio/AssetPage';
import PortfolioPage from '@features/portfolio/PortfolioPage';
import SectionPlaceholder from '@features/shell/SectionPlaceholder';
import SettingsPage from '@features/shell/SettingsPage';
import TransactionsPage from '@features/transactions/TransactionsPage';
import Assets from '@pages/Assets';
import CapitalFlows from '@pages/CapitalFlows';
import Crypto from '@pages/Crypto';
import Dashboard from '@pages/Dashboard';
import Login from '@pages/Login';
import ManualAccountDetail from '@pages/ManualAccountDetail';
import ManualAccounts from '@pages/ManualAccounts';
import ManualPrices from '@pages/ManualPrices';
import PeriodProfit from '@pages/PeriodProfit';
import RetiredLiabilities from '@pages/RetiredLiabilities';
import Settings from '@pages/Settings';
import WalletAddresses from '@pages/WalletAddresses';
import React, { useEffect } from 'react';
import { Link, Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import OwnedTransfers from './features/accounting/OwnedTransfers';

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
        <Route path="wallets" element={<SectionPlaceholder section="wallets" />} />
        <Route path="preferences" element={<SettingsPage />} />
        <Route
          path="legacy-overview"
          element={
            <>
              <aside className="legacy-scope-note" role="note" aria-label="Область прежнего обзора">
                Этот обзор показывает прежние активы и кошельки и не включает ручные счета. Для
                учета операций и оценки перейдите в <Link to="/manual-accounts">ручные счета</Link>.
              </aside>
              <Dashboard />
            </>
          }
        />
        <Route path="assets/*" element={<Assets />} />
        <Route path="liabilities/*" element={<RetiredLiabilities />} />
        <Route path="crypto" element={<Crypto />} />
        <Route path="settings" element={<Settings />} />
        <Route path="manual-accounts" element={<ManualAccounts />} />
        <Route path="owned-transfers" element={<OwnedTransfers />} />
        <Route path="manual-prices" element={<ManualPrices />} />
        <Route path="wallet-addresses" element={<WalletAddresses />} />
        <Route path="capital-flows" element={<CapitalFlows />} />
        <Route path="period-profit" element={<PeriodProfit />} />
        <Route path="manual-accounts/:id" element={<ManualAccountDetail />} />
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
