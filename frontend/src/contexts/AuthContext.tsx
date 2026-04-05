import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, authApi } from '@api';
import type { User } from '@shared/types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    firstName?: string,
    lastName?: string
  ) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common['Authorization'];
    }
  }, [token]);

  useEffect(() => {
    const restoreUser = async () => {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken) {
        try {
          api.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
          const userData = await authApi.getCurrentUser();
          setUser(userData);
          setToken(savedToken);
        } catch {
          localStorage.removeItem(TOKEN_KEY);
          delete api.defaults.headers.common['Authorization'];
          setToken(null);
          setUser(null);
        }
      }
      setLoading(false);
    };

    restoreUser();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    const { access_token, user: userData } = response;
    setToken(access_token);
    setUser(userData);
    localStorage.setItem(TOKEN_KEY, access_token);
    api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
  }, []);

  const register = useCallback(
    async (email: string, password: string, firstName?: string, lastName?: string) => {
      const response = await authApi.register({
        email,
        password,
        firstName,
        lastName,
      });

      if (response.access_token) {
        const { access_token } = response;
        setToken(access_token);
        api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
        const fullUser = await authApi.getCurrentUser();
        setUser(fullUser);
        localStorage.setItem(TOKEN_KEY, access_token);
      }
    },
    []
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    delete api.defaults.headers.common['Authorization'];
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const userData = await authApi.getCurrentUser();
      setUser(userData);
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  }, []);

  const value: AuthContextType = {
    user,
    token,
    loading,
    login,
    register,
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
