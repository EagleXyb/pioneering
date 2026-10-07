/**
 * useAguiChat —— chat 模式自研 AG-UI 对话 Hook
 *
 * SSE 解析复用 lib/parseAguiStream；契约：
 *   - setMessages(messages, 'replace')：历史消息整包同步（会话切换/分页/重生成后）
 *   - sendUserMessage({ prompt, deepThink })：追加 user/assistant 占位后发起流式请求
 *   - abortChat()：仅中止前端读取；停止生成的 /stop 通知由组件层另行调用
 *
 * 消息结构沿用 types/chat：assistant 消息的 content 为
 * [reasoning?, search?, markdown]，reasoning 块结构与历史转换器 converter.ts 对齐。
 */
import { useCallback, useRef, useState } from 'react';
import { getAuthHeader } from '../../../api/client';
import { parseAguiStream } from '../../../lib/parseAguiStream';
import type {
  AIMessage,
  AIMessageContent,
  ChatMessagesData,
  ChatStatus,
  ReferenceItem,
} from '../../../types/chat';

export interface SendUserMessageOptions {
  prompt: string;
  /** R1 深度思考开关（对应请求体 deepThink） */
  deepThink?: boolean;
  /** 联网搜索开关（对应请求体 netSearch） */
  netSearch?: boolean;
  /** 指定模型 id（对应请求体 model；后端默认 deepseek-v4-flash） */
  model?: string;
}

export interface UseAguiChatReturn {
  messages: ChatMessagesData[];
  status: ChatStatus;
  /** 整包替换消息（历史同步） */
  setMessages: (
    messages: ChatMessagesData[],
    mode?: 'replace',
  ) => void;
  sendUserMessage: (options: SendUserMessageOptions) => void;
  abortChat: () => void;
}

export function useAguiChat(
  sessionId: () => string | null,
): UseAguiChatReturn {
  const [messages, setMessagesState] = useState<ChatMessagesData[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');

  const abortRef = useRef<AbortController | null>(null);
  /** 流式中防止重复发送（对齐 task hook 的 guard） */
  const inflightRef = useRef(false);

  const setMessages = useCallback(
    (next: ChatMessagesData[], _mode: 'replace' = 'replace') => {
      // 目前只支持整包替换（历史同步）。流式期间的历史同步由组件在
      // 会话切换时触发，此处不做合并。
      setMessagesState(next);
    },
    [],
  );

  /** 原地更新指定 id 的 assistant 消息 */
      const patchAssistant = useCallback(
        (id: string, updater: (msg: AIMessage) => AIMessage) => {
          setMessagesState((prev) =>
            prev.map((m) =>
              m.id === id && m.role === 'assistant' ? updater(m) : m,
            ),
          );
        },
        [],
      );

  const abortChat = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendUserMessage = useCallback(
    ({ prompt, deepThink = false, netSearch = false, model }: SendUserMessageOptions) => {
      const sid = sessionId();
      if (!sid) return;
      // 流式/待响应中忽略重复发送
      if (inflightRef.current) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inflightRef.current = true;

      const ts = Date.now();
      const userMsg: ChatMessagesData = {
        id: `u_${ts}`,
        role: 'user',
        content: [{ type: 'text', data: prompt }],
      };
      const assistantId = `a_${ts}`;
      const assistantMsg: AIMessage = {
        id: assistantId,
        role: 'assistant',
        content: [{ type: 'markdown', data: '' }],
        status: 'streaming',
      };

      // 闭包累积，避免 React state 异步滞后
      let answer = '';
      let thinking = '';
      let sources: ReferenceItem[] = [];

      /** 校验后端 WEB_SEARCH_SOURCES 事件负载并收敛为 ReferenceItem[] */
      const normalizeSources = (raw: unknown): ReferenceItem[] => {
        if (!Array.isArray(raw)) return [];
        return raw
          .filter(
            (s): s is Record<string, unknown> =>
              !!s && typeof s === 'object',
          )
          .map((s) => ({
            title: typeof s.title === 'string' ? s.title : '',
            url: typeof s.url === 'string' ? s.url : '',
            content: typeof s.content === 'string' ? s.content : '',
            site: typeof s.site === 'string' ? s.site : '',
          }))
          .filter((s) => s.title || s.content);
      };

      // 按当前累积值生成 content：reasoning + search + markdown
      const buildContent = (): AIMessageContent[] => {
        const content: AIMessageContent[] = [];
        if (thinking) {
          content.push({
            type: 'reasoning',
            // 与 converter.ts 历史结构一致；流式阶段默认展开
            data: [{ type: 'text', data: thinking }],
            status: 'streaming',
            ext: { collapsed: false },
          });
        }
        if (sources.length > 0) {
          content.push({
            type: 'search',
            data: { references: sources },
            status: 'complete',
          });
        }
        content.push({ type: 'markdown', data: answer });
        return content;
      };

      const syncAssistant = (statusPatch?: AIMessage['status']) => {
        patchAssistant(assistantId, (m) => ({
          ...m,
          content: buildContent(),
          ...(statusPatch ? { status: statusPatch } : {}),
        }));
      };

      setMessagesState((prev) => [...prev, userMsg, assistantMsg]);
      setStatus('pending');

      (async () => {
        try {
          const response = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeader(),
            },
            body: JSON.stringify({
              sessionId: sid,
              message: prompt,
              stream: true,
              deepThink,
              netSearch,
              model,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(
              (errData as { message?: string })?.message ||
                `请求失败: ${response.status}`,
            );
          }

          setStatus('streaming');

          const result = await parseAguiStream(
            response,
            {
              onRunStarted: () => {
                // RUN_STARTED：预留（会话/运行元数据可在此扩展）
              },
              onWebSearchSources: (raw) => {
                // 来源事件先于正文到达：写入 search 内容块，供操作栏"N 篇来源"读取
                const next = normalizeSources(raw);
                if (next.length > 0) {
                  sources = next;
                  syncAssistant();
                }
              },
              onThinkingStart: () => {
                // 新一轮思考：保留已累积内容（多段场景），不重置 answer
              },
              onThinkingDelta: (delta) => {
                thinking += delta;
                syncAssistant();
              },
              onThinkingEnd: () => {
                syncAssistant();
              },
              onTextDelta: (delta) => {
                answer += delta;
                syncAssistant();
              },
              onRunError: (event) => {
                const msg =
                  (event.message as string) || '生成失败，请重试';
                setStatus('error');
                patchAssistant(assistantId, (m) => ({
                  ...m,
                  // 已有正文时保留正文，仅标记失败；无正文时显示错误
                  content: answer
                    ? m.content
                    : [{ type: 'text', data: msg }],
                  status: 'error',
                }));
              },
              onRunFinished: () => {
                patchAssistant(assistantId, (m) => ({
                  ...m,
                  content: buildContent(),
                  status: 'complete',
                }));
              },
            },
            controller.signal,
          );

          if (result.reason === 'error-event') {
            // onRunError 已落地状态
            return;
          }

          if (result.reason === 'aborted') {
            // 用户停止：保留已生成内容，标记为 stop（终态，允许后续操作）
            patchAssistant(assistantId, (m) => ({
              ...m,
              content: buildContent(),
              status: 'stop',
            }));
            setStatus('complete');
            return;
          }

          // finished / closed 兜底收尾
          patchAssistant(assistantId, (m) => ({
            ...m,
            content: buildContent(),
            status: m.status === 'error' ? 'error' : 'complete',
          }));
          setStatus((prev) => (prev === 'error' ? 'error' : 'complete'));
        } catch (err) {
          const e = err as { name?: string; message?: string };
          if (e?.name === 'AbortError') {
            patchAssistant(assistantId, (m) => ({
              ...m,
              content: buildContent(),
              status: 'stop',
            }));
            setStatus('complete');
            return;
          }
          setStatus('error');
          patchAssistant(assistantId, (m) => ({
            ...m,
            content: answer
              ? m.content
              : [{ type: 'text', data: `请求失败: ${e?.message || '未知错误'}` }],
            status: 'error',
          }));
        } finally {
          inflightRef.current = false;
        }
      })();
    },
    [sessionId, patchAssistant],
  );

  return { messages, status, setMessages, sendUserMessage, abortChat };
}
