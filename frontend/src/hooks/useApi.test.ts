import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useApi, useMutation } from './useApi';

describe('useApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should start with loading true when enabled', () => {
      const fetcher = vi.fn().mockResolvedValue([]);

      const { result } = renderHook(() => useApi(fetcher));

      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBeUndefined();
      expect(result.current.error).toBeNull();
    });

    it('should use initial data when provided', async () => {
      const fetcher = vi.fn().mockResolvedValue(['new data']);
      const initialData = ['initial'];

      const { result } = renderHook(() => useApi(fetcher, [], { initialData }));

      expect(result.current.data).toEqual(['initial']);
    });

    it('should not fetch when disabled', async () => {
      const fetcher = vi.fn().mockResolvedValue([]);

      const { result } = renderHook(() => useApi(fetcher, [], { enabled: false }));

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(false);
    });
  });

  describe('data fetching', () => {
    it('should fetch data on mount', async () => {
      const mockData = [{ id: 1, name: 'Test' }];
      const fetcher = vi.fn().mockResolvedValue(mockData);

      const { result } = renderHook(() => useApi(fetcher));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual(mockData);
      expect(result.current.error).toBeNull();
    });

    it('should handle fetch error', async () => {
      const error = new Error('Network error');
      const fetcher = vi.fn().mockRejectedValue(error);

      const { result } = renderHook(() => useApi(fetcher));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toEqual(error);
      expect(result.current.data).toBeUndefined();
    });

    it('should convert non-Error objects to Error', async () => {
      const fetcher = vi.fn().mockRejectedValue('String error');

      const { result } = renderHook(() => useApi(fetcher));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('String error');
    });
  });

  describe('callbacks', () => {
    it('should call onSuccess callback', async () => {
      const mockData = [{ id: 1 }];
      const fetcher = vi.fn().mockResolvedValue(mockData);
      const onSuccess = vi.fn();

      renderHook(() => useApi(fetcher, [], { onSuccess }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(mockData);
      });
    });

    it('should call onError callback', async () => {
      const error = new Error('Failed');
      const fetcher = vi.fn().mockRejectedValue(error);
      const onError = vi.fn();

      renderHook(() => useApi(fetcher, [], { onError }));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(error);
      });
    });
  });

  describe('refetch', () => {
    it('should refetch data when refetch is called', async () => {
      const mockData = [{ id: 1 }];
      const fetcher = vi.fn().mockResolvedValue(mockData);

      const { result } = renderHook(() => useApi(fetcher));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refetch();
      });

      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('dependency changes', () => {
    it('should refetch when dependencies change', async () => {
      const mockData = [{ id: 1 }];
      const fetcher = vi.fn().mockResolvedValue(mockData);

      const { result, rerender } = renderHook(
        ({ dep }) => useApi(fetcher, [dep]),
        { initialProps: { dep: 1 } }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetcher).toHaveBeenCalledTimes(1);

      rerender({ dep: 2 });

      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledTimes(2);
      });
    });
  });
});

describe('useMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should start with loading false', () => {
      const mutationFn = vi.fn();

      const { result } = renderHook(() => useMutation(mutationFn));

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.data).toBeNull();
    });
  });

  describe('mutation execution', () => {
    it('should execute mutation and return data', async () => {
      const mockData = { id: 1, name: 'Created' };
      const mutationFn = vi.fn().mockResolvedValue(mockData);

      const { result } = renderHook(() => useMutation(mutationFn));

      let returnedData;
      await act(async () => {
        returnedData = await result.current.mutate({ name: 'Test' });
      });

      expect(mutationFn).toHaveBeenCalledWith({ name: 'Test' });
      expect(result.current.data).toEqual(mockData);
      expect(returnedData).toEqual(mockData);
      expect(result.current.loading).toBe(false);
    });

    it('should handle mutation error', async () => {
      const error = new Error('Mutation failed');
      const mutationFn = vi.fn().mockRejectedValue(error);

      const { result } = renderHook(() => useMutation(mutationFn));

      await act(async () => {
        try {
          await result.current.mutate({ name: 'Test' });
        } catch {
          // Expected error
        }
      });

      expect(result.current.error).toEqual(error);
      expect(result.current.data).toBeNull();
    });

    it('should convert non-Error to Error', async () => {
      const mutationFn = vi.fn().mockRejectedValue('String error');

      const { result } = renderHook(() => useMutation(mutationFn));

      await act(async () => {
        try {
          await result.current.mutate({});
        } catch {
          // Expected error
        }
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('String error');
    });

    it('should set loading during mutation', async () => {
      let resolveMutation: (value: { id: number }) => void;
      const mutationPromise = new Promise<{ id: number }>((resolve) => {
        resolveMutation = resolve;
      });
      const mutationFn = vi.fn().mockImplementation(() => mutationPromise);

      const { result } = renderHook(() => useMutation(mutationFn));

      // Start mutation
      act(() => {
        result.current.mutate({});
      });

      // During mutation, loading should be true
      expect(result.current.loading).toBe(true);

      // Resolve the mutation
      await act(async () => {
        resolveMutation!({ id: 1 });
        await mutationPromise;
      });

      expect(result.current.loading).toBe(false);
    });
  });

  describe('callbacks', () => {
    it('should call onSuccess callback', async () => {
      const mockData = { id: 1 };
      const mutationFn = vi.fn().mockResolvedValue(mockData);
      const onSuccess = vi.fn();

      const { result } = renderHook(() => useMutation(mutationFn, { onSuccess }));

      await act(async () => {
        await result.current.mutate({ name: 'Test' });
      });

      expect(onSuccess).toHaveBeenCalledWith(mockData, { name: 'Test' });
    });

    it('should call onError callback', async () => {
      const error = new Error('Failed');
      const mutationFn = vi.fn().mockRejectedValue(error);
      const onError = vi.fn();

      const { result } = renderHook(() => useMutation(mutationFn, { onError }));

      await act(async () => {
        try {
          await result.current.mutate({ name: 'Test' });
        } catch {
          // Expected
        }
      });

      expect(onError).toHaveBeenCalledWith(error, { name: 'Test' });
    });
  });

  describe('reset', () => {
    it('should reset state', async () => {
      const mockData = { id: 1 };
      const mutationFn = vi.fn().mockResolvedValue(mockData);

      const { result } = renderHook(() => useMutation(mutationFn));

      await act(async () => {
        await result.current.mutate({});
      });

      expect(result.current.data).toEqual(mockData);

      act(() => {
        result.current.reset();
      });

      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });
});

