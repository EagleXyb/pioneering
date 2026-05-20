import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { useChatSession } from './hooks';
import { MessageBubble, TypingIndicator, ChatInput } from './components';
import './index.scss';

export default function Chat() {
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
  const scrollRef = useRef<any>(null);

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
      <View className='onboarding'>
        <Text className='onboarding-icon'>🧭</Text>
        <Text className='onboarding-title'>每个人心里都有{'\n'}一个「想做的事」</Text>
        <Text className='onboarding-subtitle'>只是还没想清楚。{'\n'}我来帮你找到它。</Text>
        <View className='onboarding-btn' onClick={startChat}>
          <Text>开始探索</Text>
        </View>
      </View>
    );
  }

  return (
    <View className='chat-page'>
      {/* 头部 */}
      <View className='chat-header'>
        <View className='chat-header-left'>
          <View className='chat-avatar'>
            <Text>🧭</Text>
          </View>
          <View className='chat-header-info'>
            <Text className='chat-name'>创路伙伴</Text>
            <Text className='chat-phase'>{phaseName}</Text>
          </View>
        </View>
        <View className='chat-header-right' onClick={resetChat}>
          <Text>↻</Text>
        </View>
      </View>

      {/* 阶段进度 */}
      <View className='phase-progress'>
        {[0, 1, 2, 3, 4].map((i) => (
          <View
            key={i}
            className={`phase-dot ${i < currentPhase ? 'phase-dot-done' : ''} ${i === currentPhase ? 'phase-dot-active' : ''}`}
          />
        ))}
        <Text className='phase-label'>{phaseLabel}</Text>
      </View>

      {/* 消息列表 */}
      <ScrollView
        ref={scrollRef}
        className='chat-messages'
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
