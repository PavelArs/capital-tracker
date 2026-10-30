import { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let apiClient: AxiosInstance;
let authApi: typeof import('./auth.api').authApi;
let setErrorHandler: typeof import('./client').setErrorHandler;
let setUnauthorizedHandler: typeof import('./client').setUnauthorizedHandler;

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
    ({ default: apiClient, setErrorHandler, setUnauthorizedHandler } = await import('./client'));
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

  it('STALE-STATE says the server did not answer instead of its raw text, and marks reads unanswered until one answers', async () => {
    const { connection } = await import('./connection');
    connection.reset();
    const onError = vi.fn();
    setErrorHandler(onError);
    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError(
        'Server error',
        undefined,
        config,
        undefined,
        response(config, { statusCode: 500, message: 'Internal server error' }, 500),
      );
    };
    await expect(apiClient.get('/portfolio/history')).rejects.toMatchObject({
      response: { status: 500 },
    });
    expect(onError).toHaveBeenCalledWith("The server didn't answer. Try again in a moment.");
    expect(connection.get().failing).toBe(true);

    // A refusal is an answer: the server is there.
    apiClient.defaults.adapter = async (config) => {
      throw rejected(config, 404);
    };
    await expect(apiClient.get('/portfolio/history')).rejects.toMatchObject({
      response: { status: 404 },
    });
    expect(connection.get().failing).toBe(false);

    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError('Network Error', undefined, config, {});
    };
    await expect(apiClient.get('/portfolio/history')).rejects.toBeInstanceOf(AxiosError);
    expect(onError).toHaveBeenLastCalledWith('No connection. Check your network and try again.');
    expect(connection.get().failing).toBe(true);
    apiClient.defaults.adapter = async (config) => response(config, {});
    await apiClient.get('/portfolio/history');
    expect(connection.get().failing).toBe(false);
  });

  it('STALE-STATE keeps reads marked unanswered when a different read answers', async () => {
    const { connection } = await import('./connection');
    connection.reset();
    setErrorHandler(vi.fn());
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/goals') throw rejected(config, 500);
      return response(config, {});
    };
    await expect(apiClient.get('/goals')).rejects.toMatchObject({ response: { status: 500 } });
    await apiClient.get('/sync-status');
    // The goals shown are still the ones from before: only goals answering again clears it.
    expect(connection.get().failing).toBe(true);
    apiClient.defaults.adapter = async (config) => response(config, {});
    await apiClient.get('/goals');
    expect(connection.get().failing).toBe(false);
  });

  it('STALE-STATE drops a failure whose page is gone, and keeps one the screen still reads', async () => {
    const { connection, CARRY_MS } = await import('./connection');
    connection.reset();
    setErrorHandler(vi.fn());
    vi.useFakeTimers();
    try {
      apiClient.defaults.adapter = async (config) => {
        if (config.url === '/goals' || config.url === '/sync-status') throw rejected(config, 500);
        return response(config, {});
      };
      await expect(apiClient.get('/goals')).rejects.toMatchObject({ response: { status: 500 } });
      await expect(apiClient.get('/sync-status')).rejects.toMatchObject({
        response: { status: 500 },
      });
      // The owner leaves the goals page; the shell's sync status is still on screen.
      connection.pageChanged();
      expect(connection.get().failing).toBe(true);
      // The shell reads the sync status again, and it still gets no answer.
      await expect(apiClient.get('/sync-status')).rejects.toMatchObject({
        response: { status: 500 },
      });
      vi.advanceTimersByTime(CARRY_MS);
      expect(connection.get().failing).toBe(true);
      // Once the sync status answers, the goals read nobody asks for again no longer counts.
      apiClient.defaults.adapter = async (config) => response(config, {});
      await apiClient.get('/sync-status');
      expect(connection.get().failing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('STALE-STATE Retry drops a failure the page drawn again no longer reads', async () => {
    const { connection, CARRY_MS } = await import('./connection');
    connection.reset();
    setErrorHandler(vi.fn());
    vi.useFakeTimers();
    try {
      apiClient.defaults.adapter = async (config) => {
        throw rejected(config, 500);
      };
      await expect(apiClient.get('/portfolio/history?period=1M')).rejects.toMatchObject({
        response: { status: 500 },
      });
      connection.retry();
      expect(connection.get().failing).toBe(true);
      vi.advanceTimersByTime(CARRY_MS);
      expect(connection.get().failing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['post', '/wallet-addresses'],
    ['patch', '/wallet-addresses/w1/tokens'],
    ['put', '/inflation/personal-rates/USD'],
    ['put', '/owner-settings'],
  ] as const)('leaves a refused %s of %s to the screen that reports it', async (method, url) => {
    const onError = vi.fn();
    setErrorHandler(onError);
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'synthetic-csrf' });
      throw rejected(config, 422);
    };

    await expect(apiClient[method](url, {})).rejects.toMatchObject({ response: { status: 422 } });
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['/wallet-addresses', '/inflation', '/owner-settings'])(
    'still reports a failed background read of %s globally',
    async (url) => {
      const onError = vi.fn();
      setErrorHandler(onError);
      apiClient.defaults.adapter = async (config) => {
        throw rejected(config, 422);
      };

      await expect(apiClient.get(url)).rejects.toMatchObject({ response: { status: 422 } });
      expect(onError).toHaveBeenCalled();
    },
  );

  it('leaves a refused goal request to the goal dialog', async () => {
    const onError = vi.fn();
    setErrorHandler(onError);
    apiClient.defaults.adapter = async (config) => {
      throw rejected(config, 409);
    };

    await expect(apiClient.get('/goals')).rejects.toMatchObject({ response: { status: 409 } });
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

  it('drops every kept read after a successful write but not after a read', async () => {
    const cache = await import('./read-cache');
    apiClient.defaults.adapter = async (config) =>
      config.url === '/auth/csrf' ? response(config, { csrfToken: 'csrf' }) : response(config, {});
    cache.remember('page', { total: 1 }, cache.generationNow());

    await apiClient.get('/accounting/portfolio');
    expect(cache.recall('page')).toEqual({ total: 1 });

    await apiClient.post('/accounting/trades', {});
    expect(cache.recall('page')).toBeUndefined();
  });

  it('keeps the reads after a POST that only reads, and still sends it with CSRF', async () => {
    const cache = await import('./read-cache');
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      return config.url === '/auth/csrf'
        ? response(config, { csrfToken: 'csrf' })
        : response(config, {});
    };
    cache.remember('page', { total: 1 }, cache.generationNow());

    await apiClient.post('/goals/preview', { targetAmount: '1000' }, { changesNothing: true });

    expect(cache.recall('page')).toEqual({ total: 1 });
    expect(sent.at(-1)?.headers.get('X-CSRF-Token')).toBe('csrf');
  });

  it('keeps the reads after a deposit preview, which saves nothing', async () => {
    const cache = await import('./read-cache');
    const { depositsApi } = await import('./deposits.api');
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      return config.url === '/auth/csrf'
        ? response(config, { csrfToken: 'csrf' })
        : response(config, {});
    };
    cache.remember('page', { total: 1 }, cache.generationNow());

    const controller = new AbortController();
    await depositsApi.preview({} as Parameters<typeof depositsApi.preview>[0], controller.signal);

    expect(sent.at(-1)?.url).toBe('/deposits/preview');
    expect(sent.at(-1)?.changesNothing).toBe(true);
    // A superseded preview can be cancelled.
    expect(sent.at(-1)?.signal).toBe(controller.signal);
    expect(cache.recall('page')).toEqual({ total: 1 });
  });

  it('keeps the reads after a write the server refused', async () => {
    const cache = await import('./read-cache');
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'csrf' });
      throw rejected(config, 422);
    };
    setErrorHandler(() => undefined);
    cache.remember('page', 1, cache.generationNow());

    await expect(apiClient.post('/accounting/trades', {})).rejects.toBeInstanceOf(AxiosError);

    expect(cache.recall('page')).toBe(1);
  });

  it('goals-02 drops every kept read when a write gets no answer, since it may have been saved', async () => {
    const cache = await import('./read-cache');
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'csrf' });
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    };
    cache.remember('page', 1, cache.generationNow());

    await expect(apiClient.post('/goals', {})).rejects.toBeInstanceOf(AxiosError);

    expect(cache.recall('page')).toBeUndefined();
  });

  it('keeps the kept reads when a POST that only reads gets no answer or is cancelled', async () => {
    const cache = await import('./read-cache');
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'csrf' });
      if (config.url === '/goals/preview') throw new AxiosError('canceled', 'ERR_CANCELED', config);
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    };
    cache.remember('page', 1, cache.generationNow());

    await expect(
      apiClient.post('/deposits/preview', {}, { changesNothing: true }),
    ).rejects.toBeInstanceOf(AxiosError);
    await expect(
      apiClient.post('/goals/preview', {}, { changesNothing: true }),
    ).rejects.toBeInstanceOf(AxiosError);

    expect(cache.recall('page')).toBe(1);
  });

  it('keeps the kept reads when a write is cancelled before an answer, as a superseded preview is', async () => {
    const cache = await import('./read-cache');
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'csrf' });
      throw new AxiosError('canceled', 'ERR_CANCELED', config);
    };
    cache.remember('page', 1, cache.generationNow());

    await expect(apiClient.post('/deposits/preview', {})).rejects.toBeInstanceOf(AxiosError);
    const controller = new AbortController();
    controller.abort();
    await expect(
      apiClient.post('/goals/preview', {}, { signal: controller.signal }),
    ).rejects.toBeTruthy();

    expect(cache.recall('page')).toBe(1);
  });

  it('goals-02 keeps the kept reads when a read gets no answer', async () => {
    const cache = await import('./read-cache');
    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    };
    cache.remember('page', 1, cache.generationNow());

    await expect(apiClient.get('/goals')).rejects.toBeInstanceOf(AxiosError);

    expect(cache.recall('page')).toBe(1);
  });

  it('drops every kept read when the session ends with a protected 401', async () => {
    const cache = await import('./read-cache');
    setUnauthorizedHandler(() => undefined);
    apiClient.defaults.adapter = async (config) => {
      throw rejected(config, 401);
    };
    cache.remember('page', 1, cache.generationNow());

    await expect(apiClient.get('/accounting/portfolio')).rejects.toBeInstanceOf(AxiosError);

    expect(cache.recall('page')).toBeUndefined();
  });

  it('asks a read once more after a timeout and shows the page when the second answer comes', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (sent.length === 1) {
        throw new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED', config);
      }
      return response(config, { ok: true });
    };

    const answer = await apiClient.get('/accounting/portfolio/history');

    expect(answer.data).toEqual({ ok: true });
    expect(sent.map((config) => config.url)).toEqual([
      '/accounting/portfolio/history',
      '/accounting/portfolio/history',
    ]);
  });

  it('asks a read once more after a gateway error but not after another refusal', async () => {
    const sent: string[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(`${config.url}`);
      if (config.url === '/accounting/gateway' && sent.length === 1) throw rejected(config, 504);
      if (config.url === '/accounting/gateway') return response(config, { ok: true });
      throw rejected(config, 404);
    };

    await expect(apiClient.get('/accounting/gateway')).resolves.toMatchObject({ status: 200 });
    await expect(apiClient.get('/accounting/missing')).rejects.toBeInstanceOf(AxiosError);

    expect(sent).toEqual(['/accounting/gateway', '/accounting/gateway', '/accounting/missing']);
  });

  it('gives up on a read after its one repeat fails as well', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    };

    await expect(apiClient.get('/accounting/portfolio')).rejects.toBeInstanceOf(AxiosError);

    expect(sent).toHaveLength(2);
  });

  it('never repeats a write that timed out', async () => {
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'token' });
      throw new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED', config);
    };

    await expect(apiClient.post('/accounting/trades', {})).rejects.toBeInstanceOf(AxiosError);

    expect(sent.filter((config) => config.url === '/accounting/trades')).toHaveLength(1);
  });

  it('notifies React on a protected 401 without changing the document URL or retrying its write', async () => {
    window.history.replaceState({}, '', '/manual-accounts/retained-command');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const sent: InternalAxiosRequestConfig[] = [];
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      if (config.url === '/auth/csrf') return response(config, { csrfToken: 'current-csrf' });
      throw rejected(config, 401);
    };

    await expect(
      apiClient.post('/accounting/accounts/one/csv-imports/batch/confirm', {
        requestId: 'original-command',
      }),
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/manual-accounts/retained-command');
    expect(sent.map((config) => config.url)).toEqual([
      '/auth/csrf',
      '/accounting/accounts/one/csv-imports/batch/confirm',
    ]);
  });

  it('cleans up only the registration being removed and tolerates repeated cleanup', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = setUnauthorizedHandler(first);
    const removeSecond = setUnauthorizedHandler(second);
    removeFirst();
    removeFirst();
    apiClient.defaults.adapter = async (config) => {
      throw rejected(config, 401);
    };

    await expect(apiClient.get('/accounting/accounts')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    removeSecond();
    await expect(apiClient.get('/accounting/instruments')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(second).toHaveBeenCalledOnce();
  });

  it.each(['/auth/login', '/auth/mfa'])(
    'keeps %s denial local without clearing authentication state',
    async (path) => {
      const onUnauthorized = vi.fn();
      setUnauthorizedHandler(onUnauthorized);
      apiClient.defaults.adapter = async (config) => {
        if (config.url === '/auth/csrf') return response(config, { csrfToken: 'form-csrf' });
        throw rejected(config, 401);
      };
      await expect(apiClient.post(path, {})).rejects.toMatchObject({ response: { status: 401 } });
      expect(onUnauthorized).not.toHaveBeenCalled();
    },
  );

  it.each(['get', 'post'] as const)(
    'ignores a delayed old-session %s 401 after a successful factor rotation',
    async (method) => {
      const onUnauthorized = vi.fn();
      setUnauthorizedHandler(onUnauthorized);
      let rejectOld: () => void = () => {};
      const delayed = new Promise<void>((resolve) => {
        rejectOld = resolve;
      });
      const sent: InternalAxiosRequestConfig[] = [];
      apiClient.defaults.adapter = async (config) => {
        sent.push(config);
        if (config.url === '/auth/csrf') return response(config, { csrfToken: 'old-csrf' });
        if (config.url === '/auth/login')
          return response(config, { mfaRequired: true, csrfToken: 'pending-csrf' });
        if (config.url === '/auth/mfa')
          return response(config, { user: { id: 'owner' }, csrfToken: 'new-full-csrf' });
        if (config.url === '/accounting/old') {
          await delayed;
          throw rejected(config, 401);
        }
        return response(config, {});
      };
      const old = expect(
        apiClient.request({ method, url: '/accounting/old' }),
      ).rejects.toMatchObject({ response: { status: 401 } });
      await vi.waitFor(() =>
        expect(sent.some((config) => config.url === '/accounting/old')).toBe(true),
      );
      await authApi.login({ email: 'owner@example.invalid', password: 'Synthetic-password-42!' });
      await authApi.verifyFactor({ kind: 'totp', code: '012345' });
      rejectOld();
      await old;

      expect(onUnauthorized).not.toHaveBeenCalled();
      await apiClient.post('/accounting/explicit-next-action', {});
      expect(sent.at(-1)?.headers.get('X-CSRF-Token')).toBe('new-full-csrf');
      expect(sent.filter((config) => config.url === '/accounting/old')).toHaveLength(1);
    },
  );

  it('still reports a current-session 401 after an ordinary 403 CSRF refresh', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    let rejectRead: () => void = () => {};
    const delayed = new Promise<void>((resolve) => {
      rejectRead = resolve;
    });
    let readStarted = false;
    let csrfRequests = 0;
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/csrf')
        return response(config, { csrfToken: `csrf-${++csrfRequests}` });
      if (config.url === '/accounting/old-read') {
        readStarted = true;
        await delayed;
        throw rejected(config, 401);
      }
      throw rejected(config, 403);
    };
    const old = expect(apiClient.get('/accounting/old-read')).rejects.toMatchObject({
      response: { status: 401 },
    });
    await vi.waitFor(() => expect(readStarted).toBe(true));
    await expect(apiClient.post('/accounting/refused-write')).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(csrfRequests).toBe(2);
    rejectRead();
    await old;
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
