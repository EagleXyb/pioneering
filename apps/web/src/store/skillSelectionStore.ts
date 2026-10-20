/**
 * skillSelectionStore —— 输入框「技能」选择的单一事实源（按模式隔离）
 *
 * 背景（P0 选择→执行）：
 *   改造前选中态住在 SkillPicker 内部的 useSkillOptions 实例里，发送方
 *   （useAgentChat / usePlanExecuteChat）读不到，导致「勾选不生效」。
 *   提升为全局 store 后：Picker 负责写、发送路径负责读，二者共享同一份状态。
 *
 * 持久化策略与改造前保持一致：localStorage 的 `skill-select:<mode>`
 * （JSON 字符串数组），保证既有用户选择不丢失。
 */
import { create } from 'zustand';
import type { AppMode } from '../types';

const STORAGE_KEY_PREFIX = 'skill-select:';

/** 某模式的持久化键（导出供测试断言） */
export function skillStorageKey(mode: AppMode): string {
  return `${STORAGE_KEY_PREFIX}${mode}`;
}

/** 从 localStorage 读取某模式的选择；不可用 / 损坏时按未选择处理 */
export function readStoredSkills(mode: AppMode): string[] {
  try {
    const raw = localStorage.getItem(skillStorageKey(mode));
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

function writeStoredSkills(mode: AppMode, names: string[]): void {
  try {
    localStorage.setItem(skillStorageKey(mode), JSON.stringify(names));
  } catch {
    // 持久化失败不影响本次选择
  }
}

interface SkillSelectionState {
  /** 模式 → 已选技能名（undefined 表示尚未 hydrate） */
  byMode: Partial<Record<AppMode, string[]>>;
  /** 首次使用某模式时从 localStorage 载入（幂等） */
  hydrate: (mode: AppMode) => void;
  /** 勾选 / 取消勾选（多选） */
  toggle: (mode: AppMode, name: string) => void;
  /** 覆盖某模式的选择 */
  setSelected: (mode: AppMode, names: string[]) => void;
  /** 清空某模式的选择（回到「服务端默认」语义） */
  clear: (mode: AppMode) => void;
}

export const useSkillSelectionStore = create<SkillSelectionState>((set, get) => ({
  byMode: {},

  hydrate: (mode) => {
    if (get().byMode[mode] !== undefined) return;
    set((state) => ({
      byMode: { ...state.byMode, [mode]: readStoredSkills(mode) },
    }));
  },

  toggle: (mode, name) => {
    const current = get().byMode[mode] ?? readStoredSkills(mode);
    const next = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name];
    writeStoredSkills(mode, next);
    set((state) => ({ byMode: { ...state.byMode, [mode]: next } }));
  },

  setSelected: (mode, names) => {
    const next = [...new Set(names.filter((n) => typeof n === 'string' && n.trim()))];
    writeStoredSkills(mode, next);
    set((state) => ({ byMode: { ...state.byMode, [mode]: next } }));
  },

  clear: (mode) => {
    writeStoredSkills(mode, []);
    set((state) => ({ byMode: { ...state.byMode, [mode]: [] } }));
  },
}));

/**
 * 非 React 调用方（发送路径）读取当前选择。
 *
 * 未 hydrate 时回退到 localStorage，避免「首帧即发送」读不到已保存的选择。
 */
export function getSelectedSkills(mode: AppMode): string[] {
  const cached = useSkillSelectionStore.getState().byMode[mode];
  return [...(cached ?? readStoredSkills(mode))];
}

/** 测试辅助：清空全部模式的选择 */
export function _resetSkillSelectionForTest(): void {
  useSkillSelectionStore.setState({ byMode: {} });
}
