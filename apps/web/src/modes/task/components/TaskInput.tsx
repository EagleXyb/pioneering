import React, { useState, useCallback } from 'react';
import type { ChatStatus } from 'tdesign-web-components/lib/chat-engine';

interface Props {
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function TaskInput({ status, onSend, onStop }: Props) {
  const [value, setValue] = useState('');

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue('');
  }, [value, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const isStreaming = status === 'streaming' || status === 'pending';

  return (
    <div className="task-input-area">
      <div className="task-input-inner">
        <textarea
          className="task-input-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述任务需求... Enter 发送，Shift+Enter 换行"
          rows={1}
          disabled={isStreaming}
        />
        <div className="task-input-actions">
          {isStreaming ? (
            <button className="task-input-btn task-input-btn-stop" onClick={onStop}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="2" width="10" height="10" rx="1"/>
              </svg>
              停止
            </button>
          ) : (
            <button
              className="task-input-btn task-input-btn-send"
              onClick={handleSend}
              disabled={!value.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2L2 7l4 2 8-7-4 8 4 4z"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}