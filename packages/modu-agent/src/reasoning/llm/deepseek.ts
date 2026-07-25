// 对应 Python: components/reasoning/llm/deepseek.py
// DeepSeek LLM 推理器
import { BaseLLMReasoner } from './base-llm.js'

const _DEFAULT_BASE_URL = 'https://api.deepseek.com'
// P2-3 修复：deepseek-chat 非有效模型名（API 仅支持 deepseek-v4-pro / deepseek-v4-flash），未配置环境变量时 API 调用必然失败
const _DEFAULT_MODEL = 'deepseek-v4-flash'

/**
 * DeepSeek LLM 推理器。
 * 对应 Python DeepSeekLLMReasoner。
 *
 * API key / base_url / model 解析优先级：
 *   显式参数 > MODU_DEEPSEEK_* 环境变量 > LLM_* 通用环境变量 > 默认值
 */
export class DeepSeekLLMReasoner extends BaseLLMReasoner {
  constructor(
    apiKey?: string | null,
    baseUrl?: string | null,
    defaultModel?: string | null,
    timeout: number = 120.0,
    systemPrompt?: string | null,
  ) {
    const resolvedKey = apiKey || process.env.MODU_DEEPSEEK_API_KEY || process.env.LLM_API_KEY || ''
    const resolvedUrl = baseUrl || process.env.MODU_DEEPSEEK_BASE_URL || process.env.LLM_BASE_URL || _DEFAULT_BASE_URL
    const resolvedModel = defaultModel || process.env.MODU_DEEPSEEK_MODEL || process.env.LLM_DEFAULT_MODEL || _DEFAULT_MODEL
    super(
      resolvedKey,
      resolvedUrl,
      resolvedModel,
      timeout,
      systemPrompt,
      'deepseek',
    )
  }
}
