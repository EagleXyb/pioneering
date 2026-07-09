// ============================================================
// genId — 带降级的唯一 ID 生成器（对应文档 E5）
// crypto.randomUUID 在非安全上下文（如普通浏览器预览 ?platform=）
// 可能抛错；统一收敛到带降级的实现，避免各处散落不一致的兜底逻辑。
// ============================================================

export function genId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID()
    } catch {
      // 非安全上下文会抛错，落到下面的降级实现
    }
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
