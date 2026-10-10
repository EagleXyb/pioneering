/**
 * 全局输入偏好读取（键名与 SettingsDialog 保持一致）
 *
 * 由输入框 Hook（useTaskInput）与消息行内编辑 Hook（useMessageEdit）共用，
 * 保证"Enter 发送 / Ctrl+Enter 发送"策略在各入口完全一致。
 */

export interface AppInputPrefs {
  /** false 时需 Ctrl/Cmd + Enter 发送 */
  enterToSend: boolean;
}

const DEFAULT_PREFS: AppInputPrefs = { enterToSend: true };

const STORAGE_KEY = 'app:preferences';

/** 读取全局应用偏好；存储缺失或损坏时回退默认值 */
export function readInputPrefs(): AppInputPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      enterToSend: typeof parsed.enterToSend === 'boolean' ? parsed.enterToSend : true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
