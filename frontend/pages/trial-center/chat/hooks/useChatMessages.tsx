import React, { useState, useCallback, useRef } from 'react';
import type { DisplayMessage } from '../../types';
import { UserMessage, AssistantMessage, SystemMessage } from '../components/ChatMessage';

const FEEDBACK_KEY = 'iac_trial_feedback';

function loadFeedbackSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    if (!raw) return new Set();
    const data = JSON.parse(raw);
    return new Set(data[key] || []);
  } catch {
    return new Set();
  }
}

function persistFeedback(liked: Set<string>, disliked: Set<string>) {
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({
      liked: Array.from(liked),
      disliked: Array.from(disliked),
    }));
  } catch {}
}

export function useChatMessages(messages: DisplayMessage[]) {
  const [showThinkingFor, setShowThinkingFor] = useState<Set<string>>(new Set());
  const [likedMessages, setLikedMessages] = useState<Set<string>>(() => loadFeedbackSet('liked'));
  const [dislikedMessages, setDislikedMessages] = useState<Set<string>>(() => loadFeedbackSet('disliked'));
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });

  const likedRef = useRef(likedMessages);
  likedRef.current = likedMessages;
  const dislikedRef = useRef(dislikedMessages);
  dislikedRef.current = dislikedMessages;

  const showToast = useCallback((message: string) => {
    setToast({ show: true, message });
    setTimeout(() => { setToast({ show: false, message: '' }); }, 2000);
  }, []);

  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      showToast('复制成功');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('复制成功');
    }
  }, [showToast]);

  const handleForward = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    const content = msg.answerContent || msg.content;
    if (navigator.share) {
      navigator.share({ title: 'IAC Incubator', text: content }).catch(() => {});
    } else {
      navigator.clipboard.writeText(content).then(() => showToast('链接已复制，可粘贴转发')).catch(() => showToast('转发失败'));
    }
  }, [messages, showToast]);

  const toggleThinkingDisplay = useCallback((messageId: string) => {
    setShowThinkingFor(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) newSet.delete(messageId);
      else newSet.add(messageId);
      return newSet;
    });
  }, []);

  const toggleLike = useCallback((messageId: string) => {
    setLikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) newSet.delete(messageId);
      else {
        newSet.add(messageId);
        setDislikedMessages(p => { const s = new Set(p); s.delete(messageId); return s; });
      }
      persistFeedback(newSet, dislikedRef.current);
      return newSet;
    });
  }, []);

  const toggleDislike = useCallback((messageId: string) => {
    setDislikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) newSet.delete(messageId);
      else {
        newSet.add(messageId);
        setLikedMessages(p => { const s = new Set(p); s.delete(messageId); return s; });
      }
      persistFeedback(likedRef.current, newSet);
      return newSet;
    });
  }, []);

  const renderMessageContent = useCallback((message: DisplayMessage, onRetry: (msgId: string) => void) => {
    if (message.role === 'system') return <SystemMessage message={message} />;
    if (message.role === 'user') return <UserMessage message={message} />;
    return (
      <AssistantMessage
        message={message}
        showThinking={showThinkingFor.has(message.id)}
        isLiked={likedMessages.has(message.id)}
        isDisliked={dislikedMessages.has(message.id)}
        onToggleThinking={() => toggleThinkingDisplay(message.id)}
        onToggleLike={() => toggleLike(message.id)}
        onToggleDislike={() => toggleDislike(message.id)}
        onCopy={handleCopyMessage}
        onRetry={onRetry}
        onForward={handleForward}
      />
    );
  }, [showThinkingFor, likedMessages, dislikedMessages, toggleThinkingDisplay, toggleLike, toggleDislike, handleCopyMessage, handleForward]);

  return {
    toast,
    showToast,
    renderMessageContent,
  };
}
