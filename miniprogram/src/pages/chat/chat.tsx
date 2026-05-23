import { useState, useEffect, useCallback } from 'react';
import { View, ScrollView } from '@tarojs/components';
import ChatMessageComponent from '@/components/chat-message';
import EmptyState from '@/components/empty-state';
import LoadingDots from '@/components/loading-dots';
import ChatNavBar from './components/ChatNavBar';
import ChatInputArea from './components/ChatInputArea';
import SessionDrawer from './components/SessionDrawer';
import { useChatLogic } from './hooks/useChatLogic';
import { useKeyboardHeight } from './hooks/useKeyboardHeight';
import styles from './chat.module.scss';

export default function Chat() {
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [scrollInto, setScrollInto] = useState('');

  const {
    currentSessionId,
    sessions,
    messages,
    chatPhase,
    inputValue,
    deepThinkActive,
    netSearchActive,
    isBusy,
    hasActiveSession,
    setInputValue,
    handleNewChat,
    handleSend,
    handleStop,
    handleRegenerate,
    handleSwitchSession,
    handleDeleteSession,
    handleDeepThinkTap,
    handleNetSearchTap,
    handleInputFocus,
  } = useChatLogic();

  const { bottomAreaStyle } = useKeyboardHeight();

  // 自动滚动到底部
  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';
  useEffect(() => {
    if (lastMsgId) {
      setTimeout(() => setScrollInto(`msg-${lastMsgId}`), 50);
    }
  }, [lastMsgId]);

  const handleDrawerVisibleChange = useCallback((e: any) => {
    setDrawerVisible(e.detail?.visible ?? false);
  }, []);

  const handleOpenDrawer = useCallback(() => {
    setDrawerVisible(true);
  }, []);

  const handleNewChatWithDrawer = useCallback(() => {
    handleNewChat();
    setDrawerVisible(false);
  }, [handleNewChat]);

  const handleSwitchSessionWithDrawer = useCallback(
    (id: string) => {
      handleSwitchSession(id);
      setDrawerVisible(false);
    },
    [handleSwitchSession],
  );

  return (
    <View className={styles.chatPage}>
      {/* 导航栏 */}
      <ChatNavBar onOpenDrawer={handleOpenDrawer} onNewChat={handleNewChatWithDrawer} />
      <t-navbar title="元宝" fixed />

      {/* 中部：可滚动内容区 */}
      <ScrollView
        className={styles.chatMessages}
        scrollY
        scrollIntoView={scrollInto}
        scrollWithAnimation
        enhanced
        showScrollbar={false}
      >
        {!hasActiveSession && messages.length === 0 ? (
          <View className={styles.welcome}>
            <EmptyState text="开始一段新的探索吧" />
          </View>
        ) : (
          <>
            {messages.map((msg) => (
              <View key={msg.id} id={`msg-${msg.id}`}>
                <ChatMessageComponent
                  content={msg.content}
                  thinkingContent={msg.thinkingContent}
                  isUser={msg.isUser}
                  status={msg.status}
                  error={msg.error}
                  onRegenerate={
                    !msg.isUser ? () => handleRegenerate(msg.id) : undefined
                  }
                />
              </View>
            ))}

            {/* ChatLoading：思考阶段显示 */}
            {chatPhase === 'thinking' && !messages.some((m) => !m.isUser && m.status === 'streaming') && (
              <LoadingDots />
            )}
          </>
        )}
      </ScrollView>

      {/* 底部：对话输入区域 */}
      <ChatInputArea
        inputValue={inputValue}
        isBusy={isBusy}
        deepThinkActive={deepThinkActive}
        netSearchActive={netSearchActive}
        bottomAreaStyle={bottomAreaStyle}
        onInputChange={setInputValue}
        onSend={handleSend}
        onStop={handleStop}
        onDeepThinkTap={handleDeepThinkTap}
        onNetSearchTap={handleNetSearchTap}
        onInputFocus={handleInputFocus}
        onInputBlur={() => {}}
        onLineChange={() => {}}
      />

      {/* 侧边抽屉：会话列表 */}
      <SessionDrawer
        visible={drawerVisible}
        sessions={sessions}
        activeId={currentSessionId}
        onVisibleChange={handleDrawerVisibleChange}
        onSelectSession={handleSwitchSessionWithDrawer}
        onDeleteSession={handleDeleteSession}
        onNewChat={handleNewChatWithDrawer}
      />
    </View>
  );
}
