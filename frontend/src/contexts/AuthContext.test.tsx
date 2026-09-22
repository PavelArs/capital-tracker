import { authApi } from '@api';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('@api', () => ({
  authApi: {
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    verifyFactor: vi.fn(),
    logout: vi.fn(),
  },
}));

const owner = {
  id: 'synthetic-owner',
  email: 'owner@example.invalid',
  createdAt: '2026-09-21T00:00:00Z',
  updatedAt: '2026-09-21T00:00:00Z',
};

describe('cookie-backed auth state', () => {
  beforeEach(() => {
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(owner);
  });

  afterEach(cleanup);

  it('restores the real profile without a stored token and removes legacy storage', async () => {
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(authApi.getCurrentUser).toHaveBeenCalledOnce();
    expect(result.current.user).toEqual(owner);
    expect(localStorage.removeItem).toHaveBeenCalledWith('token');
    expect(localStorage.getItem).not.toHaveBeenCalledWith('token');
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('finishes anonymous bootstrap without treating stored credentials as authentication', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue('obsolete-browser-token');
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(new Error('Unauthorized'));
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(authApi.getCurrentUser).toHaveBeenCalledOnce();
  });

  it('retains the profile until server logout completes', async () => {
    let completeLogout: () => void = () => {};
    vi.mocked(authApi.logout).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        completeLogout = resolve;
      }),
    );
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const logout = result.current.logout();
    expect(result.current.user).toEqual(owner);
    await act(async () => {
      completeLogout();
      await logout;
    });
    expect(result.current.user).toBeNull();
  });

  it('keeps the profile available for retry when server logout fails', async () => {
    vi.mocked(authApi.logout).mockRejectedValueOnce(new Error('Logout rejected'));
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.logout()).rejects.toThrow('Logout rejected');
    expect(result.current.user).toEqual(owner);
  });

  it('replaces password success with pending state and grants a profile only after factor success', async () => {
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(new Error('Unauthorized'));
    vi.mocked(authApi.login).mockResolvedValueOnce({
      mfaRequired: true,
      csrfToken: 'pending-csrf',
    });
    vi.mocked(authApi.verifyFactor).mockRejectedValueOnce(new Error('Invalid factor'));
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.login(owner.email, 'Synthetic-password-42!'));
    expect(result.current).toMatchObject({ user: null, mfaPending: true });
    await expect(result.current.verifyFactor('totp', '012345')).rejects.toThrow('Invalid factor');
    expect(result.current).toMatchObject({ user: null, mfaPending: true });

    vi.mocked(authApi.verifyFactor).mockResolvedValueOnce({ user: owner, csrfToken: 'full-csrf' });
    await act(() => result.current.verifyFactor('totp', '012346'));
    expect(result.current).toMatchObject({ user: owner, mfaPending: false });
    expect(authApi.verifyFactor).toHaveBeenLastCalledWith({ kind: 'totp', code: '012346' });
  });

  it('restarts password entry without storing pending authentication or claiming a user', async () => {
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(new Error('Unauthorized'));
    vi.mocked(authApi.login).mockResolvedValueOnce({
      mfaRequired: true,
      csrfToken: 'pending-csrf',
    });
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.login(owner.email, 'Synthetic-password-42!'));
    expect(result.current).toMatchObject({ user: null, mfaPending: true });

    act(() => result.current.restartPassword());
    expect(result.current).toMatchObject({ user: null, mfaPending: false });
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(authApi.verifyFactor).not.toHaveBeenCalled();
  });
});
