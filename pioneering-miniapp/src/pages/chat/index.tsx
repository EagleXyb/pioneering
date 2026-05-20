import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, Slot } from '@tarojs/components';
import { useChatSession } from './hooks';
import type { ChatMessage } from './strategy/types';
import { InsightCard, ActionCard, SessionDrawer } from './components';
import { requireAuth } from '@/services/auth';
import styles from './index.module.scss';

/** 将 ChatMessage 转换为 t-chat-message 的 content 格式 */
function toTDesignContent(msg: ChatMessage) {
  if (msg.type === 'insight' || msg.type === 'action') {
    return [];
  }
  return [{ type: 'text' as const, data: msg.content }];
}

export default function Chat() {
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollIntoViewId = useRef('');

  // 消息变化时自动滚动到底部
  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';
  useEffect(() => {
    if (lastMsgId) {
      scrollIntoViewId.current = `msg-${lastMsgId}`;
    }
  }, [lastMsgId, isTyping]);

  const handleSend = (e: any) => {
    const text = typeof e === 'string' ? e : inputValue;
    if (!text?.trim()) return;
    sendMessage(text.trim());
    setInputValue('');
  };

  const handleSenderChange = (e: any) => {
    setInputValue(e?.detail?.value ?? e ?? '');
  };

  // Onboarding 页面
  if (!started) {
    return (
      <View className={styles.onboarding}>
        <Text className={styles['onboarding-icon']}>🧭</Text>
        <Text className={styles['onboarding-title']}>
          每个人心里都有{'\n'}一个「想做的事」
        </Text>
        <Text className={styles['onboarding-subtitle']}>
          只是还没想清楚。{'\n'}我来帮你找到它。
        </Text>
        <t-button theme="default" size="large" onClick={startChat}>
          开始探索
        </t-button>
      </View>
    );
  }

  return (
    <View className={styles['chat-page']}>
      {/* 侧边抽屉 */}
      <SessionDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* 头部 */}
      <View className={styles['chat-header']}>
        <View className={styles['chat-header-left']}>
          <View
            className={styles['chat-header-menu']}
            onClick={() => setDrawerOpen(true)}
          >
            <t-icon name="view-list" size="48rpx" />
          </View>
          <View className={styles['chat-avatar']}>
            <Text>🧭</Text>
          </View>
          <View className={styles['chat-header-info']}>
            <Text className={styles['chat-name']}>创路伙伴</Text>
            <Text className={styles['chat-phase']}>{phaseName}</Text>
          </View>
        </View>
        <View className={styles['chat-header-right']} onClick={resetChat}>
          <t-icon name="refresh" size="48rpx" />
        </View>
      </View>

      {/* 阶段进度 */}
      <View className={styles['phase-progress']}>
        <t-steps current={currentPhase} layout="vertical" readonly>
          {[0, 1, 2, 3, 4].map((i) => (
            <t-step key={i} />
          ))}
        </t-steps>
        <Text className={styles['phase-label']}>{phaseLabel}</Text>
      </View>

      {/* 消息列表 - 使用 ScrollView 保持滚动控制权 */}
      <ScrollView
        className={styles['chat-messages']}
        scrollY
        scrollIntoView={scrollIntoViewId.current}
        scrollWithAnimation
        enhanced
        showScrollbar={false}
      >
        {messages.map((msg) => (
          <View key={msg.id} id={`msg-${msg.id}`}>
            <t-chat-message
              avatar={msg.isUser ? '' : '🧭'}
              name={msg.isUser ? '我' : '创路伙伴'}
              content={toTDesignContent(msg)}
              role={msg.isUser ? 'user' : 'assistant'}
              placement={msg.isUser ? 'right' : 'left'}
              status="complete"
            >
              {msg.type === 'insight' && msg.insightData && (
                <Slot name="content">
                  <InsightCard
                    data={msg.insightData}
                    msgId={msg.id}
                    onAccept={acceptInsight}
                    onRevise={reviseInsight}
                  />
                </Slot>
              )}
              {msg.type === 'action' && msg.actionData && (
                <Slot name="content">
                  <ActionCard data={msg.actionData} onSelect={selectAction} />
                </Slot>
              )}
            </t-chat-message>
          </View>
        ))}

        {/* 打字指示器 */}
        {isTyping && (
          <View id="msg-typing">
            <t-chat-message
              avatar="🧭"
              name="创路伙伴"
              content={[]}
              role="assistant"
              status="loading"
            />
          </View>
        )}
      </ScrollView>

      {/* 快捷回复区 */}
      {quickReplies.length > 0 && (
        <View className={styles['quick-replies']}>
          {quickReplies.map((text, i) => (
            <View
              key={i}
              className={`${styles['quick-reply-btn']} ${text === '✍️ 我想自己说' ? styles['quick-reply-free'] : ''}`}
              onClick={() => selectQuickReply(text)}
            >
              {text}
            </View>
          ))}
        </View>
      )}

      {/* 输入区 - 使用 t-chat-sender */}
      <t-chat-sender
        value={inputValue}
        loading={isTyping}
        disabled={isTyping}
        autoRiseWithKeyboard
        placeholder="也可以直接打字..."
        onSend={handleSend}
        onChange={handleSenderChange}
      />
    </View>
  );
}
