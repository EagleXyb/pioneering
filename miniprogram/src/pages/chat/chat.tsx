import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Taro from '@tarojs/taro';
import { View, ScrollView, Text, Textarea, Image } from '@tarojs/components';
import { useAppStore, type SessionItem } from '@/store';
import type { ChatMessage } from '@/types/chat';
import { useConversation } from '@/hooks/useConversation';
import { useSSE } from '@/hooks/useSSE';
import ChatMessageComponent from '@/components/chat-message';
import EmptyState from '@/components/empty-state';
import LoadingDots from '@/components/loading-dots';
import SessionList from '@/components/session-list';
import { NavIcons } from '@/utils/icons';
import styles from './chat.module.scss';

export default function Chat() {
  const sidRef = useRef('');

  // ---- Store ----
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const messagesMap = useAppStore((s) => s.messagesMap);
  const chatPhase = useAppStore((s) => s.chatPhase);
  const setChatPhase = useAppStore((s) => s.setChatPhase);
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setCurrentSessionId = useAppStore((s) => s.setCurrentSessionId);
  const clearMessages = useAppStore((s) => s.clearMessages);

  // ---- Hooks ----
  const conv = useConversation(sidRef.current);
  const sse = useSSE(sidRef.current);

  // ---- Local state ----
  const [inputValue, setInputValue] = useState('');
  const [scrollInto, setScrollInto] = useState('');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [deepThinkActive, setDeepThinkActive] = useState(false);
  const [netSearchActive, setNetSearchActive] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // 当前会话消息
  const messages: ChatMessage[] = messagesMap[sidRef.current] || [];

  // 同步 sessionId ref
  useEffect(() => {
    sidRef.current = currentSessionId;
  }, [currentSessionId]);

  // 自动滚动到底部
  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';
  useEffect(() => {
    if (lastMsgId) {
      setTimeout(() => setScrollInto(`msg-${lastMsgId}`), 50);
    }
  }, [lastMsgId, sse.status, chatPhase]);

  // 键盘高度监听
  useEffect(() => {
    let lastHeight = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleKeyboardChange = (res: { height: number }) => {
      if (Math.abs(res.height - lastHeight) > 10) {
        lastHeight = res.height;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          setKeyboardHeight(res.height);
          setIsKeyboardVisible(res.height > 0);
        }, 50);
      }
    };
    try {
      Taro.onKeyboardHeightChange(handleKeyboardChange);
      return () => {
        if (timer) clearTimeout(timer);
        Taro.offKeyboardHeightChange(handleKeyboardChange);
      };
    } catch (e) {
      console.warn('键盘高度监听不支持:', e);
    }
  }, []);

  const chatBottomAreaStyle = useMemo(() => {
    if (isKeyboardVisible && keyboardHeight > 0) {
      try {
        const sysInfo = Taro.getSystemInfoSync();
        const safeAreaBottom = sysInfo.safeArea?.bottom || sysInfo.windowHeight;
        const screenHeight = sysInfo.screenHeight || sysInfo.windowHeight;
        const safeBottomInset = screenHeight - safeAreaBottom;
        const totalPadding = keyboardHeight + Math.max(safeBottomInset, 0);

        return {
          paddingBottom: `${totalPadding}px`,
          transition: 'padding-bottom 0.25s ease',
          transform: 'translateZ(0)',
        };
      } catch {
        return {
          paddingBottom: `${keyboardHeight}px`,
          transition: 'padding-bottom 0.25s ease',
          transform: 'translateZ(0)',
        };
      }
    }
    return {};
  }, [isKeyboardVisible, keyboardHeight]);

  // ---- 操作 ----

  const handleNewChat = useCallback(() => {
    const newSession: SessionItem = {
      id: `session_${Date.now()}`,
      title: '新的对话',
      preview: '开始一段全新的对话...',
      updatedAt: Date.now(),
    };
    addSession(newSession);
    setCurrentSessionId(newSession.id);
    sidRef.current = newSession.id;
    setDrawerVisible(false);
    sse.reset();
  }, [addSession, setCurrentSessionId, sse]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;

    // 流式中禁止重复发送
    if (sse.status === 'streaming' || sse.status === 'connecting') return;

    let sid = sidRef.current;
    if (!sid) {
      sid = conv.createSession();
      sidRef.current = sid;
    }

    // 敏感词过滤 + 构建用户消息
    const result = conv.buildUserMessage(sid, text);
    if (!result.passed) {
      Taro.showToast({ title: result.reason || '发送失败', icon: 'none' });
      return;
    }

    setInputValue('');

    // 创建 AI 占位消息
    const aiMsg = conv.createAIMessage(sid);
    const aiMsgId = aiMsg.id;

    // 更新会话预览
    conv.updateSessionPreview(sid, text);

    // 状态机：进入思考阶段
    setChatPhase('thinking');

    // 启动流式
    sse.startStream(aiMsgId, text, deepThinkActive);
  }, [inputValue, sse, conv, setChatPhase, deepThinkActive]);

  // SSE 流式内容同步到 Store
  useEffect(() => {
    const sid = sidRef.current;
    if (!sid) return;

    const msgs = messagesMap[sid] || [];
    const lastAi = [...msgs].reverse().find((m) => !m.isUser);
    if (!lastAi) return;

    if (sse.status === 'streaming') {
      conv.updateAIMessage(sid, lastAi.id, {
        content: sse.streamingContent,
        thinkingContent: sse.thinkingContent || undefined,
        status: 'streaming',
      });
      setChatPhase('generating');
    } else if (sse.status === 'done') {
      conv.updateAIMessage(sid, lastAi.id, {
        content: sse.streamingContent,
        thinkingContent: sse.thinkingContent || undefined,
        status: 'done',
      });
      setChatPhase('completed');
    } else if (sse.status === 'error') {
      conv.updateAIMessage(sid, lastAi.id, {
        content: sse.streamingContent || '暂时无法回答，请换种方式提问',
        status: 'error',
        error: sse.error || '生成失败',
      });
      setChatPhase('completed');
    }
  }, [sse.status, sse.streamingContent, sse.thinkingContent, sse.error, messagesMap, conv, setChatPhase]);

  const handleStop = useCallback(() => {
    const sid = sidRef.current;
    if (!sid) return;

    sse.stopStream();

    // 标记最后一条 AI 消息为 stopped
    const msgs = messagesMap[sid] || [];
    const lastAi = [...msgs].reverse().find((m) => !m.isUser);
    if (lastAi) {
      conv.updateAIMessage(sid, lastAi.id, { status: 'stopped' });
    }

    setChatPhase('completed');
  }, [sse, messagesMap, conv, setChatPhase]);

  const handleRegenerate = useCallback(
    (msgId: string) => {
      const sid = sidRef.current;
      if (!sid) return;
      if (sse.status === 'streaming' || sse.status === 'connecting') return;

      // 找到该 AI 消息之前的用户消息
      const msgs = messagesMap[sid] || [];
      const aiIdx = msgs.findIndex((m) => m.id === msgId);
      if (aiIdx < 1) return;

      const prevUser = msgs[aiIdx - 1];
      if (!prevUser?.isUser) return;

      // 重置当前 AI 消息
      conv.updateAIMessage(sid, msgId, { content: '', status: 'pending' });

      setChatPhase('thinking');
      sse.startStream(msgId, prevUser.content, deepThinkActive);
    },
    [messagesMap, sse, conv, setChatPhase, deepThinkActive],
  );

  const handleInputFocus = useCallback(() => {
    setTimeout(() => {
      try {
        const query = Taro.createSelectorQuery();
        query.select(`.${styles.textarea}`).boundingClientRect();
        query.exec((res: any) => {
          if (res && res[0]) {
            const { top } = res[0];
            const systemInfo = Taro.getSystemInfoSync();
            const windowHeight = systemInfo.windowHeight || 667;
            if (top > windowHeight * 0.5) {
              Taro.pageScrollTo({
                scrollTop: top - windowHeight * 0.3,
                duration: 200,
              });
            }
          }
        });
      } catch (e) {
        console.warn('输入框聚焦滚动失败:', e);
      }
    }, 300);
  }, []);

  const handleInputBlur = useCallback(() => {}, []);

  const handleLineChange = useCallback((_e: any) => {}, []);

  const handleDeepThinkTap = useCallback(() => {
    setDeepThinkActive((prev) => !prev);
  }, []);

  const handleNetSearchTap = useCallback(() => {
    setNetSearchActive((prev) => !prev);
  }, []);

  const handleSwitchSession = useCallback(
    (id: string) => {
      setCurrentSessionId(id);
      sidRef.current = id;
      sse.reset();
      setChatPhase('idle');
      setDrawerVisible(false);
    },
    [setCurrentSessionId, sse, setChatPhase],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      removeSession(id);
      clearMessages(id);
      if (id === sidRef.current) {
        sidRef.current = '';
        setCurrentSessionId('');
        sse.reset();
        setChatPhase('idle');
      }
    },
    [removeSession, setCurrentSessionId, clearMessages, sse, setChatPhase],
  );

  const handleDrawerVisibleChange = useCallback((e: any) => {
    setDrawerVisible(e.detail?.visible ?? false);
  }, []);

  const hasActiveSession = !!sidRef.current;
  const isBusy = sse.status === 'streaming' || sse.status === 'connecting';

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
      {/* 导航栏 */}
      <View className={styles.navActions} style={navbarStyle}>
        <View className={styles.navBtn} onClick={() => setDrawerVisible(true)}>
          <Image className={styles.navIcon} src={NavIcons.viewList()} />
        </View>
        <View className={styles.navBtn} onClick={handleNewChat}>
          <Image className={styles.navIcon} src={NavIcons.add()} />
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
      <View className={styles.chatBottomArea} style={chatBottomAreaStyle}>
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
              onInput={(e) => setInputValue(e.detail.value)}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              onLineChange={handleLineChange}
              confirmType="send"
              onConfirm={handleSend}
            />
          </View>

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

            {/* 发送 / 停止按钮 */}
            {isBusy ? (
              <View className={styles.stopBtn} onClick={handleStop}>
                <View className={styles.stopIcon} />
              </View>
            ) : (
              <View
                className={`${styles.sendBtn} ${inputValue.trim() ? styles.sendBtnReady : ''}`}
                onClick={handleSend}
              >
                <t-icon name="chevron-up" size="40rpx" color="#fff" />
              </View>
            )}
          </View>
        </View>

        <View className={styles.aiDisclaimer}>内容由AI生成，仅供参考</View>
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
              activeId={sidRef.current}
              variant="full"
              onSelect={handleSwitchSession}
              onDelete={handleDeleteSession}
            />
          )}
          <View className={styles.drawerBottom}>
            <t-button theme="primary" size="medium" block onClick={handleNewChat}>
              + 新建对话
            </t-button>
          </View>
        </View>
      </t-drawer>
    </View>
  );
}