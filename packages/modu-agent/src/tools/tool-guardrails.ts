// P2-1: 写操作 + 敏感数据安全防护（对应文档 §1.2 优化点 10 + §5.3 P2-1）
//
// 设计要点（对应风险 R-10 规避策略）：
//   1. ACTION_GUARDRAILS 配置化注册表，支持按工具名/操作类型匹配
//   2. guardrail 命中时通过 LangGraph interrupt 触发现有 HITL 机制（不新建独立审批流）
//   3. 与现有 requiresApprovalFor 合并判定：
//      - guardrail 命中 → 直接 interrupt（强审批）
//      - guardrail 未命中 → 走原有 requiresApprovalFor 逻辑
//   4. dry_run 模式：仅检查是否命中 guardrail，不实际执行工具，结果以独立字段回写
//   5. feature flag enable_action_guardrails 默认 false
//
// 触发位置：
//   在 human_review 节点内部集成（合并判定），避免新增独立节点破坏图拓扑（R-10 策略③）
//   guardrail 优先于 requiresApprovalFor 判定

import { getToolCapability } from './tool-registry.js'

/**
 * Guardrail 规则类型。
 *
 * 描述单个 guardrail 规则的匹配条件与动作。
 */
export interface GuardrailRule {
  /** 规则 ID（用于日志追踪） */
  rule_id: string
  /** 匹配的工具名（精确匹配，null 表示匹配所有工具） */
  tool_name?: string | null
  /** 匹配的操作类型（如 'write' / 'delete' / 'sensitive_read'） */
  operation_type?: string
  /** 匹配的参数条件（key=参数路径，value=期望值或正则字符串） */
  param_conditions?: Record<string, string>
  /** 规则描述（用于 interrupt payload 展示） */
  description: string
  /** 是否支持 dry_run 模式（默认 true） */
  dry_run_supported?: boolean
}

/**
 * Guardrail 检查结果。
 */
export interface GuardrailCheckResult {
  /** 是否命中 guardrail */
  hit: boolean
  /** 命中的规则（hit=true 时非空） */
  rule?: GuardrailRule
  /** dry_run 预检结果（仅 dry_run=true 时填充） */
  dry_run_result?: {
    would_execute: boolean
    blocked_reason?: string
  }
}

/**
 * ACTION_GUARDRAILS 注册表。
 *
 * 预置常见写操作/敏感数据操作的 guardrail 规则。
 * 宿主可通过 registerGuardrailRule 追加或覆盖条目。
 *
 * 规则优先级：tool_name + param_conditions > tool_name only > operation_type only
 */
export const ACTION_GUARDRAILS: GuardrailRule[] = [
  {
    rule_id: 'guard_file_ops_write',
    tool_name: 'file_ops',
    operation_type: 'write',
    param_conditions: { mode: 'write|append|overwrite' },
    description: 'File write operation requires approval (may modify filesystem)',
    dry_run_supported: true,
  },
  {
    rule_id: 'guard_file_ops_delete',
    tool_name: 'file_ops',
    operation_type: 'delete',
    param_conditions: { mode: 'delete|remove' },
    description: 'File delete operation requires approval (irreversible)',
    dry_run_supported: true,
  },
  {
    rule_id: 'guard_sql_query_write',
    tool_name: 'sql_query',
    operation_type: 'write',
    param_conditions: { sql: 'INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE' },
    description: 'SQL write operation requires approval (modifies database)',
    dry_run_supported: true,
  },
  {
    rule_id: 'guard_http_request_sensitive',
    tool_name: 'http_request',
    operation_type: 'sensitive_read',
    param_conditions: { method: 'POST|PUT|PATCH|DELETE' },
    description: 'HTTP write request requires approval (may modify external service)',
    dry_run_supported: true,
  },
  {
    rule_id: 'guard_code_executor_network',
    tool_name: 'code_executor',
    operation_type: 'network_access',
    param_conditions: { code: 'fetch|requests|http|socket|net' },
    description: 'Code execution with network access requires approval',
    dry_run_supported: false,
  },
]

/**
 * 注册或追加 guardrail 规则。
 *
 * @param rule guardrail 规则
 */
export function registerGuardrailRule(rule: GuardrailRule): void {
  if (!rule.rule_id) throw new Error('GuardrailRule.rule_id must be non-empty')
  // 按 rule_id 去重：同 id 覆盖
  const idx = ACTION_GUARDRAILS.findIndex((r) => r.rule_id === rule.rule_id)
  if (idx >= 0) {
    ACTION_GUARDRAILS[idx] = rule
  } else {
    ACTION_GUARDRAILS.push(rule)
  }
}

/**
 * 检查单个参数条件是否匹配。
 *
 * @param actualValue 参数实际值
 * @param pattern 期望值或正则字符串（含 | 表示多选，否则精确匹配）
 */
function _matchParamCondition(actualValue: any, pattern: string): boolean {
  if (actualValue === undefined || actualValue === null) return false
  const actualStr = String(actualValue).toLowerCase()
  // 含 | 表示多选模式（如 'write|append|overwrite'）
  if (pattern.includes('|')) {
    const alternatives = pattern.split('|').map((p) => p.trim().toLowerCase())
    // 使用 includes 而非 === 以支持 SQL 语句中的关键词匹配
    return alternatives.some((alt) => actualStr.includes(alt))
  }
  // 精确匹配（大小写不敏感）
  return actualStr === pattern.toLowerCase()
}

/**
 * 检查工具调用是否命中 guardrail。
 *
 * 匹配逻辑（与 TOOL_CAPABILITY_MATRIX.requires_confirmation 双层判定）：
 *   1. 遍历 ACTION_GUARDRAILS，按 tool_name → operation_type → param_conditions 逐级过滤
 *   2. 命中任一规则即返回 hit=true
 *   3. 未命中任何规则时，回退到 TOOL_CAPABILITY_MATRIX.requires_confirmation 静态标注
 *
 * @param toolName 工具名
 * @param args 工具调用参数
 * @param dryRun 是否仅做 dry_run 预检（不实际执行）
 * @returns 检查结果
 */
export function checkGuardrail(
  toolName: string,
  args: Record<string, any>,
  dryRun: boolean = false,
): GuardrailCheckResult {
  // 第一层：ACTION_GUARDRAILS 规则匹配
  for (const rule of ACTION_GUARDRAILS) {
    // tool_name 匹配（null 表示通配）
    if (rule.tool_name && rule.tool_name !== toolName) continue

    // param_conditions 匹配（所有条件均需满足）
    if (rule.param_conditions) {
      let allMatch = true
      for (const [paramPath, pattern] of Object.entries(rule.param_conditions)) {
        const actualValue = _getParamValue(args, paramPath)
        if (!_matchParamCondition(actualValue, pattern)) {
          allMatch = false
          break
        }
      }
      if (!allMatch) continue
    }

    // 命中规则
    const result: GuardrailCheckResult = {
      hit: true,
      rule,
    }
    if (dryRun && rule.dry_run_supported !== false) {
      result.dry_run_result = {
        would_execute: false,
        blocked_reason: `Guardrail ${rule.rule_id} triggered: ${rule.description}`,
      }
    }
    return result
  }

  // 第二层：回退到 TOOL_CAPABILITY_MATRIX.requires_confirmation 静态标注
  // （对应 R-10 策略①：guardrail 仅对 requires_confirmation=true 的工具生效）
  const cap = getToolCapability(toolName)
  if (cap?.requires_confirmation === true) {
    return {
      hit: true,
      rule: {
        rule_id: `matrix_${toolName}`,
        tool_name: toolName,
        description: `Tool ${toolName} requires confirmation (from TOOL_CAPABILITY_MATRIX)`,
        dry_run_supported: true,
      },
      dry_run_result: dryRun
        ? {
            would_execute: false,
            blocked_reason: `Tool ${toolName} marked as requires_confirmation in capability matrix`,
          }
        : undefined,
    }
  }

  return { hit: false }
}

/**
 * 从参数对象中按路径取值（支持点分路径如 'sql' / 'options.mode'）。
 */
function _getParamValue(args: Record<string, any>, path: string): any {
  if (!path.includes('.')) {
    return args[path]
  }
  const parts = path.split('.')
  let current: any = args
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }
  return current
}

/**
 * 批量检查多个 tool_calls 的 guardrail。
 *
 * @param toolCalls tool_calls 数组（每项含 name/args/id）
 * @param dryRun 是否仅做 dry_run 预检
 * @returns 命中 guardrail 的 tool_calls 列表（需审批）
 */
export function checkGuardrailsForToolCalls(
  toolCalls: Array<Record<string, any>>,
  dryRun: boolean = false,
): Array<{ toolCall: Record<string, any>; guardrailResult: GuardrailCheckResult }> {
  const hits: Array<{ toolCall: Record<string, any>; guardrailResult: GuardrailCheckResult }> = []
  for (const tc of toolCalls) {
    const toolName = tc['name'] ?? ''
    const args = tc['args'] ?? {}
    const result = checkGuardrail(toolName, args, dryRun)
    if (result.hit) {
      hits.push({ toolCall: tc, guardrailResult: result })
    }
  }
  return hits
}
