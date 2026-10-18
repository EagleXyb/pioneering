// SSE 行解析（P1）
//
// 只做「一行文本 → data 载荷」的纯函数转换，便于单测与复用。
// 返回 null 表示该行不是有效数据行（空行 / 注释 / 心跳 / 非 data: 前缀）。

/** 取出 `data:` 后的载荷；`[DONE]` 由调用方判断。 */
export function parseSSEDataLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':')) return null
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  return payload ? payload : null
}

/**
 * 把缓冲区按行切分，返回完整行与剩余不完整片段。
 *
 * 同时兼容 `\n` 与 `\r\n`（后者在 split 后会残留 `\r`，由 parseSSEDataLine 的 trim 处理）。
 */
export function splitSSEBuffer(buffer: string): { lines: string[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  return { lines, rest }
}
