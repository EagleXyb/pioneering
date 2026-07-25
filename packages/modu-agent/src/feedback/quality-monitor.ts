// 对应 Python: feedback/quality_monitor.py
// QualityMonitor: 响应质量监控器（支持 rule/llm/hybrid 模式）
//
// 统一 LLM 接口改造（对应文档 §2.1）：
//   - 评估器统一面向 ModuLLM 接口消费，消除调用路径上的鸭子类型分支
//   - 构造函数接收 ModuLLM 实例；为保持向后兼容，也接受 LangChain ChatOpenAI
//     或已实现 ModuLLM 的 BaseLLMReasoner，内部统一归一化为 ModuLLM
//   - 调用路径 _invokeJudgeLlm 仅通过 ModuLLM.invoke 消费，不再分支 areason/ainvoke

import type { LLMMessage, ModuLLM } from '../core/interfaces/llm.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[quality-monitor] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[quality-monitor] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[quality-monitor] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[quality-monitor] ${msg}`, ...args),
}

/**
 * 响应质量监控器（P2-7: 升级支持 LLM-as-Judge）。
 *
 * 支持三种评估模式：
 *    - "rule":    基于关键词/长度/不确定词等规则评估（同步，原默认行为）
 *    - "llm":     使用独立 LLM 调用进行语义级评估（异步）
 *    - "hybrid":  规则 + LLM 双路评估后加权融合（异步）
 *
 * LLM 模式需通过 evaluator_llm 注入一个 ModuLLM 实例：
 *    - BaseLLMReasoner 子类（已实现 ModuLLM 接口）
 *    - 通过 wrap_chat_model_as_modu 包装的 LangChain ChatOpenAI
 *
 * 为保持向后兼容，构造函数也接受未包装的 LangChain ChatOpenAI 实例，
 * 内部通过 wrap_chat_model_as_modu 归一化为 ModuLLM。
 *
 * 当 LLM 评估失败（超时/解析错误）时，自动 fallback 到规则评估，确保闭环不中断。
 */
export class QualityMonitor {
  // 扣分关键词
  static readonly UNKNOWN_PATTERNS = ['不知道', '无法回答', '无法提供', '不清楚', '不确定']
  // 低置信度模式
  static readonly LOW_CONFIDENCE_PATTERNS = [
    '可能', '也许', '不确定', '大概', '也许吧', '不太确定',
    '不是很确定', '我猜测', '我认为可能', '这可能是一个',
  ]
  // 工具调用失败的模式
  static readonly TOOL_FAILURE_PATTERNS = [
    '调用失败', '执行失败', '操作失败', '请求失败', '工具错误',
  ]

  // LLM Judge system prompt（输出 JSON）
  static readonly _JUDGE_SYSTEM_PROMPT =
    '你是一个严格的回复质量评估器。请从相关性、完整性、准确性、置信度、' +
    '工具调用成功率五个维度评估 Agent 回复质量，输出 0.00-1.00 之间的分数（保留 2 位小数）。' +
    '若回复未涉及工具调用，tool_success 默认为 1.0。' +
    '仅输出一个合法 JSON 对象，不要包含任何额外文字、Markdown 代码块或解释。'

  // 从 LLM 输出中提取 JSON 的正则（容忍 ```json ... ``` 包裹）
  static readonly _JSON_PATTERN = /\{[^{}]*\}/

  private _evaluatorLlm: ModuLLM | null
  private _mode: string
  private _llmTimeout: number
  private _llmTemperature: number
  private _llmMaxTokens: number
  private _hybridRuleWeight: number
  private _hybridLlmWeight: number

  constructor(
    evaluatorLlm: ModuLLM | any = null,
    mode: string = 'rule',
    llmTimeout: number = 10.0,
    llmTemperature: number = 0.0,
    llmMaxTokens: number = 256,
    hybridRuleWeight: number = 0.4,
    hybridLlmWeight: number = 0.6,
  ) {
    if (mode !== 'rule' && mode !== 'llm' && mode !== 'hybrid') {
      logger.warning("Unknown quality_monitor mode '%s', falling back to 'rule'", mode)
      mode = 'rule'
    }

    // 统一归一化评估器为 ModuLLM 接口（消除调用路径鸭子类型）
    const normalized = QualityMonitor._normalizeEvaluator(evaluatorLlm)

    if ((mode === 'llm' || mode === 'hybrid') && normalized === null) {
      logger.warning(
        "quality_monitor mode='%s' but evaluator_llm is None/unnormalizable, falling back to 'rule'",
        mode,
      )
      mode = 'rule'
    }

    this._evaluatorLlm = normalized
    this._mode = mode
    this._llmTimeout = llmTimeout
    this._llmTemperature = llmTemperature
    this._llmMaxTokens = llmMaxTokens
    this._hybridRuleWeight = hybridRuleWeight
    this._hybridLlmWeight = hybridLlmWeight
  }

  /**
   * 将传入的评估器归一化为 ModuLLM 接口实例。
   *
   * 适配矩阵（对应文档 §2.1 消除鸭子类型建议）：
   *   - null/undefined                         → null（rule 模式或后续降级）
   *   - 已实现 ModuLLM（含 invoke/stream/bindTools）→ 原样返回
   *   - 其他（如未包装的 LangChain ChatOpenAI）   → null + 警告，降级到 rule
   *
   * 注：
   *   - BaseLLMReasoner 在统一 LLM 接口改造后已实现 ModuLLM，走第二分支
   *   - LangChain ChatOpenAI 应由调用方（如 factory._build_judge_llm）通过
   *     wrap_chat_model_as_modu 预先包装为 ModuLLM 后再注入，避免在构造函数
   *     中引入异步 import 造成 constructor 异步化
   */
  private static _normalizeEvaluator(llm: any): ModuLLM | null {
    if (llm === null || llm === undefined) {
      return null
    }
    // 已实现 ModuLLM 接口（BaseLLMReasoner / ModuLLMAdapter / 已包装的 ChatOpenAI）
    if (
      typeof llm.invoke === 'function' &&
      typeof llm.stream === 'function' &&
      typeof llm.bindTools === 'function'
    ) {
      return llm as ModuLLM
    }
    logger.warning(
      'evaluator_llm does not implement ModuLLM interface ' +
      '(got %s). LangChain ChatOpenAI should be wrapped via ' +
      "wrap_chat_model_as_modu() before injection. Falling back to rule.",
      llm?.constructor?.name ?? typeof llm,
    )
    return null
  }

  /** 当前评估模式。 */
  get mode(): string {
    return this._mode
  }

  /**
   * 评估响应质量（基于规则，同步）。
   *
   * 规则：
   * - 空响应 → 0分
   * - 包含"不知道"/"无法回答" → 扣分
   * - 工具调用失败 → 扣分
   * - 低置信度感知 → 降低预期
   */
  evaluate(
    prompt: string,
    response: string,
    context: Record<string, any>,
  ): Record<string, any> {
    if (!response || !response.trim()) {
      return {
        relevance: 0.0,
        completeness: 0.0,
        confidence: 0.0,
        tool_success: 0.0,
        overall: 0.0,
      }
    }

    const relevance = this._checkRelevance(prompt, response, context)
    const completeness = this._checkCompleteness(prompt, response, context)
    const confidence = this._checkConfidence(response)
    const toolSuccess = this._checkToolSuccess(response, context)

    const overall =
      relevance * 0.3 +
      completeness * 0.3 +
      confidence * 0.2 +
      toolSuccess * 0.2

    return {
      relevance,
      completeness,
      confidence,
      tool_success: toolSuccess,
      overall,
    }
  }

  /**
   * 异步评估响应质量。
   *
   * 按 mode 选择评估路径：
   *   - "rule":   直接调用 evaluate()（同步逻辑，无 await 开销）
   *   - "llm":    调用 LLM Judge，失败时 fallback 到规则
   *   - "hybrid": 规则 + LLM 双路并行，加权融合
   */
  async evaluateAsync(
    prompt: string,
    response: string,
    context: Record<string, any>,
  ): Promise<Record<string, any>> {
    // 空响应短路：所有模式一致
    if (!response || !response.trim()) {
      return {
        relevance: 0.0,
        completeness: 0.0,
        confidence: 0.0,
        tool_success: 0.0,
        overall: 0.0,
        evaluator_mode: this._mode,
      }
    }

    if (this._mode === 'rule') {
      const result = this.evaluate(prompt, response, context)
      result['evaluator_mode'] = 'rule'
      return result
    }

    if (this._mode === 'llm') {
      const llmResult = await this._safeEvaluateWithLlm(prompt, response, context)
      if (llmResult !== null) {
        llmResult['evaluator_mode'] = 'llm'
        return llmResult
      }
      // fallback
      const ruleResult = this.evaluate(prompt, response, context)
      ruleResult['evaluator_mode'] = 'rule_fallback'
      return ruleResult
    }

    if (this._mode === 'hybrid') {
      const ruleResult = this.evaluate(prompt, response, context)
      const llmResult = await this._safeEvaluateWithLlm(prompt, response, context)
      if (llmResult === null) {
        ruleResult['evaluator_mode'] = 'rule_fallback'
        return ruleResult
      }
      const blended = this._blendResults(ruleResult, llmResult)
      blended['evaluator_mode'] = 'hybrid'
      return blended
    }

    // 兜底
    const result = this.evaluate(prompt, response, context)
    result['evaluator_mode'] = 'rule'
    return result
  }

  /**
   * 调用 LLM Judge 并解析结果，失败时返回 null。
   *
   * 任何异常（超时、网络、解析错误）都被捕获并记录，
   * 调用方据此决定是否 fallback 到规则评估。
   */
  private async _safeEvaluateWithLlm(
    prompt: string,
    response: string,
    context: Record<string, any>,
  ): Promise<Record<string, any> | null> {
    if (this._evaluatorLlm === null) {
      return null
    }

    try {
      const content = await this._withTimeout(
        this._invokeJudgeLlm(prompt, response),
        this._llmTimeout * 1000,  // 秒 → 毫秒
      )
      return this._parseJudgeResponse(content)
    } catch (e) {
      if (e instanceof Error && e.message === 'TIMEOUT') {
        logger.warning(
          'LLM Judge timed out after %.1fs, falling back to rule',
          this._llmTimeout,
        )
      } else {
        logger.warning('LLM Judge failed: %s, falling back to rule', String(e))
      }
    }
    return null
  }

  /**
   * Promise 超时包装（对应 Python asyncio.wait_for）。
   * 超时时抛出 Error('TIMEOUT')。
   */
  private async _withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('TIMEOUT'))
      }, timeoutMs)

      promise
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }

  /**
   * 调用 evaluator_llm 获取 Judge 文本输出。
   *
   * 统一通过 ModuLLM.invoke 消费（对应文档 §2.1 消除鸭子类型建议）：
   *   - 构造函数已将评估器归一化为 ModuLLM 实例
   *   - 这里不再分支 areason/ainvoke，仅构造 LLMMessage[] 后调用 invoke
   *   - Judge 调用附带 taskType='quality_judge'，便于成本核算按任务维度统计
   */
  private async _invokeJudgeLlm(prompt: string, response: string): Promise<string> {
    if (this._evaluatorLlm === null) {
      throw new Error('No evaluator_llm available for LLM Judge mode')
    }

    const userContent = this._formatJudgeUserPrompt(
      prompt.slice(0, 2000),   // 截断保护，避免超长输入
      response.slice(0, 4000),
    )

    const messages: LLMMessage[] = [
      { role: 'system', content: QualityMonitor._JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ]

    const result = await this._evaluatorLlm.invoke(messages, {
      temperature: this._llmTemperature,
      maxTokens: this._llmMaxTokens,
      taskType: 'quality_judge',
    })
    return result.content
  }

  /** 构建 LLM Judge user prompt。 */
  private _formatJudgeUserPrompt(prompt: string, response: string): string {
    return (
      `【用户问题】\n${prompt}\n\n` +
      `【Agent 回复】\n${response}\n\n` +
      `【评估维度】\n` +
      `1. relevance（相关性）：回复是否切题、与问题相关\n` +
      `2. completeness（完整性）：回复是否完整回答了问题的各个方面\n` +
      `3. accuracy（准确性）：回复中的事实信息是否准确无误\n` +
      `4. confidence（置信度）：回复表达是否明确、是否避免不必要的模糊\n` +
      `5. tool_success（工具调用成功率）：基于回复判断工具调用是否成功\n\n` +
      `【输出格式】\n` +
      `{"relevance": 0.85, "completeness": 0.80, "accuracy": 0.90, ` +
      `"confidence": 0.85, "tool_success": 1.0, "overall": 0.87, ` +
      `"reasoning": "简短说明"}`
    )
  }

  /**
   * 解析 LLM Judge 返回的 JSON 评分。
   *
   * 使用正则提取首个 JSON 对象，逐字段解析并钳制到 [0, 1]。
   */
  private _parseJudgeResponse(content: string): Record<string, number> | null {
    if (!content || !content.trim()) {
      return null
    }

    let data: any
    // 尝试直接解析（最理想情况）
    try {
      data = JSON.parse(content.trim())
    } catch {
      // fallback：用正则提取首个 {...} 块
      const match = QualityMonitor._JSON_PATTERN.exec(content)
      if (!match) {
        logger.warning('Failed to extract JSON from Judge response: %s', content.slice(0, 200))
        return null
      }
      try {
        data = JSON.parse(match[0])
      } catch (e) {
        logger.warning('Failed to parse Judge JSON: %s, raw=%s', String(e), match[0].slice(0, 200))
        return null
      }
    }

    const clamp = (key: string, defaultVal: number = 0.5): number => {
      const val = data[key]
      const num = Number(val)
      if (isNaN(num)) return defaultVal
      return Math.max(0.0, Math.min(1.0, num))
    }

    const relevance = clamp('relevance', 0.5)
    const completeness = clamp('completeness', 0.5)
    const accuracy = clamp('accuracy', 0.5)
    const confidence = clamp('confidence', 0.5)
    const toolSuccess = clamp('tool_success', 1.0)

    // overall 优先使用 LLM 给的，缺失则按规则加权计算
    let overall: number
    const overallRaw = data.overall
    if (overallRaw !== undefined && overallRaw !== null) {
      const num = Number(overallRaw)
      if (!isNaN(num)) {
        overall = Math.max(0.0, Math.min(1.0, num))
      } else {
        overall = QualityMonitor._computeOverall(relevance, completeness, accuracy, confidence, toolSuccess)
      }
    } else {
      overall = QualityMonitor._computeOverall(relevance, completeness, accuracy, confidence, toolSuccess)
    }

    return {
      relevance,
      completeness,
      accuracy,
      confidence,
      tool_success: toolSuccess,
      overall,
    }
  }

  /** LLM 模式的综合得分加权（含 accuracy 维度）。 */
  static _computeOverall(
    relevance: number,
    completeness: number,
    accuracy: number,
    confidence: number,
    toolSuccess: number,
  ): number {
    return (
      relevance * 0.25 +
      completeness * 0.25 +
      accuracy * 0.25 +
      confidence * 0.15 +
      toolSuccess * 0.10
    )
  }

  /**
   * hybrid 模式：规则与 LLM 结果加权融合。
   *
   * LLM 结果含 accuracy 维度，规则结果无此维度，融合时从 LLM 继承。
   */
  private _blendResults(
    ruleResult: Record<string, any>,
    llmResult: Record<string, any>,
  ): Record<string, any> {
    let rw = this._hybridRuleWeight
    let lw = this._hybridLlmWeight
    // 归一化权重（防止配置错误）
    const total = rw + lw
    if (total <= 0) {
      rw = 0.4
      lw = 0.6
    } else {
      rw = rw / total
      lw = lw / total
    }

    const blended: Record<string, number> = {}
    // 规则与 LLM 共有的维度：加权平均
    const commonKeys = ['relevance', 'completeness', 'confidence', 'tool_success']
    for (const key of commonKeys) {
      const rVal = ruleResult[key] ?? 0.5
      const lVal = llmResult[key] ?? 0.5
      blended[key] = rVal * rw + lVal * lw
    }

    // accuracy 仅 LLM 提供，直接继承
    blended['accuracy'] = llmResult['accuracy'] ?? 0.5

    // overall 重新加权（含 accuracy）
    blended['overall'] = QualityMonitor._computeOverall(
      blended['relevance'],
      blended['completeness'],
      blended['accuracy'],
      blended['confidence'],
      blended['tool_success'],
    )
    return blended
  }

  // ===== 以下为原规则评估的内部方法（保持不变） =====

  /** 检查响应与提示的相关性。 */
  private _checkRelevance(
    prompt: string,
    response: string,
    context: Record<string, any>,
  ): number {
    if (!response || !response.trim()) {
      return 0.0
    }

    const promptKeywords = new Set(prompt.toLowerCase().split(/\s+/))
    const responseKeywords = new Set(response.toLowerCase().split(/\s+/))

    const stopWords = new Set([
      '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这',
    ])
    for (const sw of stopWords) {
      promptKeywords.delete(sw)
      responseKeywords.delete(sw)
    }

    if (promptKeywords.size === 0) {
      return 1.0
    }

    let overlap = 0
    for (const kw of promptKeywords) {
      if (responseKeywords.has(kw)) {
        overlap += 1
      }
    }
    const keywordRatio = overlap / promptKeywords.size

    const responseLength = response.trim().length
    const promptLength = prompt.trim().length

    if (responseLength < Math.max(10, promptLength * 0.1)) {
      if (keywordRatio < 0.2) {
        return 0.2
      }
    }

    if (keywordRatio < 0.1) {
      return 0.3
    }

    const relevance = Math.min(1.0, keywordRatio + 0.5)
    return Math.max(0.3, relevance)
  }

  /** 检查响应的完整性。 */
  private _checkCompleteness(
    prompt: string,
    response: string,
    context: Record<string, any>,
  ): number {
    if (!response || !response.trim()) {
      return 0.0
    }

    let completeness = 1.0

    const incompletePatterns = ['？', '?', '...']
    for (const pattern of incompletePatterns) {
      if (response.trimEnd().endsWith(pattern)) {
        completeness -= 0.3
      }
    }

    const truncatedMarkers = ['等等', '略', '等', '以下']
    for (const marker of truncatedMarkers) {
      if (response.includes(marker)) {
        completeness -= 0.15
      }
    }

    for (const unknown of QualityMonitor.UNKNOWN_PATTERNS) {
      if (response.includes(unknown)) {
        completeness -= 0.25
      }
    }

    const promptLength = prompt.trim().length
    const responseLength = response.trim().length

    if (promptLength > 50 && responseLength < 20) {
      completeness -= 0.3
    } else if (promptLength > 100 && responseLength < 50) {
      completeness -= 0.2
    }

    return Math.max(0.0, Math.min(1.0, completeness))
  }

  /** 检查响应的置信度。 */
  private _checkConfidence(response: string): number {
    if (!response) {
      return 0.0
    }

    let confidence = 1.0

    for (const pattern of QualityMonitor.LOW_CONFIDENCE_PATTERNS) {
      if (response.includes(pattern)) {
        confidence -= 0.15
      }
    }

    let uncertainCount = 0
    for (const p of QualityMonitor.LOW_CONFIDENCE_PATTERNS) {
      if (response.includes(p)) {
        uncertainCount += 1
      }
    }
    if (uncertainCount > 2) {
      confidence -= 0.2
    }

    return Math.max(0.0, Math.min(1.0, confidence))
  }

  /** 检查工具调用是否成功。 */
  private _checkToolSuccess(
    response: string,
    context: Record<string, any>,
  ): number {
    let toolSuccess = 1.0

    for (const pattern of QualityMonitor.TOOL_FAILURE_PATTERNS) {
      if (response.includes(pattern)) {
        toolSuccess -= 0.4
      }
    }

    const toolResult = context['tool_result']
    if (toolResult !== undefined && toolResult !== null) {
      if (typeof toolResult === 'object' && !Array.isArray(toolResult)) {
        if (toolResult.error || toolResult.success === false) {
          toolSuccess -= 0.5
        }
      } else if (typeof toolResult === 'string') {
        if (toolResult.toLowerCase().includes('error') || toolResult.toLowerCase().includes('fail')) {
          toolSuccess -= 0.3
        }
      }
    }

    if (context['tool_called'] && !toolResult) {
      toolSuccess -= 0.3
    }

    return Math.max(0.0, Math.min(1.0, toolSuccess))
  }
}
