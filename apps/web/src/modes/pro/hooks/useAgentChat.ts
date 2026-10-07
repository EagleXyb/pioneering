import { useState, useCallback, useRef, useEffect } from 'react';
import { parseAguiStream, type AguiStreamHandlers } from '../../../lib/parseAguiStream';
import type { ChatMessagesData } from '../../../types/chat';
import { streamCompletion, streamResume, stopAgentCompletion } from '../../../api/agent';
import { fetchSessionMessages } from '../../../lib/load-session-messages';
import { contentBlocksToSteps } from './contentBlocksToSteps';
import {
  useHitlStore,
  type HitlItem,
  type HitlItemInput,
  type HitlResolveInput,
  type RestoreHitlPauseInput,
  type ResumeHitlResult,
  type UserQuestionRequestPayload,
} from '@pioneering/agent-protocol';
import { bindAgentModeRuntime } from '../../../lib/agent-host';

// ========== 类型定义 ==========

/** 推理步骤状态 */
export interface AgentStep {
  type: string;
  label: string;
  content: unknown;
  status: 'running' | 'done' | 'pending';
}

/** Agent 消息 — 复用全局聊天消息类型 */
export type AgentMessage = ChatMessagesData;

/** Agent chat 状态 - 与 ChatStatus 兼容 */
export type AgentChatStatus =
  | 'idle'
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'error';

/** 单次流的内部生命周期状态 */
type FlowStatus = 'idle' | 'running' | 'paused' | 'aborted' | 'error';

/** 返回值 */
export interface UseAgentChatReturn {
  messages: ChatMessagesData[];
  status: AgentChatStatus;
  stateMap: Record<string, AgentStep>;
  currentStateKey: string | null;
  sendMessage: (params: { prompt: string }) => void;
  abort: () => void;
  /** T3.1：会话切换时恢复历史消息 */
  loadHistory: (sessionId: string) => Promise<void>;
  /** 当前待答复 HITL 项（非空时输入框锁定并渲染卡片） */
  hitl: HitlItem | null;
  hitlError: string | null;
  hitlBusy: boolean;
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

// ========== Hook 实现 ==========

/**
 * Agent 对话 Hook
 *
 * 连接 /agent/completions 与 /agent/resume 的 SSE 流，AG-UI 协议解析统一
 * 收敛到 lib/parseAguiStream；本 hook 负责：
 * - 构建 stateMap 供 ProcessPanel 展示推理过程
 * - 构建 messages 供 AnalysisMessageList 展示对话内容
 * - HITL：中断事件入队、暂停保留消息 id、resume 续写同一条消息
 */
export function useAgentChat(
  activeId: string | null,
  _deepThinking: boolean,
): UseAgentChatReturn {
  const [messages, setMessages] = useState<ChatMessagesData[]>([]);
  const [stateMap, setStateMap] = useState<Record<string, AgentStep>>({});
  const [currentStateKey, setCurrentStateKey] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentChatStatus>('idle');

  // HITL 队列订阅
  const hitl = useHitlStore((s) => s.currentItem);
  const hitlError = useHitlStore((s) => s.error);
  const hitlBusy = useHitlStore((s) => s.status === 'resolving');

  const sendControllerRef = useRef<AbortController | null>(null);
  const resumeControllerRef = useRef<AbortController | null>(null);
  const stepCounterRef = useRef(0);
  const sessionIdRef = useRef(activeId);

  // 流期间的跨闭包状态（避免 React state 异步滞后）
  const assistantMsgIdRef = useRef<string | null>(null);
  const assistantTextRef = useRef('');
  const thinkingKeyRef = useRef<string | null>(null);
  const thinkingTextRef = useRef('');
  const toolCallKeyRef = useRef<string | null>(null);
  const flowStatusRef = useRef<FlowStatus>('idle');
  /** 当前运行是否为 resume 续写（决定终态时是否 dequeue） */
  const isResumeRunRef = useRef(false);

  // 同步外部 activeId 变化
  sessionIdRef.current = activeId;

  // ========== 消息按 id 更新 ==========

  const setMessageText = (
    msgId: string,
    text: string,
    terminalStatus?: 'complete' | 'stop' | 'error',
  ) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId);
      if (idx === -1) return prev;
      const next = [...prev];
      // 仅用于 assistant 消息（调用方按 assistantMsgId 定位）
      next[idx] = {
        ...next[idx]!,
        content: [{ type: 'markdown' as const, data: text }],
        // 流收尾时写入终态，供消息组件决定操作栏展示
        ...(terminalStatus ? { status: terminalStatus } : {}),
      } as ChatMessagesData;
      return next;
    });
  };

  /** 将所有 running 步骤收尾为 done（错误/中止时调用） */
  const settleRunningSteps = () => {
    setStateMap((prev) => {
      let changed = false;
      const updated = { ...prev };
      for (const key of Object.keys(updated)) {
        if (updated[key].status === 'running') {
          updated[key] = { ...updated[key], status: 'done' };
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
    setCurrentStateKey(null);
  };

  /** 重置本地视图（切会话时） */
  const resetLocalView = useCallback(() => {
    sendControllerRef.current?.abort();
    resumeControllerRef.current?.abort();
    sendControllerRef.current = null;
    resumeControllerRef.current = null;
    assistantMsgIdRef.current = null;
    assistantTextRef.current = '';
    thinkingKeyRef.current = null;
    thinkingTextRef.current = '';
    toolCallKeyRef.current = null;
    flowStatusRef.current = 'idle';
    stepCounterRef.current = 0;
    setMessages([]);
    setStateMap({});
    setCurrentStateKey(null);
    setStatus('idle');
  }, []);

  // 切会话时重置视图（挂载首次不重置）
  const firstMountRef = useRef(true);
  useEffect(() => {
    if (firstMountRef.current) {
      firstMountRef.current = false;
      return;
    }
    resetLocalView();
  }, [activeId, resetLocalView]);

  // ========== 统一 AG-UI 事件处理（send / resume 共用） ==========

  const streamHandlers: AguiStreamHandlers = {
    onThinkingStart: (event) => {
      stepCounterRef.current += 1;
      const key = `step_${stepCounterRef.current}`;
      thinkingKeyRef.current = key;
      thinkingTextRef.current = '';
      setStateMap((prev) => ({
        ...prev,
        [key]: {
          type: 'thinking',
          label: (event.title as string) || '深度思考',
          content: '',
          status: 'running',
        },
      }));
      setCurrentStateKey(key);
    },
    onThinkingDelta: (delta) => {
      thinkingTextRef.current += delta;
      const key = thinkingKeyRef.current;
      if (!key) return;
      setStateMap((prev) => {
        const step = prev[key];
        if (!step) return prev;
        return { ...prev, [key]: { ...step, content: thinkingTextRef.current } };
      });
    },
    onThinkingEnd: () => {
      const key = thinkingKeyRef.current;
      thinkingKeyRef.current = null;
      setCurrentStateKey(null);
      if (!key) return;
      setStateMap((prev) => {
        const step = prev[key];
        if (!step) return prev;
        return {
          ...prev,
          [key]: {
            ...step,
            status: 'done',
            content: thinkingTextRef.current || step.content,
            label: step.label || '推理分析',
          },
        };
      });
    },
    onToolCallStart: (event) => {
      stepCounterRef.current += 1;
      const key = `step_${stepCounterRef.current}`;
      toolCallKeyRef.current = key;
      const toolName = (event.toolCallName as string) || '';
      setStateMap((prev) => ({
        ...prev,
        [key]: {
          type: 'tool_call',
          label: `调用工具 ${toolName}`,
          content: '',
          status: 'running',
        },
      }));
      setCurrentStateKey(key);
    },
    onToolCallArgs: (delta) => {
      const key = toolCallKeyRef.current;
      if (!key) return;
      setStateMap((prev) => {
        const step = prev[key];
        if (!step) return prev;
        return { ...prev, [key]: { ...step, content: delta } };
      });
    },
    onToolCallResult: (event) => {
      const toolName = (event.toolCallName as string) || '';
      const resultContent = (event.content as string) || '';

      const toolKey = toolCallKeyRef.current;
      toolCallKeyRef.current = null;
      if (toolKey) {
        setStateMap((prev) => {
          const step = prev[toolKey];
          if (!step) return prev;
          return { ...prev, [toolKey]: { ...step, status: 'done' } };
        });
      }

      stepCounterRef.current += 1;
      const obsKey = `step_${stepCounterRef.current}`;
      setStateMap((prev) => ({
        ...prev,
        [obsKey]: {
          type: 'tool_result',
          label: `工具结果: ${toolName}`,
          content: resultContent,
          status: 'done',
        },
      }));
      setCurrentStateKey(null);
    },
    onTextDelta: (delta) => {
      assistantTextRef.current += delta;
      const msgId = assistantMsgIdRef.current;
      if (msgId) setMessageText(msgId, assistantTextRef.current);
    },
    onRunFinished: () => {
      setCurrentStateKey(null);
    },
    onRunError: (event) => {
      flowStatusRef.current = 'error';
      settleRunningSteps();
      // resume 流出错：同样出队当前暂停项（初次发送时队列空，no-op）
      if (isResumeRunRef.current) useHitlStore.getState().dequeue();
      setStatus('error');
      const msgId = assistantMsgIdRef.current;
      const text = `Agent 错误: ${(event.message as string) || '未知错误'}`;
      assistantTextRef.current = text;
      if (msgId) setMessageText(msgId, text, 'error');
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
      setCurrentStateKey(null);
    },
    onHitlAborted: (event) => {
      flowStatusRef.current = 'aborted';
      settleRunningSteps();
      const msgId = assistantMsgIdRef.current;
      const base = assistantTextRef.current;
      const text = base
        ? `${base}\n\n[已中止] 该操作未执行。`
        : '[已中止] 该操作未执行。';
      assistantTextRef.current = text;
      if (msgId) setMessageText(msgId, text, 'stop');
      setCurrentStateKey(null);
      useHitlStore.getState().dequeue();
      void event;
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

        if (result.reason === 'paused') {
          // onRunPaused 已更新引用，等待用户答复
          return;
        }
        if (result.reason === 'error-event') {
          // onRunError 已落地
          return;
        }
        if (result.reason === 'aborted') {
          if (msgId) setMessageText(msgId, assistantTextRef.current, 'stop');
          setStatus('complete');
          return;
        }

        // closed + HITL_ABORTED：onHitlAborted 已收尾（含 dequeue）
        if (flowStatusRef.current === 'aborted') return;

        // finished / closed：固化最终消息
        if (msgId) setMessageText(msgId, assistantTextRef.current, 'complete');
        setStatus('complete');
        // resume 续写正常结束：出队当前暂停项
        if (isResumeRunRef.current) useHitlStore.getState().dequeue();
        flowStatusRef.current = 'idle';
      } catch (err) {
        const e = err as { name?: string; message?: string };
        if (e?.name === 'AbortError') {
          if (msgId) setMessageText(msgId, assistantTextRef.current, 'stop');
          setStatus('complete');
          flowStatusRef.current = 'idle';
        } else {
          flowStatusRef.current = 'error';
          setStatus('error');
          settleRunningSteps();
          if (msgId)
            setMessageText(
              msgId,
              `请求失败: ${e?.message || '未知错误'}`,
              'error',
            );
        }
      }
    },
    // streamHandlers 在每次渲染重建（引用 refs，语义稳定）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ========== 发送 ==========

  const sendMessage = useCallback(
    (params: { prompt: string }) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      // HITL 暂停时禁止发起新请求（输入框已锁定，此为双保险）
      if (flowStatusRef.current === 'paused') return;

      sendControllerRef.current?.abort();

      const controller = new AbortController();
      sendControllerRef.current = controller;

      const ts = Date.now();
      const userMsgId = `u_${ts}`;
      const assistantMsgId = `a_${ts}`;

      const userMsg: ChatMessagesData = {
        id: userMsgId,
        role: 'user' as const,
        content: [{ type: 'text' as const, data: params.prompt }],
      };
      const assistantMsg: ChatMessagesData = {
        id: assistantMsgId,
        role: 'assistant' as const,
        content: [{ type: 'markdown' as const, data: '' }],
        status: 'streaming' as const,
      };

      // 重置流引用
      assistantMsgIdRef.current = assistantMsgId;
      assistantTextRef.current = '';
      thinkingKeyRef.current = null;
      thinkingTextRef.current = '';
      toolCallKeyRef.current = null;
      stepCounterRef.current = 0;
      flowStatusRef.current = 'running';
      isResumeRunRef.current = false;

      // T3.1：多轮累积（不再每次重置）
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStatus('pending');
      setStateMap({});
      setCurrentStateKey(null);

      (async () => {
        try {
          setStatus('streaming');
          const response = await streamCompletion(
            {
              sessionId,
              message: params.prompt,
              stream: true,
            },
            controller.signal,
          );
          await consumeStream(response, controller);
        } catch (err) {
          const e = err as { name?: string; message?: string };
          if (e?.name === 'AbortError') {
            setStatus('complete');
            flowStatusRef.current = 'idle';
          } else {
            flowStatusRef.current = 'error';
            setStatus('error');
            settleRunningSteps();
            setMessageText(
              assistantMsgId,
              `请求失败: ${e?.message || '未知错误'}`,
            );
          }
        }
      })();
    },
    [consumeStream],
  );

  // ========== HITL 宿主动作（供 hitlStore 状态机调用） ==========

  /** resume：用户批准/拒绝/回答后续写同一条消息 */
  const resumeHitl = useCallback(
    async (sessionId: string, input: HitlResolveInput): Promise<ResumeHitlResult> => {
      if (flowStatusRef.current !== 'paused') {
        return {
          ok: false as const,
          reason: '该会话当前没有等待答复的操作，请刷新会话状态后重试。',
        };
      }
      if (sessionId !== sessionIdRef.current || !assistantMsgIdRef.current) {
        return { ok: false as const, reason: '会话状态不匹配，请刷新后重试。' };
      }

      const controller = new AbortController();
      resumeControllerRef.current = controller;
      flowStatusRef.current = 'running';
      isResumeRunRef.current = true;
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
        // resume 流已启动：后台继续消费（续写同一条 assistant 消息）
        void consumeStream(response, controller);
        return { ok: true as const };
      } catch (err) {
        // 回滚到暂停态允许重试
        flowStatusRef.current = 'paused';
        setStatus('complete');
        return { ok: false as const, reason: (err as Error)?.message || '恢复失败，请重试。' };
      }
    },
    [consumeStream],
  );

  /**
   * T3.1：切换会话时从后端恢复历史消息。
   * （pro 无 plan 快照，仅恢复消息；recover 在 ProMode 中随后调用）
   */
  const loadHistory = useCallback(async (sessionId: string) => {
    sendControllerRef.current?.abort()
    resumeControllerRef.current?.abort()
    sendControllerRef.current = null
    resumeControllerRef.current = null
    assistantMsgIdRef.current = null
    assistantTextRef.current = ''
    thinkingKeyRef.current = null
    thinkingTextRef.current = ''
    toolCallKeyRef.current = null
    flowStatusRef.current = 'idle'
    stepCounterRef.current = 0
    setMessages([])
    setStatus('idle')
    setStateMap({})

    try {
      const { messages: mapped, rawMessages } = await fetchSessionMessages(sessionId)
      setMessages(mapped)
      // T3.3：从最后一条 assistant 消息的 contentBlocks 还原右侧过程面板
      const lastAssistant = [...rawMessages].reverse().find((m) => m.role === 'assistant')
      if (lastAssistant) {
        setStateMap(contentBlocksToSteps(lastAssistant.contentBlocks))
      }
    } catch {
      // 失败静默降级为空态
    }
  }, [])

  /** 刷新恢复：重建可续写的暂停占位消息 */
  const restoreHitlPause = useCallback((input: RestoreHitlPauseInput) => {
    const msgId = `assistant-hitl-${input.sessionId}-${Date.now()}`;
    const placeholder: ChatMessagesData = {
      id: msgId,
      role: 'assistant' as const,
      content: [{ type: 'markdown' as const, data: '' }],
    };
    assistantMsgIdRef.current = msgId;
    assistantTextRef.current = '';
    thinkingKeyRef.current = null;
    thinkingTextRef.current = '';
    toolCallKeyRef.current = null;
    stepCounterRef.current = 0;
    flowStatusRef.current = 'paused';
    setMessages((prev) => [...prev, placeholder]);
    setStatus('complete');
  }, []);

  /** 失效收尾：在暂停占位消息上追加说明并解除暂停 */
  const finalizeHitlStale = useCallback((sessionId: string, reason: string) => {
    const msgId = assistantMsgIdRef.current;
    if (msgId && sessionId === sessionIdRef.current) {
      const text = `[已失效] ${reason}`;
      assistantTextRef.current = text;
      setMessageText(msgId, text);
    }
    assistantMsgIdRef.current = null;
    flowStatusRef.current = 'idle';
    setStatus('complete');
  }, []);

  // 注册模式运行时（卸载时注销）
  useEffect(() => {
    bindAgentModeRuntime({
      getPausedSessionId: () =>
        flowStatusRef.current === 'paused' ? sessionIdRef.current : null,
      resumeHitl: (sid, input) => resumeHitl(sid, input),
      restoreHitlPause: (input) => restoreHitlPause(input),
      finalizeHitlStale: (sid, reason) => finalizeHitlStale(sid, reason),
    })
    return () => bindAgentModeRuntime(null)
  }, [resumeHitl, restoreHitlPause, finalizeHitlStale])

  // ========== 中止 ==========

  const abort = useCallback(() => {
    if (flowStatusRef.current === 'paused') {
      // 暂停态：等同放弃待确认操作（状态机内部调 abort 端点 + dequeue）
      useHitlStore.getState().dismiss('user_cancel')
      return
    }
    sendControllerRef.current?.abort();
    resumeControllerRef.current?.abort();
    // T2.3：通知后端真正中止上游 LLM 请求
    const sid = sessionIdRef.current
    if (sid) void stopAgentCompletion(sid)
  }, []);

  return {
    messages,
    status,
    stateMap,
    currentStateKey,
    sendMessage,
    abort,
    loadHistory,
    hitl,
    hitlError,
    hitlBusy,
  };
}
