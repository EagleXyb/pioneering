import { useRef, useCallback } from 'react';
import type { DisplayMessage } from './types';
import { REQUEST_TIMEOUT } from './types';
import llmService, { type ChatMessage } from '../../services/llmService';

export function useStreamChat(
  updateMessage: (id: string, updates: Partial<DisplayMessage>) => void,
  setIsGenerating: (v: boolean) => void,
) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamBufferRef = useRef<{ id: string; content: string } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const flushStreamBuffer = useCallback(() => {
    rafIdRef.current = null;
    const buffer = streamBufferRef.current;
    if (buffer) {
      streamBufferRef.current = null;
      updateMessage(buffer.id, { content: buffer.content, status: 'loading' });
    }
  }, [updateMessage]);

  const appendStreamChunk = useCallback((id: string, chunk: string) => {
    if (streamBufferRef.current && streamBufferRef.current.id === id) {
      streamBufferRef.current.content += chunk;
    } else {
      if (streamBufferRef.current) {
        updateMessage(streamBufferRef.current.id, { content: streamBufferRef.current.content, status: 'loading' });
      }
      streamBufferRef.current = { id, content: chunk };
    }
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(flushStreamBuffer);
    }
  }, [updateMessage, flushStreamBuffer]);

  const cleanupStream = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    streamBufferRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    abortControllerRef.current = null;
  }, []);

  const startStream = useCallback(
    (
      assistantMsgId: string,
      config: { apiKey: string; provider: string; model: string; prompt: string },
      contextMessages: ChatMessage[],
      onStreamDone: (accumulatedContent: string) => void,
      onStreamError: (error: string, accumulatedContent: string) => void,
    ) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      timeoutRef.current = setTimeout(() => {
        controller.abort();
        updateMessage(assistantMsgId, { status: 'error', error: '请求超时，请重试' });
        setIsGenerating(false);
      }, REQUEST_TIMEOUT);

      let accumulatedContent = '';

      llmService.streamChat(
        config,
        contextMessages,
        {
          onChunk: (text: string) => {
            accumulatedContent += text;
            appendStreamChunk(assistantMsgId, text);
          },
          onDone: () => {
            cleanupStream();
            onStreamDone(accumulatedContent);
          },
          onError: (error: string) => {
            cleanupStream();
            onStreamError(error, accumulatedContent);
          },
        },
        controller.signal,
      );
    },
    [updateMessage, setIsGenerating, appendStreamChunk, cleanupStream],
  );

  const stopStream = useCallback(
    (messages: DisplayMessage[], onStopped: (msgId: string, hasContent: boolean) => void) => {
      cleanupStream();
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.status === 'loading');
      if (lastAssistantMsg) {
        onStopped(lastAssistantMsg.id, !!lastAssistantMsg.content);
      }
      setIsGenerating(false);
    },
    [cleanupStream, setIsGenerating],
  );

  return {
    startStream,
    stopStream,
    cleanupStream,
  };
}
