import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { useChatSession } from './hooks';
import { MessageBubble, TypingIndicator, ChatInput } from './components';
import { requireAuth } from '@/services/auth';
import styles from './index.module.scss';

export default function Chat() {
  // AI 模式需要登录态
  useEffect(() => {
    requireAuth();
  }, []);
  const {
    messages,
    currentPhase,
    isTyping,
    quickReplies,
    started,
    phaseName,
    phaseLabel,
    startChat,
    selectQuickReply,
    sendMessage,
    acceptInsight,
    reviseInsight,
    selectAction,
    resetChat,
  } = useChatSession();

  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<{ scrollTo?: (options: { top: number; behavior?: string }) => void }>(null);

  // 消息变化时自动滚动到底部
  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo?.({ top: 999999, behavior: 'smooth' });
    }, 100);
  }, [messages.length, isTyping]);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    sendMessage(inputValue);
    setInputValue('');
  };

  // Onboarding 页面
  if (!started) {
    return (
      <View className={styles.onboarding}>
        <Text className={styles['onboarding-icon']}>🧭</Text>
        <Text className={styles['onboarding-title']}>每个人心里都有{'\n'}一个「想做的事」</Text>
        <Text className={styles['onboarding-subtitle']}>只是还没想清楚。{'\n'}我来帮你找到它。</Text>
        <t-button
          theme='default'
          size='large'
          onClick={startChat}
        >
          开始探索
        </t-button>
      </View>
    );
  }

  return (
    <View className={styles['chat-page']}>
      {/* 头部 */}
      <View className={styles['chat-header']}>
        <View className={styles['chat-header-left']}>
          <View className={styles['chat-avatar']}>
            <Text>🧭</Text>
          </View>
          <View className={styles['chat-header-info']}>
            <Text className={styles['chat-name']}>创路伙伴</Text>
            <Text className={styles['chat-phase']}>{phaseName}</Text>
          </View>
        </View>
        <View className={styles['chat-header-right']} onClick={resetChat}>
          <t-icon name='refresh' size='48rpx' />
        </View>
      </View>

      {/* 阶段进度 */}
      <View className={styles['phase-progress']}>
        <t-steps
          current={currentPhase}
          layout='vertical'
          readonly
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <t-step key={i} />
          ))}
        </t-steps>
        <Text className={styles['phase-label']}>{phaseLabel}</Text>
      </View>

      {/* 消息列表 */}
      <ScrollView
        ref={scrollRef}
        className={styles['chat-messages']}
        scrollY
        scrollIntoView=''
        scrollWithAnimation
        enhanced
        showScrollbar={false}
      >
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onAcceptInsight={acceptInsight}
            onReviseInsight={reviseInsight}
            onSelectAction={selectAction}
          />
        ))}
        {isTyping && <TypingIndicator />}
      </ScrollView>

      {/* 输入区 */}
      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        disabled={isTyping}
        quickReplies={quickReplies}
        onSelectQuickReply={selectQuickReply}
      />
    </View>
  );
}
