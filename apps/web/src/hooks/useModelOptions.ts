/**
 * useModelOptions —— 输入框模型选择（P3：切换为能力清单驱动）
 *
 * 数据来源优先级：
 *   1. GET /capabilities（含 alias / provider / capabilities / status）
 *   2. 旧接口 GET /system/models（后端未升级或能力清单失败时的兜底）
 *   3. 本地默认模型（离线兜底）
 *
 * 选择状态仍按模式持久化到 localStorage（key: model-select:<mode>），
 * 旧版本存的是真实 model_id（如 deepseek-v4-flash），这里会自动映射回别名。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getModels, type ModelInfo } from '../api/system';
import { toModelInfo } from '../api/capabilities';
import { useCapabilities } from './useCapabilities';
import { getDefaultModel } from '../config/models';
import type { AppMode } from '../types';

const STORAGE_KEY_PREFIX = 'model-select:';

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

/**
 * 读取指定模式当前选中的模型 id（非 hook 版本）。
 *
 * 供发送动作在提交时取值：与 `ModelSelect` 共用同一个 localStorage key，
 * 因此无需把选择状态层层透传到发送回调，也不会出现"UI 选了但请求没带"的偏差。
 */
export function getSelectedModelId(mode: AppMode): string {
  return readStored(mode);
}

export interface UseModelOptionsReturn {
  models: ModelInfo[];
  /** 当前选中的模型 id（能力清单下为别名，如 fast / reasoning） */
  selectedId: string;
  /** 当前选中的模型信息（列表未就绪时用 id 合成） */
  selectedModel: ModelInfo;
  selectModel: (id: string) => void;
}

export function useModelOptions(mode: AppMode): UseModelOptionsReturn {
  const { models: capabilityModels, loading } = useCapabilities();
  const [legacyModels, setLegacyModels] = useState<ModelInfo[]>([]);
  const [storedId, setStoredId] = useState<string>(() => readStored(mode));

  // 能力清单不可用（旧后端 / 网络失败）时回退到 /system/models
  useEffect(() => {
    if (loading || capabilityModels.length > 0) return;
    let alive = true;
    getModels()
      .then((list) => {
        if (alive && Array.isArray(list)) setLegacyModels(list);
      })
      .catch(() => {
        // 回退失败时保留本地默认模型
      });
    return () => {
      alive = false;
    };
  }, [loading, capabilityModels.length]);

  const models = useMemo<ModelInfo[]>(() => {
    if (capabilityModels.length > 0) return capabilityModels.map(toModelInfo);
    if (legacyModels.length > 0) return legacyModels;
    return [{ id: getDefaultModel(mode), name: getDefaultModel(mode) }];
  }, [capabilityModels, legacyModels, mode]);

  // 兼容旧存储：历史值可能是真实 model_id，映射回别名用于选中态
  const selectedId = useMemo(() => {
    if (models.some((m) => m.id === storedId)) return storedId;
    const byModelId = models.find((m) => m.model_id === storedId);
    return byModelId?.id ?? storedId;
  }, [models, storedId]);

  useEffect(() => {
    setStoredId(readStored(mode));
  }, [mode]);

  const selectModel = useCallback(
    (id: string) => {
      setStoredId(id);
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
