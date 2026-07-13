import { ChatSender } from '@tdesign-react/chat';
import { Button, Space } from 'tdesign-react';
import type { ChatStatus } from '../../../types/tdesign';

interface Props {
  status: ChatStatus;
  value: string;
  onChange: (val: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  r1Active: boolean;
  onR1Change: (v: boolean) => void;
}

// P1-3 修复：联网查询后端未实现（netSearch 为空壳参数），移除按钮避免误导用户
// 保留 ChatCompletionRequest.netSearch 与后端 Schema 字段，便于未来接入搜索 API 时恢复
export function ChatInput({ status, value, onChange, onSend, onStop, r1Active, onR1Change }: Props) {

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
      <ChatSender
      value={value}
      placeholder="输入你要撰写的主题"
      loading={status === 'streaming' || status === 'pending'}
      autosize={{ minRows: 2 }}
      onChange={handleChange}
      onSend={handleSend}
      onStop={handleStop}
    >
      {/* 自定义输入框底部区域slot，可以增加模型选项 */}
      <div slot="footer-prefix">
        <Space align="center" size="small">
          <Button
            variant="outline"
            shape="round"
            theme={r1Active ? 'primary' : 'default'}
            size="small"
            onClick={() => onR1Change(!r1Active)}
          >
            R1.深度思考
          </Button>
        </Space>
      </div>
    </ChatSender>
      <div className="copyright__item">内容由AI生成，仅供参考</div>
    </div>
  );
}
