import type {
  FactorCredentials,
  FullAuthResponse,
  LoginCredentials,
  LoginResponse,
  User,
} from '@shared/types';
import apiClient, { setCsrfToken } from './client';

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/auth/login', credentials);
    setCsrfToken(response.data.csrfToken);
    return response.data;
  },

  verifyFactor: async (credentials: FactorCredentials): Promise<FullAuthResponse> => {
    const response = await apiClient.post<FullAuthResponse>('/auth/mfa', credentials);
    setCsrfToken(response.data.csrfToken);
    return response.data;
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
    setCsrfToken(null);
  },

  getProfile: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me');
    return response.data;
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me');
    return response.data;
  },
};
