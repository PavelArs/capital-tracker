import type { ApiError } from '@shared/types';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
let csrfVersion = 0;
let authenticationVersion = 0;
const requestAuthentication = new WeakMap<InternalAxiosRequestConfig, number>();
let unauthorizedRegistration: { notify: () => void } | null = null;

export function setUnauthorizedHandler(notify: () => void): () => void {
  const registration = { notify };
  unauthorizedRegistration = registration;
  return () => {
    if (unauthorizedRegistration === registration) unauthorizedRegistration = null;
  };
}

export function setCsrfToken(token: string | null): void {
  // Non-null tokens are published by successful password/factor rotations.
  // Ordinary CSRF retrieval and invalidation do not create a new authentication.
  if (token !== null) authenticationVersion++;
  csrfToken = token;
  csrfVersion++;
  csrfRequest = null;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (csrfRequest) return csrfRequest;

  const version = csrfVersion;
  const request = apiClient.get<{ csrfToken: string }>('/auth/csrf').then(({ data }) => {
    // Password, factor verification or logout may replace the session during retrieval.
    if (version !== csrfVersion) return getCsrfToken();
    if (typeof data.csrfToken !== 'string' || !data.csrfToken) {
      throw new Error('Unable to confirm the session');
    }
    csrfToken = data.csrfToken;
    return csrfToken;
  });
  csrfRequest = request;
  try {
    return await request;
  } finally {
    if (csrfRequest === request) csrfRequest = null;
  }
}

function isUnsafeRequest(config?: InternalAxiosRequestConfig): boolean {
  return !['get', 'head', 'options'].includes(config?.method?.toLowerCase() || 'get');
}

// Error handler function - will be set from ErrorContext
let errorHandler: ((message: string) => void) | null = null;

export function setErrorHandler(handler: (message: string) => void): void {
  errorHandler = handler;
}

// Cookies are browser-managed; synchronizer tokens stay only in memory.
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    config.headers.delete('Authorization');
    if (isUnsafeRequest(config)) config.headers.set('X-CSRF-Token', await getCsrfToken());
    requestAuthentication.set(config, authenticationVersion);
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError<ApiError>) => {
    const pageHandlesError =
      ['/auth/login', '/auth/mfa', '/auth/logout', '/auth/csrf'].includes(
        error.config?.url || '',
      ) ||
      error.config?.url?.startsWith('/accounting/') === true ||
      error.config?.url?.startsWith('/auth/password-reset') === true;
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      if (status === 403 && isUnsafeRequest(error.config)) {
        // A delayed rejection must not discard a newer login or another refresh.
        if (error.config?.headers.get('X-CSRF-Token') === csrfToken) setCsrfToken(null);
        try {
          await getCsrfToken();
        } catch {
          // Preserve the original failure. Only a later explicit action may retry.
        }
      }

      if (
        status === 401 &&
        !['/auth/login', '/auth/mfa'].includes(error.config?.url || '') &&
        error.config &&
        requestAuthentication.get(error.config) === authenticationVersion
      ) {
        setCsrfToken(null);
        // React navigation preserves in-memory commands; the original request still rejects.
        unauthorizedRegistration?.notify();
      }

      const anonymousProfile = status === 401 && error.config?.url === '/auth/me';
      if (status >= 400 && errorHandler && !pageHandlesError && !anonymousProfile) {
        let errorMessage = 'An error occurred';

        if (data?.message) {
          errorMessage = data.message;
        } else if (typeof data === 'string') {
          errorMessage = data;
        } else {
          switch (status) {
            case 400:
              errorMessage = 'Bad request';
              break;
            case 401:
              errorMessage = 'Unauthorized. Please login again.';
              break;
            case 403:
              errorMessage = 'Access forbidden';
              break;
            case 404:
              errorMessage = 'Resource not found';
              break;
            case 429:
              errorMessage = 'Too many requests. Please try again later.';
              break;
            case 500:
              errorMessage = 'Internal server error';
              break;
            default:
              errorMessage = `Error ${status}: ${error.response.statusText || 'Unknown error'}`;
          }
        }

        errorHandler(errorMessage);
      }
    } else if (error.request) {
      if (errorHandler && !pageHandlesError) {
        errorHandler('Network error. Please check your connection.');
      }
    } else {
      if (errorHandler && !pageHandlesError) {
        errorHandler(error.message || 'An unexpected error occurred');
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
