import { useState, useRef, useCallback, useEffect } from 'react';
import type { ChatMessagesData, ChatStatus } from '../../../types/chat';
import { parseAguiStream, type AguiStreamHandlers } from '../../../lib/parseAguiStream';
import { usePlanExecuteStore } from '../../../store/planExecuteStore';
import { getMessages } from '../../../api/message';
import { fetchSessionMessages } from '../../../lib/load-session-messages';
import { getMessagePlan, patchCollapsedSteps } from '../../../api/plan';
import { streamCompletion, streamResume, stopAgentCompletion } from '../../../api/agent';
import {
  useHitlStore,
  type HitlItemInput,
  type HitlResolveInput,
  type RestoreHitlPauseInput,
  type ResumeHitlResult,
  type UserQuestionRequestPayload,
} from '@pioneering/agent-protocol';
import { bindAgentModeRuntime } from '../../../lib/agent-host';

/**
 * 任务模式 Plan-and-Execute 对话 Hook
 *
 * 与 pro/useAgentChat 的关键差异：
 *   1. 多轮累积（pro 模式每次发送重置 messages，任务模式保留历史）
 *   2. 请求体 agentMode: 'plan_execute' 启用后端 Plan-Execute 图
 *   3. STATE_DELTA 事件 → planExecuteStore.applyPlanDelta
 *   4. HITL 暂停时通过 planExecuteStore.setHitlLock 互斥（步骤不可交互、phase 不推进）
 *   5. loadHistory() 在会话切换时从后端恢复历史消息与 plan 时间轴快照
 */

interface SendMessageParams {
  prompt: string;
}

/** AG-UI 中断载荷（snake_case）→ hitlStore 项（camelCase） */
function payloadToHitlInput(p: UserQuestionRequestPayload): HitlItemInput {
  return {
    sessionId: p.session_id,
    runId: p.run_id,
    kind: p.kind,
    message: p.message,
    toolCalls: p.tool_calls,
    question: p.question,
    options: p.options,
    artifacts: p.artifacts,
    origin: 'live',
  };
}

type FlowStatus = 'idle' | 'running' | 'paused' | 'aborted' | 'error';

export function usePlanExecuteChat(activeId: string | null) {
  const [messages, setMessages] = useState<ChatMessagesData[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const abortRef = useRef<AbortController | null>(null);
  const resumeAbortRef = useRef<AbortController | null>(null);

  const applyPlanDelta = usePlanExecuteStore((s) => s.applyPlanDelta);
  const setPhase = usePlanExecuteStore((s) => s.setPhase);
  const resetPlan = usePlanExecuteStore((s) => s.reset);
  const hydrateFromHistory = usePlanExecuteStore((s) => s.hydrateFromHistory);
  const setHitlLock = usePlanExecuteStore((s) => s.setHitlLock);

  // 当前流引用
  const assistantMsgIdRef = useRef<string | null>(null);
  const assistantTextRef = useRef('');
  const flowStatusRef = useRef<FlowStatus>('idle');
  const isResumeRunRef = useRef(false);

  /** 按消息 id 更新 assistant 文本 */
  const updateAssistantContent = useCallback((msgId: string, text: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? ({
              ...m,
              content: [{ type: 'text' as const, data: text }],
            } as ChatMessagesData)
          : m,
      ),
    );
  }, []);

  /**
   * 流结束后异步回传用户折叠状态快照至后端，确保历史恢复时视觉细节一致。
   */
  const persistCollapsedSnapshot = useCallback(async (sessionId: string) => {
    const state = usePlanExecuteStore.getState();
    if (state.rootIds.length === 0) return;
    try {
      const resp = await getMessages(sessionId, undefined, 1, 'before');
      const lastAssistant = resp.messages.find((m) => m.role === 'assistant');
      if (!lastAssistant) return;
      const meta = lastAssistant.metadata as Record<string, unknown> | undefined;
      if (!meta?.plan_phase) return;
      await patchCollapsedSteps(lastAssistant.id, state.collapsedSteps);
    } catch (e) {
      console.warn('[task.plan_execute] persistCollapsedSnapshot.fail', e);
    }
  }, []);

  // ========== AG-UI 事件处理（send / resume 共用） ==========

  const streamHandlers: AguiStreamHandlers = {
    onStateDelta: (event) => {
      const phase = (event.phase as string) ?? '';
      // 协议负载结构由后端保证，此处整体透传（store 内含 HITL 锁定守卫）
      applyPlanDelta({
        phase,
        plan: event.plan,
        step_update: event.step_update,
      } as Parameters<typeof applyPlanDelta>[0]);
    },
    onTextDelta: (delta) => {
      assistantTextRef.current += delta;
      const msgId = assistantMsgIdRef.current;
      if (msgId) updateAssistantContent(msgId, assistantTextRef.current);
    },
    onRunFinished: () => {
      setStatus('complete');
      setPhase('done');
      setHitlLock(false);
      if (isResumeRunRef.current) useHitlStore.getState().dequeue();
      if (activeId) void persistCollapsedSnapshot(activeId);
    },
    onRunError: (event) => {
      const errMsg = (event.message as string) || '执行失败';
      flowStatusRef.current = 'error';
      setStatus('error');
      setPhase('error', errMsg);
      setHitlLock(false);
      if (isResumeRunRef.current) useHitlStore.getState().dequeue();
      const msgId = assistantMsgIdRef.current;
      if (msgId && !assistantTextRef.current) {
        assistantTextRef.current = `错误: ${errMsg}`;
        updateAssistantContent(msgId, assistantTextRef.current);
      }
    },
    // ===== HITL =====
    onHumanInputRequest: (event) => {
      useHitlStore
        .getState()
        .enqueue(payloadToHitlInput(event as unknown as UserQuestionRequestPayload));
    },
    onRunPaused: () => {
      // 不 finalize：保留 assistantMsgId 供 resume 续写同一条消息
      flowStatusRef.current = 'paused';
      setStatus('complete');
      setHitlLock(true);
    },
    onHitlAborted: () => {
      flowStatusRef.current = 'aborted';
      setHitlLock(false);
      const msgId = assistantMsgIdRef.current;
      const base = assistantTextRef.current;
      const text = base
        ? `${base}\n\n[已中止] 该操作未执行。`
        : '[已中止] 该操作未执行。';
      assistantTextRef.current = text;
      if (msgId) updateAssistantContent(msgId, text);
      useHitlStore.getState().dequeue();
    },
  };

  // ========== 流消费（send / resume 共用） ==========

  const consumeStream = useCallback(
    async (response: Response, controller: AbortController) => {
      const msgId = assistantMsgIdRef.current;
      try {
        const result = await parseAguiStream(
          response,
          streamHandlers,
          controller.signal,
        );

        if (result.reason === 'paused') return; // 等待用户答复
        if (result.reason === 'error-event') return; // onRunError 已落地
        if (result.reason === 'aborted') {
          setStatus('complete');
          return;
        }
        if (flowStatusRef.current === 'aborted') return; // onHitlAborted 已收尾

        // closed 兜底
        setStatus((prev) => (prev === 'streaming' ? 'complete' : prev));
        const currentPhase = usePlanExecuteStore.getState().phase;
        if (currentPhase === 'planning' || currentPhase === 'executing') {
          setPhase('done');
        }
        setHitlLock(false);
        if (isResumeRunRef.current) useHitlStore.getState().dequeue();
        flowStatusRef.current = 'idle';
      } catch (e) {
        const err = e as { name?: string };
        setHitlLock(false);
        if (err?.name === 'AbortError') {
          setStatus('complete');
          flowStatusRef.current = 'idle';
        } else {
          flowStatusRef.current = 'error';
          setStatus('error');
          setPhase('error', String(e));
          if (msgId && !assistantTextRef.current) {
            updateAssistantContent(msgId, `请求失败: ${String(e)}`);
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      applyPlanDelta,
      setPhase,
      setHitlLock,
      updateAssistantContent,
      persistCollapsedSnapshot,
    ],
  );

  // ========== 发送 ==========

  const sendMessage = useCallback(
    async (params: SendMessageParams) => {
      if (!activeId || status === 'streaming' || status === 'pending') return;
      // HITL 暂停守卫：paused 时不能发起新请求
      if (flowStatusRef.current === 'paused') return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // 构造用户消息与 assistant 占位消息（多轮累积，不重置）
      const ts = Date.now();
      const userMsg: ChatMessagesData = {
        id: `u_${ts}`,
        role: 'user',
        content: [{ type: 'text', data: params.prompt }],
      };
      const assistantMsg: ChatMessagesData = {
        id: `a_${ts}`,
        role: 'assistant',
        content: [{ type: 'text', data: '' }],
      };

      assistantMsgIdRef.current = assistantMsg.id;
      assistantTextRef.current = '';
      flowStatusRef.current = 'running';
      isResumeRunRef.current = false;
      setHitlLock(false);

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStatus('streaming');
      setPhase('planning');

      try {
        const response = await streamCompletion(
          {
            sessionId: activeId,
            message: params.prompt,
            stream: true,
            agentMode: 'plan_execute',
          },
          controller.signal,
        );
        await consumeStream(response, controller);
      } catch (e) {
        flowStatusRef.current = 'error';
        setStatus('error');
        setPhase('error', String(e));
        updateAssistantContent(assistantMsg.id, `请求失败: ${String(e)}`);
      }
    },
    [activeId, status, setPhase, setHitlLock, consumeStream, updateAssistantContent],
  );

  // ========== HITL 宿主动作 ==========

  const resumeHitl = useCallback(
    async (sessionId: string, input: HitlResolveInput): Promise<ResumeHitlResult> => {
      if (flowStatusRef.current !== 'paused') {
        return {
          ok: false as const,
          reason: '该会话当前没有等待答复的操作，请刷新会话状态后重试。',
        };
      }
      if (sessionId !== activeId || !assistantMsgIdRef.current) {
        return { ok: false as const, reason: '会话状态不匹配，请刷新后重试。' };
      }

      const controller = new AbortController();
      resumeAbortRef.current = controller;
      flowStatusRef.current = 'running';
      isResumeRunRef.current = true;
      setHitlLock(false);
      setStatus('streaming');

      try {
        const response = await streamResume(
          {
            sessionId,
            approved: input.approved,
            feedback: input.feedback ?? null,
            modifiedArgs: input.modifiedArgs ?? null,
            answer: input.answer ?? null,
            answerId: input.answerId ?? null,
          },
          controller.signal,
        );
        void consumeStream(response, controller);
        return { ok: true as const };
      } catch (err) {
        flowStatusRef.current = 'paused';
        setStatus('complete');
        setHitlLock(true);
        return { ok: false as const, reason: (err as Error)?.message || '恢复失败，请重试。' };
      }
    },
    [activeId, consumeStream, setHitlLock],
  );

  const restoreHitlPause = useCallback(
    (input: RestoreHitlPauseInput) => {
      const msgId = `assistant-hitl-${input.sessionId}-${Date.now()}`;
      const placeholder: ChatMessagesData = {
        id: msgId,
        role: 'assistant',
        content: [{ type: 'text' as const, data: '' }],
      };
      assistantMsgIdRef.current = msgId;
      assistantTextRef.current = '';
      flowStatusRef.current = 'paused';
      isResumeRunRef.current = false;
      setMessages((prev) => [...prev, placeholder]);
      setStatus('complete');
      setHitlLock(true);
    },
    [setHitlLock],
  );

  const finalizeHitlStale = useCallback(
    (sessionId: string, reason: string) => {
      const msgId = assistantMsgIdRef.current;
      if (msgId && sessionId === activeId) {
        const text = `[已失效] ${reason}`;
        assistantTextRef.current = text;
        updateAssistantContent(msgId, text);
      }
      assistantMsgIdRef.current = null;
      flowStatusRef.current = 'idle';
      setHitlLock(false);
      setStatus('complete');
    },
    [activeId, setHitlLock, updateAssistantContent],
  );

  // 注册模式运行时（卸载时注销）
  useEffect(() => {
    bindAgentModeRuntime({
      getPausedSessionId: () =>
        flowStatusRef.current === 'paused' && activeId ? activeId : null,
      resumeHitl: (sid, input) => resumeHitl(sid, input),
      restoreHitlPause: (input) => restoreHitlPause(input),
      finalizeHitlStale: (sid, reason) => finalizeHitlStale(sid, reason),
    })
    return () => bindAgentModeRuntime(null)
  }, [activeId, resumeHitl, restoreHitlPause, finalizeHitlStale])

  const abort = useCallback(() => {
    if (flowStatusRef.current === 'paused') {
      useHitlStore.getState().dismiss('user_cancel')
      return
    }
    abortRef.current?.abort();
    resumeAbortRef.current?.abort();
    setStatus('complete');
    // T2.3：通知后端中止上游
    if (activeId) void stopAgentCompletion(activeId)
  }, [activeId]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    resumeAbortRef.current?.abort();
    assistantMsgIdRef.current = null;
    assistantTextRef.current = '';
    flowStatusRef.current = 'idle';
    setMessages([]);
    setStatus('idle');
    resetPlan();
  }, [resetPlan]);

  /**
   * 切换会话时从后端恢复历史消息与 plan 时间轴快照。
   */
  const loadHistory = useCallback(
    async (sessionId: string) => {
      abortRef.current?.abort();
      resumeAbortRef.current?.abort();
      assistantMsgIdRef.current = null;
      assistantTextRef.current = '';
      flowStatusRef.current = 'idle';
      isResumeRunRef.current = false;
      setMessages([]);
      setStatus('idle');
      resetPlan();

      try {
        const { messages: mapped, rawMessages } = await fetchSessionMessages(sessionId);
        setMessages(mapped);

        const lastAssistant = [...rawMessages].reverse().find((m) => m.role === 'assistant');
        if (!lastAssistant) return;
        const meta = lastAssistant.metadata as Record<string, unknown> | undefined;
        if (!meta?.plan_phase) return;

        const snapshot = await getMessagePlan(lastAssistant.id);
        if (snapshot.steps.length > 0) {
          hydrateFromHistory(snapshot);
        }
      } catch (e) {
        console.error('[task.plan_execute] loadHistory.error', e);
      }
    },
    [resetPlan, hydrateFromHistory],
  );

  return {
    messages,
    status,
    sendMessage,
    abort,
    reset,
    loadHistory,
    hitl: useHitlStore((s) => s.currentItem),
    hitlError: useHitlStore((s) => s.error),
    hitlBusy: useHitlStore((s) => s.status === 'resolving'),
  };
}
