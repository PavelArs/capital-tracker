import type { ApiError } from '@shared/types';
import axios, { AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Error handler function - will be set from ErrorContext
let errorHandler: ((message: string) => void) | null = null;

export function setErrorHandler(handler: (message: string) => void): void {
  errorHandler = handler;
}

// Request interceptor for adding auth token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError<ApiError>) => {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      // Handle 401 - Unauthorized
      if (status === 401) {
        localStorage.removeItem('token');
        // Don't redirect on login/register pages
        if (
          !window.location.pathname.includes('/login') &&
          !window.location.pathname.includes('/register')
        ) {
          window.location.href = '/login';
        }
      }

      if (status >= 400 && errorHandler) {
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
      if (errorHandler) {
        errorHandler('Network error. Please check your connection.');
      }
    } else {
      if (errorHandler) {
        errorHandler(error.message || 'An unexpected error occurred');
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
