import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@contexts/AuthContext';
import { ErrorProvider, useError } from '@contexts/ErrorContext';
import { ThemeProvider } from '@contexts/ThemeContext';
import { setErrorHandler } from '@api';
import ErrorNotification from '@components/ErrorNotification';
import Login from '@pages/Login';
import Register from '@pages/Register';
import ForgotPassword from '@pages/ForgotPassword';
import ResetPassword from '@pages/ResetPassword';
import VerifyEmail from '@pages/VerifyEmail';
import ResendVerification from '@pages/ResendVerification';
import Dashboard from '@pages/Dashboard';
import Assets from '@pages/Assets';
import Liabilities from '@pages/Liabilities';
import Crypto from '@pages/Crypto';
import Metrics from '@pages/Metrics';
import Settings from '@pages/Settings';
import Subscriptions from '@pages/Subscriptions';
import Layout from '@components/Layout';

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
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/resend-verification" element={<ResendVerification />} />

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
        <Route path="liabilities" element={<Liabilities />} />
        <Route path="crypto" element={<Crypto />} />
        <Route path="metrics" element={<Metrics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="subscriptions" element={<Subscriptions />} />
      </Route>
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
