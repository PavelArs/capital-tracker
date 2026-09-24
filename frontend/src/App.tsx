import { setErrorHandler } from '@api';
import ErrorNotification from '@components/ErrorNotification';
import Layout from '@components/Layout';
import { AuthProvider, useAuth } from '@contexts/AuthContext';
import { ErrorProvider, useError } from '@contexts/ErrorContext';
import { ThemeProvider } from '@contexts/ThemeContext';
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
import React, { useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';

interface PrivateRouteProps {
  children: React.ReactNode;
}

function PrivateRoute({ children }: PrivateRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-container">Loading...</div>;
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
        <Route index element={<Dashboard />} />
        <Route path="assets/*" element={<Assets />} />
        <Route path="liabilities/*" element={<RetiredLiabilities />} />
        <Route path="crypto" element={<Crypto />} />
        <Route path="settings" element={<Settings />} />
        <Route path="manual-accounts" element={<ManualAccounts />} />
        <Route path="manual-prices" element={<ManualPrices />} />
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
