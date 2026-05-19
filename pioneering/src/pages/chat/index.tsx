import { View, Text, ScrollView } from '@tarojs/components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@tarojs/taro';
import { useChatSession } from './hooks';
import { MessageBubble, ChatInput } from './components';
import { AGENT_MODE_LABELS } from '@/constants';
import Loading from '@/components/Loading';
import './index.scss';

const SUGGESTIONS = [
  '为我的SaaS产品想5个增长策略',
  '分析短视频赛道的创新机会',
  '帮我设计一个用户激励体系',
  '评估AI在教育领域的应用前景',
];

export default function Chat() {
  const router = useRouter();
  const initialMode = (router.params as any)?.mode || 'brainstorm';

  const { messages, isSending, mode, setMode, sendMessage, stopGenerate, retry } =
    useChatSession(initialMode);

  const [inputValue, setInputValue] = useState('');
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollViewRef = useRef<any>(null);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollIntoView?.();
    }, 50);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  const onScroll = useCallback((e: any) => {
    const { scrollTop, scrollHeight, clientHeight } = e.detail;
    const distance = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distance < 60;
    setShowScrollBottom(distance > 200);
  }, []);

  const onSend = useCallback(() => {
    const val = inputValue.trim();
    if (!val || isSending) return;
    setInputValue('');
    sendMessage(val);
  }, [inputValue, isSending, sendMessage]);

  const onSuggestionTap = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  return (
    <View className="chat-page">
      {/* Top mode bar */}
      <View className="chat-mode-bar">
        <View className="chat-mode-tag">
          {AGENT_MODE_LABELS[mode]}
          <Text className="chat-mode-arrow">▸</Text>
        </View>
        <View className="chat-model-select">DeepSeek V4</View>
      </View>

      {/* Messages */}
      <ScrollView
        className="chat-content"
        scrollY
        scrollWithAnimation
        onScroll={onScroll}
        enableBackToTop
      >
        {messages.length === 0 ? (
          <View className="chat-empty">
            <View className="chat-empty-icon">💡</View>
            <View className="chat-empty-title">开始你的创意探索</View>
            <View className="chat-empty-desc">
              我是你的 AI 创意孵化助手，可以帮你头脑风暴、深度分析、
              生成方案或评估决策。告诉我你想探索什么？
            </View>
            <View className="chat-empty-prompts">
              {SUGGESTIONS.map((s, i) => (
                <View
                  key={i}
                  className="chat-empty-prompt"
                  onClick={() => onSuggestionTap(s)}
                >
                  {s}
                </View>
              ))}
            </View>
          </View>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onRetry={() => retry(msg.id)}
            />
          ))
        )}
        <View ref={scrollViewRef} style={{ height: '1rpx' }} />
      </ScrollView>

      {showScrollBottom && messages.length > 0 && (
        <View className="chat-scroll-bottom" onClick={scrollToBottom}>
          ↓
        </View>
      )}

      <ChatInput
        value={inputValue}
        disabled={isSending}
        onChange={setInputValue}
        onSend={isSending ? stopGenerate : onSend}
      />
    </View>
  );
}
