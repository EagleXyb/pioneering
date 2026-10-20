/**
 * useSkillOptions —— 输入框技能选择（pro / task 模式共用）
 *
 * - 技能列表来自 GET /skills，模块级缓存（两个模式共用一次请求），
 *   加载失败不缓存，可经 reload() 重试
 * - 已选技能（多选）由 skillSelectionStore 统一持有（按模式隔离并持久化到
 *   localStorage，key: skill-select:<mode>）；发送路径经 getSelectedSkills 读取
 */
import { useCallback, useEffect, useState } from 'react';
import { getSkills, type SkillBrief } from '../api/skills';
import type { AppMode } from '../types';
import { useSkillSelectionStore } from '../store/skillSelectionStore';

// ---- 模块级列表缓存（全应用只请求一次） ----
interface SkillListSnapshot {
  skills: SkillBrief[];
  /** 技能子系统是否启用（false 时菜单给出管理员提示） */
  enabled: boolean;
}

let skillsCache: SkillListSnapshot | null = null;
let inflight: Promise<SkillListSnapshot> | null = null;

/** 稳定的空数组：避免 selector 每次返回新引用导致重渲染 */
const EMPTY_SELECTION: string[] = [];

function fetchSkills(): Promise<SkillListSnapshot> {
  if (skillsCache) return Promise.resolve(skillsCache);
  if (!inflight) {
    inflight = getSkills()
      .then((resp) => {
        skillsCache = {
          skills: Array.isArray(resp.skills) ? resp.skills : [],
          // 字段缺失时按「启用」处理：兼容旧后端（无 enabled 字段）
          enabled: resp.enabled !== false,
        };
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

export interface UseSkillOptionsReturn {
  skills: SkillBrief[];
  /** 技能子系统总开关（false = 需要管理员在设置中开启） */
  enabled: boolean;
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
  const [skills, setSkills] = useState<SkillBrief[]>(skillsCache?.skills ?? []);
  const [enabled, setEnabled] = useState<boolean>(skillsCache?.enabled ?? true);
  const [loading, setLoading] = useState(skillsCache === null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // 选中态：全局 store（按模式），首帧从 localStorage 载入
  const selected = useSkillSelectionStore((s) => s.byMode[mode]) ?? EMPTY_SELECTION;
  const hydrate = useSkillSelectionStore((s) => s.hydrate);
  const toggle = useSkillSelectionStore((s) => s.toggle);

  useEffect(() => {
    hydrate(mode);
  }, [mode, hydrate]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchSkills()
      .then((snapshot) => {
        if (!alive) return;
        setSkills(snapshot.skills);
        setEnabled(snapshot.enabled);
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
      toggle(mode, name);
    },
    [mode, toggle],
  );

  const isSelected = useCallback(
    (name: string) => selected.includes(name),
    [selected],
  );

  return {
    skills,
    enabled,
    loading,
    error,
    selected,
    isSelected,
    toggleSkill,
    reload,
  };
}
