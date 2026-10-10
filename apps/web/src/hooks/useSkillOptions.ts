/**
 * useSkillOptions —— 输入框技能选择（pro / task 模式共用）
 *
 * - 技能列表来自 GET /skills，模块级缓存（两个模式共用一次请求），
 *   加载失败不缓存，可经 reload() 重试
 * - 已选技能（多选）按模式持久化到 localStorage（key: skill-select:<mode>，
 *   JSON 字符串数组），与 useModelOptions 的持久化策略一致
 */
import { useCallback, useEffect, useState } from 'react';
import { getSkills, type SkillBrief } from '../api/skills';
import type { AppMode } from '../types';

const STORAGE_KEY_PREFIX = 'skill-select:';

// ---- 模块级列表缓存（全应用只请求一次） ----
let skillsCache: SkillBrief[] | null = null;
let inflight: Promise<SkillBrief[]> | null = null;

function fetchSkills(): Promise<SkillBrief[]> {
  if (skillsCache) return Promise.resolve(skillsCache);
  if (!inflight) {
    inflight = getSkills()
      .then((resp) => {
        skillsCache = Array.isArray(resp.skills) ? resp.skills : [];
        return skillsCache;
      })
      .catch((e: unknown) => {
        // 失败不缓存：下次挂载 / reload 可重试
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

/** 从未知异常中提取 message，取不到时用 fallback。 */
function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

function storageKey(mode: AppMode): string {
  return `${STORAGE_KEY_PREFIX}${mode}`;
}

function readStored(mode: AppMode): string[] {
  try {
    const raw = localStorage.getItem(storageKey(mode));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    // localStorage 不可用 / 内容损坏时按未选择处理
  }
  return [];
}

export interface UseSkillOptionsReturn {
  skills: SkillBrief[];
  loading: boolean;
  error: string | null;
  /** 已勾选的技能名（按模式持久化） */
  selected: string[];
  isSelected: (name: string) => boolean;
  /** 勾选 / 取消勾选（多选） */
  toggleSkill: (name: string) => void;
  /** 强制重新拉取列表（忽略模块缓存） */
  reload: () => void;
}

export function useSkillOptions(mode: AppMode): UseSkillOptionsReturn {
  const [skills, setSkills] = useState<SkillBrief[]>(skillsCache ?? []);
  const [loading, setLoading] = useState(skillsCache === null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(() => readStored(mode));
  const [reloadTick, setReloadTick] = useState(0);

  // 切换模式时同步该模式的持久化选择
  useEffect(() => {
    setSelected(readStored(mode));
  }, [mode]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchSkills()
      .then((list) => {
        if (!alive) return;
        setSkills(list);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errorMessage(e, '技能列表加载失败'));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadTick]);

  const reload = useCallback(() => {
    skillsCache = null;
    inflight = null;
    setReloadTick((t) => t + 1);
  }, []);

  const toggleSkill = useCallback(
    (name: string) => {
      setSelected((prev) => {
        const next = prev.includes(name)
          ? prev.filter((n) => n !== name)
          : [...prev, name];
        try {
          localStorage.setItem(storageKey(mode), JSON.stringify(next));
        } catch {
          // 持久化失败不影响本次选择
        }
        return next;
      });
    },
    [mode],
  );

  const isSelected = useCallback(
    (name: string) => selected.includes(name),
    [selected],
  );

  return {
    skills,
    loading,
    error,
    selected,
    isSelected,
    toggleSkill,
    reload,
  };
}
