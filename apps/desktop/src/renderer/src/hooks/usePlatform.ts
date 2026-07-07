// ============================================================
// usePlatform — 跨平台检测 Hook
// 读取由 App 经 IPC 初始化好的 platformAtom（单一数据源），
// 不重复推断，保证全应用平台判断一致。
// ============================================================

import { useAtomValue } from 'jotai'
import { platformAtom, isFullscreenAtom } from '@/stores/atoms'

export function usePlatform() {
  const platform = useAtomValue(platformAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)

  const isMac = platform === 'mac'
  const isWindows = platform === 'windows'
  const isLinux = platform === 'linux'
  // 唯一的结构性差异：macOS 使用原生红绿灯，Win/Linux 由渲染端自绘控件
  const hasNativeWindowControls = platform === 'mac'

  return { isMac, isWindows, isLinux, isFullscreen, hasNativeWindowControls, platform }
}
