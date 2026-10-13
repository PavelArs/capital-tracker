import { setErrorHandler } from '@api';
import BootShell, { BootPage } from '@components/BootShell';
import Layout from '@components/Layout';
import ToastViewport from '@components/Toast';
import { AuthProvider, useAuth } from '@contexts/AuthContext';
import { ErrorProvider, useError } from '@contexts/ErrorContext';
import { ThemeProvider } from '@contexts/ThemeContext';
import DashboardPage from '@features/dashboard/DashboardPage';
import { retiredPaths } from '@features/shell/navigation';
import PageLoadBoundary from '@features/shell/PageLoadBoundary';
import { pages } from '@features/shell/route-pages';
import Login from '@pages/Login';
import React, { Suspense, useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';

const {
  portfolio: PortfolioPage,
  asset: AssetPage,
  transactions: TransactionsPage,
  wallets: WalletsPage,
  wallet: WalletPage,
  deposits: DepositsPage,
  deposit: DepositPage,
  realEstate: RealEstatePage,
  settings: SettingsPage,
  history: HistoryPage,
  forgotPassword: ForgotPasswordPage,
  resetPassword: ResetPasswordPage,
} = pages;

// A screen that is still being fetched shows the grey blocks of its layout inside the real frame;
// one that cannot be fetched says so there, and another path starts afresh.
function InFrame({ page }: { page: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <PageLoadBoundary resetKey={pathname}>
      <Suspense fallback={<BootPage />}>{page}</Suspense>
    </PageLoadBoundary>
  );
}
const inFrame = (page: React.ReactNode) => <InFrame page={page} />;

interface PrivateRouteProps {
  children: React.ReactNode;
}

function PrivateRoute({ children }: PrivateRouteProps) {
  const { user, loading } = useAuth();

  if (loading) return <BootShell />;

  return user ? <>{children}</> : <Navigate to="/login" />;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route
        path="/password-reset"
        element={
          <PageLoadBoundary>
            <Suspense fallback={null}>
              <ForgotPasswordPage />
            </Suspense>
          </PageLoadBoundary>
        }
      />
      <Route
        path="/password-reset/new"
        element={
          <PageLoadBoundary>
            <Suspense fallback={null}>
              <ResetPasswordPage />
            </Suspense>
          </PageLoadBoundary>
        }
      />

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
        <Route path="portfolio" element={inFrame(<PortfolioPage />)} />
        <Route path="portfolio/:assetId" element={inFrame(<AssetPage />)} />
        <Route path="transactions" element={inFrame(<TransactionsPage />)} />
        <Route path="wallets" element={inFrame(<WalletsPage />)} />
        <Route path="wallets/:accountId" element={inFrame(<WalletPage />)} />
        <Route path="deposits" element={inFrame(<DepositsPage />)} />
        <Route path="deposits/:depositId" element={inFrame(<DepositPage />)} />
        <Route path="real-estate" element={inFrame(<RealEstatePage />)} />
        <Route path="preferences" element={inFrame(<SettingsPage />)} />
        <Route path="history" element={inFrame(<HistoryPage />)} />
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
      <ToastViewport />
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
