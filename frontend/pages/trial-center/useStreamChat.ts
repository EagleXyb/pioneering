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

/**
 * 检查 <think 标签是否完整（以 > 或空格+属性+> 结尾）
 * 避免误匹配 <thinkers> 等非思考标签
 */
function isOpenThinkTag(text: string, tagStartIdx: number): boolean {
  const after = text.slice(tagStartIdx + THINK_OPEN.length);
  return /^(>|\/>| )/.test(after);
}

/**
 * 跳过 <think...> 开始标签，返回标签结束后的起始索引
 */
function skipOpenTag(text: string, tagStartIdx: number): number {
  const gtIdx = text.indexOf('>', tagStartIdx + THINK_OPEN.length);
  if (gtIdx !== -1) {
    return gtIdx + 1;
  }
  return tagStartIdx + THINK_OPEN.length;
}

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
  // 标记流是否已由本层处理完成（正常完成/超时/停止），防止 llmService 的回调重复处理
  const completedRef = useRef(false);

  const processStreamChunk = useCallback(
    (id: string, text: string, type?: 'thinking' | 'answer') => {
      // 流已结束，忽略迟到的 chunk
      if (completedRef.current) return;

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
          // pendingThinkTag 包含 <think...> 开标签，需跳过
          const contentStart = skipOpenTag(state.pendingThinkTag, 0);
          state.thinkBuffer += state.pendingThinkTag.slice(contentStart, closeIdx);
          state.inThinkBlock = false;
          remaining = state.pendingThinkTag.slice(closeIdx + THINK_CLOSE.length);
          state.pendingThinkTag = '';
        } else if (state.pendingThinkTag.length > 10) {
          // 超时回退：跳过 <think...> 开标签后取内容
          const contentStart = skipOpenTag(state.pendingThinkTag, 0);
          state.thinkBuffer += state.pendingThinkTag.slice(contentStart);
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
          if (openIdx !== -1 && isOpenThinkTag(remaining, openIdx)) {
            state.answerBuffer += remaining.slice(0, openIdx);
            remaining = remaining.slice(openIdx);

            const closeIdx = remaining.indexOf(THINK_CLOSE);
            if (closeIdx !== -1) {
              const contentStart = skipOpenTag(remaining, 0);
              state.thinkBuffer += remaining.slice(contentStart, closeIdx);
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
    // 先中断 fetch 请求，防止后续 chunk 回调
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
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
      completedRef.current = false;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      timeoutRef.current = setTimeout(() => {
        // 标记已由超时处理，阻止 onDone/onError 重复处理
        completedRef.current = true;
        cleanupStream();
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
            // 流已被超时/停止处理，忽略迟到的 onDone
            if (completedRef.current) return;
            completedRef.current = true;

            const { answerBuffer, thinkBuffer } = stateRef.current;
            cleanupStream();
            onStreamDone(
              answerBuffer || thinkBuffer,
              thinkBuffer,
              answerBuffer,
            );
          },
          onError: (error: string) => {
            // 流已被超时/停止处理，忽略迟到的 onError
            if (completedRef.current) return;
            completedRef.current = true;

            const { answerBuffer } = stateRef.current;
            cleanupStream();
            onStreamError(error, answerBuffer);
          },
        },
        controller.signal,
      );
    },
    [updateMessage, setIsGenerating, processStreamChunk, cleanupStream],
  );

  const stopStream = useCallback(
    (messages: DisplayMessage[], onStopped: (msgId: string, hasContent: boolean) => void) => {
      // 标记已由停止处理，阻止 onDone/onError 重复处理
      completedRef.current = true;
      cleanupStream();
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.status === 'loading');
      if (lastAssistantMsg) {
        const hasContent = !!(lastAssistantMsg.answerContent || lastAssistantMsg.thinkingContent || lastAssistantMsg.content);
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
