import { useState, useRef, useCallback } from 'react';
import { useAppStore } from '@/store';
import { chatApi } from '@/services';
import { generateMockStream } from '@/services/mock';

// ====== Mock 模式开关 ======
const USE_MOCK = true;

// ====== SSE 连接状态 ======
export type SSEStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error';

export function useSSE(sessionId: string) {
  const [status, setStatus] = useState<SSEStatus>('idle');
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const setAbortController = useAppStore((s) => s.setAbortController);
  const clearAbortController = useAppStore((s) => s.clearAbortController);

  const startStream = useCallback(
    (messageId: string, userContent: string, deepThink: boolean) => {
      setStatus('connecting');
      setStreamingContent('');
      setThinkingContent('');
      setError(null);

      // 创建 AbortController
      const ctrl = new AbortController();
      setAbortController(ctrl);

      // Mock 流式模式
      if (USE_MOCK) {
        const msgs = useAppStore.getState().messagesMap[sessionId] || [];
        const useThinking = deepThink || (msgs.length > 0 && msgs.length % 4 === 0);

        const replies = [
          '我是你的创路伙伴，有什么可以帮你的？',
          '明白，我正在理解你的问题...',
          '这个问题很有意思，我来为你详细解答一下。',
          '你说的内容我已经收到啦！',
          '好的，这是一个很好的方向！让我帮你深入分析。',
          '我理解你的顾虑，这确实是很多人在这个阶段会有的感受。',
          '从你刚才说的来看，我建议我们从最核心的问题开始梳理。',
          '太好了！这个想法很有潜力，我们一起来把它变得更具体吧。',
        ];
        const reply = replies[Math.floor(Math.random() * replies.length)];

        setStatus('streaming');
        let fullContent = '';
        let fullThinking = '';

        (async () => {
          try {
            for await (const chunk of generateMockStream({
              content: reply,
              chunkSize: 3,
              chunkDelay: 80,
              useThinking,
            })) {
              if (ctrl.signal.aborted) break;
              if (chunk.type === 'thinking') {
                fullThinking += chunk.data;
                setThinkingContent(fullThinking);
              } else {
                fullContent += chunk.data;
                setStreamingContent(fullContent);
              }
            }
            if (!ctrl.signal.aborted) {
              setStatus('done');
            }
          } catch {
            if (!ctrl.signal.aborted) {
              setError('流式输出异常');
              setStatus('error');
            }
          } finally {
            clearAbortController();
          }
        })();

        abortRef.current = () => ctrl.abort();
        return;
      }

      // 真实 SSE 模式
      const conn = chatApi.sendMessageStream(
        { sessionId, content: userContent, messageId, deepThink },
        {
          onChunk: (data) => {
            if (ctrl.signal.aborted) return;
            setStatus('streaming');
            if (data.type === 'thinking') {
              setThinkingContent((prev) => prev + data.data);
            } else {
              setStreamingContent((prev) => prev + data.data);
            }
          },
          onDone: () => {
            if (!ctrl.signal.aborted) {
              setStatus('done');
              clearAbortController();
            }
          },
          onError: (err) => {
            if (!ctrl.signal.aborted) {
              setError(err.message || '流式输出异常');
              setStatus('error');
              clearAbortController();
            }
          },
        },
      );

      abortRef.current = () => {
        ctrl.abort();
        conn.abort();
      };
    },
    [sessionId, setAbortController, clearAbortController],
  );

  const stopStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setStatus((prev) => (prev === 'streaming' ? 'done' : prev));
    clearAbortController();
  }, [clearAbortController]);

  const reset = useCallback(() => {
    setStatus('idle');
    setStreamingContent('');
    setThinkingContent('');
    setError(null);
    abortRef.current = null;
  }, []);

  return {
    status,
    streamingContent,
    thinkingContent,
    error,
    startStream,
    stopStream,
    reset,
  };
}