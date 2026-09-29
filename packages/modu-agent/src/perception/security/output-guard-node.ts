// P0（T-05）：输出护栏接线节点包装器。
//
// 背景：`SecurityGuard.detectOutputSensitive`（guard.ts:312）与 `sanitizeOutput`（:369）
// 实现完整，但全仓（src/ 与 tests/）零调用 → 纯死代码，"输出敏感信息拦截"能力从未生效。
// 本模块以**节点包装器**形式接入，不修改 nodes.ts 内部实现（保持观测/安全埋点低侵入）。
//
// 行为：
//   - 包装 finalize_response 节点的返回值，对 `response` 文本做敏感信息清洗
//     （密钥/凭证 → [REDACTED:类型]、内网 IP → [REDACTED:INTERNAL_IP]、
//      手机号/身份证/银行卡 → [REDACTED:类型]）。
//   - 命中时发布 `output_sensitive_blocked` 审计事件（audit.ts:36），补上此前缺失的发布者。
//
// 硬约束（默认行为零变化）：
//   - 仅当 `perception.security.sanitize_output.enabled=true` 时挂载该包装
//     （graph.ts 内门控）；默认 false → 节点函数原样使用。
//   - 清洗异常一律降级为原响应（catch + warning），绝不影响主流程。

import { SecurityGuard } from './guard.js'
import { publish_security_audit_event_sync } from './audit.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[security.output_guard] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[security.output_guard] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[security.output_guard] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[security.output_guard] ${msg}`, ...args),
}

type NodeFn = (state: any) => any

/**
 * 用输出护栏包装一个节点函数。
 *
 * @param inner 原节点函数（如 responseNode）
 * @returns 包装后的节点函数（签名与返回值结构保持兼容）
 */
export function makeOutputGuardNode(inner: NodeFn): NodeFn {
  const guard = new SecurityGuard()

  return function _outputGuardNode(state: any): any {
    const result = inner(state)
    try {
      const text = result?.response
      if (typeof text !== 'string' || text.length === 0) {
        return result
      }

      const [sanitized, detection] = guard.sanitizeOutput(text)
      if (!detection?.detected || sanitized === text) {
        return result
      }

      const secretTypes: string[] = detection.secret_types ?? []
      const piiTypes: string[] = detection.pii_types ?? []
      const internalIps: string[] = detection.internal_ips ?? []

      logger.warning(
        '[output-guard] Sensitive content redacted: secrets=%s pii=%s internal_ips=%d session=%s',
        secretTypes.join(',') || '(none)',
        piiTypes.join(',') || '(none)',
        internalIps.length,
        state?.session_id ?? '',
      )

      // 审计事件：补上 12 类事件中 output_sensitive_blocked 的发布者
      publish_security_audit_event_sync({
        eventType: 'output_sensitive_blocked',
        decision: 'audit',
        sessionId: state?.session_id ?? '',
        userId: state?.user_id ?? '',
        traceId: state?.trace_id ?? '',
        details: {
          secret_types: secretTypes,
          pii_types: piiTypes,
          internal_ips_count: internalIps.length,
        },
      })

      return { ...result, response: sanitized }
    } catch (e: any) {
      // 输出清洗失败 → 保留原响应（不阻断主流程）
      logger.warning('[output-guard] sanitize failed, keeping original response: %s', String(e?.message ?? e))
      return result
    }
  }
}
