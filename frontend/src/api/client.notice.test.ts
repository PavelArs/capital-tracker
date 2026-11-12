import { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Characterization of the error notice the client raises itself, and of the requests whose
// page says why they failed instead.
let apiClient: AxiosInstance;
let onError = vi.fn<(message: string) => void>();

function response(config: InternalAxiosRequestConfig, data: unknown, status: number, text = '') {
  return { config, data, status, statusText: text, headers: {} };
}

/** Every request fails with this answer; with `csrf`, the CSRF retrieval a write needs succeeds. */
function failWith(data: unknown, status: number, text = '', csrf = true) {
  apiClient.defaults.adapter = async (config) => {
    if (csrf && config.url === '/auth/csrf')
      return response(config, { csrfToken: 'synthetic-csrf' }, 200);
    throw new AxiosError(
      'Rejected request',
      undefined,
      config,
      {},
      response(config, data, status, text),
    );
  };
}

describe('API client error notice', () => {
  beforeEach(async () => {
    vi.resetModules();
    const client = await import('./client');
    apiClient = client.default;
    onError = vi.fn<(message: string) => void>();
    client.setErrorHandler(onError);
  });

  it('says the message the server gave', async () => {
    failWith({ message: 'Synthetic refusal' }, 409);
    await expect(apiClient.get('/portfolio/assets')).rejects.toBeInstanceOf(AxiosError);
    expect(onError).toHaveBeenCalledWith('Synthetic refusal');
  });

  it('says a plain-text answer as it came', async () => {
    failWith('Synthetic plain text', 409);
    await expect(apiClient.get('/portfolio/assets')).rejects.toBeInstanceOf(AxiosError);
    expect(onError).toHaveBeenCalledWith('Synthetic plain text');
  });

  it.each([
    [400, '', 'Bad request'],
    [401, '', 'Unauthorized. Please login again.'],
    [403, '', 'Access forbidden'],
    [404, '', 'Resource not found'],
    [429, '', 'Too many requests. Please try again later.'],
    [418, 'Synthetic teapot', 'Error 418: Synthetic teapot'],
    [418, '', 'Error 418: Unknown error'],
  ])('names a %i with no message by its status', async (status, text, notice) => {
    failWith({}, status, text);
    await expect(apiClient.get('/portfolio/assets')).rejects.toBeInstanceOf(AxiosError);
    expect(onError).toHaveBeenCalledWith(notice);
  });

  it('says what went wrong when no request went out', async () => {
    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError('Synthetic setup failure', undefined, config);
    };
    await expect(apiClient.get('/portfolio/assets')).rejects.toBeInstanceOf(AxiosError);
    expect(onError).toHaveBeenCalledWith('Synthetic setup failure');

    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError('', undefined, config);
    };
    await expect(apiClient.get('/portfolio/assets')).rejects.toBeInstanceOf(AxiosError);
    expect(onError).toHaveBeenLastCalledWith('An unexpected error occurred');
  });

  it.each([
    '/auth/login',
    '/auth/mfa',
    '/auth/logout',
    '/auth/csrf',
    '/accounting/accounts',
    '/brokers/catalog',
    '/deposits',
    '/goals/synthetic-goal',
    '/auth/password-reset/status',
    '/auth/security/sessions',
    '/export/owner',
  ])('leaves a failed read of %s to its page', async (url) => {
    failWith({ message: 'Synthetic refusal' }, 409, '', false);
    await expect(apiClient.get(url)).rejects.toBeInstanceOf(AxiosError);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['/wallet-addresses', '/inflation/own-rates', '/owner-settings'])(
    'leaves a failed save to %s to its page, but not a failed read',
    async (url) => {
      failWith({ message: 'Synthetic refusal' }, 409);
      await expect(apiClient.post(url, {})).rejects.toBeInstanceOf(AxiosError);
      expect(onError).not.toHaveBeenCalled();
      await expect(apiClient.get(url)).rejects.toBeInstanceOf(AxiosError);
      expect(onError).toHaveBeenCalledWith('Synthetic refusal');
    },
  );
});
