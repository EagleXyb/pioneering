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
