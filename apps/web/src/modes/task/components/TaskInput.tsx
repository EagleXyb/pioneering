import React, { useState, useCallback } from 'react';
import { Send, Square } from 'lucide-react';
import type { ChatStatus } from '../../../types/tdesign';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const isStreaming = status === 'streaming' || status === 'pending';

  return (
    <div className="task-input-area">
      <div className="task-input-inner">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述任务需求... Enter 发送，Shift+Enter 换行"
          rows={1}
          disabled={isStreaming}
          className="task-input-textarea min-h-0 resize-none border-0 bg-transparent px-0 py-1 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground"
        />
        <div className="task-input-actions">
          {isStreaming ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={onStop}
              className="gap-1 rounded-md"
            >
              <Square className="h-3 w-3 fill-current" />
              停止
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!value.trim()}
              className="rounded-full"
              aria-label="发送"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
