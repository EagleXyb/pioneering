import { useLocation } from 'react-router';
import type { AppMode } from '../types';

/**
 * 从路由派生当前模式，作为 mode 的唯一真理来源。
 * 直接访问 /pro 等路径时也能立即返回正确值，避免 appStore.mode 与路由不同步。
 */
export function useMode(): AppMode {
  const { pathname } = useLocation();
  const match = pathname.match(/^\/(chat|pro|task)/);
  return (match?.[1] as AppMode) ?? 'chat';
}
