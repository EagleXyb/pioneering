// P1（T-12）：内置 LLM provider 规格表 + 工厂装配。
//
// 职责分离（避免 ESM 循环依赖）：
//   - 本模块：**纯数据 + 装配逻辑**，不 import `@langchain/*`、不读 `process.env`；
//   - `llm-adapter.ts`：提供"实际构造 ChatModel"的回调（含 env 解析与 undici fetch 修复），
//     并在模块加载时/`create_agent` 启动时调用 `ensureBuiltinLLMProviders`。
//
// 为什么不让本模块直接构造：`build_chat_model` 是既有唯一构造入口
// （含 P0 修复的 undici fetch 覆盖，见 llm-adapter.ts），把它搬走会
// ① 让 `config/env.ts` 的"消费模块"文档失真；② 增加回归面。
// 这里采用**回调注入**（与 `setSkillToolWrapperFactory` 同范式，见 core/registry.ts:22-30）。

import type { LLMProviderFactory, LLMProviderSpec } from '../../core/interfaces/llm-provider.js'
import type { ComponentRegistry } from '../../core/registry.js'

/**
 * 内置 provider 规格表。
 *
 * **唯一事实源**：与改造前 `graph/adapters/llm-adapter.ts` 的 `_PROVIDER_CONFIG`
 * （api_key / base_url / model / default_base_url / default_model）逐字段等价；
 * `reasoning/llm/{gpt,qwen}.ts` 的第二轨（`MODU_OPENAI_*` 等）降级为**别名**。
 *
 * 双轨差异的处置（对应实施计划 §0.1 #10）：
 *   - gpt：主 = `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`（在用约定）；
 *          别名 = `MODU_OPENAI_API_KEY`/`MODU_OPENAI_BASE_URL`/`MODU_OPENAI_MODEL`；
 *          默认模型取在用的 `gpt-4o-mini`（第二轨的 `gpt-4o` 仅记录，不生效）。
 *   - qwen：默认模型取在用的 `qwen-plus`（第二轨的 `qwen-max` 记录，不生效）。
 *   - 通用回退 `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_DEFAULT_MODEL` 对全部 provider 生效
 *     （改造前仅 `llm-adapter.ts` 路径有 —— 这是 llm-adapter 侧的确切行为，故保持）。
 */
export const BUILTIN_LLM_PROVIDER_SPECS: readonly LLMProviderSpec[] = [
  {
    id: 'glm',
    apiKeyEnv: 'MODU_GLM_API_KEY',
    baseUrlEnv: 'MODU_GLM_BASE_URL',
    modelEnv: 'MODU_GLM_MODEL',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
  },
  {
    id: 'deepseek',
    apiKeyEnv: 'MODU_DEEPSEEK_API_KEY',
    baseUrlEnv: 'MODU_DEEPSEEK_BASE_URL',
    modelEnv: 'MODU_DEEPSEEK_MODEL',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
  },
  {
    id: 'gpt',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrlEnv: 'OPENAI_BASE_URL',
    modelEnv: 'OPENAI_MODEL',
    apiKeyEnvAliases: ['MODU_OPENAI_API_KEY'],
    baseUrlEnvAliases: ['MODU_OPENAI_BASE_URL'],
    modelEnvAliases: ['MODU_OPENAI_MODEL'],
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'qwen',
    apiKeyEnv: 'MODU_QWEN_API_KEY',
    baseUrlEnv: 'MODU_QWEN_BASE_URL',
    modelEnv: 'MODU_QWEN_MODEL',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
]

/**
 * ChatModel 构造回调。
 *
 * 由 `llm-adapter.ts` 提供（唯一构造入口，保留既有 env 解析与网络层修复）。
 */
export type ChatModelBuilder = (
  spec: LLMProviderSpec,
  cfg: { model?: string | null; temperature?: number | null; maxTokens?: number | null; apiKey?: string | null; baseUrl?: string | null },
  runtimeConfig: any,
) => any

/**
 * 由规格表 + 构造回调生成内置 provider 工厂列表。
 *
 * @param build 实际构造 ChatModel 的回调（见 {@link ChatModelBuilder}）
 */
export function createBuiltinLLMProviderFactories(
  build: ChatModelBuilder,
): LLMProviderFactory[] {
  return BUILTIN_LLM_PROVIDER_SPECS.map((spec) => ({
    id: spec.id,
    defaultModel: spec.defaultModel,
    defaultBaseUrl: spec.defaultBaseUrl,
    apiKeyEnv: spec.apiKeyEnv,
    apiKeyEnvAliases: spec.apiKeyEnvAliases,
    spec,
    create(cfg, runtimeConfig) {
      return build(
        spec,
        {
          model: cfg.model ?? null,
          temperature: cfg.temperature ?? null,
          maxTokens: cfg.maxTokens ?? null,
          apiKey: cfg.apiKey ?? null,
          baseUrl: cfg.baseUrl ?? null,
        },
        runtimeConfig,
      )
    },
  }))
}

/**
 * 幂等注册内置 provider 工厂。
 *
 * 冲突策略：**已注册者优先**（宿主通过 `registerLLMProvider` 覆盖内置实现时不被回退覆盖），
 * 与 `registerTool` 的"已存在则跳过"语义一致。
 *
 * @returns 实际新注册的 provider id 列表（已存在的不计入）
 */
export function ensureBuiltinLLMProviders(
  registry: ComponentRegistry,
  build: ChatModelBuilder,
): string[] {
  const registered: string[] = []
  for (const factory of createBuiltinLLMProviderFactories(build)) {
    if (registry.getLLMProvider(factory.id) !== undefined) continue
    registry.registerLLMProvider(factory)
    registered.push(factory.id)
  }
  return registered
}
