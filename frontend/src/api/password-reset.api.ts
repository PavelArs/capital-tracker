import apiClient from './client';

export type ResetLinkState = 'valid' | 'expired' | 'invalid';

// PR-AUTH-3: the request answer is the same for every address, so it carries no body.
export const passwordResetApi = {
  request: async (email: string): Promise<void> => {
    await apiClient.post('/auth/password-reset', { email });
  },

  status: async (token: string): Promise<ResetLinkState> => {
    const response = await apiClient.post<{ state: ResetLinkState }>(
      '/auth/password-reset/status',
      { token },
    );
    return response.data.state;
  },

  confirm: async (token: string, password: string): Promise<void> => {
    await apiClient.post('/auth/password-reset/confirm', { token, password });
  },
};
