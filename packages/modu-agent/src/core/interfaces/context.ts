// P2（T-15）: 上下文策略契约（ContextStrategy / ContextFragment / ContextRegistry）。
//
// 目标（对应评估报告 G-4「上下文策略可注册」）：
//   把 `graph/nodes.ts` 的 `agentNode` 中**过程式**的 7 段
//   `messages.splice/push` 上下文注入，收敛为**声明式片段**（fragment）：
//   每个片段声明优先级（priority）、注入位置（placement）与构建函数（build），
//   由 `reasoning/context-builder.ts` 统一按序执行。
//
// 字符等价约束（硬约束 §2.4.1）：
//   默认策略 `default_agent_context` 的片段顺序与插入偏移**复刻**迁移前的
//   splice/push 行为（含 `anchorOffset` 语义），逐字节一致由
//   `tests/reasoning/context-builder.test.ts` 锁定。
//
// 层归属：本文件仅声明契约（零实现）；实现见 `reasoning/context-builder.ts`，
//   内置策略见 `graph/context-strategies.ts`。

import type { BaseMessage } from '@langchain/core/messages'
import type { ModuAgentState } from '../../graph/state.js'

/**
 * 片段注入位置。
 *
 *   - `anchor`：插入到系统提示词锚点附近（`anchorIndex + anchorOffset`），
 *     复刻既有 `messages.splice(idx, 0, msg)` 语义；
 *   - `append`：追加到消息数组末尾，复刻既有 `messages.push(msg)` 语义。
 *
 * 执行顺序：先处理全部 `anchor` 片段（按 priority 升序），再处理 `append` 片段
 * （按 priority 升序）。该顺序与迁移前"先全部 splice、再全部 push"一致。
 */
export type ContextPlacement = 'anchor' | 'append'

/** 片段构建函数返回值：字符串（由 builder 包装为 SystemMessage）或现成消息。 */
export type ContextFragmentOutput = string | BaseMessage | null | undefined

/**
 * 构建期运行时上下文（由 `agentNode` 提供）。
 */
export interface ContextRuntime {
  /**
   * 系统提示词锚点索引：`0` 表示消息数组首位不是 SystemMessage（无 system prompt），
   * `1` 表示首位是 SystemMessage。片段插入位置 = `anchorIndex + anchorOffset`。
   */
  anchorIndex: number
  /** P4: Plan-and-Execute 步骤上下文注入器（返回 SystemMessage 或 null）。 */
  planContextInjector?: ((state: ModuAgentState) => BaseMessage | null) | null
  /** P2-2: Few-shot 动态示例选择器（异步）。 */
  fewShotSelector?: { selectAndFormat(query: string): Promise<string> } | null
  /** 片段 id → 字符预算上限（缺省 = 不限制，保证默认路径字符等价）。 */
  budgets?: Record<string, number>
}

/**
 * 单个上下文片段。
 */
export interface ContextFragment {
  /** 片段唯一 id，如 'ctx.perception' / 'ctx.memory_knowledge'。 */
  id: string
  /** 优先级：数值越小越先被处理（同组内排序依据）。 */
  priority: number
  /** 注入位置。 */
  placement: ContextPlacement
  /**
   * `placement='anchor'` 时相对系统提示词锚点的偏移。
   *
   * 默认 `0`（= 紧随系统提示词之后）。既有的 doc_gen 任务类型提醒使用 `1`
   * （与迁移前 `messages.splice(insertIdx + 1, 0, ...)` 一致）。
   */
  anchorOffset?: number
  /** 字符预算上限（undefined/<=0 表示不限制）。 */
  budget?: number
  /**
   * 构建片段内容；返回 `null`/`undefined`/空串表示该片段本次不适用（跳过，不产生消息）。
   */
  build(
    state: ModuAgentState,
    ctx: ContextRuntime,
  ): ContextFragmentOutput | Promise<ContextFragmentOutput>
}

/**
 * 上下文策略：一组片段 + 适用任务类型。
 */
export interface ContextStrategy {
  readonly id: string
  /** 该策略是否适用于给定任务类型（undefined = 通用兜底）。 */
  supports(taskType?: string): boolean
  /** 返回该策略的片段集合。 */
  fragments(): ContextFragment[]
}

/**
 * 上下文策略注册表接口（实现为 `ComponentRegistry` 的
 * `registerContextStrategy/resolveContextStrategy/...` 方法组）。
 */
export interface ContextRegistry {
  registerStrategy(strategy: ContextStrategy, opts?: { makeDefault?: boolean }): void
  resolve(taskType?: string): ContextStrategy | undefined
  list(): string[]
}
