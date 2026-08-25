// ============================================================
// Agent Runtime — 主进程内嵌 modu-agent（云边双模阶段 1）
//
// 职责：把 modu-agent 内核（stream_response / resume_stream /
// resume_sync / get_interrupt_state / checkInterruptTimeout）以
// Electron IPC 形态暴露给渲染进程，语义逐条对齐 backend-ts
// routes/agent.ts 的 REST 端点：
//
//   startSend    ←→  POST /agent/completions（stream=true 分支）
//   startResume  ←→  POST /agent/resume
//   abortPending ←→  POST /agent/abort
//   getHitlState ←→  GET  /agent/state/:threadId
//   stopRun      ←→  POST /agent/completions/stop
//
// 差异（阶段 1 有意为之，阶段 2 补齐）：
//   - 无 Prisma 持久化：会话/消息落库仍由云端 backend-ts 承担，
//     本 runtime 只负责「执行 + 事件投递」；多轮上下文由渲染端
//     在请求里携带 history 提供。
//   - userId 为本地常量 LOCAL_USER_ID（单用户桌面场景，无 JWT）。
//   - model / systemPrompt / agentMode 覆盖暂不透传（云端 completions
//     同样固定 model:null，行为对齐）。
//
// 事件投递：AGUIStreamAdapter 产出的 { data: "<json>" } dict 逐条
// JSON.parse 后封装为 AgentEventEnvelope { runId, seq, event } 经
// webContents.send 推送。seq 单调递增，供渲染端校验顺序（IPC 本身
// 保序，seq 仅作诊断兜底）。
// ============================================================

import { randomUUID } from 'crypto'
import {
  create_agent,
  get_runner,
  stream_response,
  resume_stream,
  resume_sync,
  get_interrupt_state,
  checkInterruptTimeout,
  AGUIStreamAdapter,
} from '@pioneering/modu-agent'
import { IpcChannel } from '../shared/ipc-channels'
import type { SendMessageRequest, ResumeRequest, HitlStateResponse } from '../shared/types'

const logger = {
  info: (msg: string, ...args: unknown[]) => console.info(`[agent-runtime] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[agent-runtime] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[agent-runtime] ${msg}`, ...args),
}

/** 本地单用户标识（云端为 JWT userId；本地无鉴权，固定常量） */
export const LOCAL_USER_ID = 'local_user'

/** 事件投递目标的最小接口（BrowserWindow.webContents 的结构子集，便于测试） */
export interface AgentEventSender {
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

/** AG-UI 事件信封：runId 路由 + 单调递增 seq（顺序诊断） */
export interface AgentEventEnvelope {
  runId: string
  seq: number
  event: Record<string, unknown>
}

interface AgentRun {
  runId: string
  sessionId: string
  controller: AbortController
  sender: AgentEventSender
}

/** 进行中的 run 注册表（runId → run），供 stop/销毁清理 */
const activeRuns = new Map<string, AgentRun>()

// ============================================================
// 环境准备：LLM key 等环境变量加载
// ============================================================

/**
 * 最小 .env 解析（KEY=VALUE，忽略注释/空行，不引 dotenv 依赖）。
 * 仅填充当前未设置的变量，不覆盖已有环境。
 */
function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // 剥离成对引号
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

let envLoaded = false

/**
 * 惰性加载 Agent 运行所需环境变量（LLM_API_KEY / MODU_*_API_KEY 等）。
 * 候选文件依次尝试，先命中先用；已存在的 process.env 项不覆盖。
 * 由 ipc-handlers 传入基于 app.getAppPath() 推导的候选路径，
 * 本模块保持无 electron 依赖（可单测）。
 */
export function ensureAgentEnv(envFileCandidates: string[], readFile: (p: string) => string): void {
  if (envLoaded) return
  envLoaded = true
  for (const file of envFileCandidates) {
    let content: string
    try {
      content = readFile(file)
    } catch {
      continue
    }
    const parsed = parseEnvFile(content)
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined && v !== '') {
        process.env[k] = v
      }
    }
    logger.info('env.loaded file=%s keys=%d', file, Object.keys(parsed).length)
  }
}

// ============================================================
// 请求校验（对齐 backend zod schema 的关键字段）
// ============================================================

export function validateSendRequest(request: unknown): SendMessageRequest | null {
  if (!request || typeof request !== 'object') return null
  const r = request as Partial<SendMessageRequest>
  if (typeof r.message !== 'string' || !r.message.trim() || r.message.length > 100_000) return null
  if (r.sessionId !== undefined && typeof r.sessionId !== 'string') return null
  if (r.history !== undefined) {
    if (!Array.isArray(r.history)) return null
    for (const h of r.history) {
      if (!h || typeof h !== 'object') return null
      if (typeof (h as { role?: unknown }).role !== 'string') return null
      if (typeof (h as { content?: unknown }).content !== 'string') return null
    }
  }
  return {
    sessionId: r.sessionId,
    message: r.message,
    history: r.history,
  }
}

export function validateResumeRequest(request: unknown): ResumeRequest | null {
  if (!request || typeof request !== 'object') return null
  const r = request as Partial<ResumeRequest>
  if (typeof r.sessionId !== 'string' || !r.sessionId) return null
  if (typeof r.approved !== 'boolean') return null
  if (r.feedback !== undefined && r.feedback !== null && typeof r.feedback !== 'string') return null
  return {
    sessionId: r.sessionId,
    approved: r.approved,
    feedback: r.feedback ?? undefined,
    modifiedArgs: r.modifiedArgs ?? undefined,
  }
}

// ============================================================
// 事件发射（带 runId 路由 + seq）
// ============================================================

function makeEmitter(run: AgentRun): (event: Record<string, unknown>) => boolean {
  let seq = 0
  return (event) => {
    if (run.sender.isDestroyed()) return false
    const envelope: AgentEventEnvelope = { runId: run.runId, seq: seq++, event }
    try {
      run.sender.send(IpcChannel.AGENT_EVENT, envelope)
      return true
    } catch (e) {
      logger.error('emit.failed runId=%s err=%s', run.runId, String(e))
      return false
    }
  }
}

/** AGUI dict（{ data: "<json>" }）→ 解析为事件对象后发射；解析失败丢弃并告警 */
function emitAguiDict(
  emit: (event: Record<string, unknown>) => boolean,
  dict: Record<string, string>,
): boolean {
  const dataStr = dict.data ?? ''
  if (!dataStr) return true
  try {
    const event = JSON.parse(dataStr)
    if (!event || typeof event !== 'object') return true
    return emit(event as Record<string, unknown>)
  } catch {
    logger.warn('agui.parse_failed len=%d sample=%s', dataStr.length, dataStr.slice(0, 120))
    return true
  }
}

// ============================================================
// 流执行：send / resume
// ============================================================

interface StartRunOptions {
  runId: string
  sessionId: string
  sender: AgentEventSender
}

async function executeSend(run: AgentRun, request: SendMessageRequest): Promise<void> {
  const emit = makeEmitter(run)
  const traceId = randomUUID()
  try {
    const graph = await create_agent()
    const adapter = new AGUIStreamAdapter(traceId)
    const inputData: Record<string, unknown> = { input_type: 'text', prompt: request.message }
    if (request.history && request.history.length > 0) {
      inputData.history = request.history
    }
    logger.info(
      'send.start runId=%s session=%s trace=%s history=%d',
      run.runId, run.sessionId, traceId, request.history?.length ?? 0,
    )
    for await (const dict of adapter.transform_langgraph_events(
      stream_response(graph, LOCAL_USER_ID, run.sessionId, inputData, traceId),
    )) {
      if (run.controller.signal.aborted) break
      if (!emitAguiDict(emit, dict)) {
        run.controller.abort()
        break
      }
    }
  } catch (e) {
    logger.error('send.error runId=%s err=%s', run.runId, String(e))
    emit({ type: 'RUN_ERROR', code: 'AGENT_ERROR', message: String(e) })
  } finally {
    activeRuns.delete(run.runId)
    logger.info('send.end runId=%s', run.runId)
  }
}

async function executeResume(run: AgentRun, request: ResumeRequest): Promise<void> {
  const emit = makeEmitter(run)
  const traceId = randomUUID()
  try {
    const graph = await create_agent()
    const adapter = new AGUIStreamAdapter(traceId)
    logger.info(
      'resume.start runId=%s session=%s approved=%s modified_args=%d',
      run.runId, run.sessionId, request.approved, Object.keys(request.modifiedArgs ?? {}).length,
    )
    for await (const dict of adapter.transform_langgraph_events(
      resume_stream(graph, run.sessionId, request.approved, request.feedback ?? '', traceId, {
        modifiedArgs: request.modifiedArgs ?? undefined,
      }),
    )) {
      if (run.controller.signal.aborted) break
      if (!emitAguiDict(emit, dict)) {
        run.controller.abort()
        break
      }
    }
  } catch (e) {
    logger.error('resume.error runId=%s err=%s', run.runId, String(e))
    emit({ type: 'RUN_ERROR', code: 'AGENT_ERROR', message: String(e) })
  } finally {
    activeRuns.delete(run.runId)
    logger.info('resume.end runId=%s', run.runId)
  }
}

function registerRun(opts: StartRunOptions): AgentRun {
  const run: AgentRun = {
    runId: opts.runId,
    sessionId: opts.sessionId,
    controller: new AbortController(),
    sender: opts.sender,
  }
  activeRuns.set(opts.runId, run)
  return run
}

/**
 * 启动一次 Agent 流式执行（语义对齐 POST /agent/completions stream 分支）。
 * 不等待流结束——invoke 立即返回，事件经 agent:event 通道推送。
 */
export function startSend(
  sender: AgentEventSender,
  runId: string,
  request: SendMessageRequest,
): { ok: boolean; error?: string } {
  if (!request.sessionId) {
    return { ok: false, error: 'sessionId is required' }
  }
  if (activeRuns.has(runId)) {
    return { ok: false, error: 'runId already exists' }
  }
  const run = registerRun({ runId, sessionId: request.sessionId, sender })
  void executeSend(run, request)
  return { ok: true }
}

/**
 * 恢复被 interrupt 暂停的 run（语义对齐 POST /agent/resume）。
 * 返回与 startSend 一致的 AG-UI 事件流（新 runId）。
 */
export function startResume(
  sender: AgentEventSender,
  runId: string,
  request: ResumeRequest,
): { ok: boolean; error?: string } {
  if (activeRuns.has(runId)) {
    return { ok: false, error: 'runId already exists' }
  }
  const run = registerRun({ runId, sessionId: request.sessionId, sender })
  void executeResume(run, request)
  return { ok: true }
}

// ============================================================
// stop / abort / state（语义对齐 backend REST 端点）
// ============================================================

/** 中止该会话所有进行中的流（对齐 POST /agent/completions/stop） */
export function stopRun(sessionId: string): { message: string; aborted: boolean } {
  let aborted = false
  for (const run of activeRuns.values()) {
    if (run.sessionId === sessionId) {
      run.controller.abort()
      aborted = true
    }
  }
  return { message: 'stopped', aborted }
}

/** 中止/拒绝 HITL 待答复项（对齐 POST /agent/abort：resume_sync(approved=false)） */
export async function abortPending(
  sessionId: string,
  reason: string,
): Promise<{ message: string; aborted: boolean; error?: string }> {
  const graph = await get_runner()
  const state = await get_interrupt_state(graph, sessionId)
  const pending = state !== null && (!state['user_id'] || state['user_id'] === LOCAL_USER_ID)
  if (!pending) {
    return { message: 'no_pending_interrupt', aborted: false }
  }
  const result = await resume_sync(
    graph,
    sessionId,
    false,
    `user ${reason}`,
    `hitl-abort-${sessionId}-${Date.now()}`,
  )
  if (result && result['status'] === 'error') {
    logger.error('abort.failed session=%s code=%s', sessionId, String(result['error_code'] ?? ''))
    return { message: 'abort_failed', aborted: false, error: String(result['error_code'] ?? '') }
  }
  logger.info('abort.done session=%s reason=%s', sessionId, reason)
  return { message: 'aborted', aborted: true }
}

/** 查询待答复 HITL 状态（对齐 GET /agent/state/:threadId，含超时治理） */
export async function getHitlState(threadId: string): Promise<HitlStateResponse> {
  const graph = await get_runner()
  // 超时治理：查询前先检查（超时则自动拒绝并返回已过期）
  try {
    const timeoutStatus = await checkInterruptTimeout(graph, threadId)
    if (timeoutStatus === 'expired') {
      return { session_id: threadId, pending: false, expired: true }
    }
  } catch (e) {
    logger.info('state.timeout_check_skipped thread=%s err=%s', threadId, String(e))
  }
  const state = await get_interrupt_state(graph, threadId)
  if (state === null) {
    return { session_id: threadId, pending: false }
  }
  if (state['user_id'] && state['user_id'] !== LOCAL_USER_ID) {
    return { session_id: threadId, pending: false }
  }
  return {
    session_id: (state['session_id'] as string) ?? threadId,
    pending: true,
    next_nodes: (state['next_nodes'] as string[]) ?? [],
    pending_tool_calls: (state['pending_tool_calls'] as Array<Record<string, unknown>>) ?? [],
    tool_requires_approval: (state['tool_requires_approval'] as boolean) ?? false,
    trace_id: (state['trace_id'] as string) ?? '',
    user_id: (state['user_id'] as string) ?? '',
    created_at: (state['created_at'] as string | number | null) ?? null,
  }
}

/** 渲染端销毁时清理：中止该 sender 的全部在途 run（本地执行不留僵尸流） */
export function abortRunsForSender(sender: AgentEventSender): void {
  for (const run of activeRuns.values()) {
    if (run.sender === sender) {
      run.controller.abort()
    }
  }
}
