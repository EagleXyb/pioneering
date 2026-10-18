import { useState, useRef, useCallback, useEffect } from 'react';
import type { ChatMessagesData, ChatStatus } from '../../../types/chat';
import { parseAguiStream, type AguiStreamHandlers } from '../../../lib/parseAguiStream';
import {
  monitorAguiResponse,
  streamErrorMessage,
  StreamRequestError,
} from '../../../lib/sseClient';
import { usePlanExecuteStore, type Phase } from '../../../store/planExecuteStore';
import { getMessages } from '../../../api/message';
import { fetchSessionMessages } from '../../../lib/load-session-messages';
import { getMessagePlan, patchCollapsedSteps } from '../../../api/plan';
import { useAppStore } from '../../../store/appStore';
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
  /** P0：模型透传（真实模型 ID 或别名），省略时由后端默认模型兜底 */
  model?: string;
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

/**
 * P0 修复：流结束时的终态判定——流正常结束 ≠ 任务完成。
 *
 * 全部步骤收敛到 done/failed/skipped 时才允许置 'done'；只要仍有
 * pending/running 步骤（后端静默终止、执行中断等），置 'incomplete'，
 * 避免"已完成"徽章与 "已完成 0/N" 进度自相矛盾的假成功展示。
 *
 * 无计划场景（规划失败降级直答 / temp 会话）维持既有语义：置 'done'。
 */
function resolveTerminalPhase(): Phase {
  const { items, rootIds } = usePlanExecuteStore.getState();
  if (rootIds.length === 0) return 'done';
  const hasUnfinished = rootIds.some((id) => {
    const status = items[id]?.status;
    // retrying（步骤级重试中间态）同样视为未完成，避免流提前结束时误判"已完成"
    return status === 'pending' || status === 'running' || status === 'retrying';
  });
  return hasUnfinished ? 'incomplete' : 'done';
}

/** 提取消息正文（用于 HITL 刷新恢复时建立续写基线） */
function messageText(msg: ChatMessagesData): string {
  return (msg.content ?? [])
    .map((c) => {
      const data = (c as { data?: unknown }).data;
      return typeof data === 'string' ? data : '';
    })
    .join('');
}

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

  // 右侧任务流水线：默认折叠，Agent 开始输出步骤时自动展开
  const autoOpenPipeline = useAppStore((s) => s.autoOpenPipeline);
  const resetPipelineForSession = useAppStore((s) => s.resetPipelineForSession);

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
   * P1-5：流式渲染节流。
   *
   * 修复前每个 TEXT_MESSAGE_CONTENT delta 都触发一次 `setMessages` 全量重渲染，
   * 而任务模式正文可达 5 万+ 字符（实测 56156 字），长文档型任务下明显掉帧。
   * 改为 ~60ms 合并刷新；流结束时由调用方 `flushAssistantText()` 强制收尾。
   */
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAssistantFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const msgId = assistantMsgIdRef.current;
      if (msgId) updateAssistantContent(msgId, assistantTextRef.current);
    }, 60);
  }, [updateAssistantContent]);

  /** 立即把当前累积文本写入消息（流结束/中止/错误时调用） */
  const flushAssistantText = useCallback(() => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const msgId = assistantMsgIdRef.current;
    if (msgId) updateAssistantContent(msgId, assistantTextRef.current);
  }, [updateAssistantContent]);

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
      // Agent 开始输出规划/步骤信息：自动展开右侧任务流水线
      const hasPlan =
        Array.isArray(event.plan) && event.plan.length > 0;
      if (phase === 'plan' && hasPlan) {
        autoOpenPipeline();
      } else if (phase === 'execute' && event.step_update) {
        autoOpenPipeline();
      }
    },
    /**
     * P1-5：消费 TEXT_MESSAGE_START —— 每个消息段（步骤叙述 / 最终答复）
     * 之间插入空行分隔。修复前只做 `+=` 累加，5 万+字符的正文糊成一整块，
     * 用户无法区分"过程话术"与"最终交付物"。
     */
    onTextStart: () => {
      if (assistantTextRef.current.length > 0) {
        assistantTextRef.current += '\n\n';
      }
      scheduleAssistantFlush();
    },
    onTextDelta: (delta) => {
      assistantTextRef.current += delta;
      scheduleAssistantFlush();
    },
    onRunFinished: () => {
      // P1-5：流结束前把最后一段未刷新的正文写入（节流可能还压着一批 delta）
      flushAssistantText();
      setStatus('complete');
      // P0 修复：按实际步骤完成度判定终态（全部收敛 → done；仍有未完成步骤 → incomplete）
      setPhase(resolveTerminalPhase());
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
      const monitor = monitorAguiResponse(response);
      try {
        const result = await parseAguiStream(
          monitor.response,
          streamHandlers,
          controller.signal,
        );
        if (monitor.timedOut() && !controller.signal.aborted) {
          throw new StreamRequestError('timeout', '响应超时，请重试');
        }

        if (result.reason === 'paused') {
          // P1-5：暂停时也要落盘当前正文（用户刷新后可见）
          flushAssistantText();
          return; // 等待用户答复
        }
        if (result.reason === 'error-event') return; // onRunError 已落地
        if (result.reason === 'aborted') {
          flushAssistantText();
          setStatus('complete');
          return;
        }
        if (flowStatusRef.current === 'aborted') return; // onHitlAborted 已收尾

        // closed 兜底
        flushAssistantText();
        setStatus((prev) => (prev === 'streaming' ? 'complete' : prev));
        const currentPhase = usePlanExecuteStore.getState().phase;
        if (currentPhase === 'planning' || currentPhase === 'executing') {
          // P0 修复：closed 兜底同样按实际完成度判定（不允许把未完成当已完成）
          setPhase(resolveTerminalPhase());
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
          setPhase('error', streamErrorMessage(e));
          if (msgId && !assistantTextRef.current) {
            updateAssistantContent(
              msgId,
              `请求失败: ${streamErrorMessage(e)}`,
            );
          }
        }
      } finally {
        monitor.dispose();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      applyPlanDelta,
      setPhase,
      setHitlLock,
      updateAssistantContent,
      flushAssistantText,
      persistCollapsedSnapshot,
    ],
  );

  // ========== 发送 ==========

  /**
   * 统一的流式启动入口（发送 / 编辑重发共用）。
   * params.editMessageId 存在时走"编辑重发"：本地截断到目标消息为止并就地替换
   * 正文，请求体携带 messageId 交由后端更新 + 截断（方案 B）。
   */
  const startRun = useCallback(
    async (params: { prompt: string; editMessageId?: string; model?: string }) => {
      if (!activeId || status === 'streaming' || status === 'pending') return;
      // HITL 暂停守卫：paused 时不能发起新请求
      if (flowStatusRef.current === 'paused') return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // 构造 assistant 占位消息（多轮累积，不重置）
      const ts = Date.now();
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

      if (params.editMessageId) {
        const editId = params.editMessageId;
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === editId);
          if (idx === -1) return [...prev, assistantMsg];
          const head = prev.slice(0, idx + 1).map((m, i) =>
            i === idx
              ? ({
                  ...m,
                  content: [{ type: 'text' as const, data: params.prompt }],
                } as ChatMessagesData)
              : m,
          );
          return [...head, assistantMsg];
        });
      } else {
        const userMsg: ChatMessagesData = {
          id: `u_${ts}`,
          role: 'user',
          content: [{ type: 'text', data: params.prompt }],
          // 供用户气泡悬停显示时间（历史消息由 converter 补齐）
          datetime: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }

      setStatus('streaming');
      setPhase('planning');
      // 新一轮任务：清除用户折叠意图并先保持折叠，待规划/步骤输出时再自动展开
      resetPipelineForSession(false);

      try {
        const response = await streamCompletion(
          {
            sessionId: activeId,
            message: params.prompt,
            stream: true,
            agentMode: 'plan_execute',
            // P0：模型透传；未选中/未加载时省略
            ...(params.model ? { model: params.model } : {}),
            ...(params.editMessageId
              ? { messageId: params.editMessageId, truncateAfter: true }
              : {}),
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
    [activeId, status, setPhase, setHitlLock, consumeStream, updateAssistantContent, resetPipelineForSession],
  );

  const sendMessage = useCallback(
    async (params: SendMessageParams) => startRun(params),
    [startRun],
  );

  /** 编辑重发（方案 B）：截断到目标用户消息为止并重新规划执行 */
  const resendEditedMessage = useCallback(
    async (params: { messageId: string; prompt: string; model?: string }) =>
      startRun({
        prompt: params.prompt,
        editMessageId: params.messageId,
        model: params.model,
      }),
    [startRun],
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
      const placeholderId = `assistant-hitl-${input.sessionId}-${Date.now()}`;
      // 修复（2026-10-14）：暂停时消息已落库（刷新可见）——若列表末尾已是 assistant
      // 消息（即 DB 恢复的半截消息），复用它作为续写目标：
      //   1. 避免出现"半截消息 + 空占位"两个气泡；
      //   2. 把已有正文设为续写基线，否则 resume 增量会覆盖已恢复的内容。
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        assistantMsgIdRef.current = last.id;
        assistantTextRef.current = messageText(last);
      } else {
        assistantMsgIdRef.current = placeholderId;
        assistantTextRef.current = '';
        setMessages((prev) => [
          ...prev,
          {
            id: placeholderId,
            role: 'assistant',
            content: [{ type: 'text' as const, data: '' }],
          } as ChatMessagesData,
        ]);
      }
      flowStatusRef.current = 'paused';
      isResumeRunRef.current = false;
      setStatus('complete');
      setHitlLock(true);
    },
    [messages, setHitlLock],
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
      // 修复（2026-10-14）：HITL 失效收尾同样要终结 plan 阶段——暂停时 phase
      // 保持 'executing'，不收尾会让任务流水线 badge 永久停留"执行中 0/N"，
      // 与"[已失效]"提示自相矛盾（用户无法判断任务是否还能继续）。
      const currentPhase = usePlanExecuteStore.getState().phase;
      if (currentPhase === 'planning' || currentPhase === 'executing') {
        setPhase(resolveTerminalPhase());
      }
    },
    [activeId, setHitlLock, setPhase, updateAssistantContent],
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
    // temp 会话：无步骤信息，面板保持折叠
    resetPipelineForSession(false);
  }, [resetPlan, resetPipelineForSession]);

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
      // 进入会话先清除用户折叠意图并折叠，待确认有历史步骤后再展开
      resetPipelineForSession(false);

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
          // 历史含任务步骤：进入会话即展开任务流水线
          resetPipelineForSession(true);
        }
      } catch (e) {
        console.error('[task.plan_execute] loadHistory.error', e);
      }
    },
    [resetPlan, hydrateFromHistory, resetPipelineForSession],
  );

  return {
    messages,
    status,
    sendMessage,
    /** 编辑重发（方案 B）：截断到目标用户消息为止并重新规划执行 */
    resendEditedMessage,
    abort,
    reset,
    loadHistory,
    hitl: useHitlStore((s) => s.currentItem),
    hitlError: useHitlStore((s) => s.error),
    hitlBusy: useHitlStore((s) => s.status === 'resolving'),
  };
}
