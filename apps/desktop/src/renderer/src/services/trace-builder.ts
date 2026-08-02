// ============================================================
// Trace Builder — 从后端持久化的 contentBlocks 重建 Trace 树
// （thinking / tool-call / observation / text）。
//
// 从 chatStore 外移至本模块，保持纯函数、无 store 依赖，便于单测。
// 节点 id / label / 层级与 services/stream-handler 保持一致：
//   - thinking 节点：${msgId}::thinking
//   - text 节点：   ${msgId}::text
//   - 工具节点：   executionId
//   - observation 子节点：${executionId}::obs
// 根节点顺序：thinking → 工具（按首次出现顺序）→ text。
// ============================================================

import type { ContentBlock, TraceNode } from '@shared/types'
import {
  extractEmbeddedToolResults,
  classifyToolResult
} from '../lib/embedded-tool-results'
import {
  makeThinkingNodeId,
  makeTextNodeId,
  makeObservationNodeId
} from './stream-handler'

/**
 * 重建 Trace 树。
 *
 * 初次生成时 Trace 树由 stream-handler 在内存中构建，仅存在于流式会话期间；
 * 侧边栏加载历史消息时后端只回传 contentBlocks，若不做重建，useTrace 会为 false，
 * 导致历史消息回退到扁平 ToolCallCard（原始 JSON 折叠），与初次生成的
 * AgentTimeline 树形时间线样式不一致。本函数补齐该缺口，使两处渲染效果一致。
 */
export function buildTraceFromContentBlocks(
  blocks: ContentBlock[] | undefined,
  msgId: string,
  fallbackContent?: string
): { nodes: Record<string, TraceNode>; roots: string[] } | undefined {
  if (!blocks || blocks.length === 0) return undefined

  const nodes: Record<string, TraceNode> = {}
  const roots: string[] = []

  // 收集工具 executionId（按首次出现顺序）、tool_result summary、最终状态
  const toolOrder: string[] = []
  const toolMeta = new Map<string, { toolName?: string; status: TraceNode['status'] }>()
  const results = new Map<string, string>()

  const mapStatus = (s?: string): TraceNode['status'] => {
    if (s === 'error' || s === 'failed') return 'error'
    if (s === 'pending') return 'pending'
    return 'completed'
  }

  for (const b of blocks) {
    if (b.type === 'tool_call' && b.executionId) {
      if (!toolMeta.has(b.executionId)) toolOrder.push(b.executionId)
      toolMeta.set(b.executionId, {
        toolName: b.toolName,
        status: mapStatus(b.status)
      })
    } else if (b.type === 'tool_result' && b.executionId && b.summary) {
      results.set(b.executionId, b.summary)
    }
  }

  // 后端在落库时会把 tool_result.summary 截断到前 200 字符（见 backend-ts agent-bridge），
  // 导致搜索结果这类较长的 JSON 被截断、无法 JSON.parse，渲染时会退化为原始文本而非
  // SearchResultsCard。完整的结果其实内嵌在 text_stream 的正文里，这里提取出来作为
  // observation content 的补充来源，按工具类型匹配填充。
  const textContent = blocks
    .filter((b) => b.type === 'text_stream')
    .map((b) => b.text ?? '')
    .join('')
  const embeddedResults: { raw: string; kind: string | null }[] = []
  for (const seg of extractEmbeddedToolResults(textContent)) {
    if (seg.type !== 'toolResult') continue
    let kind: string | null = null
    try {
      kind = classifyToolResult(seg.parsed)?.kind ?? null
    } catch {
      kind = null
    }
    embeddedResults.push({ raw: seg.raw, kind })
  }

  const isCompleteJson = (s: string): boolean => {
    try {
      JSON.parse(s)
      return true
    } catch {
      return false
    }
  }

  // 取一个工具的结果内容：优先 tool_result.summary（若为完整合法 JSON）；
  // 否则从正文内嵌的完整 JSON 中按工具类型匹配一个，避免截断 JSON 导致渲染退化。
  const usedEmbedded = new Set<number>()
  const pickObservationContent = (toolName: string | undefined, summary: string | undefined): string | undefined => {
    if (summary && isCompleteJson(summary)) return summary
    const isSearch = /search|web|news|browse/i.test(toolName ?? '')
    const isDatetime = /datetime|time|clock/i.test(toolName ?? '')
    for (let i = 0; i < embeddedResults.length; i++) {
      if (usedEmbedded.has(i)) continue
      const er = embeddedResults[i]!
      const kindMatch =
        (isSearch && er.kind === 'search') ||
        (isDatetime && er.kind === 'datetime') ||
        (!isSearch && !isDatetime && er.kind === null)
      if (kindMatch) {
        usedEmbedded.add(i)
        return er.raw
      }
    }
    // 类型不匹配时按顺序取第一个未使用的完整 JSON 兜底
    for (let i = 0; i < embeddedResults.length; i++) {
      if (!usedEmbedded.has(i)) {
        usedEmbedded.add(i)
        return embeddedResults[i]!.raw
      }
    }
    return summary || undefined
  }

  // thinking 根节点
  const hasThinking = blocks.some((b) => b.type === 'thinking')
  if (hasThinking) {
    const id = makeThinkingNodeId(msgId)
    const thinkingContent = blocks
      .filter((b) => b.type === 'thinking')
      .map((b) => b.summary ?? '')
      .join('')
    nodes[id] = {
      id,
      kind: 'thinking',
      label: '思考过程',
      status: 'completed',
      parentId: null,
      children: [],
      content: thinkingContent || undefined
    }
    roots.push(id)
  }

  // 工具根节点 + observation 子节点
  for (const id of toolOrder) {
    const meta = toolMeta.get(id)!
    const node: TraceNode = {
      id,
      kind: 'tool-call',
      label: meta.toolName || 'tool',
      toolName: meta.toolName || 'tool',
      status: meta.status,
      parentId: null,
      children: [],
      arguments: {}
    }
    const summary = results.get(id)
    const obsContent = pickObservationContent(node.toolName, summary)
    if (obsContent) {
      const obsId = makeObservationNodeId(id)
      nodes[obsId] = {
        id: obsId,
        kind: 'observation',
        label: '观察结果',
        status: meta.status === 'error' ? 'error' : 'completed',
        parentId: id,
        children: [],
        content: obsContent,
        toolName: node.toolName
      }
      node.children!.push(obsId)
    }
    nodes[id] = node
    roots.push(id)
  }

  // text 根节点：优先用 text_stream 累积的正文（textContent 已在函数开头计算）；
  // 若缺失（部分历史消息只存了 content 而无 text_stream 块），回退用 ChatMessage.content，
  // 避免正文丢失。
  const finalText = textContent || fallbackContent
  if (finalText) {
    const id = makeTextNodeId(msgId)
    nodes[id] = {
      id,
      kind: 'text',
      label: '最终回答',
      status: 'completed',
      parentId: null,
      children: [],
      content: finalText || undefined
    }
    roots.push(id)
  }

  if (roots.length === 0) return undefined
  return { nodes, roots }
}
