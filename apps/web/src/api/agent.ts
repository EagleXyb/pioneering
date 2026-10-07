/**
 * Agent 通道 API（pro / task 共用）
 *
 * - 流式端点（completions / resume）直接返回 fetch Response（SSE 不经响应包装器）
 * - JSON 端点（state / abort / stop）复用 api/client 的 get/post（自动解包、401 刷新）
 */
import { get, post, getAuthHeader } from './client'
import type {
  HitlAbortReason,
  HitlStateResponse,
} from '@pioneering/agent-protocol';

const SSE_BASE = '/api/agent';

function sseHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...getAuthHeader() };
}

// ========== POST /agent/sessions ==========

export interface AgentSessionBody {
  title?: string;
  agentMode?: 'react_agent' | 'plan_execute';
}

/** 创建 Agent 会话（pro/task），返回会话信息（含 agentMode） */
export function createAgentSession(body: AgentSessionBody): Promise<AgentSessionInfo> {
  return post<AgentSessionInfo>('/agent/sessions', body);
}

/** 后端 /agent/sessions 响应（sessionToResponse） */
export interface AgentSessionInfo {
  id: string;
  title: string | null;
  agentMode: 'react_agent' | 'plan_execute' | null;
  model: string | null;
  modelConfig?: Record<string, unknown> | null;
  systemPrompt?: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

// ========== POST /agent/completions ==========

export interface AgentCompletionBody {
  sessionId: string;
  message: string;
  stream?: boolean;
  agentMode?: 'react_agent' | 'plan_execute';
}

/** 发起 Agent 生成（SSE）。响应已通过 ok 校验，调用方交给 parseAguiStream */
export async function streamCompletion(
  body: AgentCompletionBody,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(`${SSE_BASE}/completions`, {
    method: 'POST',
    headers: sseHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || `请求失败: ${response.status}`);
  }
  return response;
}

// ========== POST /agent/resume ==========

export interface AgentResumeBody {
  sessionId: string;
  approved: boolean;
  feedback?: string | null;
  modifiedArgs?: Record<string, Record<string, unknown>> | null;
  answer?: string | null;
  answerId?: string | null;
}

/** 恢复 HITL 暂停的 run（SSE），续写同一条 assistant 消息 */
export async function streamResume(
  body: AgentResumeBody,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(`${SSE_BASE}/resume`, {
    method: 'POST',
    headers: sseHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || `请求失败: ${response.status}`);
  }
  return response;
}

// ========== GET /agent/state/:threadId ==========

/** 查询会话待答复状态（client 自动解包 {code,data}） */
export function fetchHitlState(threadId: string): Promise<HitlStateResponse> {
  return get<HitlStateResponse>(`/agent/state/${encodeURIComponent(threadId)}`);
}

// ========== POST /agent/abort ==========

/** 中止/拒绝 HITL 待答复项 */
export function abortAgentHitl(
  sessionId: string,
  reason: HitlAbortReason = 'user_cancel',
): Promise<unknown> {
  return post('/agent/abort', { sessionId, reason });
}

// ========== POST /agent/completions/stop ==========

/** 停止正在生成的 Agent run */
export function stopAgentCompletion(sessionId: string): Promise<unknown> {
  return post('/agent/completions/stop', { sessionId });
}

// ========== T5.5：Agent Run 执行记录 ==========

/** run 事件时间轴单项（collectRunTimeline 写入） */
export interface AgentRunEvent {
  seq: number;
  type: string;
  ts: number;
  role?: string;
  toolCallId?: string;
  toolCallName?: string;
  phase?: string;
  status?: string;
  code?: string;
  reason?: string;
  message?: string;
  toolCallArgs?: string;
  args?: string;
  content?: string;
  planCount?: number;
}

/** agent_run 记录（后端 runToResponse） */
export interface AgentRunData {
  id: string;
  sessionId: string;
  messageId?: string | null;
  agentMode: 'react_agent' | 'plan_execute' | string;
  status: 'running' | 'completed' | 'error' | 'cancelled' | 'paused';
  traceId: string;
  events: AgentRunEvent[];
  usage: { promptTokens: number; completionTokens: number } | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

/** GET /agent/runs —— 列出 run（可按会话过滤） */
export async function listAgentRuns(sessionId?: string): Promise<AgentRunData[]> {
  const q = sessionId
    ? `?sessionId=${encodeURIComponent(sessionId)}`
    : '';
  const r = await get<{ runs: AgentRunData[] }>(`/agent/runs${q}`);
  return r.runs;
}

/** GET /agent/runs/:runId —— 单条 run（含事件时间轴） */
export function getAgentRun(runId: string): Promise<AgentRunData> {
  return get<AgentRunData>(`/agent/runs/${encodeURIComponent(runId)}`);
}
