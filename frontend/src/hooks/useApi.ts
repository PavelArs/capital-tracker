import { useState, useEffect, useCallback, useRef } from 'react';

interface UseApiOptions<T> {
  initialData?: T;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

interface UseApiResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for data fetching with loading and error states
 *
 * @example
 * const { data, loading, error, refetch } = useApi(
 *   () => assetsApi.getAll(),
 *   [],
 *   { onSuccess: (data) => console.log('Loaded', data.length, 'assets') }
 * );
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
  options: UseApiOptions<T> = {}
): UseApiResult<T> {
  const { initialData, enabled = true, onSuccess, onError } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  // Track if request is in progress to prevent duplicate calls
  const fetchingRef = useRef(false);
  // Track mounted state to prevent state updates after unmount
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (fetchingRef.current) {
      return;
    }

    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
        onSuccess?.(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.(error);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      fetchingRef.current = false;
    }
  }, [fetcher, onSuccess, onError]);

  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      fetchData();
    }

    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch };
}

/**
 * Custom hook for mutations (POST, PUT, DELETE) with loading state
 *
 * @example
 * const { mutate, loading, error } = useMutation(
 *   (data) => assetsApi.create(data),
 *   { onSuccess: () => refetchAssets() }
 * );
 */
export function useMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: {
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error, variables: TVariables) => void;
  } = {}
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TData | null>(null);

  const mutate = useCallback(
    async (variables: TVariables) => {
      setLoading(true);
      setError(null);

      try {
        const result = await mutationFn(variables);
        setData(result);
        options.onSuccess?.(result, variables);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options.onError?.(error, variables);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [mutationFn, options]
  );

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
  }, []);

  return { mutate, loading, error, data, reset };
}
