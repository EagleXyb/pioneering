// ============================================================
// Key Store — LLM / 搜索密钥的 safeStorage 治理（云边双模阶段 2）
//
// 目标：本地模式下 API key 不再依赖 .env 明文文件，经系统密钥库
// （Windows DPAPI / macOS Keychain / Linux libsecret）加密后落
// electron-store；主进程在启动 Agent run 前解密注入 process.env，
// modu-agent 各模块（llm-adapter / search 等）零改动。
//
// 设计：
//   - 受管键白名单：只允许 ENV_VAR_REGISTRY 中的 llm_connection /
//     llm_behavior 类变量，杜绝渲染端被攻陷后注入任意环境变量。
//   - 敏感键（api_key 类）经 safeStorage.encryptString 加密存储；
//     非敏感键（base_url / model / provider）明文存储便于排查。
//   - 注入优先级：safeStorage 配置 > .env 文件 > 系统环境——
//     applySecureKeysToEnv 在 ensureAgentEnv（.env 加载，只填未设值）
//     之前执行即可实现。
//   - listKeys 只回掩码值，明文永不回传渲染端。
// ============================================================

import { safeStorage } from 'electron'
import Store from 'electron-store'

const logger = {
  info: (msg: string, ...args: unknown[]) => console.info(`[key-store] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[key-store] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[key-store] ${msg}`, ...args),
}

/** electron-store 键前缀 */
const SECURE_PREFIX = 'secure.keys.'
const PLAIN_PREFIX = 'plain.keys.'

/** 密文标记前缀（区别于明文值，防混存） */
const ENC_PREFIX = 'enc:v1:'

/** 受管键白名单（对齐 modu-agent config/env.ts 的 llm_connection / llm_behavior 类） */
export interface ManagedKeyDescriptor {
  name: string
  label: string
  placeholder: string
  sensitive: boolean
}

export const MANAGED_KEYS: readonly ManagedKeyDescriptor[] = [
  {
    name: 'LLM_API_KEY',
    label: 'LLM API 密钥',
    placeholder: 'sk-...',
    sensitive: true,
  },
  {
    name: 'LLM_BASE_URL',
    label: 'LLM 端点',
    placeholder: 'https://api.deepseek.com/v1',
    sensitive: false,
  },
  {
    name: 'LLM_DEFAULT_MODEL',
    label: '默认模型',
    placeholder: 'deepseek-chat',
    sensitive: false,
  },
  {
    name: 'MODU_LLM_PROVIDER',
    label: 'LLM Provider',
    placeholder: 'deepseek / glm / qwen / openai',
    sensitive: false,
  },
  {
    name: 'TAVILY_API_KEY',
    label: 'Tavily 搜索密钥',
    placeholder: 'tvly-...',
    sensitive: true,
  },
]

const MANAGED_NAMES = new Set(MANAGED_KEYS.map((k) => k.name))

function findDescriptor(name: string): ManagedKeyDescriptor | undefined {
  return MANAGED_KEYS.find((k) => k.name === name)
}

/** 掩码显示：保留头 4 尾 2，中间 ***；过短全掩码 */
export function maskValue(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '***'
  return `${value.slice(0, 4)}***${value.slice(-2)}`
}

// ============================================================
// KeyStore
// ============================================================

export class KeyStore {
  constructor(private store: Store) {}

  /** 配置展示态：白名单内全部键的掩码值（含未配置项） */
  list(): Array<{ name: string; masked: string; encrypted: boolean }> {
    const out: Array<{ name: string; masked: string; encrypted: boolean }> = []
    for (const d of MANAGED_KEYS) {
      const secure = this.store.get(SECURE_PREFIX + d.name) as string | undefined
      const plain = this.store.get(PLAIN_PREFIX + d.name) as string | undefined
      const value = secure !== undefined ? this.decryptOrNull(secure) : plain
      out.push({
        name: d.name,
        masked: value ? maskValue(value) : '',
        encrypted: secure !== undefined,
      })
    }
    return out
  }

  /**
   * 写入一个受管键。敏感键要求系统密钥库可用（safeStorage），否则拒绝。
   * value 传空串 = 清除该键。
   */
  set(name: string, value: string): { ok: boolean; error?: string } {
    if (!MANAGED_NAMES.has(name)) {
      return { ok: false, error: `不受支持的配置项：${name}` }
    }
    const desc = findDescriptor(name)!
    if (value === '') {
      this.store.delete(SECURE_PREFIX + name)
      this.store.delete(PLAIN_PREFIX + name)
      logger.info('key.deleted name=%s', name)
      return { ok: true }
    }
    if (desc.sensitive) {
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: '系统密钥库不可用（safeStorage），无法安全保存密钥' }
      }
      const buf = safeStorage.encryptString(value)
      this.store.set(SECURE_PREFIX + name, ENC_PREFIX + buf.toString('base64'))
    } else {
      this.store.set(PLAIN_PREFIX + name, value)
    }
    logger.info('key.saved name=%s sensitive=%s', name, desc.sensitive)
    return { ok: true }
  }

  delete(name: string): boolean {
    if (!MANAGED_NAMES.has(name)) return false
    this.store.delete(SECURE_PREFIX + name)
    this.store.delete(PLAIN_PREFIX + name)
    return true
  }

  private decryptOrNull(stored: string): string | null {
    if (!stored.startsWith(ENC_PREFIX)) return null
    try {
      const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(buf)
    } catch (e) {
      logger.error('decrypt.failed err=%s', String(e))
      return null
    }
  }

  /** 读取一个键的明文值（供 env 注入；渲染端不可达） */
  private readValue(name: string): string | null {
    const secure = this.store.get(SECURE_PREFIX + name) as string | undefined
    if (secure !== undefined) return this.decryptOrNull(secure)
    const plain = this.store.get(PLAIN_PREFIX + name) as string | undefined
    return plain ?? null
  }

  /**
   * 把全部已配置键注入 process.env（每次启动 Agent 前调用，幂等）。
   * 返回注入的键名列表（日志用）。
   */
  applyToEnv(): string[] {
    const applied: string[] = []
    for (const d of MANAGED_KEYS) {
      const v = this.readValue(d.name)
      if (v !== null && v !== '') {
        process.env[d.name] = v
        applied.push(d.name)
      }
    }
    if (applied.length > 0) {
      logger.info('env.applied keys=%s', applied.join(','))
    }
    return applied
  }
}

// ---- 单例 ----

let _keyStore: KeyStore | null = null

export function getKeyStore(store: Store): KeyStore {
  if (!_keyStore) _keyStore = new KeyStore(store)
  return _keyStore
}
