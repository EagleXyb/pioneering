import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowUp, Plus, Square } from 'lucide-react';
import type { ChatStatus } from '../../../types/tdesign';
import { Button } from '@/components/ui/button';

interface Props {
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * 任务模式输入框 —— 胶囊式设计
 *
 * 布局结构：
 * ┌──────────────────────────────────────────┐
 * │ [+]  输入区域...              [↑ 发送]  │
 * └──────────────────────────────────────────┘
 *
 * 特点：
 * - 胶囊型圆角（两端完全圆形）
 * - 浅灰底色，整体视觉柔和
 * - 左侧 Plus 按钮（附件/更多操作入口）
 * - 右侧发送按钮（圆形蓝色，停止时切换为停止按钮）
 * - textarea 随内容自动增高
 */
export function TaskInput({ status, onSend, onStop }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue('');
  }, [value, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  /**
   * textarea 随内容自动增高
   * 重置 scrollHeight 以支持内容减少时高度收缩
   */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const isStreaming = status === 'streaming' || status === 'pending';
  const canSend = !isStreaming && value.trim().length > 0;

  return (
    <div className="task-input-area">
      <div className="task-input-inner">
      <div className="task-input-capsule">
        <Button
          variant="ghost"
          size="icon"
          className="task-input-plus shrink-0"
          aria-label="更多操作"
        >
          <Plus className="h-5 w-5" />
        </Button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述任务需求... Enter 发送，Shift+Enter 换行"
          rows={1}
          disabled={isStreaming}
          className="task-input-text"
        />

        <div className="task-input-actions shrink-0">
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onStop}
              className="task-input-stop"
              aria-label="停止"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!canSend}
              className="task-input-send"
              aria-label="发送"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
