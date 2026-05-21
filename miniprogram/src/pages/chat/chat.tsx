import { useState, useEffect, useCallback, useRef } from 'react';
import { View, ScrollView } from '@tarojs/components';
import { useAppStore, type SessionItem } from '@/store';
import { chatApi } from '@/services';
import ChatMessage from '@/components/chat-message';
import EmptyState from '@/components/empty-state';
import LoadingDots from '@/components/loading-dots';
import SessionList from '@/components/session-list';
import styles from './chat.module.scss';

interface Message {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: number;
}

export default function Chat() {
  const sessionId = useRef('');
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setCurrentSessionId = useAppStore((s) => s.setCurrentSessionId);
  const updateSession = useAppStore((s) => s.updateSession);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scrollInto, setScrollInto] = useState('');
  const [drawerVisible, setDrawerVisible] = useState(false);

  useEffect(() => {
    const sid = currentSessionId;
    if (sid) {
      sessionId.current = sid;
    }
  }, [currentSessionId]);

  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';
  useEffect(() => {
    if (lastMsgId) {
      setTimeout(() => setScrollInto(`msg-${lastMsgId}`), 50);
    }
  }, [lastMsgId, isLoading]);

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleNewChat = useCallback(() => {
    const newSession: SessionItem = {
      id: `session_${Date.now()}`,
      title: '新的对话',
      preview: '开始一段全新的对话...',
      updatedAt: Date.now(),
    };
    addSession(newSession);
    setCurrentSessionId(newSession.id);
    sessionId.current = newSession.id;
    setMessages([]);
    setDrawerVisible(false);
  }, [addSession, setCurrentSessionId]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    if (!sessionId.current) {
      handleNewChat();
    }

    const userMsg: Message = {
      id: `user_${Date.now()}`,
      content: text,
      isUser: true,
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    setInputValue('');
    setIsLoading(true);

    try {
      const res = await chatApi.sendMessage({
        sessionId: sessionId.current,
        content: text,
      });
      const aiMsg: Message = {
        id: `ai_${Date.now()}`,
        content: res.message.content,
        isUser: false,
        timestamp: Date.now(),
      };
      addMessage(aiMsg);
      updateSession(sessionId.current, {
        preview: text.slice(0, 20),
        updatedAt: Date.now(),
      });
    } catch {
      addMessage({
        id: `err_${Date.now()}`,
        content: '发送失败，请重试',
        isUser: false,
        timestamp: Date.now(),
      });
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, addMessage, updateSession, handleNewChat]);

  const handleSenderChange = useCallback((e: any) => {
    setInputValue(e.detail?.value ?? '');
  }, []);

  const handleSenderSend = useCallback(() => {
    handleSend();
  }, [handleSend]);

  const handleSwitchSession = useCallback((id: string) => {
    setCurrentSessionId(id);
    sessionId.current = id;
    setMessages([]);
    setDrawerVisible(false);
  }, [setCurrentSessionId]);

  const handleDeleteSession = useCallback((id: string) => {
    removeSession(id);
    if (id === sessionId.current) {
      sessionId.current = '';
      setCurrentSessionId('');
      setMessages([]);
    }
  }, [removeSession, setCurrentSessionId]);

  const handleDrawerVisibleChange = useCallback((e: any) => {
    setDrawerVisible(e.detail?.visible ?? false);
  }, []);

  const hasActiveSession = !!sessionId.current;

  return (
    <View className={styles.chatPage}>
      {/* TDesign 导航栏：左侧放置菜单按钮和新建对话按钮 */}
      <t-navbar fixed placeholder safeAreaInsetTop leftArrow={false}>
        <View slot="left" className={styles.navActions}>
          <View
            className={styles.navBtn}
            onClick={() => setDrawerVisible(true)}
          >
            ☰
          </View>
          <View
            className={styles.navBtn}
            onClick={handleNewChat}
          >
            ⊕
          </View>
        </View>
      </t-navbar>

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
            <t-button
              theme="primary"
              size="medium"
              className={styles.welcomeBtn}
              onClick={handleNewChat}
            >
              新建对话
            </t-button>
          </View>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                id={msg.id}
                content={msg.content}
                isUser={msg.isUser}
              />
            ))}
            {isLoading && <LoadingDots />}
          </>
        )}
      </ScrollView>

      {/* 底部：对话输入框 + 安全区适配 */}
      <View className={styles.chatSenderWrap}>
        <View className={styles.chatSenderInner}>
          <t-chat-sender
            value={inputValue}
            placeholder="输入消息..."
            disabled={isLoading}
            loading={isLoading}
            renderPresets={[{ name: 'send', type: 'icon' }]}
            onInput={handleSenderChange}
            onSend={handleSenderSend}
          />
        </View>
      </View>

      {/* 侧边抽屉：会话列表 */}
      <t-drawer
        visible={drawerVisible}
        placement="left"
        showOverlay
        closeOnOverlayClick
        title="会话列表"
        onVisibleChange={handleDrawerVisibleChange}
      >
        <View className={styles.drawerContent}>
          {sessions.length === 0 ? (
            <EmptyState text="暂无会话" />
          ) : (
            <SessionList
              sessions={sessions}
              activeId={sessionId.current}
              variant="full"
              onSelect={handleSwitchSession}
              onDelete={handleDeleteSession}
            />
          )}
          <View className={styles.drawerBottom}>
            <t-button
              theme="primary"
              size="medium"
              block
              onClick={handleNewChat}
            >
              + 新建对话
            </t-button>
          </View>
        </View>
      </t-drawer>
    </View>
  );
}
