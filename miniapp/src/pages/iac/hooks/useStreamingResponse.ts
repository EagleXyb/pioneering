import { useRef, useCallback } from 'react';
import type { Message, MessageStatus } from '../constants';
import { MOCK_RESPONSES } from '../constants';

interface UseStreamingResponseOptions {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsSending: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * 流式模拟 Hook
 * 负责模拟 AI 回复的逐字输出效果
 */
export function useStreamingResponse({ setMessages, setIsSending }: UseStreamingResponseOptions) {
  const streamingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const simulateStreamingResponse = useCallback(
    (aiMessageId: number, modeId: string) => {
      const fullText = MOCK_RESPONSES[modeId] || MOCK_RESPONSES.normal;
      let charIndex = 0;

      const tick = () => {
        if (charIndex < fullText.length) {
          const step = Math.floor(Math.random() * 2) + 1;
          charIndex = Math.min(charIndex + step, fullText.length);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? { ...msg, content: fullText.substring(0, charIndex), status: 'streaming' as MessageStatus }
                : msg,
            ),
          );
          const isPunctuation = /[，。！？、；：""''）】》…—]/.test(fullText[charIndex - 1]);
          const delay = isPunctuation ? 80 + Math.random() * 60 : 25 + Math.random() * 35;
          streamingTimerRef.current = setTimeout(tick, delay);
        } else {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId ? { ...msg, status: 'success' as MessageStatus } : msg,
            ),
          );
          setIsSending(false);
          streamingTimerRef.current = null;
        }
      };

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMessageId ? { ...msg, status: 'streaming' as MessageStatus } : msg,
        ),
      );
      streamingTimerRef.current = setTimeout(tick, 400);
    },
    [setMessages, setIsSending],
  );

  const onStopGenerate = useCallback(() => {
    if (streamingTimerRef.current) {
      clearTimeout(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
    setMessages((prev) =>
      prev.map((msg) =>
        msg.status === 'streaming' || msg.status === 'loading'
          ? { ...msg, status: 'stopped' as MessageStatus }
          : msg,
      ),
    );
    setIsSending(false);
  }, [setMessages, setIsSending]);

  const cleanup = useCallback(() => {
    if (streamingTimerRef.current) {
      clearTimeout(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
  }, []);

  return { simulateStreamingResponse, onStopGenerate, cleanup };
}
