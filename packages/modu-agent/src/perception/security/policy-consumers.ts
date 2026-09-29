// policy-consumers.ts
//
// P3-C：统一策略引擎（PolicyEngine）在主链路的**消费层**。
//
// 背景：P1 已建立 input/tool/output 三阶段契约，仅 tool 阶段被 human_review 消费；
// 本模块补齐 input / output：
//   - input：感知节点装配完成后调用引擎 decide('input')，deny → 熔断（error_code）；
//   - output：finalize_response 节点包装，deny → 拦截，sanitizedText → 替换响应。
//
// 硬约束：
//   1. 全链路受 `policy.engine.enabled`（默认 false）门控 → 默认行为零变化；
//   2. fail-open：引擎异常/判定形状不符一律降级原路径，绝不因引擎故障阻断对话；
//   3. 判定内核不重写（input_guard / output_guard 规则委派既有 guard 实现）。
import { getRegistry } from '../../core/registry.js'
import { getConfig } from '../../config/runtime-config.js'
import { publish_security_audit_event_sync } from './audit.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[security.policy_consumers] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[security.policy_consumers] ${msg}`, ...args),
}

/** `policy.engine.enabled`（默认 false）。 */
export function policyEngineEnabled(): boolean {
  try {
    return Boolean(getConfig().get('policy.engine.enabled', false))
  } catch {
    return false
  }
}

// ============================================================
// input 阶段
// ============================================================

export interface InputPolicyOutcome {
  denied: boolean
  reason?: string
}

/**
 * 应用输入策略（gated；fail-open）。
 *
 * @param text  清洗后的用户输入
 * @param state 当前图状态（取 userId/sessionId/traceId/taskType）
 */
export async function applyInputPolicy(
  text: string,
  state: Record<string, any>,
): Promise<InputPolicyOutcome> {
  if (!policyEngineEnabled()) return { denied: false }

  try {
    const decision = await getRegistry().getPolicyEngine().decide(
      'input',
      { kind: 'input', text },
      {
        userId: state?.user_id ?? '',
        sessionId: state?.session_id ?? '',
        traceId: state?.trace_id ?? '',
        taskType: state?.task_type ?? undefined,
        registry: getRegistry(),
      },
    )
    if (decision.effect === 'deny') {
      return { denied: true, reason: decision.reason ?? 'input denied by policy engine' }
    }
    return { denied: false }
  } catch (e: any) {
    // fail-open：引擎故障不阻断
    logger.warning('input policy decide failed, proceeding without policy: %s', String(e?.message ?? e))
    return { denied: false }
  }
}

// ============================================================
// output 阶段
// ============================================================

type NodeFn = (state: any) => any

/** 输出被策略拒绝时的兜底响应文案。 */
const OUTPUT_REFUSAL_TEXT = '抱歉，本次输出未通过安全策略校验，请调整请求后重试。'

/**
 * 用输出策略包装 finalize_response 节点（gated；fail-open）。
 *
 * - deny          → error_code='POLICY_OUTPUT_DENIED' + 兜底响应；
 * - sanitizedText → 以清洗后文本替换 response；
 * - 其余          → 原样透传。
 */
export function makeOutputPolicyNode(inner: NodeFn): NodeFn {
  return async function _outputPolicyNode(state: any): Promise<any> {
    const result = await inner(state)
    if (!policyEngineEnabled()) return result

    const text = result?.response
    if (typeof text !== 'string' || text.length === 0) return result

    try {
      const decision = await getRegistry().getPolicyEngine().decide(
        'output',
        { kind: 'output', text },
        {
          userId: state?.user_id ?? '',
          sessionId: state?.session_id ?? '',
          traceId: state?.trace_id ?? '',
          taskType: state?.task_type ?? undefined,
          registry: getRegistry(),
        },
      )

      if (decision.effect === 'deny') {
        logger.warning(
          '[output-policy] response denied by policy engine: %s (session=%s)',
          decision.reason ?? '(no reason)', state?.session_id ?? '',
        )
        try {
          publish_security_audit_event_sync({
            eventType: 'output_policy_denied',
            decision: 'deny',
            sessionId: state?.session_id ?? '',
            userId: state?.user_id ?? '',
            traceId: state?.trace_id ?? '',
            details: { reason: decision.reason ?? '' },
          })
        } catch {
          // 审计旁路
        }
        return {
          ...result,
          response: OUTPUT_REFUSAL_TEXT,
          error_code: 'POLICY_OUTPUT_DENIED',
          error_message: decision.reason ?? 'output denied by policy engine',
        }
      }

      if (typeof decision.sanitizedText === 'string' && decision.sanitizedText !== text) {
        logger.info('[output-policy] response replaced with sanitized text (session=%s)', state?.session_id ?? '')
        return { ...result, response: decision.sanitizedText }
      }

      return result
    } catch (e: any) {
      // fail-open
      logger.warning('output policy decide failed, keeping original response: %s', String(e?.message ?? e))
      return result
    }
  }
}
