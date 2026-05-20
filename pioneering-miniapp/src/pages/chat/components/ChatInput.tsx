import { View, Input } from '@tarojs/components';
import './ChatInput.scss';

interface ChatInputProps {
  value: string;
  onChange: (val: string) => void;
  onSend: () => void;
  disabled?: boolean;
  quickReplies: string[];
  onSelectQuickReply: (text: string) => void;
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  quickReplies,
  onSelectQuickReply,
}: ChatInputProps) {
  return (
    <>
      {quickReplies.length > 0 && (
        <View className='quick-replies'>
          {quickReplies.map((text, i) => (
            <View
              key={i}
              className={`quick-reply-btn ${text === '✍️ 我想自己说' ? 'quick-reply-free' : ''}`}
              onClick={() => onSelectQuickReply(text)}
            >
              {text}
            </View>
          ))}
        </View>
      )}
      <View className='chat-input-bar'>
        <Input
          className='chat-input'
          value={value}
          onInput={(e) => onChange(e.detail.value)}
          placeholder='也可以直接打字...'
          confirmType='send'
          onConfirm={onSend}
          disabled={disabled}
        />
        <View
          className={`chat-send ${!value.trim() || disabled ? 'chat-send-disabled' : ''}`}
          onClick={value.trim() && !disabled ? onSend : undefined}
        >
          ↑
        </View>
      </View>
    </>
  );
}
