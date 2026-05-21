import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Taro from '@tarojs/taro';
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
  const navbarStyle = useMemo(() => {
    try {
      const sys = Taro.getSystemInfoSync();
      const menu = Taro.getMenuButtonBoundingClientRect();
      const statusBarHeight = sys.statusBarHeight || 44;
      const contentHeight = 2 * (menu.top - statusBarHeight) + menu.height;
      return {
        paddingTop: `${statusBarHeight}px`,
        height: `${contentHeight}px`,
      };
    } catch {
      return { paddingTop: '44px', height: '48px' };
    }
  }, []);

  return (
    <View className={styles.chatPage}>
      <View
        className={styles.navActions}
        style={navbarStyle}
      >
        <View
          className={styles.navBtn}
          onClick={() => setDrawerVisible(true)}
        >
          <t-icon name="view-list" size="44rpx" />
        </View>
        <View
          className={styles.navBtn}
          onClick={handleNewChat}
        >
          <t-icon name="add" size="44rpx" />
        </View>
      </View>

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
        <t-chat-sender
          value={inputValue}
          placeholder="你有什么想知道的，快来问我"
          disabled={isLoading}
          loading={isLoading}
          renderPresets={[{ name: 'send', type: 'icon' }]}
          onInput={handleSenderChange}
          onSend={handleSenderSend}
        />
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
