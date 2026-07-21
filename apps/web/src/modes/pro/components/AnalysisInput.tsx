import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, Mic, Square } from 'lucide-react';
import type { ChatStatus } from '../../../types/tdesign';
import { TaskInputMoreMenu } from '../../task/components/TaskInputMoreMenu';
// 复用任务模式输入区样式（发送按钮 / 更多工具 / 宽高 / 图标等保持一致）
import '../../task/task.css';

interface Props {
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function AnalysisInput({ status, onSend, onStop }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // 自动增高：与 TaskMode 输入区一致的多行展开体验
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 200;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, isStreaming, adjustHeight]);

  return (
    <div className="pro-input-area">
      <div className="pro-input-inner">
        <div className="task-input-card">
          <textarea
            ref={textareaRef}
            className="task-input-text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述分析需求... Enter 发送，Shift+Enter 换行"
            rows={1}
            disabled={isStreaming}
            aria-label="分析输入框"
          />
          <div className="task-input-toolbar">
            <div className="task-input-toolbar-left">
              <TaskInputMoreMenu />
            </div>
            <div className="task-input-toolbar-right">
              <button
                type="button"
                className="task-input-toolbar-btn"
                aria-label="语音输入"
                title="语音输入即将上线"
                disabled
              >
                <Mic className="h-5 w-5" strokeWidth={1.8} />
              </button>
              {isStreaming ? (
                <button
                  type="button"
                  className="task-input-send-btn task-input-send-btn--stop"
                  onClick={onStop}
                  aria-label="停止"
                >
                  <Square className="h-4 w-4" strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  type="button"
                  className="task-input-send-btn"
                  onClick={handleSend}
                  disabled={!value.trim()}
                  aria-label="发送"
                >
                  <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
