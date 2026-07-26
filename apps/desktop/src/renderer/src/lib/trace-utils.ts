// ============================================================
// Trace 工具函数
// ============================================================

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}
