import { useState } from 'react';
import { ChatSender } from '@tdesign-react/chat';
import type { ChatStatus } from 'tdesign-web-components/lib/chat-engine';

interface Props {
  status: ChatStatus;
  value: string;
  onChange: (val: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function ChatInput({ status, value, onChange, onSend, onStop }: Props) {
  const [deepThinking, setDeepThinking] = useState(false);
  const [webSearch, setWebSearch] = useState(false);

  // 输入变化处理
  const handleChange = (e: CustomEvent<string>) => {
    onChange(e.detail);
  };

  // 发送处理
  const handleSend = () => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    onChange('');
  };

  // 停止处理
  const handleStop = () => {
    onStop();
  };

  return (
    <div className="chat-input-area">
      <div className="chat-input-mode-tag">帮我写作</div>
      <ChatSender
        value={value}
        placeholder="输入你要撰写的主题"
        loading={status === 'streaming' || status === 'pending'}
        autosize={{ minRows: 2 }}
        onChange={handleChange}
        onSend={handleSend}
        onStop={handleStop}
      >
        <button className="chat-attach-btn" title="附件">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9.5 11.5l-4-4a2.12 2.12 0 010-3 2.12 2.12 0 013 0l5 5a3.54 3.54 0 010-5 3.54 3.54 0 00-5 0L3 10"/>
          </svg>
        </button>
        <button
          className={`chat-deep-think-btn ${deepThinking ? 'active' : ''}`}
          onClick={() => setDeepThinking(!deepThinking)}
        >
          R1.深度思考
        </button>
        <button
          className={`chat-web-search-btn ${webSearch ? 'active' : ''}`}
          onClick={() => setWebSearch(!webSearch)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
          </svg>
          联网查询
        </button>
      </ChatSender>
    </div>
  );
}
