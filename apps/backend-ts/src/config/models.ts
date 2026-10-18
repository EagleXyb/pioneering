// 模型标识单一事实源（P0 建立，P1 扩展为目录）
//
// 背景：改造前"默认模型"在三个地方各自定义 ——
//   - apps/backend-ts/src/config/env.ts     默认 deepseek-chat
//   - apps/backend-ts/src/routes/system.ts  目录里没有 deepseek-chat
//   - apps/web/src/config/models.ts         默认 deepseek-v4-flash
// 一旦 .env 缺失，后端会请求一个目录中并不存在的模型。
//
// 本模块职责：
//   1. 默认模型 / 推理模型常量；
//   2. 可用模型目录（含别名、provider、能力标签、状态）；
//   3. 别名 → 真实模型 ID 的映射与解析（P1 起由 llm-gateway 的 ModelCatalog 复用）。
//
// 设计约束：
//   - 纯常量与纯函数，不 import env / prisma / fastify，避免循环依赖；
//   - 不读取 process.env：需要环境覆盖时由 env.ts 提供。

/** 默认对话模型（.env 未配置时的兜底） */
export const DEFAULT_MODEL = 'deepseek-flash'

/** 默认别名（会话持久化、前端未指定时使用） */
export const DEFAULT_ALIAS = 'fast'

/** 深度思考模型（deepThink / reasoning 场景） */
export const REASONING_MODEL = 'deepseek-v4-pro'

/**
 * 可用模型目录。
 *
 * P0 只保留真实可用的两个模型：改造前目录里的 gpt-4o / glm-5.3 / minimax-m3
 * 等条目会被原样发往同一个 DeepSeek 端点，选中必然失败，属"可选但不可用"。
 * P1 在字段上补齐 alias / provider / capabilities / status，供 /capabilities 使用。
 */
export const AVAILABLE_MODELS = [
  {
    alias: 'fast',
    id: DEFAULT_MODEL,
    provider: 'deepseek',
    capabilities: ['tools', 'json_mode', 'long_context'] as const,
    status: 'active' as const,
    name: 'DeepSeek-V4.1-Flash',
    description: 'DeepSeek 标准对话模型（默认，速度快、成本低）',
    max_tokens: 128000,
    pricing: { input_price: 0.14, output_price: 0.28 },
  },
  {
    alias: 'reasoning',
    id: REASONING_MODEL,
    provider: 'deepseek',
    capabilities: ['tools', 'json_mode', 'reasoning', 'long_context'] as const,
    status: 'active' as const,
    name: 'DeepSeek-V4-Pro',
    description: 'DeepSeek 深度思考模型（deepThink 模式，更强的推理能力）',
    max_tokens: 128000,
    pricing: { input_price: 0.28, output_price: 0.56 },
  },
] as const

/**
 * 历史模型 ID → 当前模型 ID。
 *
 * 兼容升级前落库的用量记录、客户端本地缓存的选择值、仍按旧 ID 发请求的调用方。
 * 上游对旧 ID 仍可解析，但对外目录只暴露当前 ID。
 */
export const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'deepseek-v4-flash': 'deepseek-flash',
}

/**
 * 别名表：客户端可用别名表达意图，服务端解析为真实模型 ID。
 *
 * 由目录派生，避免"目录改了别名没改"的漂移；历史 ID 一并纳入解析。
 */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(AVAILABLE_MODELS.map((m) => [m.alias, m.id])),
  ...LEGACY_MODEL_ALIASES,
}

/**
 * 解析模型别名。
 *
 * - 命中别名 → 返回对应真实模型 ID
 * - 未命中   → 原样返回（视为调用方直接指定 model id，保持既有行为）
 * - 空值     → 返回 undefined，由调用方回退到默认模型
 */
export function resolveModelAlias(input?: string | null): string | undefined {
  if (!input) return undefined
  return MODEL_ALIASES[input] ?? input
}

/**
 * 解析为客户端可见的别名（P4）。
 *
 * 会话表 `ChatSession.model` 统一存别名：模型升级时只改目录，不迁移历史会话；
 * 未知值原样返回，避免把用户显式指定的模型悄悄换掉。
 */
export function toModelAlias(input?: string | null): string | undefined {
  if (!input) return undefined
  const resolved = MODEL_ALIASES[input] ?? input
  const found = AVAILABLE_MODELS.find(
    (m) => m.id === resolved || m.alias === resolved,
  )
  return found?.alias ?? input
}
