/**
 * useModelOptions —— 输入框模型选择
 *
 * - 模型列表来自 GET /system/models，模块级缓存（三个模式共用一次请求）
 * - 当前选择按模式持久化到 localStorage（key: model-select:<mode>），
 *   默认值取 config/models.ts 的 DEFAULT_MODEL_BY_MODE
 * - 后端不可达时退化为仅包含默认模型的单元素列表，选择器仍可渲染
 */
import { useCallback, useEffect, useState } from 'react';
import { getModels, type ModelInfo } from '../api/system';
import { getDefaultModel } from '../config/models';
import type { AppMode } from '../types';

const STORAGE_KEY_PREFIX = 'model-select:';

// ---- 模块级列表缓存（全应用只请求一次） ----
let modelsCache: ModelInfo[] | null = null;
let inflight: Promise<ModelInfo[]> | null = null;

function fetchModels(): Promise<ModelInfo[]> {
  if (modelsCache) return Promise.resolve(modelsCache);
  if (!inflight) {
    inflight = getModels()
      .then((list) => {
        modelsCache = Array.isArray(list) ? list : [];
        return modelsCache;
      })
      .catch(() => {
        // 失败不缓存：下次挂载可重试
        inflight = null;
        return [];
      });
  }
  return inflight;
}

function storageKey(mode: AppMode): string {
  return `${STORAGE_KEY_PREFIX}${mode}`;
}

function readStored(mode: AppMode): string {
  try {
    const v = localStorage.getItem(storageKey(mode));
    if (v && v.trim()) return v;
  } catch {
    // localStorage 不可用时忽略
  }
  return getDefaultModel(mode);
}

export interface UseModelOptionsReturn {
  models: ModelInfo[];
  /** 当前选中的模型 id */
  selectedId: string;
  /** 当前选中的模型信息（列表未就绪时用 id 合成） */
  selectedModel: ModelInfo;
  selectModel: (id: string) => void;
}

export function useModelOptions(mode: AppMode): UseModelOptionsReturn {
  const fallbackModel: ModelInfo = {
    id: getDefaultModel(mode),
    name: getDefaultModel(mode),
  };
  const [models, setModels] = useState<ModelInfo[]>(
    modelsCache ?? [fallbackModel],
  );
  const [selectedId, setSelectedId] = useState<string>(() => readStored(mode));

  useEffect(() => {
    let alive = true;
    fetchModels().then((list) => {
      if (alive && list.length > 0) setModels(list);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 切换模式时同步该模式的持久化选择
  useEffect(() => {
    setSelectedId(readStored(mode));
  }, [mode]);

  const selectModel = useCallback(
    (id: string) => {
      setSelectedId(id);
      try {
        localStorage.setItem(storageKey(mode), id);
      } catch {
        // 持久化失败不影响本次选择
      }
    },
    [mode],
  );

  const selectedModel =
    models.find((m) => m.id === selectedId) ?? {
      id: selectedId,
      name: selectedId,
    };

  return { models, selectedId, selectedModel, selectModel };
}
