import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authApi } from './auth.api';
import apiClient from './client';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('authApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should login user and return auth response', async () => {
      const credentials = { email: 'test@example.com', password: 'password123' };
      const authResponse = {
        access_token: 'jwt-token',
        user: { id: '1', email: 'test@example.com' },
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: authResponse });

      const result = await authApi.login(credentials);

      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', credentials);
      expect(result).toEqual(authResponse);
    });
  });

  describe('register', () => {
    it('should register new user', async () => {
      const registerData = {
        email: 'new@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
      };
      const registerResponse = {
        id: '1',
        email: 'new@example.com',
        message: 'Registration successful',
        access_token: 'jwt-token',
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: registerResponse });

      const result = await authApi.register(registerData);

      expect(apiClient.post).toHaveBeenCalledWith('/auth/register', registerData);
      expect(result).toEqual(registerResponse);
    });
  });

  describe('getProfile', () => {
    it('should fetch user profile', async () => {
      const mockUser = { id: '1', email: 'test@example.com', firstName: 'John' };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockUser });

      const result = await authApi.getProfile();

      expect(apiClient.get).toHaveBeenCalledWith('/auth/me');
      expect(result).toEqual(mockUser);
    });
  });

  describe('getCurrentUser', () => {
    it('should fetch current user (alias for getProfile)', async () => {
      const mockUser = { id: '1', email: 'test@example.com' };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockUser });

      const result = await authApi.getCurrentUser();

      expect(apiClient.get).toHaveBeenCalledWith('/auth/me');
      expect(result).toEqual(mockUser);
    });
  });

  describe('forgotPassword', () => {
    it('should request password reset', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: 'Reset email sent' },
      });

      const result = await authApi.forgotPassword('test@example.com');

      expect(apiClient.post).toHaveBeenCalledWith('/auth/forgot-password', {
        email: 'test@example.com',
      });
      expect(result).toEqual({ message: 'Reset email sent' });
    });
  });

  describe('resetPassword', () => {
    it('should reset password with token', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: 'Password reset successful' },
      });

      const result = await authApi.resetPassword('reset-token', 'newPassword123');

      expect(apiClient.post).toHaveBeenCalledWith('/auth/reset-password', {
        token: 'reset-token',
        newPassword: 'newPassword123',
      });
      expect(result).toEqual({ message: 'Password reset successful' });
    });
  });

  describe('verifyEmail', () => {
    it('should verify email with token', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: 'Email verified' },
      });

      const result = await authApi.verifyEmail('verify-token');

      expect(apiClient.post).toHaveBeenCalledWith('/auth/verify-email', {
        token: 'verify-token',
      });
      expect(result).toEqual({ message: 'Email verified' });
    });
  });

  describe('resendVerification', () => {
    it('should resend verification email', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: 'Verification email sent' },
      });

      const result = await authApi.resendVerification('test@example.com');

      expect(apiClient.post).toHaveBeenCalledWith('/auth/resend-verification', {
        email: 'test@example.com',
      });
      expect(result).toEqual({ message: 'Verification email sent' });
    });
  });

});
