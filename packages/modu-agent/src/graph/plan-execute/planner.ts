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
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

import { getConfig } from '../../config/runtime-config.js'
import type { ModuAgentState } from '../state.js'
import {
  buildPlannerSystemPrompt,
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
 * @param raw LLM 输出文本
 * @param maxSteps 步骤数硬上限
 * @returns 规整化后的 PlanStep 列表；解析/校验失败返回 null
 */
export function _parsePlan(raw: string, maxSteps: number): PlanStep[] | null {
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
  // P2-优化修复: 保留 requires_tool 字段；若 LLM 未输出则自动推断（弱模型兜底）
  return steps.map((s, i) => {
    // 优先使用 LLM 输出的 requires_tool；未输出时自动推断
    const llmRequiresTool = s.requires_tool
    const inferred = llmRequiresTool !== undefined ? llmRequiresTool : _inferRequiresTool(s.title, s.description)
    return {
      step_id: `step_${i + 1}`,
      title: s.title,
      description: s.description,
      ...(s.depends_on ? { depends_on: s.depends_on } : {}),
      ...(inferred ? { requires_tool: true } : {}),
      status: 'pending' as const,
    }
  })
}

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

    // 构建工具清单（失败时降级为空清单，不阻断规划）
    let toolCatalogText = '(no tools available)'
    try {
      const tools = registry?.listTools?.() ?? {}
      toolCatalogText = buildToolCatalogText(tools)
    } catch (e) {
      logger.warning('Failed to list tools for planner: %s', String(e))
    }

    // 重规划上下文：上一轮失败步骤及原因
    const replanContext = isReplan
      ? buildReplanContext(
          (state.step_results ?? []).filter((r) => r?.['status'] === 'failed'),
        )
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

    const messages = [
      new SystemMessage({ content: systemPrompt }),
      new HumanMessage({ content: `User goal: ${goal}${knowledgeSection}` }),
    ]

    // 调用 LLM（最多 2 次：首次 + 降温重试 1 次）
    let plan: PlanStep[] | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let effectiveLlm = llm
        const temperature = attempt === 0 ? plannerTemperature : 0
        // P-修复: 同时绑定 temperature 和 max_tokens，防止塌陷时无限生成
        try {
          effectiveLlm = llm.bind({ temperature, max_tokens: plannerMaxTokens })
        } catch {
          // 部分 LLM 实现不支持 max_tokens 绑定，退化为仅绑定 temperature
          try {
            effectiveLlm = llm.bind({ temperature })
          } catch {
            effectiveLlm = llm
          }
        }
        const response = await effectiveLlm.invoke(messages)
        const raw = typeof response?.content === 'string'
          ? response.content
          : String(response?.content ?? '')
        plan = _parsePlan(raw, maxSteps)
        if (plan) {
          break
        }
        logger.warning('Planner attempt %d produced unparseable plan', attempt + 1)
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

    logger.info(
      'Plan created: %d step(s), replan=%s replan_count=%d trace_id=%s',
      plan.length, isReplan, newReplanCount, state.trace_id ?? '',
    )

    return {
      plan: plan as unknown as Array<Record<string, any>>,
      plan_phase: 'executing',
      current_step_index: 0,
      // P1-6 修复：step_results reducer 已改为空数组清空语义
      // 返回空列表会覆盖旧步骤结果（reducer 检测 next.length===0 时返回 []）
      step_results: [],
      replan_count: newReplanCount,
      // SSE: plan_created delta（phase='plan' 携带完整计划）
      plan_delta: {
        phase: 'plan',
        plan: plan as unknown as Array<Record<string, any>>,
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
