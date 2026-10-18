// 宿主注入的 LLM 连接解析器（P2）
//
// 背景：改造前 modu-agent 自己读 `MODU_*` / `LLM_*` 环境变量构造连接参数，
// 导致同一进程内无法按任务/租户切换密钥，也无法让宿主统一做目录解析与密钥托管。
//
// 设计：
//   - 宿主可注册 resolver，按 provider / model 返回 apiKey / baseUrl / model / timeout；
//   - 未注册时保持原行为（由 llm-adapter 内的 env 解析兜底），
//     这样桌面端等直接使用 modu-agent 的宿主无需同步改造；
//   - resolver 只在构造 ChatModel 时调用，不缓存密钥。

/** resolver 入参：provider 由目录决定，model 为调用方覆盖值（可为空）。 */
export interface LLMConnectionInput {
  provider: string
  model?: string | null
}

/**
 * resolver 返回值：最小连接信息。
 *
 * 注意：这里**不提供总时长超时**。流式生成可能持续数分钟，给 ChatOpenAI 传
 * `timeout` 会按整请求计时并中断长回答；超时策略应由调用方在"空闲"维度控制
 * （chat 通道见 llm-gateway 的 idleTimeout，agent 通道见 llm.request_timeout_ms）。
 */
export interface LLMConnection {
  apiKey: string
  baseUrl: string
  /** 真实模型 ID（宿主可在此完成别名 → ID 的解析） */
  model: string
}

export type LLMConnectionResolver = (input: LLMConnectionInput) => LLMConnection

let _resolver: LLMConnectionResolver | null = null

/** 注册/清除连接解析器（传 null 恢复 env 兜底）。 */
export function setLLMConnectionResolver(resolver: LLMConnectionResolver | null): void {
  _resolver = resolver
}

export function getLLMConnectionResolver(): LLMConnectionResolver | null {
  return _resolver
}

/** 测试辅助：清理全局状态，避免用例间串扰。 */
export function _resetLLMConnectionResolverForTest(): void {
  _resolver = null
}
