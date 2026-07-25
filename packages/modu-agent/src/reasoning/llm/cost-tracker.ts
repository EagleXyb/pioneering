// LLM 成本核算辅助模块
//
// 对应文档 §2.1 成本核算建议：
//   在 LLM 接口层统一采集 token 用量，发布 EventDomain.LLM + EventAction.COST 事件，
//   累计到 per-session/per-user 成本指标。
//
// 被 BaseLLMReasoner 与 ModuLLMAdapter 共享，避免成本核算逻辑在两处实现漂移。
import { AgentEvent, EventAction, EventDomain, EventPriority } from '../../orchestration/communication/protocol.js'
import { get_event_bus } from '../../orchestration/communication/message-bus.js'
import { getConfig } from '../../config/runtime-config.js'
import type { LLMUsage } from '../../core/interfaces/llm.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[llm.cost] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[llm.cost] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[llm.cost] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[llm.cost] ${msg}`, ...args),
}

/**
 * 检查成本核算是否启用。
 *
 * 优先读取 RuntimeConfig llm.cost_tracking.enabled，配置不可用时安全降级为关闭。
 */
export function is_cost_tracking_enabled(): boolean {
  try {
    return Boolean(getConfig().get('llm.cost_tracking.enabled', true))
  } catch {
    return false
  }
}

/**
 * 成本核算事件上下文。
 */
export interface CostEventContext {
  provider: string
  model: string
  sessionId?: string
  userId?: string
  traceId?: string
  taskType?: string
}

/**
 * 发布 LLM.COST 事件到 EventBus。
 *
 * 事件 payload 为 JSON 编码的 { provider, model, usage } 结构。
 * 失败时静默降级（仅记录 debug 日志），不影响主流程。
 *
 * @param usage token 用量
 * @param ctx   调用上下文（provider/model/sessionId 等）
 */
export async function publish_llm_cost_event(
  usage: LLMUsage,
  ctx: CostEventContext,
): Promise<void> {
  if (!is_cost_tracking_enabled()) {
    return
  }

  if (!usage || usage.total_tokens === 0) {
    return
  }

  try {
    // payload 直接传结构化对象（对应文档 §2.2 建议1：消除 hex 编解码冗余）
    const payload = {
      provider: ctx.provider,
      model: ctx.model,
      usage,
    }
    const event = new AgentEvent({
      domain: EventDomain.LLM,
      action: EventAction.COST,
      session_id: ctx.sessionId || '',
      user_id: ctx.userId || 'unknown',
      payload,
      metadata: {
        provider: ctx.provider,
        model: ctx.model,
        task_type: ctx.taskType || '',
        trace_id: ctx.traceId || '',
        // 数值类元数据保留为 number（对应文档 §2.2 建议2：metadata 放宽为 unknown）
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      },
      priority: EventPriority.LOW,
    })

    const bus = get_event_bus()
    await bus.publish(event)
    logger.debug(
      'LLM.COST event published: provider=%s model=%s tokens=%d',
      ctx.provider, ctx.model, usage.total_tokens,
    )
  } catch (e) {
    // 成本核算失败不影响主流程
    logger.debug('publish_llm_cost_event failed (suppressed): %s', String(e))
  }
}
