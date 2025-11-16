import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ErrorProvider, useError } from "./contexts/ErrorContext";
import { setErrorHandler } from "./utils/axiosConfig";
import ErrorNotification from "./components/ErrorNotification";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Assets from "./pages/Assets";
import Liabilities from "./pages/Liabilities";
import Crypto from "./pages/Crypto";
import Currencies from "./pages/Currencies";
import Layout from "./components/Layout";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        Loading...
      </div>
    );
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
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
        <Route path="currencies" element={<Currencies />} />
      </Route>
    </Routes>
  );
}

function AppContent() {
  const { showError } = useError();

  // Set error handler for axios
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
    <ErrorProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorProvider>
  );
}

export default App;
