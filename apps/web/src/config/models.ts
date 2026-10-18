/**
 * 模型配置 — 集中管理各模式默认使用的模型名，便于统一调整
 */
import type { AppMode } from '../types';

export const DEFAULT_MODEL_BY_MODE: Record<AppMode, string> = {
  chat: 'deepseek-flash',
  pro: 'deepseek-flash',
  task: 'deepseek-flash',
};

/** 获取指定模式的默认模型名 */
export function getDefaultModel(mode: AppMode): string {
  return DEFAULT_MODEL_BY_MODE[mode];
}
