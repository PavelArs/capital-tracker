import apiClient, { setCsrfToken } from './client';

export interface SecuritySession {
  id: string;
  device: string | null;
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
}

export interface SecurityOverview {
  recoveryCodes: { unused: number; total: number };
  sessions: SecuritySession[];
}

// PR-AUTH-4: Settings → Security. New recovery codes are returned once and never again.
export const securityApi = {
  get: async (): Promise<SecurityOverview> => {
    const response = await apiClient.get<SecurityOverview>('/auth/security');
    return response.data;
  },

  regenerateRecoveryCodes: async (code: string): Promise<string[]> => {
    const response = await apiClient.post<{ recoveryCodes: string[] }>(
      '/auth/security/recovery-codes',
      { code },
    );
    return response.data.recoveryCodes;
  },

  endSession: async (id: string): Promise<void> => {
    await apiClient.delete(`/auth/security/sessions/${encodeURIComponent(id)}`);
  },

  logoutEverywhere: async (): Promise<void> => {
    await apiClient.post('/auth/security/logout-everywhere');
    setCsrfToken(null);
  },
};
