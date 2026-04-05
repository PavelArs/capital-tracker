import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Configure axios defaults
axios.defaults.baseURL = API_URL;

// Error handler function - will be set from ErrorContext
let errorHandler: ((message: string) => void) | null = null;

export function setErrorHandler(handler: (message: string) => void) {
  errorHandler = handler;
}

// Response interceptor for handling errors globally
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const data = error.response.data;

      if (status >= 400 && errorHandler) {
        // Extract error message
        let errorMessage = 'An error occurred';

        if (data?.message) {
          errorMessage = data.message;
        } else if (typeof data === 'string') {
          errorMessage = data;
        } else if (data?.error) {
          errorMessage = data.error;
        } else {
          // Default messages for common status codes
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
      // Request was made but no response received
      if (errorHandler) {
        errorHandler('Network error. Please check your connection.');
      }
    } else {
      // Something else happened
      if (errorHandler) {
        errorHandler(error.message || 'An unexpected error occurred');
      }
    }

    return Promise.reject(error);
  },
);

export default axios;
