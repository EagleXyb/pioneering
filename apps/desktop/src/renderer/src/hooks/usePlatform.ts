// ============================================================
// usePlatform — 跨平台检测 Hook
// 读取由 App 经 IPC 初始化好的 platformAtom（单一数据源），
// 不重复推断，保证全应用平台判断一致。
// ============================================================

import { useAtomValue } from 'jotai'
import { platformAtom } from '@/stores/atoms'

export function usePlatform() {
  const platform = useAtomValue(platformAtom)

  const isMac = platform === 'mac'
  const isWindows = platform === 'windows'
  const isLinux = platform === 'linux'

  return { isMac, isWindows, isLinux, platform }
}
