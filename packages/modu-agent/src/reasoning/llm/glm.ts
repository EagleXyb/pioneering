// 对应 Python: components/reasoning/llm/glm.py
// GLM (智谱) LLM 推理器
import { BaseLLMReasoner } from './base-llm.js'

const _DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
const _DEFAULT_MODEL = 'glm-4-flash'

/**
 * GLM LLM 推理器。
 * 对应 Python GLMLLMReasoner。
 *
 * API key / base_url / model 解析优先级：
 *   显式参数 > MODU_GLM_* 环境变量 > LLM_* 通用环境变量 > 默认值
 */
export class GLMLLMReasoner extends BaseLLMReasoner {
  constructor(
    apiKey?: string | null,
    baseUrl?: string | null,
    defaultModel?: string | null,
    timeout: number = 120.0,
    systemPrompt?: string | null,
  ) {
    const resolvedKey = apiKey || process.env.MODU_GLM_API_KEY || process.env.LLM_API_KEY || ''
    const resolvedUrl = baseUrl || process.env.MODU_GLM_BASE_URL || process.env.LLM_BASE_URL || _DEFAULT_BASE_URL
    const resolvedModel = defaultModel || process.env.MODU_GLM_MODEL || process.env.LLM_DEFAULT_MODEL || _DEFAULT_MODEL
    super(
      resolvedKey,
      resolvedUrl,
      resolvedModel,
      timeout,
      systemPrompt,
    )
  }
}
