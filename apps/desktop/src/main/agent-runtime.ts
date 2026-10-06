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
//   - model / systemPrompt 覆盖不透传（云端 completions 同样固定
//     model:null，行为对齐）；agentMode 已对齐云端契约透传：
//     plan_execute 需建图期覆盖（create_agent + 运行时 extraConfigurable），
//     其余模式复用 get_runner() 缓存图。
//   - 图构建复用内核 get_runner() 的编译图缓存（config hash 失效），
//     不再每次 run 全量重建；受管密钥变更经 invalidateAgentGraphCache()
//     主动失效（密钥注入 process.env，不进入 config hash）。
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
  reset_runner_cache,
  stream_response,
  resume_stream,
  resume_sync,
  get_interrupt_state,
  checkInterruptTimeout,
  AGUIStreamAdapter,
  getRegistry,
  getConfig,
  CodeExecutorTool,
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

/**
 * 会话 → 该会话 send 时所用图实例的映射。
 *
 * 为什么需要：plan_execute 会话 send 时走 create_agent 新建带
 * planner/step_dispatch/step_finalize 节点的图（不进 get_runner 缓存）；
 * 而 resume/abort/getState 原固定取 get_runner() 的默认 ReAct 图——
 * 在缺少 plan 节点的图上重放 plan 会话 checkpoint，批准续跑路由到
 * step_finalize 时会命中不存在的编译期目标而报错。故按会话记录图句柄，
 * 与「send 用哪张图，resume 就用哪张图」对齐。
 *
 * checkpointer 是内核模块级单例（跨图共享 checkpoint 数据），映射只解决
 * 图拓扑匹配；容量按 LRU 收口防止长生命周期进程中句柄无界增长。
 */
type SessionGraph = Awaited<ReturnType<typeof create_agent>>
const sessionGraphs = new Map<string, SessionGraph>()
const SESSION_GRAPH_LIMIT = 16

function rememberSessionGraph(sessionId: string, graph: SessionGraph): void {
  // 重新插入到末尾，保持 LRU 顺序（最近使用排最后）
  sessionGraphs.delete(sessionId)
  sessionGraphs.set(sessionId, graph)
  if (sessionGraphs.size > SESSION_GRAPH_LIMIT) {
    const oldest = sessionGraphs.keys().next().value
    if (oldest !== undefined) sessionGraphs.delete(oldest)
  }
}

/**
 * 解析会话续跑（resume/abort/getState）应使用的图：
 *   - plan_execute 会话：复用 send 时记录的图，并告知调用方透传运行时
 *     configurable（clarify→memory_query 路由仍需 plan_execute_enabled）；
 *   - 其余/映射缺失（如重启后仅靠 checkpoint 恢复）：回退默认缓存图。
 */
async function resolveSessionGraph(sessionId: string): Promise<{
  graph: SessionGraph
  planExecute: boolean
}> {
  const remembered = sessionGraphs.get(sessionId)
  if (remembered) {
    rememberSessionGraph(sessionId, remembered)
    return { graph: remembered, planExecute: true }
  }
  return { graph: await get_runner(), planExecute: false }
}

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

/**
 * 重置 .env 一次性加载标记，使下次 ensureAgentEnv 重新解析候选文件。
 *
 * ⑪修复：KeyStore.delete() 会同步 delete process.env[name]，而 envLoaded
 * 为一次性布尔——若该键同时存在于 desktop/.env，删除受管密钥后当前进程
 * 运行期间 .env 值不会重新注入（表现为「删密钥后请求 401，重启又好了」）。
 * SECURE_KEY_DELETE 成功后调用本函数，下次 run 的
 * applyToEnv（空）→ ensureAgentEnv（重新填未设值）即恢复 .env 兜底。
 */
export function resetAgentEnvState(): void {
  envLoaded = false
}

// ============================================================
// 请求校验（对齐 backend zod schema 的关键字段）
// ============================================================

/** 透传的外层图模式白名单（对齐云端 AgentChatRequestSchema，非法值归一化丢弃） */
const ALLOWED_AGENT_MODES: ReadonlySet<string> = new Set(['react_agent', 'plan_execute'])

/**
 * ⑰修复：IPC history 纵深尺寸界（渲染端 buildIpcHistory 仅取最近 20 条，
 * 主进程这里是被攻陷渲染端/异常场景的第二道闸）：
 *   - 条数上限：渲染端正常路径为 20，内核侧留 5 倍余量；
 *   - 单项 content 上限：与顶层 message 的 100k 对齐。
 * 超限整单拒绝（validate 返回 null → IPC Invalid request），杜绝无界
 * history 进入内核造成 token/内存放大。
 */
const MAX_HISTORY_ITEMS = 100
const MAX_HISTORY_CONTENT_CHARS = 100_000

export function validateSendRequest(request: unknown): SendMessageRequest | null {
  if (!request || typeof request !== 'object') return null
  const r = request as Partial<SendMessageRequest>
  if (typeof r.message !== 'string' || !r.message.trim() || r.message.length > 100_000) return null
  if (r.sessionId !== undefined && typeof r.sessionId !== 'string') return null
  if (r.history !== undefined) {
    if (!Array.isArray(r.history)) return null
    // ⑰修复：条数与单项内容尺寸界（渲染端正常路径 20 条/正文消息，正常请求不受影响）
    if (r.history.length > MAX_HISTORY_ITEMS) return null
    for (const h of r.history) {
      if (!h || typeof h !== 'object') return null
      if (typeof (h as { role?: unknown }).role !== 'string') return null
      const content = (h as { content?: unknown }).content
      if (typeof content !== 'string') return null
      if (content.length > MAX_HISTORY_CONTENT_CHARS) return null
    }
  }
  return {
    sessionId: r.sessionId,
    message: r.message,
    history: r.history,
    // agentMode 对齐云端契约透传（plan_execute 启用 Plan-Execute 图）；
    // 白名单外取值归一化为 undefined，避免任意字符串流入内核 configurable。
    agentMode:
      typeof r.agentMode === 'string' && ALLOWED_AGENT_MODES.has(r.agentMode)
        ? (r.agentMode as SendMessageRequest['agentMode'])
        : undefined,
  }
}

export function validateResumeRequest(request: unknown): ResumeRequest | null {
  if (!request || typeof request !== 'object') return null
  const r = request as Partial<ResumeRequest>
  if (typeof r.sessionId !== 'string' || !r.sessionId) return null
  if (typeof r.approved !== 'boolean') return null
  if (r.feedback !== undefined && r.feedback !== null && typeof r.feedback !== 'string') return null
  // P0 修复：answer / answerId 是澄清（kind='clarifying'）与多选（kind='choice'）
  // 弹窗的答复载荷，原实现未保留，导致本地模式下答案永远为 undefined、
  // clarify 节点读不到用户回答（云端 agent-bridge 透传这两项）。
  if (r.answer !== undefined && r.answer !== null && typeof r.answer !== 'string') return null
  if (r.answerId !== undefined && r.answerId !== null && typeof r.answerId !== 'string') return null
  return {
    sessionId: r.sessionId,
    approved: r.approved,
    feedback: r.feedback ?? undefined,
    modifiedArgs: r.modifiedArgs ?? undefined,
    answer: r.answer ?? undefined,
    answerId: r.answerId ?? undefined,
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

/**
 * 宿主侧敏感工具注册（幂等）。
 * factory 只默认注册无风险工具（datetime/search_engine/calculator/doc_writer），
 * code_executor 等需审批工具由宿主按需注册（见 factory.ts 注释）。
 * 仅当 HITL 启用时注册——否则敏感工具会绕过审批直接执行，违背安全默认。
 */
function ensureSensitiveToolsRegistered(): void {
  const cfg = getConfig()
  if (!cfg.get('tools.human_in_loop.enabled', false)) return
  const registry = getRegistry()
  if (registry.getTool('code_executor') === undefined) {
    try {
      registry.registerTool(new CodeExecutorTool())
      logger.info('sensitive tool registered: code_executor')
    } catch (e) {
      logger.warn('code_executor register failed: %s', String(e))
    }
  }
}

interface StartRunOptions {
  runId: string
  sessionId: string
  sender: AgentEventSender
}

async function executeSend(run: AgentRun, request: SendMessageRequest): Promise<void> {
  const emit = makeEmitter(run)
  const traceId = randomUUID()
  try {
    ensureSensitiveToolsRegistered()
    // agentMode 对齐云端 agent-bridge，且 plan_execute 必须「建图期」就带上覆盖：
    //   factory 按 configurable.plan_execute_enabled 决定 planner/step_dispatch/
    //   step_finalize 节点是否挂载，而 stream_response 的 extraConfigurable 只影响
    //   运行时路由（routeAfterMemoryQuery）。若只在运行时传，路由会指向不存在的
    //   planner 节点而报错——故 plan_execute 走 create_agent({ configurable })。
    //   其余模式（含默认 react_agent）复用内核编译图缓存 get_runner()，
    //   避免每次 run 全量重建（LLM/工具/checkpointer/store）。
    const enablePlanExecute = request.agentMode === 'plan_execute'
    const graph = enablePlanExecute
      ? await create_agent({ configurable: { plan_execute_enabled: true } })
      : await get_runner()
    // 记录会话所用图：plan 图不进 get_runner 缓存，resume/abort/getState
    // 必须复用同一图实例（拓扑含 planner/step_dispatch/step_finalize）。
    if (enablePlanExecute) rememberSessionGraph(run.sessionId, graph)
    const adapter = new AGUIStreamAdapter(traceId)
    const inputData: Record<string, unknown> = { input_type: 'text', prompt: request.message }
    if (request.history && request.history.length > 0) {
      inputData.history = request.history
    }
    // 运行时路由覆盖：仅影响本次 run，不触发图重建
    const extraConfigurable = enablePlanExecute ? { plan_execute_enabled: true } : null
    logger.info(
      'send.start runId=%s session=%s trace=%s history=%d agent_mode=%s',
      run.runId, run.sessionId, traceId, request.history?.length ?? 0,
      request.agentMode ?? 'react_agent',
    )
    for await (const dict of adapter.transform_langgraph_events(
      stream_response(graph, LOCAL_USER_ID, run.sessionId, inputData, traceId, null, extraConfigurable),
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
    ensureSensitiveToolsRegistered()
    // resume 依赖 checkpointer 的 thread checkpoint（内核模块级单例，跨图共享数据），
    // 但图拓扑必须与 send 一致：plan_execute 会话复用 send 时记录的 plan 图，
    // 否则批准后续跑路由到 step_finalize 等 plan 专属节点会命中未注册目标。
    const { graph, planExecute } = await resolveSessionGraph(run.sessionId)
    const adapter = new AGUIStreamAdapter(traceId)
    logger.info(
      'resume.start runId=%s session=%s approved=%s modified_args=%d answer=%s plan_execute=%s',
      run.runId, run.sessionId, request.approved,
      Object.keys(request.modifiedArgs ?? {}).length,
      request.answer ? 'yes' : 'no',
      planExecute ? 'yes' : 'no',
    )
    for await (const dict of adapter.transform_langgraph_events(
      resume_stream(graph, run.sessionId, request.approved, request.feedback ?? '', traceId, {
        modifiedArgs: request.modifiedArgs ?? undefined,
        // 澄清回答透传给 clarify 节点（kind='clarifying' | 'choice'）
        answer: request.answer ?? undefined,
        answerId: request.answerId ?? undefined,
        // plan 会话续跑需运行时路由开关：clarify 恢复后经 memory_query
        // 路由时仍读 configurable.plan_execute_enabled，不传会丢 planner。
        extraConfigurable: planExecute ? { plan_execute_enabled: true } : null,
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
  // 与 executeResume 同规则取图：plan 会话的拒绝续跑也必须在 plan 图上重放
  const { graph, planExecute } = await resolveSessionGraph(sessionId)
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
    planExecute ? { extraConfigurable: { plan_execute_enabled: true } } : undefined,
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
  // 与 send/resume 同规则取图（checkpointer 共享，图结构按会话模式匹配）
  const { graph } = await resolveSessionGraph(threadId)
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
    // kind：前端据此选择弹窗类型（工具审批 / 澄清追问 / 多选），避免靠布尔值猜测
    kind: (state['kind'] as HitlStateResponse['kind']) ?? 'tool_confirm',
    message: (state['message'] as string) ?? '',
    question: (state['question'] as string) ?? undefined,
    options: (state['options'] as HitlStateResponse['options']) ?? undefined,
    // T2 修复（修复任务清单 T2 / 报告 §4-A-2）：plan_confirm 的产物列表必须透传，
    // 与云端 agent-bridge GET /agent/state（HitlStateResponse 已含 artifacts）对齐；
    // 渲染端 hitlStore.recover 已支持该字段（恢复时构造方案确认卡的产物文件列表）。
    artifacts: (state['artifacts'] as HitlStateResponse['artifacts']) ?? undefined,
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

// ============================================================
// 图缓存治理
// ============================================================

/**
 * 使内核编译图缓存失效（下次 run 经 get_runner() 重建图）。
 *
 * 场景：受管密钥（LLM_API_KEY 等）经 safeStorage 更新后写入 process.env，
 * 但 env 不参与内核 config hash —— 不清缓存会继续复用按旧密钥构建的
 * LLM 实例，表现为「改 key 不生效直到重启」。由 ipc-handlers 在
 * SECURE_KEY_SET / SECURE_KEY_DELETE 成功后调用（best-effort，
 * 在途 run 持有各自图引用，不受影响）。
 */
export function invalidateAgentGraphCache(): void {
  try {
    reset_runner_cache()
    // 会话级 plan 图同样按旧密钥构建，必须一并丢弃；下次 send 重建、
    // resume 在映射缺失时回退 get_runner() 新图。
    sessionGraphs.clear()
    logger.info('graph_cache.invalidated')
  } catch (e) {
    logger.warn('graph_cache.invalidate_failed err=%s', String(e))
  }
}
