// P1（T-12）：LLM Provider 统一注册表契约。
//
// 背景（详见 `packages/docs/Agent架构分层解耦实施计划.md` §0.1 #10/#11）：
//   - provider → 环境变量/默认模型 的映射此前硬编码于
//     `graph/adapters/llm-adapter.ts` 的 `_PROVIDER_CONFIG`；
//   - `reasoning/llm/{gpt,qwen,glm,deepseek}.ts` 又各自维护一套 env/model 常量
//     （"第二轨"，且除 index 再导出外零消费者）；
//   - 两轨对同一 provider 的约定不一致：gpt 用 `OPENAI_API_KEY`/`gpt-4o-mini`
//     vs `MODU_OPENAI_API_KEY`/`gpt-4o`；qwen 用 `qwen-plus` vs `qwen-max`。
//
// 本契约把 provider 收口为**可注册工厂**：
//   - 内置 4 个 factory 由 `graph/adapters/llm-adapter.ts` 提供
//     （以在用的 `_PROVIDER_CONFIG` 约定为唯一事实源，第二轨降级为"别名"）；
//   - 宿主可通过 `ComponentRegistry.registerLLMProvider` 新增/覆盖 provider，
//     无需修改内核源码（对应 M2「横向可替换 ×3」验收之一）。
//
// 硬约束：
//   1. `create()` 返回 **LangChain ChatModel**（与在用的
//      `build_chat_model(): ChatOpenAI` 形态一致），**不是** `ModuLLM`；
//      `ModuLLM` 视图由 `wrap_chat_model_as_modu` 单独包装 —— 若此处返回 ModuLLM，
//      P0 T-08 已接线的模型路由链路（routeTable 工厂 / agentNode）会断裂。
//   2. 本文件不 import `@langchain/*`（core 层保持框架无关），故返回类型为 `any`。
//   3. 默认行为零变化：内置 factory 的 env 解析顺序为
//      显式参数 > 主 env > 别名 env > 通用 LLM_* > 默认值，与改造前逐条一致。

import type { RuntimeConfig } from '../../config/runtime-config.js'

/**
 * provider 构造参数。
 *
 * 覆盖优先级：显式参数（apiKey/baseUrl/model/temperature/maxTokens）
 *   > 环境变量 > RuntimeConfig / 内置默认值
 */
export interface LLMProviderConfig {
  provider: string
  model?: string | null
  temperature?: number | null
  maxTokens?: number | null
  /** 显式 API Key（优先级最高；宿主运行时注入时使用，不落盘） */
  apiKey?: string | null
  /** 显式 Base URL（优先级最高） */
  baseUrl?: string | null
}

/**
 * provider 元数据（env 名 + 默认值）。
 *
 * 纯数据，供统一 env 解析、审计与文档对齐使用；
 * `llm-adapter.ts` 的 `_PROVIDER_CONFIG` 由本表派生，消除双轨硬编码。
 */
export interface LLMProviderSpec {
  /** provider 唯一标识，如 'deepseek' / 'glm' / 'gpt' / 'qwen' */
  id: string
  /** 默认模型名 */
  defaultModel: string
  /** 默认 Base URL */
  defaultBaseUrl: string
  /** 主 API Key 环境变量名（与在用约定一致） */
  apiKeyEnv: string
  /** 主 Base URL 环境变量名 */
  baseUrlEnv: string
  /** 主 Model 环境变量名 */
  modelEnv: string
  /** API Key 别名环境变量（兼容第二轨，如 gpt 的 `MODU_OPENAI_API_KEY`） */
  apiKeyEnvAliases?: readonly string[]
  /** Base URL 别名环境变量 */
  baseUrlEnvAliases?: readonly string[]
  /** Model 别名环境变量 */
  modelEnvAliases?: readonly string[]
}

/**
 * LLM provider 工厂。
 *
 * 对应实施计划 §4.1.1；由 `ComponentRegistry.registerLLMProvider` 注册。
 */
export interface LLMProviderFactory {
  /** provider 唯一标识 */
  readonly id: string
  /** 默认模型名（消除 llm-adapter.ts 与 reasoning/llm/gpt.ts 的双轨默认值） */
  readonly defaultModel: string
  /** 默认 Base URL */
  readonly defaultBaseUrl: string
  /** 主 API Key 环境变量名 */
  readonly apiKeyEnv: string
  /** API Key 别名环境变量（兼容第二轨） */
  readonly apiKeyEnvAliases?: readonly string[]
  /** provider 元数据（env 名 + 默认值的完整描述） */
  readonly spec: LLMProviderSpec
  /**
   * 构造 LangChain ChatModel（**非** ModuLLM，见文件头硬约束 1）。
   *
   * @param cfg            构造参数（provider 名 + 可选覆盖）
   * @param runtimeConfig  运行时配置（temperature/max_tokens 的配置级默认值）
   */
  create(cfg: LLMProviderConfig, runtimeConfig: RuntimeConfig): any
}
