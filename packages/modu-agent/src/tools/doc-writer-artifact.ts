// T3-4：文档产物（doc_writer 成功结果）的**单一事实源**判定。
//
// 背景（修复前的缺陷）：同一套判定逻辑在两处各写了一遍——
//   1. `graph/nodes.ts` 的 toolResultProcessor：判定后写入 `state.artifacts`
//   2. `orchestration/communication/agui-adapter.ts`：判定后发 ARTIFACT_CREATED 事件
// 两处条件几乎逐字重复但**各有一处细微差异**（nodes 要求 name+path 均存在，
// agui 只要求 name），任一侧被单独修改就会静默漂移（表现为"事件发不出"或
// "state 有产物但前端无卡片"）。
//
// 本模块无任何 import（仅类型标注），因此不存在循环依赖风险，两侧均可安全引入。
// 判定语义保持与原实现**逐字一致**，仅把"必须同时具备 name 与 path"统一为
// 两侧都要求的严格条件（doc_writer 成功时两者必然同时存在，故为等价收紧）。

/** 归一化后的文档产物字段（snake_case，agui 侧再转 camelCase）。 */
export interface DetectedDocArtifact {
  name: string
  path: string
  absolute_path: string
  size: number
  format: string
  /** 固定 'document'，与 state.artifacts 的既有类型一致 */
  type: 'document'
  operation: string
  summary: string
  title: string
}

/** 解析工具输出为对象（字符串则尝试 JSON.parse；非对象返回 null）。 */
function _parseContent(content: unknown): Record<string, any> | null {
  if (content === null || content === undefined) return null
  if (typeof content === 'object') return content as Record<string, any>
  if (typeof content !== 'string') return null
  const trimmed = content.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null
  } catch {
    return null
  }
}

/**
 * 从工具执行结果中识别文档产物。
 *
 * 判定条件（与原两处实现一致）：
 *   1. 工具名是 `doc_writer`；**或**
 *   2. 结果结构满足 `status==='success'` 且 `data.format` 为字符串 `'md'`
 *      且 `data.path` 为以 `.md` 结尾的字符串（结构化兜底，不依赖工具名）
 *   3. 且 `data.name` 与 `data.path` 均非空
 *
 * @param toolName 工具名（来自 tool_call）
 * @param content  工具原始输出（字符串或已解析对象）
 * @returns 命中的产物描述；未命中返回 null
 */
export function detectDocArtifact(toolName: string, content: unknown): DetectedDocArtifact | null {
  const parsed = _parseContent(content)
  if (!parsed) return null

  const data = (parsed['data'] ?? {}) as Record<string, any>
  // 成功态是两侧原有的**共同前置条件**（nodes 侧在 isDocWriterResult 之后单独判
  // status==='success'；agui 侧在 isDocWriterSuccess 之后判 status==='success'）。
  // 若只在结构分支检查，`toolName==='doc_writer'` 但 status 为 error 时会漏判，
  // 此处统一为无条件要求，避免改变既有行为。
  if (parsed['status'] !== 'success') return null

  const byToolName = toolName === 'doc_writer'
  const byStructure =
    typeof data['format'] === 'string' &&
    data['format'] === 'md' &&
    typeof data['path'] === 'string' &&
    data['path'].endsWith('.md')

  if (!byToolName && !byStructure) return null
  if (!data['name'] || !data['path']) return null

  return {
    name: String(data['name']),
    path: String(data['path']),
    absolute_path: data['absolute_path'] != null ? String(data['absolute_path']) : '',
    size: Number.isFinite(Number(data['size'])) ? Number(data['size']) : 0,
    format: typeof data['format'] === 'string' ? data['format'] : 'md',
    type: 'document',
    operation: data['operation'] != null ? String(data['operation']) : 'create',
    summary: data['summary'] != null ? String(data['summary']) : '',
    title: data['title'] != null ? String(data['title']) : '',
  }
}
