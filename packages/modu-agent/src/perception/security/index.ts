// 对应 Python: components/perception/security/__init__.py
// 安全感知模块
//
// 安全沙箱优化（对应文档 §2.5 建议9）：
//   - SecurityGuard：输入校验 / Prompt 注入检测 / PII 检测 / 输出敏感信息检测
//   - audit：集中化审计日志，安全事件统一发布 SECURITY.AUDIT/ALLOW/DENY 事件
export { SecurityGuard } from './guard.js'
export {
  publish_security_audit_event,
  publish_security_audit_event_sync,
  type AuditEventType,
  type AuditContext,
} from './audit.js'
// P0（T-05）: 输出护栏节点包装器（接线 detectOutputSensitive / sanitizeOutput）
export { makeOutputGuardNode } from './output-guard-node.js'
// P1（T-10 / T-10b）: 三层护栏策略规则（判定层；执行层保持不变）
export {
  ToolApprovalPolicyRule,
  InputGuardPolicyRule,
  OutputGuardPolicyRule,
  registerDefaultPolicyRules,
  createModuLlmJudgeCallback,
  DEFAULT_POLICY_RULE_IDS,
  type LLMJudgeCallback,
  type InputGuardPolicyRuleOptions,
  type OutputGuardPolicyRuleOptions,
  type RegisterDefaultPolicyRulesOptions,
} from './policy-rules.js'
