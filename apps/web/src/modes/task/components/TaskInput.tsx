import type { ChatStatus } from '../../../types/tdesign';
import { ArrowUp, Command, FileText, Mic, Square } from 'lucide-react';
import { useTaskInput } from '../hooks/useTaskInput';
import { TaskInputMoreMenu } from './TaskInputMoreMenu';

interface Props {
  chatId: string | null;
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * 任务模式输入框 —— Apple 极简卡片式设计
 *
 * 布局结构：
 * ┌─────────────────────────────────────────────┐
 * │  今天帮你做些什么？@引用对话文件，/调用技能与指令  │
 * │                                              │
 * │ [+] │ [⌘]                    [📄] [🎤] [↑●]  │
 * └─────────────────────────────────────────────┘
 *
 * 逻辑实现见 `../hooks/useTaskInput.ts`。
 */
export function TaskInput({ chatId, status, onSend, onStop }: Props) {
  const isStreaming = status === 'streaming' || status === 'pending';

  const {
    value,
    setValue,
    textareaRef,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
    handleSend,
    canSend,
  } = useTaskInput({ chatId, isStreaming, onSend, onStop });

  return (
    <div className="task-input-area">
      <div className="task-input-inner">
        <div className="task-input-card">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="今天帮你做些什么？@引用对话文件，/调用技能与指令"
            rows={1}
            disabled={isStreaming}
            className="task-input-text"
            aria-label="任务输入框"
          />

          <div className="task-input-toolbar">
            <div className="task-input-toolbar-left">
              <TaskInputMoreMenu />
              <span className="task-input-divider" />
              <button
                type="button"
                className="task-input-toolbar-btn"
                aria-label="命令面板"
                disabled
                title="命令面板即将上线"
              >
                <Command className="h-5 w-5" strokeWidth={1.8} />
              </button>
            </div>

            <div className="task-input-toolbar-right">
              <button
                type="button"
                className="task-input-toolbar-btn"
                aria-label="引用文档"
                disabled
                title="引用文档即将上线"
              >
                <FileText className="h-5 w-5" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="task-input-toolbar-btn"
                aria-label="语音输入"
                disabled
                title="语音输入即将上线"
              >
                <Mic className="h-5 w-5" strokeWidth={1.8} />
              </button>

              {isStreaming ? (
                <button
                  type="button"
                  className="task-input-send-btn task-input-send-btn--stop"
                  onClick={onStop}
                  aria-label="停止生成"
                >
                  <Square className="h-4 w-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  className="task-input-send-btn"
                  onClick={handleSend}
                  disabled={!canSend}
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
