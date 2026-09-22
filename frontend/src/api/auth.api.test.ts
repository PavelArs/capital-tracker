import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from './auth.api';
import apiClient, { setCsrfToken } from './client';

vi.mock('./client', () => ({
  setCsrfToken: vi.fn(),
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
    it('returns only the pending password response and installs its CSRF token', async () => {
      const credentials = { email: 'test@example.com', password: 'Synthetic-password-42!' };
      const authResponse = {
        csrfToken: 'pending-csrf',
        mfaRequired: true,
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: authResponse });

      const result = await authApi.login(credentials);

      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', credentials);
      expect(result).toEqual(authResponse);
      expect(result).not.toHaveProperty('user');
      expect(setCsrfToken).toHaveBeenCalledWith(authResponse.csrfToken);
    });
  });

  describe('verifyFactor', () => {
    it('preserves the submitted code and installs full CSRF only after successful verification', async () => {
      const credentials = { kind: 'totp' as const, code: '012345' };
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Invalid factor'));
      await expect(authApi.verifyFactor(credentials)).rejects.toThrow('Invalid factor');
      expect(setCsrfToken).not.toHaveBeenCalled();

      const authResponse = { csrfToken: 'full-csrf', user: { id: '1', email: 'test@example.com' } };
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: authResponse });
      expect(await authApi.verifyFactor(credentials)).toEqual(authResponse);
      expect(apiClient.post).toHaveBeenLastCalledWith('/auth/mfa', credentials);
      expect(setCsrfToken).toHaveBeenCalledExactlyOnceWith('full-csrf');
    });
  });

  describe('logout', () => {
    it('clears CSRF only after the server accepts logout', async () => {
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Session still active'));
      await expect(authApi.logout()).rejects.toThrow('Session still active');
      expect(setCsrfToken).not.toHaveBeenCalled();

      vi.mocked(apiClient.post).mockResolvedValueOnce({ status: 204 });
      await authApi.logout();
      expect(apiClient.post).toHaveBeenLastCalledWith('/auth/logout');
      expect(setCsrfToken).toHaveBeenCalledWith(null);
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
});
