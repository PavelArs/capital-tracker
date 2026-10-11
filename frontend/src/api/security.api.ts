import apiClient, { setCsrfToken } from './client';

export interface SecuritySession {
  id: string;
  device: string | null;
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
}

// SEC-TOTP: a new authenticator waiting for its first code. The key is shown only now.
export interface AuthenticatorSetup {
  uri: string;
  secret: string;
  candidateId: string;
  expiresAt: string;
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

  prepareAuthenticator: async (factor: {
    kind: 'totp' | 'recovery';
    code: string;
  }): Promise<AuthenticatorSetup> => {
    const response = await apiClient.post<AuthenticatorSetup>(
      '/auth/security/authenticator',
      factor,
    );
    return response.data;
  },

  confirmAuthenticator: async (candidateId: string, code: string): Promise<string[]> => {
    const response = await apiClient.post<{ recoveryCodes: string[] }>(
      '/auth/security/authenticator/confirm',
      { candidateId, code },
    );
    return response.data.recoveryCodes;
  },

  changePassword: async (input: {
    currentPassword: string;
    newPassword: string;
    code: string;
  }): Promise<void> => {
    await apiClient.post('/auth/security/password', input);
  },

  endSession: async (id: string): Promise<void> => {
    await apiClient.delete(`/auth/security/sessions/${encodeURIComponent(id)}`);
  },

  logoutEverywhere: async (): Promise<void> => {
    await apiClient.post('/auth/security/logout-everywhere');
    setCsrfToken(null);
  },
};
