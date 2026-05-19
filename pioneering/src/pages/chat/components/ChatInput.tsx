import { View, Textarea } from '@tarojs/components';
import { useState, useCallback, useRef } from 'react';
import './ChatInput.scss';

interface ChatInputProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}

export default function ChatInput({ value, disabled, onChange, onSend }: ChatInputProps) {
  const [focused, setFocused] = useState(false);
  const cursorRef = useRef(0);

  const handleInput = useCallback(
    (e: any) => {
      const val = e.detail.value;
      cursorRef.current = e.detail.cursor;
      onChange(val);
    },
    [onChange],
  );

  const handleConfirm = useCallback(() => {
    if (!disabled && value.trim()) onSend();
  }, [value, disabled, onSend]);

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <View className="chat-input-wrap">
      <View className={`chat-input-bar${focused ? ' focused' : ''}`}>
        <View className="chat-input-plus">+</View>
        <Textarea
          className="chat-input-textarea"
          value={value}
          placeholder="输入你的创意想法..."
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onConfirm={handleConfirm}
          autoHeight
          maxlength={5000}
          adjustPosition
          cursorSpacing={20}
          showConfirmBar={false}
        />
        <View
          className={`chat-input-send${!canSend ? ' disabled' : ''}`}
          onClick={canSend ? onSend : undefined}
        >
          ↑
        </View>
      </View>
      <View className="chat-input-tools">
        <View className="chat-input-tool">📎 图片</View>
        <View className="chat-input-tool">📷 拍照</View>
        <View className="chat-input-tool">📄 文件</View>
      </View>
    </View>
  );
}
