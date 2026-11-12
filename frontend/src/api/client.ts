import type { ApiError } from '@shared/types';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { connection } from './connection';
import { forgetReads } from './read-cache';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Set on the one repeat of a read that timed out or met a gateway error. */
    retried?: boolean;
    /** A POST that only reads (its body keeps private terms out of URLs): kept answers stay. */
    changesNothing?: boolean;
  }
}

// A read that timed out, lost the connection or met a gateway error is asked once more: the
// server often finished the work meanwhile (a snapshot rebuild, a restarting container), so the
// owner would only have pressed "Try again" to see the page.
const RETRY_DELAY_MS = 500;
const GATEWAY_STATUSES = [502, 503, 504];

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

function worthRepeating(error: AxiosError): boolean {
  const { config } = error;
  if (!config || config.retried || isUnsafeRequest(config) || error.code === 'ERR_CANCELED') {
    return false;
  }
  if (error.response) return GATEWAY_STATUSES.includes(error.response.status);
  return ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(error.code ?? '');
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
    else connection.started(config, apiClient.getUri(config));
    requestAuthentication.set(config, authenticationVersion);
    return config;
  },
  (error) => Promise.reject(error),
);

/** The pages that say why their requests failed themselves, so the client raises no notice. */
function pageHandlesError(config?: InternalAxiosRequestConfig): boolean {
  const url = config?.url || '';
  return (
    ['/auth/login', '/auth/mfa', '/auth/logout', '/auth/csrf'].includes(url) ||
    [
      '/accounting/',
      '/brokers/',
      '/deposits',
      '/goals',
      '/auth/password-reset',
      '/auth/security',
      '/export/',
    ].some((prefix) => url.startsWith(prefix)) ||
    // Wallets, inflation and Settings say why a save failed themselves. Reads stay here: some
    // (the main currency, the bell, token chains) swallow a failure, so this notice is their only one.
    (isUnsafeRequest(config) &&
      ['/wallet-addresses', '/inflation', '/owner-settings'].some((prefix) =>
        url.startsWith(prefix),
      ))
  );
}

/** A write refused with 403 gets a fresh CSRF token for a later, explicit retry. */
async function renewRefusedCsrf(config?: InternalAxiosRequestConfig): Promise<void> {
  // A delayed rejection must not discard a newer login or another refresh.
  if (config?.headers.get('X-CSRF-Token') === csrfToken) setCsrfToken(null);
  try {
    await getCsrfToken();
  } catch {
    // Preserve the original failure. Only a later explicit action may retry.
  }
}

/** A 401 ends the session unless it answers a sign-in step or an authentication now replaced. */
function endsSession(config?: InternalAxiosRequestConfig): boolean {
  return (
    !['/auth/login', '/auth/mfa'].includes(config?.url || '') &&
    !!config &&
    requestAuthentication.get(config) === authenticationVersion
  );
}

const STATUS_NOTICES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized. Please login again.',
  403: 'Access forbidden',
  404: 'Resource not found',
  429: 'Too many requests. Please try again later.',
};

/** The notice for a refusal: the server's own words, or what its status means. */
function refusalNotice(response: AxiosResponse<ApiError>): string {
  const { status, data } = response;
  // A server error's own text ("Internal server error") tells the owner nothing.
  if (status >= 500) return "The server didn't answer. Try again in a moment.";
  if (data?.message) return data.message;
  if (typeof data === 'string') return data;
  return STATUS_NOTICES[status] ?? `Error ${status}: ${response.statusText || 'Unknown error'}`;
}

/** Whether the server answered: undefined for a request cancelled or about to be asked again. */
function answeredRead(error: AxiosError, cancelled: boolean): boolean | undefined {
  if (cancelled || worthRepeating(error)) return undefined;
  const status = error.response?.status;
  return status !== undefined && status < 500;
}

/** A write that may have saved something, unlike a POST that only reads. */
const changeUnanswered = (config?: InternalAxiosRequestConfig) =>
  isUnsafeRequest(config) && !config?.changesNothing;

/** The notice for a failure its page does not explain itself. */
function raiseNotice(error: AxiosError<ApiError>): void {
  if (!errorHandler || pageHandlesError(error.config)) return;
  if (!error.response) {
    errorHandler(
      error.request
        ? 'No connection. Check your network and try again.'
        : error.message || 'An unexpected error occurred',
    );
    return;
  }
  const status = error.response.status;
  const anonymousProfile = status === 401 && error.config?.url === '/auth/me';
  if (status >= 400 && !anonymousProfile) errorHandler(refusalNotice(error.response));
}

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    connection.settled(response.config, true, apiClient.getUri(response.config));
    // A change by the owner (or a sign-in or sign-out) makes every kept answer old.
    if (isUnsafeRequest(response.config) && !response.config.changesNothing) forgetReads();
    return response;
  },
  async (error: AxiosError<ApiError>) => {
    // A change that got no answer may have been saved: the kept answers may be old as well. A
    // POST that only reads changed nothing either way, and a request the page cancelled (a
    // preview superseded by the next keystroke) is not a change that went missing.
    const cancelled = axios.isCancel(error) || error.code === 'ERR_CANCELED';
    // A read the server did not answer (no answer, or a 5xx) means what is shown may be kept
    // from before; one it answered, even with a refusal, means it is reachable.
    if (error.config)
      connection.settled(
        error.config,
        answeredRead(error, cancelled),
        apiClient.getUri(error.config),
      );
    if (!error.response && !cancelled && changeUnanswered(error.config)) forgetReads();
    if (worthRepeating(error) && error.config) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return apiClient({ ...error.config, retried: true });
    }
    const status = error.response?.status;
    if (status === 403 && isUnsafeRequest(error.config)) await renewRefusedCsrf(error.config);
    if (status === 401 && endsSession(error.config)) {
      setCsrfToken(null);
      forgetReads();
      // React navigation preserves in-memory commands; the original request still rejects.
      unauthorizedRegistration?.notify();
    }
    raiseNotice(error);

    return Promise.reject(error);
  },
);

export default apiClient;
