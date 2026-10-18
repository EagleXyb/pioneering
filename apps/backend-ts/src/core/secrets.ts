/**
 * LLM 密钥解析（P5）
 *
 * 目标：把「密钥从哪来」从业务代码/网关装配中抽出来，支持两种来源：
 *   - env：沿用 `.env` / 进程环境（默认，兼容现状）
 *   - file：从独立 JSON 文件读取（推荐 0600 权限），便于容器 Secret 挂载
 *
 * 说明：这不是完整的 KMS/Vault 客户端，但把明文从仓库内 `.env` 中移出，
 * 并为后续接入 Secret Manager 保留单一替换点。密钥在进程启动时解析一次，
 * 轮换需重启（或后续增加热更新）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type SecretProviderKind = 'env' | 'file'

export interface LlmSecrets {
  apiKey: string
  baseUrl: string
  source: SecretProviderKind
}

export interface ResolveSecretsOptions {
  provider?: SecretProviderKind
  /** file provider 的路径；空则用 ~/.pioneering/llm-secrets.json */
  filePath?: string
  envFallback: { apiKey: string; baseUrl: string }
}

const DEFAULT_SECRET_FILE = path.join(os.homedir(), '.pioneering', 'llm-secrets.json')

/** 读取 JSON 密钥文件；不存在/格式错误返回 null。 */
export function readSecretsFile(filePath: string): { apiKey: string; baseUrl: string } | null {
  try {
    const stat = fs.statSync(filePath)
    // POSIX 权限检查：仅警告，不阻断（Windows 不支持 mode）
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      console.warn(
        `[llm.secrets] 密钥文件权限过宽（${(stat.mode & 0o777).toString(8)}），建议 chmod 600：${filePath}`,
      )
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
    const llm = (raw.llm ?? raw) as Record<string, unknown>
    const apiKey = typeof llm.apiKey === 'string' ? llm.apiKey : ''
    const baseUrl = typeof llm.baseUrl === 'string' ? llm.baseUrl : ''
    if (!apiKey) return null
    return { apiKey, baseUrl }
  } catch (e) {
    console.warn(`[llm.secrets] 读取密钥文件失败，回退环境变量：${String((e as Error).message)}`)
    return null
  }
}

/** 解析 LLM 密钥（file 优先，失败回退 env）。 */
export function resolveLlmSecrets(opts: ResolveSecretsOptions): LlmSecrets {
  const provider = opts.provider ?? 'env'
  if (provider === 'file') {
    const filePath = opts.filePath?.trim() || DEFAULT_SECRET_FILE
    const fromFile = readSecretsFile(filePath)
    if (fromFile) {
      return {
        apiKey: fromFile.apiKey,
        baseUrl: fromFile.baseUrl || opts.envFallback.baseUrl,
        source: 'file',
      }
    }
  }
  return {
    apiKey: opts.envFallback.apiKey,
    baseUrl: opts.envFallback.baseUrl,
    source: 'env',
  }
}
