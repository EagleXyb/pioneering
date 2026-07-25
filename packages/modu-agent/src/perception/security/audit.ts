// 对应文档 §2.5 建议9：集中化审计日志
//
// 安全事件（拦截、审批、拒绝、限流、敏感检测命中）统一发布为
// EventDomain.SECURITY 事件，由 PersistentEventLog 持久化到独立审计日志。
//
// 设计要点：
//   - 发布失败静默处理，不影响主流程（审计为旁路）
//   - 审计事件 priority 默认 HIGH（拒绝/拦截为 CRITICAL）
//   - payload 结构化，便于后续审计查询
//   - 复用 EventBus 基础设施，无需独立传输通道

import { AgentEvent, EventAction, EventDomain, EventPriority } from '../../orchestration/communication/protocol.js'
import { get_event_bus } from '../../orchestration/communication/message-bus.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[security-audit] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[security-audit] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[security-audit] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[security-audit] ${msg}`, ...args),
}

/**
 * 审计事件类型。
 */
export type AuditEventType =
  | 'prompt_injection_blocked'    // Prompt 注入拦截
  | 'pii_detected'                // PII 检测命中
  | 'ssrf_blocked'                // SSRF 防护拦截
  | 'path_traversal_blocked'      // 路径穿越拦截
  | 'sql_injection_blocked'       // SQL 注入拦截
  | 'code_validation_blocked'     // 代码校验拦截
  | 'tool_approval_required'      // 工具需审批
  | 'tool_approval_approved'      // 工具审批通过
  | 'tool_approval_rejected'      // 工具审批拒绝
  | 'tool_rate_limited'           // 工具限流触发
  | 'output_sensitive_blocked'    // 输出敏感信息拦截
  | 'sensitivity_circuit_breaker' // 敏感度熔断

/**
 * 审计事件上下文。
 */
export interface AuditContext {
  /** 事件类型 */
  eventType: AuditEventType
  /** 决策结果：allow/deny/audit */
  decision: 'allow' | 'deny' | 'audit'
  /** 会话 ID */
  sessionId?: string
  /** 用户 ID */
  userId?: string
  /** Trace ID */
  traceId?: string
  /** 工具名（如适用） */
  toolName?: string
  /** 事件详情（结构化，便于查询） */
  details?: Record<string, any>
}

/**
 * 发布安全审计事件。
 *
 * 对应文档 §2.5 建议9：安全事件统一发布 SECURITY.AUDIT/ALLOW/DENY 事件。
 *
 * 策略：
 *   - decision='deny' → EventAction.DENY + priority=CRITICAL
 *   - decision='allow' → EventAction.ALLOW + priority=NORMAL
 *   - decision='audit' → EventAction.AUDIT + priority=HIGH
 *
 * 发布失败静默处理（catch + warning），不影响主流程。
 */
export async function publish_security_audit_event(ctx: AuditContext): Promise<void> {
  try {
    const action =
      ctx.decision === 'deny' ? EventAction.DENY :
      ctx.decision === 'allow' ? EventAction.ALLOW :
      EventAction.AUDIT

    const priority =
      ctx.decision === 'deny' ? EventPriority.CRITICAL :
      ctx.decision === 'allow' ? EventPriority.NORMAL :
      EventPriority.HIGH

    const payload = {
      event_type: ctx.eventType,
      decision: ctx.decision,
      tool_name: ctx.toolName ?? '',
      details: ctx.details ?? {},
    }

    const event = new AgentEvent({
      domain: EventDomain.SECURITY,
      action,
      session_id: ctx.sessionId || '',
      user_id: ctx.userId || 'unknown',
      trace_id: ctx.traceId || '',
      payload,
      metadata: {
        event_type: ctx.eventType,
        tool_name: ctx.toolName ?? '',
      },
      priority,
    })

    const bus = get_event_bus()
    await bus.publish(event)
    logger.debug(
      'Security audit event published: type=%s decision=%s tool=%s',
      ctx.eventType, ctx.decision, ctx.toolName ?? '',
    )
  } catch (e) {
    // 审计为旁路，发布失败不影响主流程
    logger.warning('Failed to publish security audit event: %s', String(e))
  }
}

/**
 * 同步版审计事件发布（用于非异步上下文）。
 *
 * 内部调用异步版本，但不等待结果。适用于工具 invoke 内的拦截点
 * 无法使用 await 的场景。
 */
export function publish_security_audit_event_sync(ctx: AuditContext): void {
  void publish_security_audit_event(ctx)
}
