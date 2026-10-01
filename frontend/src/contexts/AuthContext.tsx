import { authApi } from '@api';
import { setUnauthorizedHandler } from '@api/client';
import type { FactorCredentials, User } from '@shared/types';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  mfaPending: boolean;
  login: (email: string, password: string) => Promise<void>;
  verifyFactor: (kind: FactorCredentials['kind'], code: string) => Promise<void>;
  restartPassword: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [mfaPending, setMfaPending] = useState(false);
  const stateVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const removeUnauthorizedHandler = setUnauthorizedHandler(() => {
      stateVersion.current++;
      setUser(null);
      setMfaPending(false);
      setLoading(false);
    });
    const version = stateVersion.current;
    localStorage.removeItem('token');
    const restoreUser = async () => {
      try {
        const userData = await authApi.getCurrentUser();
        if (active && version === stateVersion.current) setUser(userData);
      } catch {
        if (active && version === stateVersion.current) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    restoreUser();
    return () => {
      active = false;
      stateVersion.current++;
      removeUnauthorizedHandler();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const version = ++stateVersion.current;
    const response = await authApi.login({ email, password });
    if (version !== stateVersion.current) return;
    setUser(null);
    setMfaPending(response.mfaRequired === true);
    if (response.mfaRequired !== true) throw new Error('Unable to confirm the password step');
  }, []);

  const verifyFactor = useCallback(async (kind: FactorCredentials['kind'], code: string) => {
    const version = ++stateVersion.current;
    const response = await authApi.verifyFactor({ kind, code });
    if (version !== stateVersion.current) return;
    setUser(response.user);
    setMfaPending(false);
  }, []);

  const restartPassword = useCallback(() => {
    stateVersion.current++;
    setUser(null);
    setMfaPending(false);
  }, []);

  const logout = useCallback(async () => {
    const version = ++stateVersion.current;
    await authApi.logout();
    if (version !== stateVersion.current) return;
    setUser(null);
    setMfaPending(false);
  }, []);

  const refreshUser = useCallback(async () => {
    const version = stateVersion.current;
    try {
      const userData = await authApi.getCurrentUser();
      if (version !== stateVersion.current) return;
      setUser(userData);
      setMfaPending(false);
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    mfaPending,
    login,
    verifyFactor,
    restartPassword,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
