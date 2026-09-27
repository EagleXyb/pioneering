// ============================================================
// 表单校验（演示站纯前端使用，正式接入后端时规则保持一致）
// ============================================================

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

// 联系方式：含 @ 按邮箱校验；纯数字/空格/横线/加号按电话（≥7 位）；
// 其余按其他联系方式处理（如微信号，至少 4 个字符）。
export function isContact(value: string): boolean {
  const v = value.trim()
  if (v.includes('@')) return isEmail(v)
  if (/^[\d\s+-]+$/.test(v)) return v.replace(/[\s+-]/g, '').length >= 7
  return v.length >= 4
}
