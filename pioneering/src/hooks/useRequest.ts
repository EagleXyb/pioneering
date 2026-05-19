import { useState, useCallback, useRef, useEffect } from 'react';

interface UseRequestState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseRequestOptions {
  manual?: boolean;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
}

export function useRequest<T = any>(
  requestFn: (...args: any[]) => Promise<T>,
  options: UseRequestOptions = {},
) {
  const { manual = false, onSuccess, onError } = options;
  const [state, setState] = useState<UseRequestState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: any[]) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await requestFn(...args);
        if (mountedRef.current) {
          setState({ data: result, loading: false, error: null });
          onSuccess?.(result);
        }
        return result;
      } catch (err: any) {
        if (mountedRef.current) {
          setState({
            data: null,
            loading: false,
            error: err?.message || '请求失败',
          });
          onError?.(err);
        }
        throw err;
      }
    },
    [requestFn, onSuccess, onError],
  );

  const refresh = useCallback(() => run(), [run]);

  const mutate = useCallback((newData: T | ((prev: T | null) => T)) => {
    setState((prev) => ({
      ...prev,
      data: typeof newData === 'function' ? (newData as Function)(prev.data) : newData,
    }));
  }, []);

  useEffect(() => {
    if (!manual) run();
  }, [manual, run]);

  return { ...state, run, refresh, mutate };
}
