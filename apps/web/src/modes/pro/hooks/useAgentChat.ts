import { useState, useCallback, useRef } from 'react';
import { getAuthHeader } from '../../../api/client';
import { parseAguiStream } from '../../../lib/parseAguiStream';
import type { ChatMessagesData } from '../../../types/chat';

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

/** 返回值 */
export interface UseAgentChatReturn {
  messages: ChatMessagesData[];
  status: AgentChatStatus;
  stateMap: Record<string, AgentStep>;
  currentStateKey: string | null;
  sendMessage: (params: { prompt: string }) => void;
  abort: () => void;
}

// ========== Hook 实现 ==========

/**
 * Agent 对话 Hook
 *
 * 连接 /api/agent/completions 的 SSE 流，AG-UI 协议解析统一收敛到
 * lib/parseAguiStream（阶段 4.2）；本 hook 只负责：
 * - 构建 stateMap 供 ProcessPanel 展示推理过程
 * - 构建 messages 供 AnalysisMessageList 展示对话内容
 */
export function useAgentChat(
  activeId: string | null,
  _deepThinking: boolean,
): UseAgentChatReturn {
  const [messages, setMessages] = useState<ChatMessagesData[]>([]);
  const [stateMap, setStateMap] = useState<Record<string, AgentStep>>({});
  const [currentStateKey, setCurrentStateKey] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentChatStatus>('idle');

  const abortRef = useRef<AbortController | null>(null);
  const stepCounterRef = useRef(0);
  const sessionIdRef = useRef(activeId);

  // 同步外部 activeId 变化
  sessionIdRef.current = activeId;

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

  /** 用一段文本覆盖最后一条 assistant 消息 */
  const setAssistantText = (text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') return prev;
      const next = [...prev];
      next[next.length - 1] = {
        ...last,
        content: [{ type: 'markdown' as const, data: text }],
      };
      return next;
    });
  };

  const sendMessage = useCallback((params: { prompt: string }) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    // 中止之前的请求
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    const ts = Date.now();
    const userMsgId = `u_${ts}`;
    const assistantMsgId = `a_${ts}`;

    // 1) 添加用户消息
    const userMsg: ChatMessagesData = {
      id: userMsgId,
      role: 'user' as const,
      content: [{ type: 'text' as const, data: params.prompt }],
    };

    setMessages([userMsg]);
    setStatus('pending');
    setStateMap({});
    setCurrentStateKey(null);
    stepCounterRef.current = 0;

    // 闭包累积，避免 React state 异步滞后
    let accumulatedText = '';
    let thinkingContent = '';
    let currentThinkingKey: string | null = null;
    let currentToolCallKey: string | null = null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    };

    (async () => {
      try {
        setStatus('streaming');

        // 2) 先挂占位 assistant 消息
        const assistantMsg: ChatMessagesData = {
          id: assistantMsgId,
          role: 'assistant' as const,
          content: [{ type: 'markdown' as const, data: '' }],
          status: 'streaming' as const,
        };
        setMessages((prev) => [...prev, assistantMsg]);

        const response = await fetch('/api/agent/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sessionId,
            message: params.prompt,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          throw new Error(errData?.message || `请求失败: ${response.status}`);
        }

        // 3) 走共享解析器
        const result = await parseAguiStream(
          response,
          {
            onThinkingStart: (event) => {
              stepCounterRef.current += 1;
              const key = `step_${stepCounterRef.current}`;
              currentThinkingKey = key;
              thinkingContent = '';
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
              thinkingContent += delta;
              const key = currentThinkingKey;
              if (!key) return;
              setStateMap((prev) => {
                const step = prev[key];
                if (!step) return prev;
                return { ...prev, [key]: { ...step, content: thinkingContent } };
              });
            },
            onThinkingEnd: () => {
              const key = currentThinkingKey;
              currentThinkingKey = null;
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
                    content: thinkingContent || step.content,
                    label: step.label || '推理分析',
                  },
                };
              });
            },
            onToolCallStart: (event) => {
              stepCounterRef.current += 1;
              const key = `step_${stepCounterRef.current}`;
              currentToolCallKey = key;
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
              const key = currentToolCallKey;
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

              const toolKey = currentToolCallKey;
              currentToolCallKey = null;
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
              accumulatedText += delta;
              setAssistantText(accumulatedText);
            },
            onRunFinished: () => {
              setCurrentStateKey(null);
            },
            onRunError: (event) => {
              settleRunningSteps();
              setStatus('error');
              setAssistantText(
                `Agent 错误: ${(event.message as string) || '未知错误'}`,
              );
            },
          },
          controller.signal,
        );

        // 4) 收尾：error-event 已在回调中处理；其余情况定最终态
        if (result.reason === 'error-event') {
          // status/文本已在 onRunError 中落地
          return;
        }

        if (result.reason === 'aborted') {
          setStatus('complete');
          return;
        }

        // finished / closed：正常完成，固化最终消息
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = [...prev];
          next[next.length - 1] = {
            ...last,
            content: [{ type: 'markdown' as const, data: accumulatedText }],
            status: 'complete' as const,
          };
          return next;
        });
        setStatus('complete');
      } catch (err) {
        const e = err as { name?: string; message?: string };
        if (e?.name === 'AbortError') {
          setStatus('complete');
        } else {
          setStatus('error');
          settleRunningSteps();
          setAssistantText(`请求失败: ${e?.message || '未知错误'}`);
        }
      }
    })();
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    status,
    stateMap,
    currentStateKey,
    sendMessage,
    abort,
  };
}
