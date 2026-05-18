import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useRef, useEffect, useCallback } from 'react';
import { generateId, PROJECT_OPTIONS, MODEL_LIST } from './constants';
import type { Message } from './constants';
import { useStreamingResponse } from './hooks/useStreamingResponse';
import EmptyState from './components/EmptyState';
import MessageBubble from './components/MessageBubble';
import ChatInput from './components/ChatInput';
import ModeSheet from './components/ModeSheet';
import SidebarDrawer from './components/SidebarDrawer';
import './index.scss';

const SCROLL_BOTTOM_THRESHOLD = 80;
const SCROLL_BOTTOM_SHOW_THRESHOLD = 200;

const MOCK_GROUPS = [
  { id: '1', name: '产品创新' },
  { id: '2', name: '技术方案' },
  { id: '3', name: '市场策略' },
];

const MOCK_HISTORY = [
  { id: '1', title: '关于AI产品定位的讨论' },
  { id: '2', title: '小程序交互方案优化' },
  { id: '3', title: '用户增长策略分析' },
  { id: '4', title: '竞品功能对比研究' },
  { id: '5', title: '技术架构选型建议' },
  { id: '6', title: '商业模式可行性评估' },
  { id: '7', title: '产品需求优先级排序' },
  { id: '8', title: '设计系统规范讨论' },
];

export default function IAC() {
  /* ==================== 状态 ==================== */
  const [selectedMode, setSelectedMode] = useState('normal');
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [showModeSheet, setShowModeSheet] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [longPressMsgId, setLongPressMsgId] = useState<number | null>(null);
  const [networkHint, setNetworkHint] = useState('');
  const [scrollStamp, setScrollStamp] = useState(0);
  const [showSidebar, setShowSidebar] = useState(false);
  const [selectedModel, setSelectedModel] = useState('deepseek-flash');
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [thinkingMode, setThinkingMode] = useState<'fast' | 'deep'>('fast');

  const isAtBottomRef = useRef(true);
  const chatAreaRef = useRef<any>(null);

  /* ==================== Hooks ==================== */
  const { simulateStreamingResponse, onStopGenerate, cleanup } = useStreamingResponse({
    setMessages,
    setIsSending,
  });

  /* ==================== 清理 ==================== */
  useEffect(() => cleanup, [cleanup]);

  /* ==================== 自动滚动 ==================== */
  const scrollToBottom = useCallback((immediate = false) => {
    if (immediate) {
      setScrollStamp(Date.now());
    } else {
      setTimeout(() => setScrollStamp(Date.now()), 50);
    }
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  /* ==================== 滚动监听 ==================== */
  const onChatScroll = useCallback((e: any) => {
    const { scrollTop, scrollHeight, clientHeight } = e.detail;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceToBottom < SCROLL_BOTTOM_THRESHOLD;
    setShowScrollBottom(distanceToBottom > SCROLL_BOTTOM_SHOW_THRESHOLD);
  }, []);

  /* ==================== 发送消息 ==================== */
  const onSend = useCallback(() => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue || isSending) return;

    setIsSending(true);
    setIsExpanded(false);
    setIsVoiceMode(false);

    const userMessage: Message = {
      id: generateId(),
      type: 'user',
      content: trimmedValue,
      status: 'success',
    };

    const aiMessageId = generateId() + 1;
    const aiMessage: Message = {
      id: aiMessageId,
      type: 'ai',
      content: '',
      status: 'loading',
    };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setInputValue('');
    isAtBottomRef.current = true;
    scrollToBottom(true);

    setTimeout(() => {
      simulateStreamingResponse(aiMessageId, selectedMode);
    }, 600);
  }, [inputValue, isSending, selectedMode, scrollToBottom, simulateStreamingResponse]);

  /* ==================== 重试 ==================== */
  const onRetry = useCallback(
    (msgId: number) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg) return;

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, content: '', status: 'loading' as const } : m)),
      );
      setIsSending(true);

      setTimeout(() => {
        simulateStreamingResponse(msgId, selectedMode);
      }, 400);
    },
    [messages, selectedMode, simulateStreamingResponse],
  );

  /* ==================== 辅助计算 ==================== */
  const canSend = inputValue.trim().length > 0 && !isSending;

  /* ==================== 模式选择 ==================== */
  const onModeSelect = useCallback((id: string) => {
    setSelectedMode(id);
    setShowModeSheet(false);
  }, []);

  const toggleModeSheet = useCallback(() => {
    if (isSending) return;
    setShowModeSheet(true);
    setIsExpanded(false);
  }, [isSending]);

  /* ==================== 扩展面板 ==================== */
  const toggleExpand = useCallback(() => {
    if (isSending || isVoiceMode) return;
    setIsExpanded((prev) => !prev);
  }, [isSending, isVoiceMode]);

  const handleExpandItemTap = useCallback((key: string) => {
    switch (key) {
      case 'image':
        Taro.chooseImage({ count: 9, sizeType: ['compressed'], sourceType: ['album'] });
        break;
      case 'camera':
        Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['camera'] });
        break;
      case 'file':
        Taro.chooseMessageFile({ count: 10, type: 'all' });
        break;
    }
    setIsExpanded(false);
  }, []);

  /* ==================== 语音模式 ==================== */
  const switchToVoiceMode = useCallback(() => {
    if (isExpanded) return;
    setIsVoiceMode(true);
  }, [isExpanded]);

  const switchToKeyboardMode = useCallback(() => {
    setIsVoiceMode(false);
  }, []);

  /* ==================== 长按菜单 ==================== */
  const onLongPress = useCallback((msgId: number) => {
    setLongPressMsgId(msgId);
    Taro.vibrateShort({ type: 'medium' });
  }, []);

  const onCopyContent = useCallback((content: string) => {
    Taro.setClipboardData({
      data: content,
      success: () => {
        Taro.showToast({ title: '已复制', icon: 'none' });
      },
    });
    setLongPressMsgId(null);
  }, []);

  const onCloseLongPress = useCallback(() => {
    setLongPressMsgId(null);
  }, []);

  /* ==================== 加载历史 ==================== */
  const onLoadHistory = useCallback(() => {
    setNetworkHint('正在加载历史消息...');
    setTimeout(() => {
      setNetworkHint('');
      Taro.showToast({ title: '已加载全部历史', icon: 'none' });
    }, 800);
  }, []);

  /* ==================== 侧边栏 ==================== */
  const openSidebar = useCallback(() => {
    setShowSidebar(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setShowSidebar(false);
  }, []);

  const onNewChat = useCallback(() => {
    setMessages([]);
    setInputValue('');
    setShowSidebar(false);
  }, []);

  const onGroupClick = useCallback((id: string) => {
    console.log('点击分组:', id);
  }, []);

  const onHistoryClick = useCallback((id: string) => {
    console.log('点击历史:', id);
  }, []);

  const onAddGroup = useCallback(() => {
    console.log('添加分组');
  }, []);

  const onMoreHistory = useCallback(() => {
    console.log('更多历史');
  }, []);

  /* ==================== 模型选择弹框 ==================== */
  const onSelectModel = useCallback((id: string) => {
    setSelectedModel(id);
    setShowModeSheet(false);
  }, []);

  const onToggleSearch = useCallback(() => {
    setSearchEnabled((prev) => !prev);
  }, []);

  const onToggleThinkingMode = useCallback((mode: 'fast' | 'deep') => {
    setThinkingMode(mode);
  }, []);

  /* ==================== 渲染 ==================== */
  return (
    <View className='page'>
      {networkHint && (
        <View className='network-hint'>
          <Text className='network-hint-text'>{networkHint}</Text>
        </View>
      )}

      <View className='chat-header'>
        <View className='chat-header-menu-btn' onClick={openSidebar}>
          <Text className='chat-header-menu-icon'>☰</Text>
        </View>
      </View>

      <ScrollView
        className='chat-area'
        ref={chatAreaRef}
        scrollY
        scrollTop={scrollStamp}
        onScroll={onChatScroll}
        lowerThreshold={200}
        onScrollToLower={onLoadHistory}
      >
        {messages.length === 0 ? (
          <EmptyState selectedMode={selectedMode} onModeSelect={setSelectedMode} />
        ) : (
          <View className='message-list'>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onRetry={onRetry}
                onLongPress={onLongPress}
                isLongPressed={longPressMsgId === msg.id}
                onCopy={onCopyContent}
                onCloseLongPress={onCloseLongPress}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {showScrollBottom && messages.length > 0 && (
        <View
          className='scroll-bottom-btn'
          onClick={() => {
            isAtBottomRef.current = true;
            scrollToBottom();
          }}
        >
          <Text className='scroll-bottom-arrow'>↓</Text>
        </View>
      )}

      <ChatInput
        inputValue={inputValue}
        isSending={isSending}
        isVoiceMode={isVoiceMode}
        isExpanded={isExpanded}
        selectedMode={selectedMode}
        thinkingMode={thinkingMode}
        selectedModel={selectedModel}
        searchEnabled={searchEnabled}
        canSend={canSend}
        onInput={setInputValue}
        onSend={onSend}
        onStopGenerate={onStopGenerate}
        onToggleVoiceMode={switchToVoiceMode}
        onToggleKeyboardMode={switchToKeyboardMode}
        onToggleExpand={toggleExpand}
        onToggleModeSheet={toggleModeSheet}
        onExpandItemTap={handleExpandItemTap}
      />

      <ModeSheet
        visible={showModeSheet}
        selectedModel={selectedModel}
        searchEnabled={searchEnabled}
        thinkingMode={thinkingMode}
        models={MODEL_LIST}
        onSelectModel={onSelectModel}
        onToggleSearch={onToggleSearch}
        onToggleThinkingMode={onToggleThinkingMode}
        onClose={() => setShowModeSheet(false)}
      />

      <SidebarDrawer
        visible={showSidebar}
        onClose={closeSidebar}
        onNewChat={onNewChat}
        groups={MOCK_GROUPS}
        historyList={MOCK_HISTORY}
        onGroupClick={onGroupClick}
        onHistoryClick={onHistoryClick}
        onAddGroup={onAddGroup}
        onMoreHistory={onMoreHistory}
      />
    </View>
  );
}
