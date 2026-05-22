import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Taro from '@tarojs/taro';
import { View, ScrollView, Text, Textarea } from '@tarojs/components';
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
  const [deepThinkActive, setDeepThinkActive] = useState(false);
  const [netSearchActive, setNetSearchActive] = useState(false);

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

  const handleInputFocus = useCallback(() => {
  }, []);

  const handleInputBlur = useCallback(() => {
  }, []);

  const handleLineChange = useCallback((e: any) => {
  }, []);

  const handleDeepThinkTap = useCallback(() => {
    setDeepThinkActive((prev) => !prev);
  }, []);

  const handleNetSearchTap = useCallback(() => {
    setNetSearchActive((prev) => !prev);
  }, []);

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
                content={msg.content}
                isUser={msg.isUser}
              />
            ))}
            {isLoading && <LoadingDots />}
          </>
        )}
      </ScrollView>

      {/* 底部：对话输入区域 */}
      <View className={styles.chatBottomArea}>
        {/* 自定义输入框卡片：textarea + 工具栏 + 发送按钮 合为一体 */}
        <View className={styles.inputCard}>
          {/* 输入区域 */}
          <View className={styles.textareaWrap}>
            <Textarea
              className={styles.textarea}
              value={inputValue}
              placeholder="请输入消息..."
              placeholderClass={styles.placeholder}
              disabled={isLoading}
              maxlength={2000}
              autoHeight
              cursorSpacing={16}
              onInput={(e) => setInputValue(e.detail.value)}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              onLineChange={handleLineChange}
              confirmType="send"
              onConfirm={handleSend}
            />
          </View>

          {/* 底部工具栏：深度思考 / 联网搜索 / 发送 */}
          <View className={styles.inputFooter}>
            <View className={styles.footerLeft}>
              <View
                className={`${styles.deepThinkBlock} ${deepThinkActive ? styles.active : ''}`}
                onClick={handleDeepThinkTap}
              >
                <t-icon name="system-sum" size="36rpx" />
                <Text className={styles.deepThinkText}>深度思考</Text>
              </View>
              <View
                className={`${styles.netSearchBlock} ${netSearchActive ? styles.active : ''}`}
                onClick={handleNetSearchTap}
              >
                <t-icon name="internet" size="36rpx" />
              </View>
            </View>
            <View
              className={`${styles.sendBtn} ${inputValue.trim() && !isLoading ? styles.sendBtnReady : ''}`}
              onClick={handleSend}
            >
              <t-icon name="chevron-up" size="40rpx" color="#fff" />
            </View>
          </View>
        </View>

        {/* AI 生成提示 */}
        <View className={styles.aiDisclaimer}>
          内容由AI生成，仅供参考
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