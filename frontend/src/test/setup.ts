import '@testing-library/jest-dom/vitest';
import { forgetReads } from '@api/read-cache';
import { beforeEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock import.meta.env
vi.stubGlobal('import.meta.env', {
  VITE_API_URL: 'http://localhost:3000',
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  // Every test starts as a fresh visit: nothing kept from an earlier one.
  forgetReads();
});
