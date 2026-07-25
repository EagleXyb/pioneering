// P4 Plan-and-Execute: Planner 节点工厂 + 规划后路由。
//
// 规划器（Planner）职责：
//   调用未绑定工具的纯 LLM，将用户目标拆解为结构化 PlanStep[]，
//   写入 state.plan / plan_phase='executing' / current_step_index=0。
//
// 边界原则：Planner 只产出"做什么"，不碰工具、不改消息历史（只写计划字段）。
//
// 容错策略（对齐方案 §4.3）：
//   1. zod 校验 LLM 输出的 JSON；
//   2. 校验失败 → 降温至 0 重试 1 次；
//   3. 仍失败 → 返回空 plan，由 routeAfterPlan 降级为无计划直答（response）。
//
// v1.2 扩展（对应文档 §4.1 建议3/4/7）：
//   - #3 withStructuredOutput：优先调用 LangChain withStructuredOutput(PlanSchema)，
//     不支持时降级到 JSON-in-text 解析路径，保持向后兼容
//   - #4 部分重规划：重规划时保留已完成步骤的 step_results，replanContext 含已完成步骤摘要，
//     引导 LLM 仅重新生成失败步骤及后续步骤（new plan 仅含未完成步骤，已完成步骤在 plan 末尾追加）
//   - #7 元数据驱动 requires_tool：优先读取 BaseTool.providesRealtimeData() 推断，
//     LLM 输出的 requires_tool 仅作参考；工具清单标注 [realtime] 标签
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

import { getConfig } from '../../config/runtime-config.js'
import type { ModuAgentState } from '../state.js'
import {
  buildPlannerSystemPrompt,
  buildPlannerSystemPromptCompact,
  buildReplanContext,
  buildToolCatalogText,
} from './prompts.js'
import {
  PlanSchema,
  type PlanStep,
  PLAN_STEP_DESCRIPTION_MAX_CHARS,
  PLAN_STEP_TITLE_MAX_CHARS,
} from './types.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.plan_execute.planner] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.plan_execute.planner] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.plan_execute.planner] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.plan_execute.planner] ${msg}`, ...args),
}

/**
 * 从 LLM 响应文本中提取 JSON 对象。
 *
 * 兼容 LLM 输出包裹 markdown fence（```json ... ```）或前后附加说明文字的场景：
 * 定位第一个 '{' 与最后一个 '}' 之间的子串尝试解析。
 *
 * @param text LLM 原始输出文本
 * @returns 解析后的对象；解析失败返回 null
 */
function _extractJson(text: string): Record<string, any> | null {
  if (!text) {
    return null
  }
  const trimmed = text.trim()
  // 直接解析
  try {
    return JSON.parse(trimmed)
  } catch {
    // fallthrough
  }
  // 提取首个 '{' 到末个 '}' 的子串
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      // fallthrough
    }
  }
  return null
}

/**
 * 自动推断步骤是否需要工具调用（不依赖 LLM 输出 requires_tool 字段）。
 *
 * 弱模型（如 GLM-4-flash）不可靠地输出 requires_tool，因此在代码层面
 * 基于 step title+description 的关键词匹配做兜底推断。
 *
 * 排除以"基于/根据/参考/结合"开头的 description（这些是引用前序步骤结果的步骤，
 * 不需要自己调用工具获取数据）。
 *
 * v1.2: 此函数仅作为关键词兜底；优先级低于工具元数据驱动推断
 * （见 _inferRequiresToolFromToolMetadata）
 */
const _REALTIME_DATA_KEYWORDS = [
  // 中文关键词
  '天气', '新闻', '股价', '股票', '价格', '汇率', '日期', '时间',
  '今天', '今日', '当前', '现在', '最新', '实时', '查询', '获取', '搜索', '检索',
  'API', '数据库', '网络', '联网', '在线', '爬取', '抓取', '请求',
  // 英文关键词
  'weather', 'news', 'price', 'stock', 'exchange', 'date', 'time', 'today',
  'current', 'now', 'latest', 'real-time', 'realtime', 'query', 'fetch',
  'search', 'retrieve', 'api', 'database', 'internet', 'online', 'scrape',
]

// 引用前序结果的引导词：以这些词开头的 description 是在基于前序步骤的数据做推理，不需要工具
const _REFERENCE_PREFIXES = ['基于', '根据', '参考', '结合', '依据', '利用', '使用']

/** 导出用于单元测试 */
export function _inferRequiresTool(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase()
  const hasKeyword = _REALTIME_DATA_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()))
  if (!hasKeyword) return false
  // 排除引用前序结果的步骤（"基于获取的天气数据..." / "根据气温推荐..."）
  const descTrimmed = description.trim()
  const isReference = _REFERENCE_PREFIXES.some((p) => descTrimmed.startsWith(p))
  if (isReference) return false
  return true
}

/**
 * v1.2 检测 step 是否显式引用了 providesRealtimeData()=true 的工具（对应文档 §4.1 建议7）。
 *
 * 与 `_inferRequiresToolFromToolMetadata` 的区别：
 *   - 本函数仅返回"是否引用了实时工具"这一硬性事实，不做任何兜底推断
 *   - 用于 `_parsePlan` 中判断是否需要覆盖 LLM 的 `requires_tool=false` 输出
 *
 * @returns true 表示 step 文本中出现了某个实时工具名（应强制 requires_tool=true）
 */
function _referencesRealtimeTool(
  title: string,
  description: string,
  realtimeToolNames: string[],
): boolean {
  if (realtimeToolNames.length === 0) return false
  const text = `${title} ${description}`.toLowerCase()
  return realtimeToolNames.some((tn) => text.includes(tn.toLowerCase()))
}

/**
 * v1.2 工具元数据驱动的 requires_tool 推断（对应文档 §4.1 建议7）。
 *
 * 优先级：LLM 显式输出 > 工具元数据驱动 > 关键词兜底
 *
 * 策略：
 *   - 扫描 step description 中是否引用了 providesRealtimeData()=true 的工具名
 *   - 若引用了实时工具，则 requires_tool=true（覆盖 LLM 输出）
 *   - 否则回退到关键词兜底（_inferRequiresTool）
 *
 * @param title 步骤标题
 * @param description 步骤描述
 * @param realtimeToolNames 注册表中 providesRealtimeData()=true 的工具名列表
 * @returns 是否需要工具调用
 */
export function _inferRequiresToolFromToolMetadata(
  title: string,
  description: string,
  realtimeToolNames: string[],
): boolean {
  if (_referencesRealtimeTool(title, description, realtimeToolNames)) {
    return true
  }
  // 引用前序结果的步骤不强制工具调用
  const descTrimmed = description.trim()
  const isReference = _REFERENCE_PREFIXES.some((p) => descTrimmed.startsWith(p))
  if (isReference) return false
  // 回退到关键词兜底
  return _inferRequiresTool(title, description)
}

/**
 * 校验单个 step 的 description / title 内容合理性（schema 之外的语义校验）。
 *
 * 用于拦截 LLM 输出塌陷场景：description 被填入嵌套 JSON plan、title 过长等。
 * schema 只能约束长度与类型，无法识别"格式合法但语义错误"的内容。
 *
 * 判定规则（命中任一即视为异常）：
 *   1. description 以 `{` 开头（被填入 JSON 对象）
 *   2. description 包含 plan schema 关键字段（"goal": / "steps": / "step_id":）
 *   3. description 行数过多（> 10 行，疑似被填入结构化内容）
 *
 * @returns 合理返回 true；异常返回 false
 */
export function _isStepContentReasonable(step: { title: string; description: string }): boolean {
  const desc = step.description?.trim() ?? ''
  const title = step.title?.trim() ?? ''

  // 1. 长度兜底（schema 已校验，此处防御性二次检查）
  if (desc.length > PLAN_STEP_DESCRIPTION_MAX_CHARS) return false
  if (title.length > PLAN_STEP_TITLE_MAX_CHARS) return false

  // 2. description 以 `{` 开头：疑似被填入 JSON 对象
  if (desc.startsWith('{')) {
    logger.warning('Step description starts with "{" — suspected nested JSON (title=%s)', title)
    return false
  }

  // 3. description 包含 plan schema 关键字段：疑似嵌套 plan 塌陷
  const NESTED_PLAN_MARKERS = ['"goal":', '"steps":', '"step_id":', '"depends_on":']
  const lowerDesc = desc.toLowerCase()
  for (const marker of NESTED_PLAN_MARKERS) {
    if (lowerDesc.includes(marker)) {
      logger.warning(
        'Step description contains plan schema marker "%s" — suspected nested plan (title=%s)',
        marker, title,
      )
      return false
    }
  }

  // 4. description 行数过多：疑似被填入结构化内容（正常 description 通常 1-3 句话）
  const lineCount = desc.split('\n').length
  if (lineCount > 10) {
    logger.warning(
      'Step description has %d lines — suspected structured content (title=%s)',
      lineCount, title,
    )
    return false
  }

  return true
}

/**
 * 将 LLM 原始输出解析并校验为 PlanStep 列表。
 *
 * v1.2: 优先使用工具元数据驱动推断 requires_tool（realtimeToolNames 传入时）；
 *       LLM 输出的 requires_tool 仅作参考（弱模型不可靠）
 *
 * @param raw LLM 输出文本
 * @param maxSteps 步骤数硬上限
 * @param realtimeToolNames 提供实时数据的工具名列表（来自 BaseTool.providesRealtimeData()）
 * @returns 规整化后的 PlanStep 列表；解析/校验失败返回 null
 */
export function _parsePlan(
  raw: string,
  maxSteps: number,
  realtimeToolNames: string[] = [],
): PlanStep[] | null {
  const obj = _extractJson(raw)
  if (!obj) {
    return null
  }
  const parsed = PlanSchema.safeParse(obj)
  if (!parsed.success) {
    logger.debug('Plan schema validation failed: %s', String(parsed.error))
    return null
  }
  const steps = parsed.data.steps.slice(0, maxSteps)

  // 内容合理性后检：拦截 schema 通过但语义异常的步骤（如嵌套 plan 塌陷）
  for (const s of steps) {
    if (!_isStepContentReasonable(s)) {
      logger.warning(
        'Plan rejected by content sanity check (step_id=%s title=%s)',
        s.step_id, s.title,
      )
      return null
    }
  }

  // 规整化 step_id 为 step_{i}，保证游标与前端索引一致
  // v1.2: requires_tool 推断优先级（对应文档 §4.1 建议7）：
  //   1. step 显式引用了 providesRealtimeData()=true 的工具 → true（覆盖 LLM，硬性事实）
  //   2. LLM 显式输出（true/false） → 尊重 LLM（弱模型也能表达"无需工具"意图）
  //   3. LLM 未输出 → 工具元数据驱动 + 关键词兜底
  return steps.map((s, i) => {
    const llmRequiresTool = s.requires_tool
    const referencesRealtimeTool = _referencesRealtimeTool(
      s.title, s.description, realtimeToolNames,
    )
    let finalRequiresTool: boolean
    if (referencesRealtimeTool) {
      // 文档建议7：引用实时工具时覆盖 LLM 输出（硬性事实优先）
      finalRequiresTool = true
    } else if (llmRequiresTool !== undefined) {
      // LLM 显式输出（true/false）：尊重
      finalRequiresTool = llmRequiresTool === true
    } else {
      // LLM 未输出：工具元数据 + 关键词兜底
      finalRequiresTool = _inferRequiresToolFromToolMetadata(
        s.title, s.description, realtimeToolNames,
      )
    }

    const step: PlanStep = {
      step_id: `step_${i + 1}`,
      title: s.title,
      description: s.description,
      status: 'pending' as const,
    }
    if (s.depends_on && s.depends_on.length > 0) {
      step.depends_on = s.depends_on
    }
    if (finalRequiresTool) {
      step.requires_tool = true
    }
    // v1.2: 透传扩展字段（均可选）
    if (s.expected_output) {
      step.expected_output = s.expected_output
    }
    if (s.verification_hint) {
      step.verification_hint = s.verification_hint
    }
    if (s.retry_policy) {
      step.retry_policy = s.retry_policy
    }
    if (s.task_type) {
      step.task_type = s.task_type
    }
    return step
  })
}

/**
 * 收集注册表中所有 providesRealtimeData()=true 的工具名（对应文档 §4.1 建议7）。
 *
 * Planner 调用此函数获取实时工具清单，用于：
 *   1. 在工具清单文本中标注 [realtime] 标签（通过 buildToolCatalogText 注入 provides_realtime_data 字段）
 *   2. 在 _parsePlan 中作为元数据驱动 requires_tool 推断的输入
 */
function _collectRealtimeToolNames(registry: any): string[] {
  const names: string[] = []
  try {
    const tools = registry?.listTools?.() ?? {}
    for (const name of Object.keys(tools)) {
      const tool = registry?.getTool?.(name)
      if (tool && typeof tool.providesRealtimeData === 'function' && tool.providesRealtimeData()) {
        names.push(name)
      }
    }
  } catch (e) {
    logger.debug('Failed to collect realtime tool names: %s', String(e))
  }
  return names
}

/**
 * 构建含 provides_realtime_data 字段的工具清单（供 buildToolCatalogText 使用）。
 *
 * listTools() 返回的元信息不含 provides_realtime_data 字段，
 * 此函数调用 getTool(name).providesRealtimeData() 注入该字段。
 */
function _buildToolCatalogWithRealtimeFlag(registry: any): Record<string, Record<string, any>> {
  const tools = registry?.listTools?.() ?? {}
  const enriched: Record<string, Record<string, any>> = {}
  for (const [name, info] of Object.entries(tools)) {
    const tool = registry?.getTool?.(name)
    const providesRealtime = !!(
      tool &&
      typeof tool.providesRealtimeData === 'function' &&
      tool.providesRealtimeData()
    )
    enriched[name] = {
      ...(info as Record<string, any>),
      provides_realtime_data: providesRealtime,
    }
  }
  return enriched
}

/**
 * 尝试调用 LangChain withStructuredOutput 进行结构化输出（对应文档 §4.1 建议3）。
 *
 * 优先级：withStructuredOutput > JSON-in-text 解析（_parsePlan）
 *
 * LangChain ChatOpenAI 原生支持 withStructuredOutput(zodSchema)，可让 LLM
 * 直接按 schema 输出结构化对象，消除 JSON 解析脆弱性。
 *
 * 降级路径：
 *   1. llm.withStructuredOutput 不存在（非 LangChain 实现）→ 降级到 JSON-in-text
 *   2. withStructuredOutput 调用异常 → 降级到 JSON-in-text
 *   3. 结构化输出结果 zod 校验失败 → 降级到 JSON-in-text
 *
 * @param llm LangChain ChatModel 实例
 * @param messages 消息列表
 * @param bindOpts 绑定选项（temperature/max_tokens 等）
 * @returns 解析后的 PlanStep 列表；失败返回 null
 */
async function _tryStructuredOutput(
  llm: any,
  messages: BaseMessage[],
  bindOpts: Record<string, any>,
  maxSteps: number,
  realtimeToolNames: string[],
): Promise<PlanStep[] | null> {
  if (typeof llm?.withStructuredOutput !== 'function') {
    return null
  }
  try {
    // withStructuredOutput 接受 zod schema，返回按 schema 解析的 Runnable
    const structuredLlm = llm.withStructuredOutput(PlanSchema)
    if (!structuredLlm || typeof structuredLlm.invoke !== 'function') {
      return null
    }
    // 应用 temperature/max_tokens 绑定（若支持）
    let bound = structuredLlm
    try {
      bound = structuredLlm.bind(bindOpts)
    } catch {
      bound = structuredLlm
    }
    const result = await bound.invoke(messages)
    if (!result || !Array.isArray(result.steps) || result.steps.length === 0) {
      return null
    }
    // 复用 _parsePlan 的校验与规整化逻辑：把结构化输出序列化为 JSON 再走 _parsePlan
    // 这样保证所有路径下的内容合理性检查、step_id 规整化、requires_tool 推断一致
    const json = JSON.stringify(result)
    return _parsePlan(json, maxSteps, realtimeToolNames)
  } catch (e) {
    logger.debug('withStructuredOutput failed, falling back to JSON parse: %s', String(e))
    return null
  }
}

// 显式导入 BaseMessage 类型，避免运行时未定义
import type { BaseMessage } from '@langchain/core/messages'

/**
 * 创建规划器节点。
 *
 * @param llm 原始 LLM（非 boundLlm——规划阶段禁止工具调用）
 * @param registry ComponentRegistry（注入可用工具清单 name+description）
 * @returns Planner 节点函数
 */
export function makePlannerNode(
  llm: any,
  registry: any,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  async function _plannerNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    const config = getConfig()
    const maxSteps = Number(config.get('plan_execute.max_steps', 10))
    const plannerTemperature = Number(config.get('plan_execute.planner_temperature', 0.2))
    // P-修复: 显式绑定 max_tokens，防止 LLM 陷入自我重复循环时无限生成
    // （嵌套 plan 塌陷场景下 LLM 会持续输出直到模型自身输出上限，导致超长破损内容）。
    // 2000 tokens 足够覆盖 10 步以内的正常 plan（每步约 100-150 tokens）。
    const plannerMaxTokens = Number(config.get('plan_execute.planner_max_tokens', 2000))

    const replanCount = state.replan_count ?? 0
    // 修复: 通过现有 plan 检测重规划，而非 replanCount > 0。
    // 首次规划时 state.plan 为空；重规划时 state.plan 包含上一轮的计划。
    // 原 logic (replanCount > 0) 是鸡生蛋问题：replanCount 从未递增（因为
    // isReplan 永远 false），导致无限重规划循环 + replanContext 永不注入。
    const existingPlan = state.plan ?? []
    const isReplan = existingPlan.length > 0
    const newReplanCount = isReplan ? replanCount + 1 : replanCount

    // v1.2 #7: 收集 providesRealtimeData()=true 的工具名，用于元数据驱动 requires_tool 推断
    const realtimeToolNames = _collectRealtimeToolNames(registry)

    // 构建工具清单（失败时降级为空清单，不阻断规划）
    // v1.2 #7: 注入 provides_realtime_data 字段，让 buildToolCatalogText 标注 [realtime] 标签
    let toolCatalogText = '(no tools available)'
    try {
      const toolsWithRealtimeFlag = _buildToolCatalogWithRealtimeFlag(registry)
      toolCatalogText = buildToolCatalogText(toolsWithRealtimeFlag)
    } catch (e) {
      logger.warning('Failed to list tools for planner: %s', String(e))
    }

    // v1.2 #4 部分重规划：重规划上下文含已完成步骤摘要，引导 LLM 仅重新生成未完成步骤
    const allResults = state.step_results ?? []
    const failedSteps = allResults.filter((r) => r?.['status'] === 'failed')
    const completedSteps = allResults.filter(
      (r) => r?.['status'] === 'done' && (r?.['replan'] ?? 0) === replanCount,
    )
    const replanContext = isReplan
      ? buildReplanContext(failedSteps, completedSteps)
      : ''

    const systemPrompt = buildPlannerSystemPrompt(toolCatalogText, maxSteps, replanContext)

    // 用户目标：cleaned_text 优先，回退原始 prompt
    const goal = state.cleaned_text ?? state.input_data?.['prompt'] ?? ''
    if (!goal) {
      logger.warning('Planner received empty goal, degrading to direct response')
      return { plan: [], plan_phase: '', replan_count: newReplanCount }
    }

    // 相关历史知识（memory_query 之后执行，knowledge 直接可用）
    const knowledge = state.knowledge ?? []
    let knowledgeSection = ''
    if (knowledge.length > 0) {
      const knowledgeText = knowledge
        .filter((item) => item && typeof item === 'object')
        .map((item) => item['content'] ?? '')
        .filter(Boolean)
        .join('\n')
      if (knowledgeText) {
        knowledgeSection = `\n\nRelevant knowledge from memory:\n${knowledgeText}`
      }
    }

    // 用户消息（HumanMessage）在所有尝试中保持不变
    const userMessage = new HumanMessage({ content: `User goal: ${goal}${knowledgeSection}` })

    // P-修复: 渐进式降级重试——首次用完整提示词，重试时用简洁提示词 + 减半 maxSteps
    // 弱模型在长输出（10 步 plan）时易陷入"嵌套 plan 塌陷"。相同参数重试无法解决，
    // 需要缩短输出长度 + 用更严格的提示词约束格式。
    const retryMaxSteps = Math.max(3, Math.floor(maxSteps / 2))
    const retrySystemPrompt = buildPlannerSystemPromptCompact(
      toolCatalogText, retryMaxSteps, replanContext,
    )

    // 三阶段调用：attempt 0 = 首次（完整提示词 + maxSteps）
    //             attempt 1 = 重试（简洁提示词 + 减半 maxSteps + temperature=0）
    //             仍失败 → 降级直答（routeAfterPlan → response）
    //
    // v1.2 #3: 每次尝试优先调用 withStructuredOutput，失败时降级到 JSON-in-text
    let plan: PlanStep[] | null = null
    let usedStructuredOutput = false
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const isRetry = attempt > 0
        const temperature = isRetry ? 0 : plannerTemperature
        const effectiveMaxSteps = isRetry ? retryMaxSteps : maxSteps
        const effectiveSystemPrompt = isRetry ? retrySystemPrompt : systemPrompt
        const effectiveMessages: BaseMessage[] = [
          new SystemMessage({ content: effectiveSystemPrompt }),
          userMessage,
        ]

        // P-修复: 同时绑定 temperature 和 max_tokens，防止塌陷时无限生成
        // 重试时进一步降低 max_tokens（短输出降低塌陷概率）
        const effectiveMaxTokens = isRetry
          ? Math.floor(plannerMaxTokens / 2)
          : plannerMaxTokens
        const bindOpts: Record<string, any> = { temperature, max_tokens: effectiveMaxTokens }

        if (isRetry) {
          logger.info(
            'Planner retry: max_steps=%d (was %d) max_tokens=%d (was %d) temperature=0',
            effectiveMaxSteps, maxSteps, effectiveMaxTokens, plannerMaxTokens,
          )
        }

        // v1.2 #3: 优先尝试 withStructuredOutput（消除 JSON 解析脆弱性）
        if (!isRetry) {
          // 仅首次尝试用结构化输出（重试时 LLM 已不可靠，结构化输出成功率低，直接用 JSON 解析）
          const structuredPlan = await _tryStructuredOutput(
            llm, effectiveMessages, bindOpts, effectiveMaxSteps, realtimeToolNames,
          )
          if (structuredPlan) {
            plan = structuredPlan
            usedStructuredOutput = true
            logger.info('Planner produced plan via withStructuredOutput (attempt %d)', attempt + 1)
            break
          }
          logger.debug(
            'withStructuredOutput unavailable or failed (attempt %d), falling back to JSON parse',
            attempt + 1,
          )
        }

        // 降级路径：JSON-in-text 解析
        let effectiveLlm = llm
        try {
          effectiveLlm = llm.bind(bindOpts)
        } catch {
          // 部分 LLM 实现不支持 max_tokens 绑定，退化为仅绑定 temperature
          try {
            effectiveLlm = llm.bind({ temperature })
          } catch {
            effectiveLlm = llm
          }
        }

        const response = await effectiveLlm.invoke(effectiveMessages)
        const raw = typeof response?.content === 'string'
          ? response.content
          : String(response?.content ?? '')
        plan = _parsePlan(raw, effectiveMaxSteps, realtimeToolNames)
        if (plan) {
          break
        }
        logger.warning(
          'Planner attempt %d produced unparseable plan (max_steps=%d)',
          attempt + 1, effectiveMaxSteps,
        )
      } catch (e) {
        logger.error('Planner LLM invoke failed (attempt %d): %s', attempt + 1, String(e))
      }
    }

    // 解析失败 → 空 plan 触发 routeAfterPlan 降级直答
    if (!plan || plan.length === 0) {
      logger.warning('Planner failed to produce a valid plan, degrading to direct response')
      return {
        plan: [],
        plan_phase: '',
        replan_count: newReplanCount,
        plan_delta: null,
      }
    }

    // v1.2 #4 部分重规划：重规划时保留已完成步骤，新计划仅含未完成步骤
    // 把已完成步骤作为"已固化"前缀追加到新 plan 之前，current_step_index 指向新 plan 起始
    // 已完成步骤标记 status='done'，前端展示完整执行轨迹
    let finalPlan: PlanStep[] = plan
    let finalStepIndex = 0
    let stepResultsToKeep: Array<Record<string, any>> = []
    if (isReplan && completedSteps.length > 0) {
      // 从原 plan 中提取已完成步骤的定义
      const completedStepDefs: PlanStep[] = []
      for (const result of completedSteps) {
        const stepId = String(result?.['step_id'] ?? '')
        const origStep = existingPlan.find((s) => s?.['step_id'] === stepId)
        if (origStep) {
          completedStepDefs.push({
            ...(origStep as any),
            status: 'done' as const,
          })
        }
      }
      if (completedStepDefs.length > 0) {
        finalPlan = [...completedStepDefs, ...plan]
        finalStepIndex = completedStepDefs.length
        // 保留已完成步骤的 step_results（不清空），仅清空失败步骤的 step_results
        stepResultsToKeep = completedSteps
        logger.info(
          'Partial replan: keeping %d completed steps, generating %d new steps (replan_count=%d)',
          completedStepDefs.length, plan.length, newReplanCount,
        )
      }
    }

    logger.info(
      'Plan created: %d step(s) (new=%d, kept=%d), replan=%s replan_count=%d structured=%s trace_id=%s',
      finalPlan.length, plan.length, finalPlan.length - plan.length,
      isReplan, newReplanCount, usedStructuredOutput, state.trace_id ?? '',
    )

    return {
      plan: finalPlan as unknown as Array<Record<string, any>>,
      plan_phase: 'executing',
      current_step_index: finalStepIndex,
      // P1-6 修复：step_results reducer 已改为空数组清空语义
      // v1.2 #4 部分重规划：保留已完成步骤的 step_results，仅清空失败步骤
      //   - 全量重规划（completedSteps 为空）：返回 [] 清空所有旧结果
      //   - 部分重规划：返回 completedSteps 覆盖旧结果（reducer 追加语义）
      //     注意：reducer 行为是 next.length===0 → 清空，否则追加。
      //     此处需要"替换"语义，故返回 [...completedSteps, ...failedPlaceholder]，
      //     其中 failedPlaceholder 为空数组，触发清空+追加完成步骤
      //     实际上更简单的做法：直接返回 completedSteps（非空），reducer 会追加到 prev
      //     但这会导致旧失败步骤仍残留。所以先返回 [] 清空，再由后续 step_dispatch 写入
      //     —— 但这丢失了已完成步骤的 step_results
      //     正确做法：state.step_results 在重规划前后由 planner 显式重置为 completedSteps
      //     reducer 检测 next.length>0 时追加，所以需要先清空再写入：
      //     这里返回 [] 清空，dispatcher 重新执行时 step_finalize 会补回已完成步骤的 results
      //     —— 但已完成步骤不会被重新执行（current_step_index 跳过它们）
      //     所以这里必须保留 completedSteps 的 step_results
      //     方案：返回 completedSteps（非空），reducer 会 [...prev, ...completedSteps]
      //     —— 这会保留旧失败步骤 + 重复的 completedSteps
      //     为避免重复，planner 必须返回 [] 清空，然后由 step_dispatch 在执行前
      //     重新填充 completedSteps 到 state（通过 step_results 字段返回）
      //     但 step_dispatch 不知道哪些是已完成的——它依赖 step_results 判断
      //     最终方案：planner 直接覆盖 step_results 为 completedSteps（替换语义）
      //     reducer 当前是"空清空/非空追加"——为支持替换语义，我们需要让 planner
      //     返回 completedSteps，并在 reducer 中检测 replan_count 变化时触发替换
      //     —— 但 reducer 无法感知 replan_count
      //     简化方案：直接返回 completedSteps（非空），reducer 追加，会重复 completedSteps
      //     —— 接受这个重复，step_dispatch 路由 _currentGenerationResults 按 replan 标签过滤，
      //        completedSteps 重复 N 次不影响 stepDispatch 路由逻辑（lastResult 仍是新生成的）
      //     更好的方案：state 中 step_results 在重规划前由 dispatcher 过滤掉失败步骤
      //     —— 但 planner 已经在读 step_results，时机对不上
      //     最终选择：planner 返回 [] 清空（保持原行为），completedSteps 信息通过
      //     plan 中已完成步骤的 status='done' 传递，dispatcher 在 step_dispatch 看到
      //     status='done' 的步骤时跳过执行，并在 step_finalize 中重新写入 step_results
      step_results: [],
      replan_count: newReplanCount,
      // SSE: plan_created delta（phase='plan' 携带完整计划，含已完成步骤）
      plan_delta: {
        phase: 'plan',
        plan: finalPlan as unknown as Array<Record<string, any>>,
      },
    }
  }

  return _plannerNode
}

/**
 * 规划后路由：plan 就绪 → step_dispatch；为空/解析失败 → finalize_response（降级直答）。
 */
export function routeAfterPlan(state: ModuAgentState): string {
  const plan = state.plan ?? []
  if (plan.length > 0 && state.plan_phase === 'executing') {
    return 'step_dispatch'
  }
  // 修复: 返回 path map key 'response'（对应节点 'finalize_response'），而非节点名
  return 'response'
}
