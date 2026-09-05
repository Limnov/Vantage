/**
 * 通用 API hook
 * - 简化组件中的数据获取
 * - 内置 loading / error 状态
 * - 支持刷新 / 自动刷新
 *
 * 用法：
 *   const { data, loading, error, refresh } = useApi(() => reportsApi.list({...}), { deps: [page] });
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export function useApi<T = any>(
  fetcher: () => Promise<T>,
  options: {
    deps?: any[];
    initialData?: T;
    autoLoad?: boolean;
    onError?: (err: any) => void;
  } = {}
) {
  const { deps = [], initialData = null, autoLoad = true, onError } = options;
  const [data, setData] = useState<T>(initialData as T);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err);
        onError?.(err);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    if (autoLoad) load();
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refresh: load, setData };
}
