export type StepStatus = 'pending' | 'streaming' | 'success' | 'error'

export function statusToTagTheme(status: StepStatus): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'pending':
      return 'default'
    case 'streaming':
      return 'warning'
    case 'success':
      return 'success'
    case 'error':
      return 'danger'
  }
}

export function statusToLabel(status: StepStatus, defaultLabel: string): string {
  if (status === 'pending') return '等待中'
  if (status === 'streaming') return '执行中'
  if (status === 'success') return '已完成'
  if (status === 'error') return '失败'
  return defaultLabel
}

export function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
