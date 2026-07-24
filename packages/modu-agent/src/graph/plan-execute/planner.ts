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
import { PlanSchema, type PlanStep } from './types.js'

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
 * 将 LLM 原始输出解析并校验为 PlanStep 列表。
 *
 * @param raw LLM 输出文本
 * @param maxSteps 步骤数硬上限
 * @returns 规整化后的 PlanStep 列表；解析/校验失败返回 null
 */
function _parsePlan(raw: string, maxSteps: number): PlanStep[] | null {
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
  // 规整化 step_id 为 step_{i}，保证游标与前端索引一致
  // P2-优化修复: 保留 requires_tool 字段，使 step_finalize 的工具调用校验生效
  return steps.map((s, i) => ({
    step_id: `step_${i + 1}`,
    title: s.title,
    description: s.description,
    ...(s.depends_on ? { depends_on: s.depends_on } : {}),
    ...(s.requires_tool !== undefined ? { requires_tool: s.requires_tool } : {}),
    status: 'pending' as const,
  }))
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

    const replanCount = state.replan_count ?? 0
    const isReplan = replanCount > 0

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
      return { plan: [], plan_phase: '', replan_count: replanCount }
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
        try {
          effectiveLlm = llm.bind({ temperature })
        } catch {
          effectiveLlm = llm
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
        replan_count: replanCount,
        plan_delta: null,
      }
    }

    logger.info(
      'Plan created: %d step(s), replan=%s trace_id=%s',
      plan.length, isReplan, state.trace_id ?? '',
    )

    return {
      plan: plan as unknown as Array<Record<string, any>>,
      plan_phase: 'executing',
      current_step_index: 0,
      // P1-6 修复：step_results reducer 已改为空数组清空语义
      // 返回空列表会覆盖旧步骤结果（reducer 检测 next.length===0 时返回 []）
      step_results: [],
      replan_count: isReplan ? replanCount + 1 : replanCount,
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
  return 'finalize_response'
}
