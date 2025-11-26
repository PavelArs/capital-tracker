import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";

export type SubscriptionType = "free" | "pro" | "enterprise";

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  subscriptionType?: SubscriptionType;
}

interface InvitationCode {
  id: string;
  code: string;
  isUsed: boolean;
  usedAt: Date | null;
  createdAt: Date;
}

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token")
  );
  const [loading, setLoading] = useState<boolean>(true);

  // Restore user from token on mount
  useEffect(() => {
    const restoreUser = async () => {
      const savedToken = localStorage.getItem("token");
      if (savedToken) {
        try {
          axios.defaults.headers.common[
            "Authorization"
          ] = `Bearer ${savedToken}`;
          const response = await axios.get("/auth/me");
          setUser(response.data);
          setToken(savedToken);
        } catch (error) {
          // Token is invalid, remove it
          localStorage.removeItem("token");
          delete axios.defaults.headers.common["Authorization"];
          setToken(null);
          setUser(null);
        }
      }
      setLoading(false);
    };

    restoreUser();
  }, []);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common["Authorization"];
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const response = await axios.post("/auth/login", { email, password });
    const { access_token, user: userData } = response.data;
    setToken(access_token);
    setUser(userData);
    localStorage.setItem("token", access_token);
    axios.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
  };

  const register = async (
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
    invitationCode?: string
  ) => {
    const response = await axios.post("/auth/register", {
      email,
      password,
      firstName,
      lastName,
      invitationCode,
    });

    // In development mode with skip email verification, access_token is returned
    // In production mode, user must verify email before login
    if (response.data.access_token) {
      const { access_token, ...userData } = response.data;
      setToken(access_token);
      setUser(userData);
      localStorage.setItem("token", access_token);
      axios.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
    }
    // If no access_token, user must verify email before they can login
    // Response contains message about checking email
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("token");
    delete axios.defaults.headers.common["Authorization"];
  };

  const refreshUser = async () => {
    try {
      const response = await axios.get("/auth/me");
      setUser(response.data);
    } catch (error) {
      console.error("Failed to refresh user:", error);
    }
  };

  const generateInvitationCode = async (): Promise<InvitationCode> => {
    const response = await axios.post("/auth/invitation-code/generate");
    return response.data;
  };

  const getMyInvitationCode = async (): Promise<InvitationCode | null> => {
    try {
      const response = await axios.get("/auth/invitation-code");
      return response.data;
    } catch (error) {
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        refreshUser,
        generateInvitationCode,
        getMyInvitationCode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
