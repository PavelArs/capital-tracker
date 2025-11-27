import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, authApi } from '@api';
import type { User, InvitationCode, SubscriptionType } from '@shared/types';

// Re-export types for backward compatibility
export type { SubscriptionType };

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
    invitationCode?: string
  ) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  generateInvitationCode: () => Promise<InvitationCode>;
  getMyInvitationCode: () => Promise<InvitationCode | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState<boolean>(true);

  // Update axios default headers when token changes
  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Restore user from token on mount
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
          // Token is invalid, remove it
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
    async (
      email: string,
      password: string,
      firstName?: string,
      lastName?: string,
      invitationCode?: string
    ) => {
      const response = await authApi.register({
        email,
        password,
        firstName,
        lastName,
        invitationCode: invitationCode || '',
      });

      // In development mode with skip email verification, access_token is returned
      // In production mode, user must verify email before login
      if (response.access_token) {
        const { access_token } = response;
        setToken(access_token);
        // Fetch the full user profile to get all fields including subscriptionType
        api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
        const fullUser = await authApi.getCurrentUser();
        setUser(fullUser);
        localStorage.setItem(TOKEN_KEY, access_token);
      }
      // If no access_token, user must verify email before they can login
      // Response contains message about checking email
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

  const generateInvitationCode = useCallback(async (): Promise<InvitationCode> => {
    return authApi.generateInvitationCode();
  }, []);

  const getMyInvitationCode = useCallback(async (): Promise<InvitationCode | null> => {
    return authApi.getMyInvitationCode();
  }, []);

  const value: AuthContextType = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    refreshUser,
    generateInvitationCode,
    getMyInvitationCode,
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
