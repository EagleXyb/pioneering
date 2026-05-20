import { View } from '@tarojs/components';
import styles from './ChatInput.module.scss';

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
        <View className={styles['quick-replies']}>
          {quickReplies.map((text, i) => (
            <View
              key={i}
              className={`${styles['quick-reply-btn']} ${text === '✍️ 我想自己说' ? styles['quick-reply-free'] : ''}`}
              onClick={() => onSelectQuickReply(text)}
            >
              {text}
            </View>
          ))}
        </View>
      )}
      <View className={styles['chat-input-bar']}>
        <t-input
          class={styles['chat-input']}
          value={value}
          onChange={(e: { detail: { value: string } }) => onChange(e.detail.value)}
          placeholder='也可以直接打字...'
          type='text'
          disabled={disabled}
        />
        <t-button
          theme='primary'
          size='small'
          icon='send'
          disabled={!value.trim() || disabled}
          onClick={onSend}
        >
          发送
        </t-button>
      </View>
    </>
  );
}
