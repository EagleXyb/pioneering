// ============================================================
// usePlatform — 跨平台检测 Hook
// 优先通过 IPC 从主进程获取真实平台，再 fallback 到 navigator 检测
// ============================================================

export function usePlatform() {
  const isMac =
    typeof navigator !== 'undefined' &&
    /mac|darwin|macintosh|mac os x/i.test(navigator.platform || navigator.userAgent)

  const isWindows = !isMac
  const modKey = isMac ? '⌘' : 'Ctrl'

  return { isMac, isWindows, modKey }
}
