import { useState, useCallback, useRef } from 'react';

interface PaginationParams {
  page: number;
  pageSize: number;
}

interface UsePaginationOptions<T> {
  fetchFn: (params: PaginationParams) => Promise<{ list: T[]; total: number }>;
  defaultPageSize?: number;
}

export function usePagination<T>(options: UsePaginationOptions<T>) {
  const { fetchFn, defaultPageSize = 20 } = options;
  const [list, setList] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasMore = list.length < total;
  const pageRef = useRef(page);

  const loadData = useCallback(
    async (isRefresh = false) => {
      const currentPage = isRefresh ? 1 : page;
      if (!isRefresh && loadingMore) return;

      if (isRefresh) {
        pageRef.current = 1;
        setPage(1);
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const res = await fetchFn({ page: currentPage, pageSize: defaultPageSize });
        if (isRefresh) {
          setList(res.list);
        } else {
          setList((prev) => [...prev, ...res.list]);
        }
        setTotal(res.total);
        pageRef.current = currentPage + 1;
        setPage(currentPage + 1);
      } catch (err: any) {
        setError(err?.message || '加载失败');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [fetchFn, page, defaultPageSize, loadingMore],
  );

  const refresh = useCallback(() => loadData(true), [loadData]);
  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore) loadData(false);
  }, [hasMore, loadingMore, loadData]);

  return {
    list,
    loading,
    loadingMore,
    error,
    hasMore,
    total,
    refresh,
    loadMore,
    setList,
  };
}
