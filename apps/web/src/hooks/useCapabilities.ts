/**
 * useCapabilities —— 模型能力清单（P3）
 *
 * - 全应用一次请求，模块级缓存 + in-flight 复用（三模式共用）
 * - 失败不缓存，下次挂载可重试
 * - 与 useModelOptions 分离：本 hook 只负责取数，不处理选择状态
 */
import { useEffect, useState } from 'react';
import { getCapabilities, type CapabilityModel } from '../api/capabilities';

let cache: CapabilityModel[] | null = null;
let inflight: Promise<CapabilityModel[]> | null = null;

export function fetchCapabilities(): Promise<CapabilityModel[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getCapabilities()
      .then((res) => {
        const models = Array.isArray(res?.models) ? res.models : [];
        cache = models;
        return models;
      })
      .catch(() => {
        inflight = null;
        return [];
      });
  }
  return inflight;
}

/** 测试辅助：清空模块缓存，避免用例间串扰。 */
export function _resetCapabilitiesCacheForTest(): void {
  cache = null;
  inflight = null;
}

export interface UseCapabilitiesReturn {
  models: CapabilityModel[];
  loading: boolean;
}

export function useCapabilities(): UseCapabilitiesReturn {
  const [models, setModels] = useState<CapabilityModel[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    if (cache) {
      setModels(cache);
      setLoading(false);
      return;
    }
    let alive = true;
    void fetchCapabilities().then((list) => {
      if (!alive) return;
      setModels(list);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { models, loading };
}
