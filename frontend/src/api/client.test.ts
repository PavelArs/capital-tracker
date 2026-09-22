import { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let apiClient: AxiosInstance;
let authApi: typeof import('./auth.api').authApi;
let setErrorHandler: typeof import('./client').setErrorHandler;

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200) {
  return { config, data, status, statusText: String(status), headers: {} };
}

function rejected(config: InternalAxiosRequestConfig, status: number) {
  return new AxiosError(
    'Rejected request',
    undefined,
    config,
    undefined,
    response(config, { message: 'Rejected request' }, status),
  );
}

describe('cookie session API client', () => {
  beforeEach(async () => {
    vi.resetModules();
    window.history.replaceState({}, '', '/login');
    ({ default: apiClient, setErrorHandler } = await import('./client'));
    ({ authApi } = await import('./auth.api'));
  });

  it('uses browser credentials without reading or sending a legacy bearer on reads', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue('obsolete-browser-token');
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      return response(config, { id: 'owner' });
    };

    await apiClient.get('/auth/me');

    expect(sent).toHaveLength(1);
    expect(sent[0].withCredentials).toBe(true);
    expect(sent[0].headers.get('Authorization')).toBeUndefined();
    expect(sent[0].headers.get('X-CSRF-Token')).toBeUndefined();
    expect(localStorage.getItem).not.toHaveBeenCalledWith('token');
  });

  it('shares one anonymous CSRF retrieval across concurrent unsafe requests', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    let releaseCsrf: (token: string) => void = () => {};
    const csrf = new Promise<string>((resolve) => {
      releaseCsrf = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') return response(config, { csrfToken: await csrf });
      return response(config, {});
    };

    const writes = Promise.all([
      apiClient.post('/assets', { name: 'first' }),
      apiClient.patch('/assets/second', { name: 'second' }),
    ]);
    await vi.waitFor(() => expect(sent.map((config) => config.url)).toEqual(['/auth/csrf']));
    releaseCsrf('shared-csrf');
    await writes;

    expect(sent.map((config) => config.url)).toEqual(['/auth/csrf', '/assets', '/assets/second']);
    for (const write of sent.slice(1)) {
      expect(write.headers.get('X-CSRF-Token')).toBe('shared-csrf');
      expect(write.withCredentials).toBe(true);
    }
  });

  it('uses the rotated password CSRF token immediately on the factor submission', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'anonymous-csrf' });
      if (config.url === '/auth/login') {
        return response(config, { mfaRequired: true, csrfToken: 'pending-csrf' });
      }
      return response(config, {});
    };

    await authApi.login({ email: 'owner@example.invalid', password: 'Synthetic-password-42!' });
    await apiClient.post('/auth/mfa', { kind: 'totp', code: '012345' });

    expect(sent.map((config) => config.url)).toEqual(['/auth/csrf', '/auth/login', '/auth/mfa']);
    expect(sent[1].headers.get('X-CSRF-Token')).toBe('anonymous-csrf');
    expect(sent[2].headers.get('X-CSRF-Token')).toBe('pending-csrf');
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('refreshes CSRF after a rejected write without replaying the mutation', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    let csrfRequests = 0;
    let writes = 0;
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') {
        csrfRequests++;
        return response(config, { csrfToken: `csrf-${csrfRequests}` });
      }
      writes++;
      if (writes === 1) throw rejected(config, 403);
      return response(config, {});
    };

    await expect(apiClient.post('/assets', { name: 'once' })).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(writes).toBe(1);
    expect(csrfRequests).toBe(2);

    await apiClient.post('/assets', { name: 'explicit retry' });
    expect(writes).toBe(2);
    expect(sent[sent.length - 1].headers.get('X-CSRF-Token')).toBe('csrf-2');
  });

  it('keeps the new login token when an older CSRF retrieval finishes afterwards', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    let csrfRequests = 0;
    let logins = 0;
    let writes = 0;
    let completeLogin: () => void = () => {};
    let completeCsrf: () => void = () => {};
    const pendingLogin = new Promise<void>((resolve) => {
      completeLogin = resolve;
    });
    const pendingCsrf = new Promise<void>((resolve) => {
      completeCsrf = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') {
        csrfRequests++;
        if (csrfRequests === 1) return response(config, { csrfToken: 'anonymous-csrf' });
        await pendingCsrf;
        return response(config, { csrfToken: 'old-session-csrf' });
      }
      if (config.url === '/auth/login') {
        logins++;
        if (logins === 2) await pendingLogin;
        return response(config, {
          mfaRequired: true,
          csrfToken: logins === 1 ? 'old-session-csrf' : 'new-login-csrf',
        });
      }
      writes++;
      if (writes === 1) throw rejected(config, 403);
      return response(config, {});
    };
    const credentials = { email: 'owner@example.invalid', password: 'Synthetic-password-42!' };
    await authApi.login(credentials);

    // Re-login is already in flight when an older session's write starts a CSRF refresh.
    const newLogin = authApi.login(credentials);
    await vi.waitFor(() => expect(logins).toBe(2));
    const failedWrite = expect(apiClient.post('/assets', { name: 'once' })).rejects.toMatchObject({
      response: { status: 403 },
    });
    await vi.waitFor(() => expect(csrfRequests).toBe(2));
    completeLogin();
    await newLogin;
    completeCsrf();
    await failedWrite;

    expect(writes).toBe(1);
    await apiClient.post('/assets', { name: 'explicit next action' });
    expect(writes).toBe(2);
    expect(csrfRequests).toBe(2);
    expect(sent[sent.length - 1].headers.get('X-CSRF-Token')).toBe('new-login-csrf');
  });

  it('keeps the new login token when a write from the old session returns a delayed 403', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    let csrfRequests = 0;
    let logins = 0;
    let writes = 0;
    let rejectOldWrite: () => void = () => {};
    const pendingWrite = new Promise<void>((resolve) => {
      rejectOldWrite = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') {
        csrfRequests++;
        return response(config, { csrfToken: `retrieval-${csrfRequests}` });
      }
      if (config.url === '/auth/login') {
        logins++;
        return response(config, {
          mfaRequired: true,
          csrfToken: logins === 1 ? 'old-session-csrf' : 'new-login-csrf',
        });
      }
      writes++;
      if (writes === 1) {
        await pendingWrite;
        throw rejected(config, 403);
      }
      return response(config, {});
    };
    const credentials = { email: 'owner@example.invalid', password: 'Synthetic-password-42!' };
    await authApi.login(credentials);

    const failedWrite = expect(apiClient.post('/assets', { name: 'once' })).rejects.toMatchObject({
      response: { status: 403 },
    });
    await vi.waitFor(() => expect(writes).toBe(1));
    await authApi.login(credentials);
    rejectOldWrite();
    await failedWrite;

    expect(writes).toBe(1);
    expect(csrfRequests).toBe(1);
    await apiClient.post('/assets', { name: 'explicit next action' });
    expect(writes).toBe(2);
    expect(csrfRequests).toBe(1);
    expect(sent[sent.length - 1].headers.get('X-CSRF-Token')).toBe('new-login-csrf');
  });

  it('does not send a mutation when CSRF retrieval fails and permits a later attempt', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    let csrfRequests = 0;
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') {
        csrfRequests++;
        if (csrfRequests === 1) throw rejected(config, 429);
        return response(config, { csrfToken: 'available-csrf' });
      }
      return response(config, {});
    };

    await expect(apiClient.post('/auth/login', {})).rejects.toMatchObject({
      response: { status: 429 },
    });
    expect(sent.map((config) => config.url)).toEqual(['/auth/csrf']);

    await apiClient.post('/auth/login', {});
    expect(sent.map((config) => config.url)).toEqual(['/auth/csrf', '/auth/csrf', '/auth/login']);
    expect(sent[2].headers.get('X-CSRF-Token')).toBe('available-csrf');
  });

  it('keeps anonymous profile denial on the login page without reloading', async () => {
    const onError = vi.fn();
    setErrorHandler(onError);
    apiClient.defaults.adapter = async (config) => {
      throw rejected(config, 401);
    };

    await expect(apiClient.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(window.location.pathname).toBe('/login');
    expect(onError).not.toHaveBeenCalled();
  });

  it('reuses anonymous CSRF after invalid credentials and leaves login feedback to the form', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    const onError = vi.fn();
    setErrorHandler(onError);
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'anonymous-csrf' });
      throw rejected(config, 401);
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        authApi.login({ email: 'owner@example.invalid', password: 'Incorrect-password-42!' }),
      ).rejects.toMatchObject({ response: { status: 401 } });
    }

    expect(sent.map((config) => config.url)).toEqual(['/auth/csrf', '/auth/login', '/auth/login']);
    expect(onError).not.toHaveBeenCalled();
    expect(sent[2].headers.get('X-CSRF-Token')).toBe('anonymous-csrf');
  });

  it('keeps pending CSRF and Russian form feedback after an invalid factor without retrying', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    const onError = vi.fn();
    setErrorHandler(onError);
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'anonymous-csrf' });
      if (config.url === '/auth/login')
        return response(config, { mfaRequired: true, csrfToken: 'pending-csrf' });
      throw rejected(config, 401);
    };
    await authApi.login({ email: 'owner@example.invalid', password: 'Synthetic-password-42!' });

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        apiClient.post('/auth/mfa', { kind: 'totp', code: '012345' }),
      ).rejects.toMatchObject({ response: { status: 401 } });
    }

    expect(sent.map((config) => config.url)).toEqual([
      '/auth/csrf',
      '/auth/login',
      '/auth/mfa',
      '/auth/mfa',
    ]);
    expect(sent[2].headers.get('X-CSRF-Token')).toBe('pending-csrf');
    expect(sent[3].headers.get('X-CSRF-Token')).toBe('pending-csrf');
    expect(onError).not.toHaveBeenCalled();
  });

  it('uses anonymous, pending and full CSRF in order across both authentication rotations', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'anonymous-csrf' });
      if (config.url === '/auth/login')
        return response(config, { mfaRequired: true, csrfToken: 'pending-csrf' });
      if (config.url === '/auth/mfa')
        return response(config, { user: { id: 'owner' }, csrfToken: 'full-csrf' });
      return response(config, {});
    };

    await authApi.login({ email: 'owner@example.invalid', password: 'Synthetic-password-42!' });
    await authApi.verifyFactor({ kind: 'totp', code: '012345' });
    await apiClient.delete('/assets/one');

    expect(sent.map((config) => config.url)).toEqual([
      '/auth/csrf',
      '/auth/login',
      '/auth/mfa',
      '/assets/one',
    ]);
    expect(sent.slice(1).map((config) => config.headers.get('X-CSRF-Token'))).toEqual([
      'anonymous-csrf',
      'pending-csrf',
      'full-csrf',
    ]);
    for (const config of sent) {
      expect(config.withCredentials).toBe(true);
      expect(config.headers.get('Authorization')).toBeUndefined();
    }
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('posts logout with the current token and obtains new CSRF for the next login', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    let csrfRequests = 0;
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') {
        csrfRequests++;
        return response(config, { csrfToken: `anonymous-${csrfRequests}` });
      }
      if (config.url === '/auth/login') {
        return response(config, { mfaRequired: true, csrfToken: 'pending-csrf' });
      }
      return response(config, undefined, 204);
    };
    const credentials = { email: 'owner@example.invalid', password: 'Synthetic-password-42!' };

    await authApi.login(credentials);
    await authApi.logout();
    await authApi.login(credentials);

    expect(sent.map((config) => config.url)).toEqual([
      '/auth/csrf',
      '/auth/login',
      '/auth/logout',
      '/auth/csrf',
      '/auth/login',
    ]);
    expect(sent[2].headers.get('X-CSRF-Token')).toBe('pending-csrf');
    expect(sent[4].headers.get('X-CSRF-Token')).toBe('anonymous-2');
  });
});
