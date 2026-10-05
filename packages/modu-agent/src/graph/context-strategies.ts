// P2（T-15）: 内置上下文策略（`agentNode` 迁移前 6 段内联注入的声明式等价物）。
//
// T4-1 修正：本文件首行原写"7 段"，但下方迁移对照表与实际 fragments 数组均为
// **6 段**（文件内自相矛盾）。现已核对 `DEFAULT_AGENT_CONTEXT_STRATEGY.fragments`
// 的实际长度，注释与实现对齐为 6。
//
// 迁移对照（`graph/nodes.ts` agentNode，迁移前行号）：
//   :1033-1044 感知上下文          → ctx.perception      （anchor, offset 0, priority 10）
//   :1046-1063 文档生成任务类型提醒 → ctx.doc_gen_task    （anchor, offset 1, priority 20）
//   :1065-1079 长期知识            → ctx.memory_knowledge（anchor, offset 0, priority 30）
//   :1081-1104 Observation 蒸馏历史 → ctx.observations    （append,           priority 40）
//   :1106-1119 Few-shot 动态示例    → ctx.few_shot        （append,           priority 45）
//   :1121-1132 plan 步骤上下文      → ctx.plan_step       （append,           priority 50）
//
// `anchorOffset=1` 的语义：复刻迁移前 `messages.splice(insertIdx + 1, 0, ...)`。
// 全部片段默认 `budget` 缺省（不截断），保证与迁移前逐字节一致。

import type { BaseMessage } from '@langchain/core/messages'

import type {
  ContextFragment,
  ContextStrategy,
} from '../core/interfaces/context.js'
import { DEFAULT_AGENT_CONTEXT_STRATEGY_ID } from '../reasoning/context-builder.js'
import { extractPerceptionContext } from '../perception/index.js'
import type { ModuAgentState } from './state.js'
import { renderPromptWithFallback } from '../reasoning/prompt-registry.js'
import { DOC_GEN_TASK_PROMPT_TEMPLATE } from './prompt-templates.js'

/** 感知上下文片段。 */
const _perceptionFragment: ContextFragment = {
  id: 'ctx.perception',
  priority: 10,
  placement: 'anchor',
  anchorOffset: 0,
  build(state: ModuAgentState): string | null {
    const perceptionResult = state.perception_result
    if (!perceptionResult) return null
    const perceptionCtx = extractPerceptionContext(perceptionResult)
    if (!perceptionCtx || Object.keys(perceptionCtx).length === 0) return null
    return `Perception context: ${JSON.stringify(perceptionCtx)}`
  },
}

/** 文档生成任务类型提醒片段（模板可注册，见 `agent.doc_generation_task`）。 */
const _docGenTaskFragment: ContextFragment = {
  id: 'ctx.doc_gen_task',
  priority: 20,
  placement: 'anchor',
  anchorOffset: 1,
  build(state: ModuAgentState): string | null {
    if (state.task_type !== 'document_generation') return null
    return renderPromptWithFallback(
      'agent.doc_generation_task', {}, DOC_GEN_TASK_PROMPT_TEMPLATE,
    )
  },
}

/** 长期知识（memory_query 节点写入 `state.knowledge`）片段。 */
const _memoryKnowledgeFragment: ContextFragment = {
  id: 'ctx.memory_knowledge',
  priority: 30,
  placement: 'anchor',
  anchorOffset: 0,
  build(state: ModuAgentState): string | null {
    const knowledge = state.knowledge ?? []
    if (knowledge.length === 0) return null
    const knowledgeText = knowledge
      .filter((item) => item && typeof item === 'object')
      .map((item) => (item as Record<string, any>)['content'] ?? '')
      .join('\n')
    if (!knowledgeText) return null
    return `Relevant knowledge from memory:\n${knowledgeText}`
  },
}

/** Observation 蒸馏历史片段（仅保留最近 5 条）。 */
const _observationsFragment: ContextFragment = {
  id: 'ctx.observations',
  priority: 40,
  placement: 'append',
  build(state: ModuAgentState): string | null {
    const observationHistory = state.observation_history ?? []
    if (observationHistory.length === 0) return null
    const recentObs = observationHistory.slice(-5) // 仅保留最近 5 条，控制 token
    const obsText = recentObs
      .map((o, idx) => {
        const summary = o['summary'] ?? ''
        const metrics = o['key_metrics'] ? ` | metrics: ${JSON.stringify(o['key_metrics'])}` : ''
        const count = o['records_count'] !== undefined ? ` | count: ${o['records_count']}` : ''
        // P1-1: error 状态且存在 enhancement 时，附加引导文本
        const enhancement = o['enhancement']
          ? `\n   ⚠️ ${o['enhancement']}`
          : ''
        return `[${idx}] ${o['tool'] ?? 'unknown'} (${o['status'] ?? 'success'}): ${summary}${count}${metrics}${enhancement}`
      })
      .join('\n')
    if (!obsText) return null
    return `Recent observations (distilled summaries):\n${obsText}`
  },
}

/** Few-shot 动态示例片段（gated by 注入的 selector；为空时静默跳过）。 */
const _fewShotFragment: ContextFragment = {
  id: 'ctx.few_shot',
  priority: 45,
  placement: 'append',
  async build(state: ModuAgentState, ctx): Promise<string | null> {
    const selector = ctx.fewShotSelector
    if (!selector) return null
    const query = state.cleaned_text ?? ''
    const fewShotPrompt = await selector.selectAndFormat(query)
    return fewShotPrompt ? fewShotPrompt : null
  },
}

/** P4 Plan-and-Execute 当前步骤上下文片段（注入器返回 SystemMessage）。 */
const _planStepFragment: ContextFragment = {
  id: 'ctx.plan_step',
  priority: 50,
  placement: 'append',
  build(state: ModuAgentState, ctx): BaseMessage | null {
    const injector = ctx.planContextInjector
    if (!injector) return null
    return injector(state) ?? null
  },
}

/**
 * 默认上下文片段清单（执行顺序由 priority 决定，见文件头迁移对照表）。
 */
export const DEFAULT_AGENT_CONTEXT_FRAGMENTS: ContextFragment[] = [
  _perceptionFragment,
  _docGenTaskFragment,
  _memoryKnowledgeFragment,
  _observationsFragment,
  _fewShotFragment,
  _planStepFragment,
]

/**
 * 默认上下文策略：通用兜底（`supports` 仅在无 taskType 时命中，
 * 以避免遮蔽宿主注册的任务级策略）。
 */
export class DefaultAgentContextStrategy implements ContextStrategy {
  readonly id: string = DEFAULT_AGENT_CONTEXT_STRATEGY_ID
  private readonly _fragments: ContextFragment[]

  constructor(fragments: ContextFragment[] = DEFAULT_AGENT_CONTEXT_FRAGMENTS) {
    this._fragments = fragments
  }

  supports(taskType?: string): boolean {
    // 通用兜底：仅当调用方未提供 taskType 时命中；
    // 任务级命中交由宿主注册的策略（resolve 会先按 taskType 匹配）。
    return taskType === undefined || taskType === null || taskType === ''
  }

  fragments(): ContextFragment[] {
    return this._fragments
  }
}

let _defaultStrategy: ContextStrategy | null = null

/** 获取默认上下文策略单例（未注册任何策略时的回退目标）。 */
export function getDefaultAgentContextStrategy(): ContextStrategy {
  if (_defaultStrategy === null) {
    _defaultStrategy = new DefaultAgentContextStrategy()
  }
  return _defaultStrategy
}

/** 重置默认策略单例（测试清理用）。 */
export function resetDefaultAgentContextStrategy(): void {
  _defaultStrategy = null
}

/**
 * 注册内置默认上下文策略（幂等）。
 *
 * 只在**尚无默认策略**时才请求 `makeDefault`——否则 `create_agent` 每次调用都会
 * 把宿主事先 `setDefaultContextStrategy(...)` 的结果顶回内置策略，使
 * "替换上下文策略不改内核源码"在真实启动序列下失效。
 *
 * 由 `graph/factory.ts` 的 `create_agent` 调用；未调用时 `agentNode` 亦会通过
 * `getDefaultAgentContextStrategy()` 回退 → 默认行为零变化。
 *
 * @returns 注册条数
 */
export function registerBuiltinContextStrategies(
  registry: {
    registerContextStrategy: (s: ContextStrategy, opts?: { makeDefault?: boolean }) => void
    getDefaultContextStrategyId?: () => string | null
  },
): number {
  const hasDefault = typeof registry.getDefaultContextStrategyId === 'function'
    ? registry.getDefaultContextStrategyId() !== null
    : false
  registry.registerContextStrategy(
    getDefaultAgentContextStrategy(),
    { makeDefault: !hasDefault },
  )
  return 1
}
