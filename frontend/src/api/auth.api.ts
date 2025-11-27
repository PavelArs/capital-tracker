import apiClient from './client';
import type {
  User,
  LoginCredentials,
  RegisterData,
  AuthResponse,
  InvitationCode,
} from '@shared/types';

export interface RegisterResponse extends Omit<User, 'subscriptionType'> {
  access_token?: string;
  message: string;
}

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
    return response.data;
  },

  register: async (data: RegisterData): Promise<RegisterResponse> => {
    const response = await apiClient.post<RegisterResponse>('/auth/register', data);
    return response.data;
  },

  getProfile: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me');
    return response.data;
  },

  // Alias for getProfile
  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me');
    return response.data;
  },

  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/auth/forgot-password', { email });
    return response.data;
  },

  resetPassword: async (token: string, newPassword: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/auth/reset-password', {
      token,
      newPassword,
    });
    return response.data;
  },

  verifyEmail: async (token: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/auth/verify-email', { token });
    return response.data;
  },

  resendVerification: async (email: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/auth/resend-verification', {
      email,
    });
    return response.data;
  },

  generateInvitationCode: async (): Promise<InvitationCode> => {
    const response = await apiClient.post<InvitationCode>('/auth/invitation-code/generate');
    return response.data;
  },

  getMyInvitationCode: async (): Promise<InvitationCode | null> => {
    try {
      const response = await apiClient.get<InvitationCode>('/auth/invitation-code');
      return response.data;
    } catch {
      return null;
    }
  },
};
