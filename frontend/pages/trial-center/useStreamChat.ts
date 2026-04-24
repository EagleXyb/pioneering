import { useRef, useCallback } from 'react';
import type { DisplayMessage } from './types';
import { REQUEST_TIMEOUT } from './types';
import llmService, { type ChatMessage } from '../../services/llmService';

interface StreamState {
  inThinkBlock: boolean;
  thinkBuffer: string;
  answerBuffer: string;
  pendingThinkTag: string;
}

const THINK_OPEN = '<think';
const THINK_CLOSE = '</think>';

function createInitialState(): StreamState {
  return {
    inThinkBlock: false,
    thinkBuffer: '',
    answerBuffer: '',
    pendingThinkTag: '',
  };
}

export function useStreamChat(
  updateMessage: (id: string, updates: Partial<DisplayMessage>) => void,
  setIsGenerating: (v: boolean) => void,
) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<StreamState>(createInitialState());

  const processStreamChunk = useCallback(
    (id: string, text: string, type?: 'thinking' | 'answer') => {
      const state = stateRef.current;

      if (type === 'thinking') {
        state.thinkBuffer += text;
        updateMessage(id, {
          thinkingContent: state.thinkBuffer,
          answerContent: state.answerBuffer,
          content: state.answerBuffer,
          status: 'loading',
        });
        return;
      }

      if (type === 'answer') {
        state.answerBuffer += text;
        updateMessage(id, {
          thinkingContent: state.thinkBuffer,
          answerContent: state.answerBuffer,
          content: state.answerBuffer,
          status: 'loading',
        });
        return;
      }

      let remaining = text;

      if (state.pendingThinkTag) {
        state.pendingThinkTag += remaining;
        if (state.pendingThinkTag.includes(THINK_CLOSE)) {
          const closeIdx = state.pendingThinkTag.indexOf(THINK_CLOSE);
          state.thinkBuffer += state.pendingThinkTag.slice(0, closeIdx);
          state.inThinkBlock = false;
          remaining = state.pendingThinkTag.slice(closeIdx + THINK_CLOSE.length);
          state.pendingThinkTag = '';
        } else if (state.pendingThinkTag.length > 10) {
          state.thinkBuffer += state.pendingThinkTag;
          state.inThinkBlock = true;
          state.pendingThinkTag = '';
        } else {
          return;
        }
      }

      while (remaining.length > 0) {
        if (state.inThinkBlock) {
          const closeIdx = remaining.indexOf(THINK_CLOSE);
          if (closeIdx !== -1) {
            state.thinkBuffer += remaining.slice(0, closeIdx);
            remaining = remaining.slice(closeIdx + THINK_CLOSE.length);
            state.inThinkBlock = false;
          } else {
            state.thinkBuffer += remaining;
            remaining = '';
          }
        } else {
          const openIdx = remaining.indexOf(THINK_OPEN);
          if (openIdx !== -1) {
            state.answerBuffer += remaining.slice(0, openIdx);
            remaining = remaining.slice(openIdx);

            const closeIdx = remaining.indexOf(THINK_CLOSE);
            if (closeIdx !== -1) {
              state.thinkBuffer += remaining.slice(0, closeIdx);
              remaining = remaining.slice(closeIdx + THINK_CLOSE.length);
            } else {
              state.pendingThinkTag = remaining;
              state.inThinkBlock = true;
              remaining = '';
            }
          } else {
            state.answerBuffer += remaining;
            remaining = '';
          }
        }
      }

      updateMessage(id, {
        thinkingContent: state.thinkBuffer,
        answerContent: state.answerBuffer,
        content: state.answerBuffer,
        status: 'loading',
      });
    },
    [updateMessage],
  );

  const cleanupStream = useCallback(() => {
    stateRef.current = createInitialState();
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
      onStreamDone: (accumulatedContent: string, thinkingContent: string, answerContent: string) => void,
      onStreamError: (error: string, accumulatedContent: string) => void,
    ) => {
      stateRef.current = createInitialState();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      timeoutRef.current = setTimeout(() => {
        controller.abort();
        updateMessage(assistantMsgId, { status: 'error', error: '请求超时，请重试' });
        setIsGenerating(false);
      }, REQUEST_TIMEOUT);

      llmService.streamChat(
        config,
        contextMessages,
        {
          onChunk: (text: string, type?: 'thinking' | 'answer') => {
            processStreamChunk(assistantMsgId, text, type);
          },
          onDone: () => {
            cleanupStream();
            onStreamDone(
              stateRef.current.answerBuffer || stateRef.current.thinkBuffer,
              stateRef.current.thinkBuffer,
              stateRef.current.answerBuffer,
            );
          },
          onError: (error: string) => {
            cleanupStream();
            onStreamError(error, stateRef.current.answerBuffer);
          },
        },
        controller.signal,
      );
    },
    [updateMessage, setIsGenerating, processStreamChunk, cleanupStream],
  );

  const stopStream = useCallback(
    (messages: DisplayMessage[], onStopped: (msgId: string, hasContent: boolean) => void) => {
      cleanupStream();
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.status === 'loading');
      if (lastAssistantMsg) {
        const hasContent = !!(lastAssistantMsg.answerContent || lastAssistantMsg.content);
        onStopped(lastAssistantMsg.id, hasContent);
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
