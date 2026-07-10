// 对应 Python: components/perception/text/llm_parser.py
// 基于 LLM 的深度文本解析器（对应问题 1、2）
//
// 能力：
// - 意图识别：通过 LLM zero-shot 分类
// - 实体抽取：通过 LLM 提取结构化实体
// - 情感检测：通过 LLM 判断情感倾向
// - 输入质量评估：LLM 辅助评估
//
// P1 增强：
// - 集成 spaCy/HanLP 做本地 NER 实体抽取（LLM 不可用时降级）
// - 集成 SnowNLP 做本地中文情感检测（LLM 不可用时降级）
// - 本地方法优先（更快、无成本），LLM 作为增强
//
// 设计原则：
// - LLM 不可用时优雅降级为本地方法或空结果（不阻塞主流程）
// - 所有 LLM 调用设置超时，超时则跳过
// - 结果以结构化 JSON 返回，供 TextPreprocessor 合并
//
// 注：TS 版无 spaCy / SnowNLP 等价库，本地 NER 和情感检测降级为：
//   - spaCy NER → 不可用，返回空列表（_SPACY_AVAILABLE = false）
//   - SnowNLP 情感 → 不可用，返回 null（_SNOWNLP_AVAILABLE = false）
//   保留接口等价，LLM 可用时由 LLM 填充这些字段。
import { BasePerception } from '../../core/interfaces/perception.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[llm-parser] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[llm-parser] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[llm-parser] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[llm-parser] ${msg}`, ...args),
}

// P1: 检测可选依赖可用性
// TS 版无 spaCy 等价库
const _SPACY_AVAILABLE = false
// TS 版无 SnowNLP 等价库
const _SNOWNLP_AVAILABLE = false

// 意图识别 prompt 模板
const _INTENT_PROMPT = `请分析以下用户输入的意图，返回 JSON 格式结果。

用户输入：{input}

请返回如下 JSON 格式（仅返回 JSON，不要其他内容）：
{{"intent": "意图名称", "confidence": 0.0-1.0, "entities": [{{"text": "实体文本", "label": "实体类型"}}], "sentiment": {{"positive": 0.0-1.0, "negative": 0.0-1.0, "neutral": 0.0-1.0}}}}

意图类别参考：question, request, command, complaint, greeting, farewell, other
实体类型参考：person, location, organization, date, time, money, product, event
`

// 质量评估 prompt 模板
const _QUALITY_PROMPT = `请评估以下用户输入的质量，返回 JSON 格式结果。

用户输入：{input}

评估维度：
- clarity: 表述清晰度 (0-1)
- completeness: 信息完整度 (0-1)
- relevance: 相关性 (0-1)

请返回：{{"clarity": 0.0, "completeness": 0.0, "relevance": 0.0, "overall": 0.0}}
仅返回 JSON，不要其他内容。
`

// spaCy 模型名称映射（TS 版不可用，仅保留定义）
const _SPACY_MODELS: Record<string, string> = {
  zh: 'zh_core_web_sm',
  en: 'en_core_web_sm',
  ja: 'ja_core_web_sm',
  ko: 'ko_core_news_sm',
  ru: 'ru_core_news_sm',
  multilingual: 'xx_ent_wiki_sm',
}

/**
 * LLM 适配器接口（鸭子类型，与 Python 一致）。
 *
 * 对应 Python llm_adapter.generate(prompt, context, temperature, max_tokens)，
 * 返回 [content, usage, tool_calls]。
 */
export interface LLMAdapter {
  generate(
    prompt: string,
    context: Record<string, any>,
    temperature?: number,
    maxTokens?: number,
  ): Promise<[string, Record<string, number>, Array<Record<string, any>>]>
}

/**
 * 基于 LLM 的深度文本解析器。
 * 对应 Python LLMParser。
 *
 * 在 TextPreprocessor 完成基础清洗后，可选地调用 LLM 做深度语义理解。
 * 若 LLM 不可用或调用失败，尝试本地方法（spaCy NER / SnowNLP 情感）降级。
 *
 * P1 优先级策略：
 * 1. 实体抽取：spaCy（本地，快） → LLM（增强）
 * 2. 情感检测：SnowNLP（本地，快） → LLM（增强）
 * 3. 意图识别：仅 LLM（本地无轻量方案）
 * 4. 质量评估：仅 LLM（可选）
 *
 * 注：TS 版 spaCy / SnowNLP 不可用，实体抽取和情感检测仅由 LLM 填充。
 */
export class LLMParser extends BasePerception {
  private _llmAdapter: LLMAdapter | null
  private _timeoutMs: number
  private _enableIntent: boolean
  private _enableQuality: boolean
  private _enableLocalNer: boolean
  private _enableLocalSentiment: boolean
  // P1: spaCy 模型（TS 版不可用）
  private _spacyNlp: any = null
  private _spacyModelName: string | null

  constructor(
    llmAdapter?: LLMAdapter | null,
    timeoutMs: number = 3000,
    enableIntent: boolean = true,
    enableQuality: boolean = false,
    enableLocalNer: boolean = true,
    enableLocalSentiment: boolean = true,
    spacyModel?: string | null,
  ) {
    super()
    this._llmAdapter = llmAdapter ?? null
    this._timeoutMs = timeoutMs
    this._enableIntent = enableIntent
    this._enableQuality = enableQuality
    this._enableLocalNer = enableLocalNer
    this._enableLocalSentiment = enableLocalSentiment

    // P1: 延迟初始化 spaCy 模型
    this._spacyModelName = spacyModel ?? null
    if (this._enableLocalNer && _SPACY_AVAILABLE) {
      this._initSpacy()
    }
  }

  /** 延迟初始化 spaCy NLP 模型（TS 版不可用，空实现）。 */
  private _initSpacy(): void {
    if (!_SPACY_AVAILABLE) {
      return
    }
    // TODO: TS 版无 spaCy 等价库，NER 仅由 LLM 填充
  }

  /** 动态注入 LLM 适配器（避免循环依赖）。 */
  setLlmAdapter(llmAdapter: LLMAdapter): void {
    this._llmAdapter = llmAdapter
  }

  /**
   * 对文本做深度解析。
   * 对应 Python perceive。
   *
   * 输入应为已清洗的文本（rawContent 为 UTF-8 编码的文本字节）。
   * 输出包含 intent / entities / sentiment / quality 字段。
   *
   * P1 策略：
   * - 实体抽取：优先 spaCy 本地方案，LLM 作为增强
   * - 情感检测：优先 SnowNLP 本地方案，LLM 作为增强
   * - 意图识别：仅 LLM
   */
  async perceive(
    inputType: string,
    rawContent: Uint8Array,
    language?: string | null,
    _sensitivityLevel: number = 0,
  ): Promise<Record<string, any>> {
    if (inputType !== 'text') {
      return this._emptyResult(inputType)
    }

    const decoder = new TextDecoder('utf-8', { fatal: false })
    const text = decoder.decode(rawContent)

    if (!text.trim()) {
      return this._emptyResult('text')
    }

    const result: Record<string, any> = {
      parsed_content: { input_type: 'text', text },
      detected_language: language,
      confidence: 0.5,  // LLM 解析默认中等置信度
      metadata: { parser: 'llm_parser' },
      intent: null,
      entities: [],
      sentiment: null,
      quality_score: 0.0,
    }

    // P1: 本地实体抽取（spaCy）— TS 版不可用
    const localEntities: Array<Record<string, string>> = []
    if (this._enableLocalNer && this._spacyNlp !== null) {
      const spacyEntities = this._extractEntitiesSpacy(text)
      if (spacyEntities.length > 0) {
        result['entities'] = spacyEntities
      }
    }

    // P1: 本地情感检测（SnowNLP，仅中文）— TS 版不可用
    let localSentiment: Record<string, number> | null = null
    if (this._enableLocalSentiment && _SNOWNLP_AVAILABLE && this._isChinese(text)) {
      localSentiment = this._detectSentimentSnownlp(text)
      if (localSentiment) {
        result['sentiment'] = localSentiment
      }
    }

    // LLM 深度解析（增强或补充本地方法未覆盖的字段）
    if (this._llmAdapter !== null) {
      const context = {
        trace_id: 'llm_parser',
        session_id: 'llm_parser',
      }

      // 意图识别（仅 LLM）
      if (this._enableIntent) {
        const intentResult = await this._callLlmSafe(
          _INTENT_PROMPT.replace('{input}', text.slice(0, 500)),
          context,
        )
        if (intentResult) {
          result['intent'] = intentResult.intent ?? null
          // LLM 实体作为补充（若本地已有则合并去重）
          const llmEntities = intentResult.entities ?? []
          if (llmEntities.length > 0) {
            result['entities'] = this._mergeEntities(localEntities, llmEntities)
          }
          // LLM 情感作为补充（若本地已有则优先本地）
          const llmSentiment = intentResult.sentiment
          if (llmSentiment && !localSentiment) {
            result['sentiment'] = llmSentiment
          }
        }
      }

      // 质量评估（仅 LLM）
      if (this._enableQuality) {
        const qualityResult = await this._callLlmSafe(
          _QUALITY_PROMPT.replace('{input}', text.slice(0, 500)),
          context,
        )
        if (qualityResult) {
          result['quality_score'] = qualityResult.overall ?? 0.0
        }
      }
    } else {
      logger.debug('LLM adapter not available, using local methods only')
    }

    // 根据结果丰富度调整置信度
    if (result['entities'].length > 0 || result['sentiment'] || result['intent']) {
      result['confidence'] = this._llmAdapter ? 0.7 : 0.6
    }

    return result
  }

  // ------------------------------------------------------------------
  // P1: 本地实体抽取（spaCy）
  // ------------------------------------------------------------------

  /**
   * 使用 spaCy 做命名实体识别。
   * 对应 Python _extract_entities_spacy。
   *
   * TS 版 spaCy 不可用，始终返回空列表。
   */
  private _extractEntitiesSpacy(_text: string): Array<Record<string, string>> {
    // TODO: TS 版无 spaCy 等价库，NER 仅由 LLM 填充
    return []
  }

  // ------------------------------------------------------------------
  // P1: 本地情感检测（SnowNLP，仅中文）
  // ------------------------------------------------------------------

  /**
   * 使用 SnowNLP 做中文情感检测。
   * 对应 Python _detect_sentiment_snownlp。
   *
   * TS 版 SnowNLP 不可用，始终返回 null。
   */
  private _detectSentimentSnownlp(_text: string): Record<string, number> | null {
    // TODO: TS 版无 SnowNLP 等价库，情感检测仅由 LLM 填充
    return null
  }

  /** 快速判断文本是否以中文为主。 */
  private _isChinese(text: string): boolean {
    if (!text) {
      return false
    }
    let chineseCount = 0
    for (const c of text) {
      const cp = c.codePointAt(0)!
      if (cp >= 0x4e00 && cp <= 0x9fff) {
        chineseCount += 1
      }
    }
    return chineseCount > text.length * 0.3
  }

  /** 合并本地和 LLM 实体结果，去重。 */
  private _mergeEntities(
    local: Array<Record<string, string>>,
    llm: Array<Record<string, string>>,
  ): Array<Record<string, string>> {
    const merged = [...local]
    const seenTexts = new Set(local.map((e) => e['text']))
    for (const entity of llm) {
      if (typeof entity === 'object' && 'text' in entity) {
        if (!seenTexts.has(entity['text'])) {
          merged.push(entity)
          seenTexts.add(entity['text'])
        }
      }
    }
    return merged.slice(0, 30)
  }

  /** 安全调用 LLM，失败时返回 null。 */
  private async _callLlmSafe(
    prompt: string,
    context: Record<string, any>,
  ): Promise<Record<string, any> | null> {
    if (!this._llmAdapter) {
      return null
    }
    try {
      const [response] = await this._llmAdapter.generate(
        prompt,
        context,
        0.3,  // 低温度保证稳定性
        256,
      )
      return this._parseJsonResponse(response)
    } catch (e) {
      logger.warning('LLM deep parsing failed: %s', String(e))
      return null
    }
  }

  /** 从 LLM 响应中提取 JSON。 */
  private _parseJsonResponse(response: string): Record<string, any> | null {
    // 尝试直接解析
    try {
      return JSON.parse(response)
    } catch {
      // 继续
    }

    // 尝试从 ```json ... ``` 块中提取
    const match = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (match) {
      try {
        return JSON.parse(match[1])
      } catch {
        // 继续
      }
    }

    // 尝试从 { ... } 中提取
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(response.slice(start, end + 1))
      } catch {
        // 继续
      }
    }

    return null
  }

  private _emptyResult(inputType: string): Record<string, any> {
    return {
      parsed_content: { input_type: inputType, error: 'unsupported or empty input' },
      detected_language: null,
      confidence: 0.0,
      metadata: { parser: 'llm_parser' },
      intent: null,
      entities: [],
      sentiment: null,
      quality_score: 0.0,
    }
  }
}
