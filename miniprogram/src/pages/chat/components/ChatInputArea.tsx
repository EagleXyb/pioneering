import { View, Text, Textarea } from '@tarojs/components';
import styles from './ChatInputArea.module.scss';

interface ChatInputAreaProps {
  inputValue: string;
  isBusy: boolean;
  deepThinkActive: boolean;
  netSearchActive: boolean;
  bottomAreaStyle: React.CSSProperties;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onDeepThinkTap: () => void;
  onNetSearchTap: () => void;
  onInputFocus: () => void;
  onInputBlur: () => void;
  onLineChange: (e: any) => void;
}

export default function ChatInputArea({
  inputValue,
  isBusy,
  deepThinkActive,
  netSearchActive,
  bottomAreaStyle,
  onInputChange,
  onSend,
  onStop,
  onDeepThinkTap,
  onNetSearchTap,
  onInputFocus,
  onInputBlur,
  onLineChange,
}: ChatInputAreaProps) {
  return (
    <View className={styles.chatBottomArea} style={bottomAreaStyle}>
      <View className={styles.inputCard}>
        <View className={styles.textareaWrap}>
          <Textarea
            className={styles.textarea}
            value={inputValue}
            placeholder="请输入消息..."
            placeholderClass={styles.placeholder}
            disabled={isBusy}
            maxlength={2000}
            autoHeight
            cursorSpacing={20}
            adjustPosition={false}
            holdKeyboard
            disableDefaultPadding={false}
            onInput={(e) => onInputChange(e.detail.value)}
            onFocus={onInputFocus}
            onBlur={onInputBlur}
            onLineChange={onLineChange}
            confirmType="send"
            onConfirm={onSend}
          />
        </View>

        <View className={styles.inputFooter}>
          <View className={styles.footerLeft}>
            <View
              className={`${styles.deepThinkBlock} ${deepThinkActive ? styles.active : ''}`}
              onClick={onDeepThinkTap}
            >
              <t-icon name="system-sum" size="36rpx" />
              <Text className={styles.deepThinkText}>深度思考</Text>
            </View>
            <View
              className={`${styles.netSearchBlock} ${netSearchActive ? styles.active : ''}`}
              onClick={onNetSearchTap}
            >
              <t-icon name="internet" size="36rpx" />
            </View>
          </View>

          {isBusy ? (
            <View className={styles.stopBtn} onClick={onStop}>
              <View className={styles.stopIcon} />
            </View>
          ) : (
            <View
              className={`${styles.sendBtn} ${inputValue.trim() ? styles.sendBtnReady : ''}`}
              onClick={onSend}
            >
              <t-icon name="chevron-up" size="40rpx" color="#fff" />
            </View>
          )}
        </View>
      </View>

      <View className={styles.aiDisclaimer}>内容由AI生成，仅供参考</View>
    </View>
  );
}
