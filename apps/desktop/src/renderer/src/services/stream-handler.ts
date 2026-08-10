// ============================================================
// Stream Handler — 流式响应累积与 rAF 批量更新
// 从 chatStore.sendMessage 中抽离，封装 pending 缓冲区、rAF 调度、
// 旧流守卫（mySeq）、idle 超时检测、最终内容合并等通用逻辑。
// M1：在原有扁平数组基础上双写 TraceNode 树（traceNodes + traceRootOrder），
// 为 M2 的树形渲染做准备；旧 API（contentDelta/thinkingDelta/toolCalls）保留，
// 保证 MessageBubble 现有扁平渲染不破坏。
// ============================================================

import type { Attachment, ToolCall, TraceNode, TraceNodeStatus } from '@shared/types'
import type { AguiStreamCallbacks } from './api/agui'

export interface StreamFinalMeta {
  messageId?: string
  sessionId?: string
  model?: string
  tokenCount?: number
}

export interface StreamHandlerOptions {
  mySeq: number
  getCurrentSeq: () => number
  getCurrentStreamingId: () => string | null
  assistantMsgId: string
  /** idle 超时毫秒数（0 = 禁用）。超过该时长未收到任何 chunk/thinking/tool 事件则触发超时错误 */
  idleTimeoutMs?: number
  onFlush: (state: {
    contentDelta: string
    thinkingDelta: string
    toolCalls: ToolCall[]
    // M1: Trace 树快照（不可变引用，每次 flush 重建）
    traceNodes: Record<string, TraceNode>
    traceRootOrder: string[]
    attachments: Attachment[]
  }) => void
  onDone: (final: {
    msgId: string
    content: string
    thinking: string | undefined
    toolCalls: ToolCall[]
    traceNodes: Record<string, TraceNode>
    traceRootOrder: string[]
    attachments: Attachment[]
    meta: StreamFinalMeta
  }) => void
  onError: (error: string, partial: {
    content: string
    thinking: string | undefined
    toolCalls: ToolCall[]
    traceNodes: Record<string, TraceNode>
    traceRootOrder: string[]
    attachments: Attachment[]
  }) => void
}

// ---- 常量：节点 id 生成 ----
const THINKING_NODE_SUFFIX = '::thinking'
const TEXT_NODE_SUFFIX = '::text'
const OBSERVATION_NODE_SUFFIX = '::obs'

export function makeThinkingNodeId(msgId: string): string {
  return `${msgId}${THINKING_NODE_SUFFIX}`
}
export function makeTextNodeId(msgId: string): string {
  return `${msgId}${TEXT_NODE_SUFFIX}`
}
export function makeObservationNodeId(toolCallId: string): string {
  return `${toolCallId}${OBSERVATION_NODE_SUFFIX}`
}

export function createStreamHandler(options: StreamHandlerOptions): AguiStreamCallbacks {
  let pendingContent = ''
  let pendingThinking = ''
  const liveToolCalls: ToolCall[] = []
  const toolIndexById = new Map<string, number>()
  let rafId: number | null = null
  let accumulatedContent = ''
  let accumulatedThinking = ''
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let finished = false

  // M1: Trace 树状态
  const { assistantMsgId } = options
  const traceNodes = new Map<string, TraceNode>()
  const traceRootOrder: string[] = []
  // text 节点延迟创建（第一条 content 到达时才加入，避免空回答也显示"最终回答"节点）
  let textNodeCreated = false
  let thinkingNodeCreated = false

  // Artifact 附件（doc_writer 产物）
  const liveAttachments: Attachment[] = []
  // Plan-step 节点计数（用于生成唯一 id）
  let planStepCounter = 0

  const thinkingNodeId = makeThinkingNodeId(assistantMsgId)
  const textNodeId = makeTextNodeId(assistantMsgId)

  const { mySeq, getCurrentSeq, getCurrentStreamingId, idleTimeoutMs = 30000 } = options

  function isStale(): boolean {
    return finished || mySeq !== getCurrentSeq() || getCurrentStreamingId() !== assistantMsgId
  }

  function resetIdleTimer() {
    if (idleTimeoutMs <= 0) return
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (isStale()) return
      handleError(`Stream idle timeout (${idleTimeoutMs / 1000}s without data)`)
    }, idleTimeoutMs)
  }

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  // M1: 把内部 Map 快照为 plain object（不可变），供 React 状态更新使用
  function snapshotTrace(): { nodes: Record<string, TraceNode>; roots: string[] } {
    const nodes: Record<string, TraceNode> = {}
    for (const [id, node] of traceNodes) {
      nodes[id] = { ...node, children: [...node.children] }
    }
    return { nodes, roots: [...traceRootOrder] }
  }

  function ensureThinkingNode(status: TraceNodeStatus) {
    if (thinkingNodeCreated) {
      const n = traceNodes.get(thinkingNodeId)
      if (n && n.status !== 'completed' && n.status !== 'error') n.status = status
      return
    }
    thinkingNodeCreated = true
    traceNodes.set(thinkingNodeId, {
      id: thinkingNodeId,
      kind: 'thinking',
      label: '思考过程',
      status,
      parentId: null,
      children: [],
      content: '',
      startTime: Date.now()
    })
    traceRootOrder.push(thinkingNodeId)
  }

  function appendThinkingContent(delta: string) {
    const n = traceNodes.get(thinkingNodeId)
    if (n) n.content = (n.content ?? '') + delta
  }

  function finishThinkingNode() {
    const n = traceNodes.get(thinkingNodeId)
    if (!n) return
    if (n.status !== 'error') n.status = 'completed'
    n.endTime = Date.now()
    if (n.startTime) n.durationMs = n.endTime - n.startTime
  }

  function ensureTextNode(status: TraceNodeStatus) {
    if (textNodeCreated) {
      const n = traceNodes.get(textNodeId)
      if (n && n.status !== 'completed' && n.status !== 'error') n.status = status
      return
    }
    textNodeCreated = true
    traceNodes.set(textNodeId, {
      id: textNodeId,
      kind: 'text',
      label: '最终回答',
      status,
      parentId: null,
      children: [],
      content: '',
      startTime: Date.now()
    })
    traceRootOrder.push(textNodeId)
  }

  function appendTextContent(delta: string) {
    const n = traceNodes.get(textNodeId)
    if (n) n.content = (n.content ?? '') + delta
  }

  function finishTextNode() {
    const n = traceNodes.get(textNodeId)
    if (!n) return
    if (n.status !== 'error') n.status = 'completed'
    n.endTime = Date.now()
    if (n.startTime) n.durationMs = n.endTime - n.startTime
  }

  function upsertToolCallStart(id: string, name: string) {
    const existing = traceNodes.get(id)
    if (existing) {
      if (existing.status !== 'completed' && existing.status !== 'error') existing.status = 'running'
      if (!existing.toolName) existing.toolName = name
      if (!existing.label || existing.label === 'tool') existing.label = name
      return
    }
    traceNodes.set(id, {
      id,
      kind: 'tool-call',
      label: name || 'tool',
      toolName: name || 'tool',
      status: 'running',
      parentId: null,
      children: [],
      arguments: {},
      argumentsRaw: '',
      startTime: Date.now()
    })
    traceRootOrder.push(id)
  }

  function appendToolArgs(id: string, rawDelta: string, parsed?: Record<string, unknown>) {
    const n = traceNodes.get(id)
    if (!n) return
    n.argumentsRaw = (n.argumentsRaw ?? '') + rawDelta
    if (parsed) n.arguments = parsed
  }

  function finishToolCall(id: string, result: string, status: 'completed' | 'error', errorMessage?: string, finalArgs?: Record<string, unknown>) {
    const n = traceNodes.get(id)
    if (!n) return
    n.status = status
    n.endTime = Date.now()
    if (n.startTime) n.durationMs = n.endTime - n.startTime
    if (errorMessage) n.errorMessage = errorMessage
    if (finalArgs && Object.keys(n.arguments ?? {}).length === 0) n.arguments = finalArgs

    // M4 预留：自动为工具节点挂载 observation 子节点
    const obsId = makeObservationNodeId(id)
    const obs: TraceNode = {
      id: obsId,
      kind: 'observation',
      label: '观察结果',
      status,
      parentId: id,
      children: [],
      content: result,
      toolName: n.toolName,
      startTime: n.endTime,
      endTime: n.endTime,
      durationMs: 0
    }
    traceNodes.set(obsId, obs)
    n.children.push(obsId)
  }

  function scheduleFlush() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      const content = pendingContent
      const thinking = pendingThinking
      pendingContent = ''
      pendingThinking = ''
      rafId = null
      accumulatedContent += content
      accumulatedThinking += thinking
      // M1: 同步思考节点正文
      if (thinking) {
        ensureThinkingNode('running')
        appendThinkingContent(thinking)
      }
      if (content) {
        ensureTextNode('running')
        appendTextContent(content)
      }
      const { nodes, roots } = snapshotTrace()
      options.onFlush({
        contentDelta: content,
        thinkingDelta: thinking,
        toolCalls: liveToolCalls.slice(),
        traceNodes: nodes,
        traceRootOrder: roots,
        attachments: liveAttachments.slice()
      })
    })
  }

  function cancelFlush() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function flushPending(): { content: string; thinking: string } {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    const content = accumulatedContent + pendingContent
    const thinking = accumulatedThinking + pendingThinking
    accumulatedContent = content
    accumulatedThinking = thinking
    pendingContent = ''
    pendingThinking = ''
    // 同步 tree 中的 text/thinking 内容
    if (thinkingNodeCreated) {
      const n = traceNodes.get(thinkingNodeId)!
      n.content = thinking
    }
    if (textNodeCreated) {
      const n = traceNodes.get(textNodeId)!
      n.content = content
    }
    return { content, thinking }
  }

  function getToolCalls(): ToolCall[] {
    return liveToolCalls.slice()
  }

  function handleDone(meta: StreamFinalMeta) {
    if (isStale()) return
    finished = true
    clearIdleTimer()
    cancelFlush()
    const { content, thinking } = flushPending()
    // 结束所有未完成节点
    if (thinkingNodeCreated) finishThinkingNode()
    if (textNodeCreated) finishTextNode()
    for (const n of traceNodes.values()) {
      if (n.kind === 'tool-call' && n.status === 'running') {
        n.status = 'completed'
        n.endTime = Date.now()
        if (n.startTime) n.durationMs = n.endTime - n.startTime
      }
    }
    const { nodes, roots } = snapshotTrace()
    const finalMsgId = meta.messageId || assistantMsgId
    options.onDone({
      msgId: finalMsgId,
      content,
      thinking: thinking || undefined,
      toolCalls: getToolCalls(),
      traceNodes: nodes,
      traceRootOrder: roots,
      attachments: liveAttachments.slice(),
      meta
    })
  }

  function handleError(error: string) {
    if (isStale()) return
    finished = true
    clearIdleTimer()
    cancelFlush()
    const { content, thinking } = flushPending()
    // 把所有在途节点标记为 error
    if (thinkingNodeCreated) {
      const n = traceNodes.get(thinkingNodeId)!
      n.status = 'error'
      n.endTime = Date.now()
      if (n.startTime) n.durationMs = n.endTime - n.startTime
    }
    if (textNodeCreated) {
      const n = traceNodes.get(textNodeId)!
      n.status = 'error'
      n.errorMessage = error
      n.endTime = Date.now()
      if (n.startTime) n.durationMs = n.endTime - n.startTime
    }
    for (const n of traceNodes.values()) {
      if (n.status === 'running' || n.status === 'pending') {
        n.status = 'error'
        n.endTime = Date.now()
        if (n.startTime) n.durationMs = n.endTime - n.startTime
      }
    }
    const { nodes, roots } = snapshotTrace()
    options.onError(error, {
      content,
      thinking: thinking || undefined,
      toolCalls: getToolCalls(),
      traceNodes: nodes,
      traceRootOrder: roots,
      attachments: liveAttachments.slice()
    })
  }

  resetIdleTimer()

  return {
    onChunk: (delta: string) => {
      if (isStale()) return
      resetIdleTimer()
      pendingContent += delta
      // 首次到达正文时确保 text 节点存在（rAF 之前即时创建，避免首帧遗漏）
      if (!textNodeCreated && pendingContent.length > 0) {
        ensureTextNode('running')
      }
      scheduleFlush()
    },

    onThinking: (delta: string) => {
      if (isStale()) return
      resetIdleTimer()
      pendingThinking += delta
      if (!thinkingNodeCreated) ensureThinkingNode('running')
      scheduleFlush()
    },

    onThinkingStart: () => {
      if (isStale()) return
      resetIdleTimer()
      // 桌面端将整条消息的 thinking 累积到单一容器（accumulatedThinking / ::thinking 节点），
      // 后端开启新一轮思考会话时，若已有前轮叙述则插入轮次分隔，避免多段叙述粘连。
      if (accumulatedThinking || pendingThinking) {
        pendingThinking += '\n\n'
        scheduleFlush()
      }
    },

    onToolCallStart: ({ id, name }) => {
      if (isStale()) return
      resetIdleTimer()
      const idx = liveToolCalls.length
      toolIndexById.set(id, idx)
      liveToolCalls.push({
        id,
        name,
        status: 'running',
        arguments: {},
        startTime: Date.now()
      })
      upsertToolCallStart(id, name)
      scheduleFlush()
    },

    onToolCallArgs: ({ id, arguments: args }) => {
      if (isStale()) return
      resetIdleTimer()
      const idx = toolIndexById.get(id)
      // 参数增量原文字符串：从 agui parser 只传 parsed 对象，
      // 这里无法拿到原始分片；保留 parsed 对象即可（args 非空时已是完整 JSON）。
      // 如需 raw 预览，可让 agui.ts 传出 delta 原文，后续迭代再完善。
      if (idx !== undefined && liveToolCalls[idx]) {
        liveToolCalls[idx] = {
          ...liveToolCalls[idx]!,
          arguments: { ...liveToolCalls[idx]!.arguments, ...args }
        }
      }
      appendToolArgs(id, '', args)
      scheduleFlush()
    },

    onToolCallResult: ({ id, name, result, status, errorMessage, arguments: toolArgs }) => {
      if (isStale()) return
      resetIdleTimer()
      const finalStatus: ToolCall['status'] = status === 'error' ? 'error' : 'completed'
      const idx = toolIndexById.get(id)
      if (idx !== undefined && liveToolCalls[idx]) {
        const prev = liveToolCalls[idx]!
        liveToolCalls[idx] = {
          ...prev,
          name: prev.name || name,
          status: finalStatus,
          result,
          errorMessage,
          endTime: Date.now(),
          arguments:
            Object.keys(prev.arguments).length === 0 && toolArgs ? toolArgs : prev.arguments
        }
      } else {
        liveToolCalls.push({
          id,
          name,
          status: finalStatus,
          arguments: toolArgs ?? {},
          result,
          errorMessage,
          endTime: Date.now()
        })
        upsertToolCallStart(id, name)
      }
      finishToolCall(id, result ?? '', finalStatus, errorMessage, toolArgs)
      scheduleFlush()
    },

    onArtifactCreated: (artifact) => {
      if (isStale()) return
      resetIdleTimer()
      // 将 artifact 转为 Attachment
      const mediaType = artifact.format === 'md' ? 'text/markdown' : 'application/octet-stream'
      liveAttachments.push({
        id: artifact.artifactId,
        name: artifact.name,
        mediaType,
        filePath: artifact.absolutePath || artifact.path,
        size: artifact.size,
      })
      scheduleFlush()
    },

    onStateDelta: (delta) => {
      if (isStale()) return
      resetIdleTimer()
      // P1-9/P1-10: Plan-and-Execute 步骤转为 plan-step TraceNode
      if (delta.phase === 'plan' && delta.plan) {
        // 收到完整计划，为每个 step 创建 plan-step 节点
        for (const step of delta.plan) {
          const stepId = `${assistantMsgId}::plan-step-${++planStepCounter}`
          const description = (step as Record<string, unknown>).description as string || (step as Record<string, unknown>).task as string || `步骤 ${planStepCounter}`
          traceNodes.set(stepId, {
            id: stepId,
            kind: 'plan-step',
            label: description,
            status: 'pending',
            parentId: null,
            children: [],
            content: description,
            startTime: Date.now(),
          })
          traceRootOrder.push(stepId)
        }
      } else if (delta.stepUpdate) {
        // 步骤状态变更，更新对应 plan-step 节点状态
        const update = delta.stepUpdate
        const stepIdx = (update.index as number) ?? -1
        const stepStatus = (update.status as string) ?? 'running'
        if (stepIdx >= 0) {
          const stepId = `${assistantMsgId}::plan-step-${stepIdx + 1}`
          const n = traceNodes.get(stepId)
          if (n) {
            n.status = stepStatus === 'completed' ? 'completed' : stepStatus === 'error' ? 'error' : 'running'
            if (n.status === 'completed' || n.status === 'error') {
              n.endTime = Date.now()
              if (n.startTime) n.durationMs = n.endTime - n.startTime
            }
          }
        }
      }
      scheduleFlush()
    },

    onDone: handleDone,
    onError: handleError
  }
}
