// ============================================================
// usePlatform — 跨平台检测 Hook
// ============================================================

export function usePlatform() {
  const platform = (window as Window).api?.app
    ? 'win32' // fallback, actual platform from preload
    : 'win32'

  // We expose the platform via preload API
  const isMac =
    typeof navigator !== 'undefined' &&
    /mac|darwin|macintosh|mac os x/i.test(navigator.platform || navigator.userAgent)

  const isWindows = !isMac
  const modKey = isMac ? '⌘' : 'Ctrl'

  return { isMac, isWindows, modKey }
}
