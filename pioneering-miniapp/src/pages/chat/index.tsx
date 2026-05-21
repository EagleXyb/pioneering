import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Input } from '@tarojs/components';
import { useChatSession } from './hooks';
import type { ChatMessage } from './strategy/types';
import { InsightCard, ActionCard, SessionDrawer } from './components';
import { PHASE_NAMES } from './scripts/conversation';
import { requireAuth } from '@/services/auth';
import styles from './index.module.scss';

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
  const [scrollInto, setScrollInto] = useState('');

  // 消息变化时自动滚动到底部
  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';
  useEffect(() => {
    if (lastMsgId) {
      // 用 setTimeout 确保 DOM 已更新
      setTimeout(() => setScrollInto(`msg-${lastMsgId}`), 50);
    }
  }, [lastMsgId, isTyping]);

  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isTyping) return;
    sendMessage(inputValue.trim());
    setInputValue('');
  }, [inputValue, isTyping, sendMessage]);

  const handleInput = useCallback((e: any) => {
    setInputValue(e.detail?.value ?? e?.target?.value ?? '');
  }, []);

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
            <t-step key={i} title={PHASE_NAMES[i]} />
          ))}
        </t-steps>
        <Text className={styles['phase-label']}>{phaseLabel}</Text>
      </View>

      {/* 消息列表 */}
      <ScrollView
        className={styles['chat-messages']}
        scrollY
        scrollIntoView={scrollInto}
        scrollWithAnimation
        enhanced
        showScrollbar={false}
      >
        {messages.map((msg) => (
          <View key={msg.id} id={`msg-${msg.id}`} className={styles['msg-wrap']}>
            {msg.isUser ? (
              /* 用户消息 */
              <View className={styles['msg-user']}>
                <View className={styles['msg-user-bubble']}>
                  <Text className={styles['msg-user-text']}>{msg.content}</Text>
                </View>
              </View>
            ) : msg.type === 'insight' && msg.insightData ? (
              /* AI 洞察卡片 */
              <View className={styles['msg-ai']}>
                <View className={styles['msg-ai-avatar']}>🧭</View>
                <View className={styles['msg-ai-content']}>
                  <Text className={styles['msg-ai-name']}>创路伙伴</Text>
                  <InsightCard
                    data={msg.insightData}
                    msgId={msg.id}
                    onAccept={acceptInsight}
                    onRevise={reviseInsight}
                  />
                </View>
              </View>
            ) : msg.type === 'action' && msg.actionData ? (
              /* AI 行动卡片 */
              <View className={styles['msg-ai']}>
                <View className={styles['msg-ai-avatar']}>🧭</View>
                <View className={styles['msg-ai-content']}>
                  <Text className={styles['msg-ai-name']}>创路伙伴</Text>
                  <ActionCard data={msg.actionData} onSelect={selectAction} />
                </View>
              </View>
            ) : (
              /* AI 文本消息 */
              <View className={styles['msg-ai']}>
                <View className={styles['msg-ai-avatar']}>🧭</View>
                <View className={styles['msg-ai-content']}>
                  <Text className={styles['msg-ai-name']}>创路伙伴</Text>
                  <View className={styles['msg-ai-bubble']}>
                    <Text className={styles['msg-ai-text']}>{msg.content}</Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        ))}

        {/* 打字指示器 */}
        {isTyping && (
          <View id="msg-typing" className={styles['msg-wrap']}>
            <View className={styles['msg-ai']}>
              <View className={styles['msg-ai-avatar']}>🧭</View>
              <View className={styles['msg-ai-content']}>
                <Text className={styles['msg-ai-name']}>创路伙伴</Text>
                <View className={styles['msg-ai-bubble']}>
                  <t-loading size="40rpx" />
                </View>
              </View>
            </View>
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

      {/* 输入区 - 自定义输入栏替代 t-chat-sender */}
      <View className={styles['chat-input-bar']}>
        <Input
          className={styles['chat-input']}
          value={inputValue}
          placeholder="也可以直接打字..."
          disabled={isTyping}
          confirmType="send"
          onInput={handleInput}
          onConfirm={handleSend}
        />
        <View
          className={`${styles['chat-send-btn']} ${inputValue.trim() ? styles['chat-send-active'] : ''}`}
          onClick={handleSend}
        >
          <t-icon name="send-filled" size="40rpx" />
        </View>
      </View>
    </View>
  );
}
