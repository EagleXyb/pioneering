import { useState, useCallback, useRef } from 'react';
import { getAuthHeader } from '../../../api/client';
import type { ChatMessagesData } from '../../../types/tdesign';

// ========== 类型定义 ==========

/** 推理步骤状态 */
export interface AgentStep {
  type: string;
  label: string;
  content: any;
  status: 'running' | 'done' | 'pending';
}

/** Agent 消息 — 直接复用 TDesign ChatMessagesData，避免类型不兼容 */
export type AgentMessage = ChatMessagesData;

/** Agent chat 状态 - 与 ChatStatus 兼容 */
export type AgentChatStatus = 'idle' | 'pending' | 'streaming' | 'complete' | 'error';

/** 返回值 */
export interface UseAgentChatReturn {
  messages: ChatMessagesData[];
  status: AgentChatStatus;
  stateMap: Record<string, AgentStep>;
  currentStateKey: string | null;
  sendMessage: (params: { prompt: string }) => void;
  abort: () => void;
}

// ========== AG-UI 事件类型 ==========

type AGUIEventType =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'THINKING_START'
  | 'THINKING_END'
  | 'THINKING_TEXT_MESSAGE_CONTENT'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'TOOL_CALL_RESULT'
  | 'STATE_DELTA';

interface AGUIEvent {
  type: AGUIEventType;
  [key: string]: any;
}

// ========== Hook 实现 ==========

/**
 * Agent 对话 Hook
 *
 * 连接 /api/agent/completions 的 SSE 流，
 * 解析 AG-UI 协议标准事件，
 * 构建 stateMap 供 ProcessPanel 展示推理过程，
 * 构建 messages 供 AnalysisMessageList 展示对话内容。
 */
export function useAgentChat(activeId: string | null, _deepThinking: boolean): UseAgentChatReturn {
  const [messages, setMessages] = useState<ChatMessagesData[]>([]);
  const [stateMap, setStateMap] = useState<Record<string, AgentStep>>({});
  const [currentStateKey, setCurrentStateKey] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentChatStatus>('idle');

  const abortRef = useRef<AbortController | null>(null);
  const stepCounterRef = useRef(0);
  const sessionIdRef = useRef(activeId);

  // 同步外部 activeId 变化
  sessionIdRef.current = activeId;

  const sendMessage = useCallback(
    (params: { prompt: string }) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      // 中止之前的请求
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      const userMsgId = `u_${Date.now()}`;
      const assistantMsgId = `a_${Date.now()}`;

      // 1) 添加用户消息
      const userMsg: ChatMessagesData = {
        id: userMsgId,
        role: 'user' as const,
        content: [{ type: 'text' as const, data: params.prompt }],
      };

      // 重置状态
      setMessages([userMsg]);
      setStatus('pending');
      setStateMap({});
      setCurrentStateKey(null);
      stepCounterRef.current = 0;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      };

      (async () => {
        try {
          setStatus('streaming');

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

          const reader = response.body?.getReader();
          if (!reader) throw new Error('无法读取响应流');

          const decoder = new TextDecoder();
          let buffer = '';
          let accumulatedText = '';
          let thinkingContent = '';

          // 追踪当前 thinking / tool_call 的 stateMap key
          let currentThinkingKey: string | null = null;
          let currentToolCallKey: string | null = null;

          // 2) 添加占位 assistant 消息
          const assistantMsg: ChatMessagesData = {
            id: assistantMsgId,
            role: 'assistant' as const,
            content: [{ type: 'markdown' as const, data: '' }],
            status: 'streaming' as const,
          };
          setMessages((prev) => [...prev, assistantMsg]);

          // 3) 读取 SSE 流，解析 AG-UI 标准事件
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const dataStr = trimmed.slice(6);
              let event: AGUIEvent;
              try {
                event = JSON.parse(dataStr);
              } catch {
                continue;
              }

              switch (event.type) {
                // ---- RUN_STARTED: 运行开始 ----
                case 'RUN_STARTED': {
                  // 可用于初始化，当前无需操作
                  break;
                }

                // ---- STATE_DELTA: 阶段状态变更 ----
                case 'STATE_DELTA': {
                  const phase = event.phase || '';
                  if (phase === 'thinking') {
                    // 标记进入思考阶段
                  }
                  break;
                }

                // ---- THINKING_START: 思考开始 ----
                case 'THINKING_START': {
                  stepCounterRef.current += 1;
                  const key = `step_${stepCounterRef.current}`;
                  currentThinkingKey = key;
                  thinkingContent = '';
                  setStateMap((prev) => ({
                    ...prev,
                    [key]: {
                      type: 'thinking',
                      label: event.title || '深度思考',
                      content: '',
                      status: 'running',
                    },
                  }));
                  setCurrentStateKey(key);
                  break;
                }

                // ---- THINKING_TEXT_MESSAGE_CONTENT: 思考内容增量 ----
                case 'THINKING_TEXT_MESSAGE_CONTENT': {
                  const delta = event.delta || '';
                  thinkingContent += delta;
                  if (currentThinkingKey) {
                    setStateMap((prev) => {
                      const updated = { ...prev };
                      if (updated[currentThinkingKey!]) {
                        updated[currentThinkingKey!] = {
                          ...updated[currentThinkingKey!],
                          content: thinkingContent,
                        };
                      }
                      return updated;
                    });
                  }
                  break;
                }

                // ---- THINKING_END: 思考结束 ----
                case 'THINKING_END': {
                  if (currentThinkingKey) {
                    const key = currentThinkingKey; // 捕获值，避免闭包引用被后续置 null 的变量
                    setStateMap((prev) => {
                      const updated = { ...prev };
                      if (updated[key]) {
                        updated[key] = {
                          ...updated[key],
                          status: 'done',
                          content: thinkingContent || updated[key].content,
                          label: updated[key].label || '推理分析',
                        };
                      }
                      return updated;
                    });
                    currentThinkingKey = null;
                    setCurrentStateKey(null);
                  }
                  break;
                }

                // ---- TOOL_CALL_START: 工具调用开始 ----
                case 'TOOL_CALL_START': {
                  stepCounterRef.current += 1;
                  const key = `step_${stepCounterRef.current}`;
                  currentToolCallKey = key;
                  const toolName = event.toolCallName || '';
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
                  break;
                }

                // ---- TOOL_CALL_ARGS: 工具参数 ----
                case 'TOOL_CALL_ARGS': {
                  if (currentToolCallKey) {
                    setStateMap((prev) => {
                      const updated = { ...prev };
                      if (updated[currentToolCallKey!]) {
                        updated[currentToolCallKey!] = {
                          ...updated[currentToolCallKey!],
                          content: event.delta || '',
                        };
                      }
                      return updated;
                    });
                  }
                  break;
                }

                // ---- TOOL_CALL_END: 工具调用结束 ----
                case 'TOOL_CALL_END': {
                  // 工具调用本身结束，但结果还未返回
                  break;
                }

                // ---- TOOL_CALL_RESULT: 工具执行结果 ----
                case 'TOOL_CALL_RESULT': {
                  const toolName = event.toolCallName || '';
                  const resultContent = event.content || '';

                  // 标记之前的 tool_call 为 done
                  if (currentToolCallKey) {
                    const toolKey = currentToolCallKey; // 捕获值，避免闭包引用被后续置 null 的变量
                    setStateMap((prev) => {
                      const updated = { ...prev };
                      if (updated[toolKey]) {
                        updated[toolKey] = {
                          ...updated[toolKey],
                          status: 'done',
                        };
                      }
                      return updated;
                    });
                    currentToolCallKey = null;
                  }

                  // 添加 observation 步骤
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
                  break;
                }

                // ---- TEXT_MESSAGE_START: 文本消息开始 ----
                case 'TEXT_MESSAGE_START': {
                  // 文本消息即将开始流式输出
                  break;
                }

                // ---- TEXT_MESSAGE_CONTENT: 流式文本增量 ----
                case 'TEXT_MESSAGE_CONTENT': {
                  const delta = event.delta || '';
                  accumulatedText += delta;
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                      updated[updated.length - 1] = {
                        ...last,
                        content: [{ type: 'markdown' as const, data: accumulatedText }],
                      };
                    }
                    return updated;
                  });
                  break;
                }

                // ---- TEXT_MESSAGE_END: 文本消息结束 ----
                case 'TEXT_MESSAGE_END': {
                  // 文本消息完成
                  break;
                }

                // ---- RUN_FINISHED: 运行结束 ----
                case 'RUN_FINISHED': {
                  setCurrentStateKey(null);
                  break;
                }

                // ---- RUN_ERROR: 运行错误 ----
                case 'RUN_ERROR': {
                  setStatus('error');
                  // 清理所有 running 状态
                  setStateMap((prev) => {
                    const updated = { ...prev };
                    for (const key of Object.keys(updated)) {
                      if (updated[key].status === 'running') {
                        updated[key] = { ...updated[key], status: 'done' };
                      }
                    }
                    return updated;
                  });
                  setCurrentStateKey(null);
                  // 在 assistant 消息中显示错误
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                      updated[updated.length - 1] = {
                        ...last,
                        content: [
                          { type: 'text' as const, data: `Agent 错误: ${event.message || '未知错误'}` },
                        ],
                      };
                    }
                    return updated;
                  });
                  return; // 退出循环
                }

                default:
                  break;
              }
            }
          }

          // 4) 流结束，更新最终消息
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: [{ type: 'markdown' as const, data: accumulatedText }],
                status: 'complete' as const,
              };
            }
            return updated;
          });

          setStatus('complete');
        } catch (err: any) {
          if (err.name === 'AbortError') {
            setStatus('complete');
          } else {
            setStatus('error');
            // 清理 running 状态
            setStateMap((prev) => {
              const updated = { ...prev };
              for (const key of Object.keys(updated)) {
                if (updated[key].status === 'running') {
                  updated[key] = { ...updated[key], status: 'done' };
                }
              }
              return updated;
            });
            setCurrentStateKey(null);
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                updated[updated.length - 1] = {
                  ...last,
                  content: [{ type: 'text' as const, data: `请求失败: ${err.message}` }],
                };
              }
              return updated;
            });
          }
        }
      })();
    },
    [],
  );

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
