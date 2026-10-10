/**
 * 消息时间格式化
 *
 * 用于用户消息气泡的悬停元信息行（参考样式："9月29日 17:26"）。
 * 规则按"距离现在远近"逐级降级，避免所有消息都带上冗余的年份：
 *   - 今天     → 17:26
 *   - 昨天     → 昨天 17:26
 *   - 今年更早 → 9月29日 17:26
 *   - 跨年     → 2025年9月29日 17:26
 *
 * 入参为空或非法时返回空字符串（调用方据此决定是否渲染时间节点），
 * 不抛错，兼容历史消息缺失 datetime 的场景。
 */

/** 取某天的零点时间戳（按本地时区，规避 DST 下固定 86400000 的误差） */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatMessageTime(
  iso?: string | null,
  now: Date = new Date(),
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const todayStart = startOfDay(now);
  const targetStart = startOfDay(d);

  if (targetStart === todayStart) return hm;
  if (targetStart === startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
    return `昨天 ${hm}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
