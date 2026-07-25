// 对应 Python: components/reasoning/llm/gpt.py
// OpenAI GPT LLM 推理器
import { BaseLLMReasoner } from './base-llm.js'

const _DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const _DEFAULT_MODEL = 'gpt-4o'

/**
 * GPT LLM 推理器。
 * 对应 Python GPTLLMReasoner。
 *
 * API key / base_url / model 解析优先级：
 *   显式参数 > MODU_OPENAI_* 环境变量 > 默认值
 */
export class GPTLLMReasoner extends BaseLLMReasoner {
  constructor(
    apiKey?: string | null,
    baseUrl?: string | null,
    defaultModel?: string | null,
    timeout: number = 120.0,
    systemPrompt?: string | null,
  ) {
    const resolvedKey = apiKey || process.env.MODU_OPENAI_API_KEY || ''
    const resolvedUrl = baseUrl || process.env.MODU_OPENAI_BASE_URL || _DEFAULT_BASE_URL
    const resolvedModel = defaultModel || process.env.MODU_OPENAI_MODEL || _DEFAULT_MODEL
    super(
      resolvedKey,
      resolvedUrl,
      resolvedModel,
      timeout,
      systemPrompt,
      'gpt',
    )
  }
}
