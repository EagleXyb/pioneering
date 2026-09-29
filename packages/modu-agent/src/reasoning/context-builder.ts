// P2（T-15）: 上下文构建器（ContextBuilder）。
//
// 职责：把 `ContextStrategy.fragments()` 声明的片段，按"位置 + 优先级"顺序
// 注入到消息数组，复刻 `graph/nodes.ts` agentNode 迁移前的过程式注入行为：
//
//   迁移前（agentNode 内联）：
//     perception  → messages.splice(insertIdx,     0, ...)
//     doc_gen     → messages.splice(insertIdx + 1, 0, ...)
//     knowledge   → messages.splice(insertIdx,     0, ...)
//     observations→ messages.push(...)
//     few_shot    → messages.push(...)
//     plan_step   → messages.push(...)
//
//   迁移后：片段声明 { placement, priority, anchorOffset }，本模块统一执行
//     - 先全部 anchor 片段（priority 升序，逐个 splice 到 anchorIndex+offset）
//     - 再全部 append 片段（priority 升序，逐个 push）
//   两者对同一输入产出**逐字节一致**的消息数组
//   （见 tests/reasoning/context-builder.test.ts 的等价矩阵）。
//
// 失败隔离：单片段异常仅告警并跳过，绝不中断 agentNode（对齐
// `perception/pipeline.ts:92-110` 的"逐项 try/catch"范式）。

import { SystemMessage, type BaseMessage } from '@langchain/core/messages'

import type {
  ContextFragment,
  ContextRuntime,
  ContextStrategy,
} from '../core/interfaces/context.js'
import type { ModuAgentState } from '../graph/state.js'

const logger = {
  warning: (msg: string, ...args: any[]) => console.warn(`[context-builder] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[context-builder] ${msg}`, ...args),
}

/** 默认上下文策略 id（内置；宿主可注册同名策略覆盖）。 */
export const DEFAULT_AGENT_CONTEXT_STRATEGY_ID = 'default_agent_context'

/** 按优先级升序排序（`Array.prototype.sort` 稳定，同优先级保持声明顺序）。 */
function _byPriority(a: ContextFragment, b: ContextFragment): number {
  return a.priority - b.priority
}

/** 构建单条消息；不适用（null/空串）或异常时返回 null。 */
async function _buildMessage(
  fragment: ContextFragment,
  state: ModuAgentState,
  ctx: ContextRuntime,
): Promise<BaseMessage | null> {
  try {
    const out = await fragment.build(state, ctx)
    if (out === null || out === undefined) return null
    if (typeof out === 'string') {
      let content = out
      const budget = fragment.budget ?? ctx.budgets?.[fragment.id]
      if (typeof budget === 'number' && budget > 0 && content.length > budget) {
        content = content.slice(0, budget)
      }
      if (content === '') return null
      return new SystemMessage({ content })
    }
    return out
  } catch (e: any) {
    logger.warning(
      'context fragment %s build failed, skipped: %s',
      fragment.id, String(e?.message ?? e),
    )
    return null
  }
}

/**
 * 按策略把上下文片段注入 `messages`（原地修改并返回同一数组）。
 *
 * @param messages 已注入 system prompt 的消息数组（agentNode 传入其局部副本）
 * @param state    当前图状态
 * @param ctx      构建期运行时上下文（含 `anchorIndex`）
 * @param strategy 上下文策略（宿主任意实现；未注册时由调用方传入内置默认策略）
 */
export async function applyContextFragments(
  messages: BaseMessage[],
  state: ModuAgentState,
  ctx: ContextRuntime,
  strategy: ContextStrategy,
): Promise<BaseMessage[]> {
  let fragments: ContextFragment[]
  try {
    fragments = strategy.fragments() ?? []
  } catch (e: any) {
    logger.warning('context strategy %s fragments() failed: %s', strategy.id, String(e?.message ?? e))
    return messages
  }
  if (!Array.isArray(fragments) || fragments.length === 0) {
    return messages
  }

  const anchorFragments = fragments.filter((f) => f.placement === 'anchor').sort(_byPriority)
  const appendFragments = fragments.filter((f) => f.placement !== 'anchor').sort(_byPriority)

  const anchorIndex = Number.isFinite(ctx.anchorIndex) ? Math.max(0, ctx.anchorIndex) : 0

  for (const fragment of anchorFragments) {
    const msg = await _buildMessage(fragment, state, ctx)
    if (msg === null) continue
    // splice 自带越界钳制；显式 clamp 使语义显式化
    // （下界 0：负 anchorIndex 会被 splice 解释为"从末尾倒数"，与迁移前语义不符）
    const idx = Math.min(anchorIndex + (fragment.anchorOffset ?? 0), messages.length)
    messages.splice(idx, 0, msg)
  }

  for (const fragment of appendFragments) {
    const msg = await _buildMessage(fragment, state, ctx)
    if (msg === null) continue
    messages.push(msg)
  }

  logger.debug(
    'context fragments applied: strategy=%s anchor=%d append=%d messages=%d',
    strategy.id, anchorFragments.length, appendFragments.length, messages.length,
  )
  return messages
}

/** 列出策略的片段 id（按实际执行顺序；供验收与调试使用）。 */
export function listFragmentIds(strategy: ContextStrategy): string[] {
  const fragments = strategy.fragments() ?? []
  return [
    ...fragments.filter((f) => f.placement === 'anchor').sort(_byPriority).map((f) => f.id),
    ...fragments.filter((f) => f.placement !== 'anchor').sort(_byPriority).map((f) => f.id),
  ]
}
