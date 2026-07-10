// 对应 Python: components/reasoning/llm/qwen.py
// Qwen (通义千问) LLM 推理器
import { BaseLLMReasoner } from './base-llm.js'

const _DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const _DEFAULT_MODEL = 'qwen-max'

/**
 * Qwen LLM 推理器。
 * 对应 Python QwenLLMReasoner。
 *
 * API key / base_url / model 解析优先级：
 *   显式参数 > MODU_QWEN_* 环境变量 > 默认值
 */
export class QwenLLMReasoner extends BaseLLMReasoner {
  constructor(
    apiKey?: string | null,
    baseUrl?: string | null,
    defaultModel?: string | null,
    timeout: number = 120.0,
    systemPrompt?: string | null,
  ) {
    const resolvedKey = apiKey || process.env.MODU_QWEN_API_KEY || ''
    const resolvedUrl = baseUrl || process.env.MODU_QWEN_BASE_URL || _DEFAULT_BASE_URL
    const resolvedModel = defaultModel || process.env.MODU_QWEN_MODEL || _DEFAULT_MODEL
    super(
      resolvedKey,
      resolvedUrl,
      resolvedModel,
      timeout,
      systemPrompt,
    )
  }
}
