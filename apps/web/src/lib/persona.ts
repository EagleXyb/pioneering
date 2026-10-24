/**
 * P1（RP-5）：从本地偏好读取用户 persona / 语言，随 Agent 请求透传。
 *
 * 设计与 SettingsDialog 共用同一个 localStorage key；读取失败时返回 undefined，
 * 保证旧客户端/隐私模式下行为不变。
 */

const PREFS_KEY = 'app:preferences'
const MAX_PERSONA_CHARS = 2000

interface PartialPrefs {
  persona?: unknown
  language?: unknown
}

function readPrefs(): PartialPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 读取 persona；空串/非字符串/超长均安全处理。 */
export function getPersona(): string | undefined {
  const value = readPrefs().persona
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, MAX_PERSONA_CHARS)
  return trimmed === '' ? undefined : trimmed
}

/** 读取角色语言。 */
export function getLocale(): 'zh' | 'en' {
  const value = readPrefs().language
  return value === 'en-US' ? 'en' : 'zh'
}
