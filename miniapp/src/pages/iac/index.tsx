import { View, Text, Textarea, Image, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useRef, useEffect, useCallback } from 'react';
import './index.scss';

import normalModeIcon from '../../assets/normal-mode.png';
import normalModeSelectedIcon from '../../assets/normal-mode-selected.png';
import professionalModeIcon from '../../assets/professional-mode.png';
import professionalModeSelectedIcon from '../../assets/professional-mode-selected.png';
import taskModeIcon from '../../assets/task-mode.png';
import taskModeSelectedIcon from '../../assets/task-mode-selected.png';
import sendIcon from '../../assets/send.png';
import addIcon from '../../assets/add.png';
import closeIcon from '../../assets/close.png';
import voiceIcon from '../../assets/voice.png';
import softKeyboardIcon from '../../assets/soft-keyboard.png';
import imageIcon from '../../assets/image.png';
import cameraIcon from '../../assets/camera.png';
import localFilesIcon from '../../assets/local-files.png';

const PROJECT_OPTIONS = [
  { id: 'normal', name: '普通模式', description: '适配多元场景支持多轮对话', icon: normalModeIcon, selectedIcon: normalModeSelectedIcon },
  { id: 'professional', name: '专业模式', description: '聚焦专业领域精准交付成果', icon: professionalModeIcon, selectedIcon: professionalModeSelectedIcon },
  { id: 'task', name: '任务模式', description: '承接复杂任务高效推进落地', icon: taskModeIcon, selectedIcon: taskModeSelectedIcon },
];

const EXPAND_ITEMS = [
  { key: 'image', label: '图片', icon: imageIcon },
  { key: 'camera', label: '拍照', icon: cameraIcon },
  { key: 'file', label: '文件', icon: localFilesIcon },
];

const MOCK_RESPONSES: Record<string, string> = {
  normal: '您好！我是您的智能助手。很高兴为您服务，请问有什么可以帮助您的吗？我会尽力为您提供准确和有用的信息。',
  professional: '【专业分析】根据您提供的信息，我将为您进行深入分析。从专业角度来看，这个问题需要考虑多个维度：\n1. 技术可行性分析\n2. 市场前景评估\n3. 风险因素识别',
  task: '【任务规划】收到您的任务请求，开始进行分析...\n第一步：需求拆解\n第二步：资源调配\n第三步：执行监控\n任务规划完成，请确认是否开始执行。',
};

type MessageStatus = 'loading' | 'streaming' | 'success' | 'error' | 'stopped';

interface Message {
  id: number;
  type: 'user' | 'ai' | 'system';
  content: string;
  status?: MessageStatus;
  timestamp?: number;
}

export default function IAC() {
  const [selectedProject, setSelectedProject] = useState('normal');
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [longPressMsgId, setLongPressMsgId] = useState<number | null>(null);
  const [networkHint, setNetworkHint] = useState('');
  const chatAreaRef = useRef<any>(null);
  const streamingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtBottomRef = useRef(true);

  const getCurrentModeShortName = () => {
    const mode = PROJECT_OPTIONS.find((opt) => opt.id === selectedProject);
    if (!mode) return '普通';
    return mode.name.replace('模式', '');
  };

  const scrollToBottom = useCallback((immediate = false) => {
    setTimeout(() => {
      if (chatAreaRef.current) {
        chatAreaRef.current.scrollTo({
          top: chatAreaRef.current.scrollHeight,
          duration: immediate ? 0 : 200,
        });
      }
    }, immediate ? 0 : 50);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (streamingTimerRef.current) {
        clearTimeout(streamingTimerRef.current);
      }
    };
  }, []);

  const onChatScroll = (e: any) => {
    const { scrollTop, scrollHeight, clientHeight } = e.detail;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceToBottom < 80;
    setShowScrollBottom(distanceToBottom > 200);
  };

  const simulateStreamingResponse = (aiMessageId: number, fullText: string) => {
    let charIndex = 0;

    const tick = () => {
      if (charIndex < fullText.length) {
        const step = Math.floor(Math.random() * 2) + 1;
        charIndex = Math.min(charIndex + step, fullText.length);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMessageId
              ? { ...msg, content: fullText.substring(0, charIndex), status: 'streaming' as MessageStatus }
              : msg
          )
        );
        const isPunctuation = /[，。！？、；：""''）】》…—]/.test(fullText[charIndex - 1]);
        const delay = isPunctuation
          ? 80 + Math.random() * 60
          : 25 + Math.random() * 35;
        streamingTimerRef.current = setTimeout(tick, delay);
      } else {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMessageId ? { ...msg, status: 'success' as MessageStatus } : msg
          )
        );
        setIsSending(false);
        streamingTimerRef.current = null;
      }
    };

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === aiMessageId ? { ...msg, status: 'streaming' as MessageStatus } : msg
      )
    );
    streamingTimerRef.current = setTimeout(tick, 400);
  };

  const onSend = () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue || isSending) return;

    setIsSending(true);
    setShowModeDropdown(false);
    setIsExpanded(false);
    setIsVoiceMode(false);

    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      content: trimmedValue,
      status: 'success',
      timestamp: Date.now(),
    };

    const aiMessageId = Date.now() + 1;
    const aiMessage: Message = {
      id: aiMessageId,
      type: 'ai',
      content: '',
      status: 'loading',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setInputValue('');
    isAtBottomRef.current = true;
    scrollToBottom(true);

    const responseText = MOCK_RESPONSES[selectedProject] || MOCK_RESPONSES.normal;

    setTimeout(() => {
      simulateStreamingResponse(aiMessageId, responseText);
    }, 600);
  };

  const onStopGenerate = () => {
    if (streamingTimerRef.current) {
      clearTimeout(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
    setMessages((prev) =>
      prev.map((msg) =>
        msg.status === 'streaming' || msg.status === 'loading'
          ? { ...msg, status: 'stopped' as MessageStatus }
          : msg
      )
    );
    setIsSending(false);
  };

  const onRetry = (msgId: number) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;

    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, content: '', status: 'loading' as MessageStatus } : m
      )
    );
    setIsSending(true);

    const responseText = MOCK_RESPONSES[selectedProject] || MOCK_RESPONSES.normal;
    setTimeout(() => {
      simulateStreamingResponse(msgId, responseText);
    }, 400);
  };

  const canSend = inputValue.trim().length > 0 && !isSending;

  const onModeSelect = (id: string) => {
    setSelectedProject(id);
    setShowModeDropdown(false);
  };

  const toggleModeDropdown = () => {
    if (!isSending) {
      setShowModeDropdown((prev) => !prev);
      setIsExpanded(false);
    }
  };

  const toggleExpand = () => {
    if (!isSending && !isVoiceMode) {
      setIsExpanded((prev) => !prev);
      setShowModeDropdown(false);
    }
  };

  const switchToVoiceMode = () => {
    if (isExpanded) return;
    setIsVoiceMode(true);
    setIsFocused(false);
  };

  const switchToKeyboardMode = () => {
    setIsVoiceMode(false);
    setTimeout(() => {
      Taro.hideKeyboard();
    }, 100);
  };

  const onVoiceRecordStart = (e: any) => {
    e.preventDefault();
    Taro.vibrateShort({ type: 'light' });
    Taro.showToast({ title: '录音中...', icon: 'none', duration: 60000 });
  };

  const onVoiceRecordEnd = (e: any) => {
    e.preventDefault();
    Taro.hideToast();
    Taro.showToast({ title: '识别中...', icon: 'loading' });
    setTimeout(() => {
      Taro.hideToast();
      setInputValue('[语音消息]');
      setIsVoiceMode(false);
    }, 800);
  };

  const handleExpandItemTap = (key: string) => {
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
      default:
        break;
    }
    setIsExpanded(false);
  };

  const onLongPress = (msgId: number) => {
    setLongPressMsgId(msgId);
    Taro.vibrateShort({ type: 'medium' });
  };

  const onCopyContent = (content: string) => {
    Taro.setClipboardData({
      data: content,
      success: () => {
        Taro.showToast({ title: '已复制', icon: 'none' });
      },
    });
    setLongPressMsgId(null);
  };

  const onCloseLongPress = () => {
    setLongPressMsgId(null);
  };

  const onLoadHistory = () => {
    setNetworkHint('正在加载历史消息...');
    setTimeout(() => {
      setNetworkHint('');
      Taro.showToast({ title: '已加载全部历史', icon: 'none' });
    }, 800);
  };

  return (
    <View className='page'>
      {networkHint ? (
        <View className='network-hint'>
          <Text className='network-hint-text'>{networkHint}</Text>
        </View>
      ) : null}

      <ScrollView className='chat-area' ref={chatAreaRef} scrollY onScroll={onChatScroll} lowerThreshold={200} onScrollToLower={onLoadHistory}>
        {messages.length === 0 ? (
          <View className='empty-state'>
            <View className='empty-icon-wrap'>
              <Text className='empty-emoji'>💬</Text>
            </View>
            <Text className='empty-title'>开始对话</Text>
            <Text className='empty-desc'>选择模式后，开始您的智能体验之旅</Text>
            <View className='mode-quick-select'>
              {PROJECT_OPTIONS.map((opt) => (
                <View
                  key={opt.id}
                  className={`mode-chip ${selectedProject === opt.id ? 'active' : ''}`}
                  onClick={() => setSelectedProject(opt.id)}
                >
                  <Text className='mode-chip-text'>{opt.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View className='message-list'>
            {messages.map((msg) => (
              <View key={msg.id} className={`message-row ${msg.type}`}>
                {msg.type === 'system' ? (
                  <View className='system-hint'>
                    <Text className='system-text'>{msg.content}</Text>
                  </View>
                ) : (
                  <>
                    <View
                      className={`message-bubble-wrap ${msg.type}`}
                      onLongPress={() => onLongPress(msg.id)}
                    >
                      <View className={`message-bubble ${msg.type} ${msg.status === 'error' ? 'error' : ''}`}>
                        <Text className='message-text' selectable>{msg.content}</Text>
                        {(msg.status === 'streaming') && (
                          <Text className='streaming-cursor'>▎</Text>
                        )}
                        {msg.status === 'loading' && (
                          <View className='typing-dots'>
                            <Text className='dot'></Text>
                            <Text className='dot'></Text>
                            <Text className='dot'></Text>
                          </View>
                        )}
                      </View>
                      {msg.status === 'error' && (
                        <View className='error-action' onClick={() => onRetry(msg.id)}>
                          <Text className='error-text'>发送失败，点击重试</Text>
                        </View>
                      )}
                      {msg.status === 'stopped' && (
                        <View className='stopped-hint'>
                          <Text className='stopped-text'>生成已停止</Text>
                          <View className='retry-btn' onClick={() => onRetry(msg.id)}>
                            <Text className='retry-text'>重新生成</Text>
                          </View>
                        </View>
                      )}
                    </View>
                    {longPressMsgId === msg.id && (
                      <View className='longpress-menu' catchMove>
                        <View className='menu-item' onClick={() => onCopyContent(msg.content)}>
                          <Text className='menu-icon'>📋</Text>
                          <Text className='menu-label'>复制</Text>
                        </View>
                        <View className='menu-divider'></View>
                        <View className='menu-item' onClick={onCloseLongPress}>
                          <Text className='menu-icon'>✕</Text>
                          <Text className='menu-label'>取消</Text>
                        </View>
                      </View>
                    )}
                  </>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {showScrollBottom && messages.length > 0 && (
        <View className='scroll-bottom-btn' onClick={() => { isAtBottomRef.current = true; scrollToBottom(true); }}>
          <Text className='scroll-bottom-arrow'>↓</Text>
        </View>
      )}

      <View className='input-bar'>
        <View className='input-container'>
          {!isVoiceMode ? (
            <View className='input-field'>
              <Textarea
                className='input'
                value={inputValue}
                onInput={(e) => setInputValue(e.detail.value)}
                placeholder={isFocused ? '有问题尽管问IAC' : '发消息或按住说话'}
                confirmType='send'
                onConfirm={onSend}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                autoHeight
                maxlength={-1}
                disableDefaultPadding
                cursorSpacing={16}
                adjustPosition
              />
            </View>
          ) : (
            <View
              className='voice-hold-area'
              onTouchStart={onVoiceRecordStart}
              onTouchEnd={onVoiceRecordEnd}
              onTouchCancel={onVoiceRecordEnd}
            >
              <Text className='voice-hold-text'>按住 说话</Text>
            </View>
          )}

          <View className='toolbar'>
            <View className='toolbar-left'>
              <View className='mode-btn-wrapper'>
                <View className='mode-btn' onClick={toggleModeDropdown}>
                  <Image
                    className='mode-icon-img'
                    src={PROJECT_OPTIONS.find((opt) => opt.id === selectedProject)?.selectedIcon || normalModeSelectedIcon}
                    mode='aspectFit'
                  />
                  <Text className='mode-label'>{getCurrentModeShortName()}</Text>
                  <Text className='dropdown-arrow'>{showModeDropdown ? '▲' : '▼'}</Text>
                </View>
                {showModeDropdown && (
                  <View className='mode-dropdown' catchMove>
                    {PROJECT_OPTIONS.map((option) => (
                      <View
                        key={option.id}
                        className={`dropdown-item ${selectedProject === option.id ? 'active' : ''}`}
                        onClick={() => onModeSelect(option.id)}
                      >
                        <View className='dropdown-item-content'>
                          <Image
                            className='dropdown-icon-img'
                            src={selectedProject === option.id ? option.selectedIcon : option.icon}
                            mode='aspectFit'
                          />
                          <View className='dropdown-info'>
                            <Text className='dropdown-title'>{option.name}</Text>
                            <Text className='dropdown-desc'>{option.description}</Text>
                          </View>
                          {selectedProject === option.id && (
                            <Text className='dropdown-check'>✓</Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <View className='toolbar-right'>
              {!isSending && (
                <View
                  className={`tool-btn voice-btn ${isVoiceMode ? 'active' : ''}`}
                  onClick={isVoiceMode ? switchToKeyboardMode : switchToVoiceMode}
                >
                  <Image className='tool-icon-img' src={isVoiceMode ? softKeyboardIcon : voiceIcon} mode='aspectFit' />
                </View>
              )}

              {isSending ? (
                <View className='action-btn stop-btn' onClick={onStopGenerate}>
                  <View className='stop-icon-box'>
                    <Text className='stop-icon'>■</Text>
                  </View>
                  <Text className='stop-label'>停止</Text>
                </View>
              ) : canSend ? (
                <View className='tool-btn send-mode-btn' onClick={onSend}>
                  <Image className='tool-icon-img' src={sendIcon} mode='aspectFit' />
                </View>
              ) : (
                <View className={`tool-btn expand-btn ${isExpanded ? 'expanded' : ''}`} onClick={toggleExpand}>
                  <Image className='tool-icon-img expand-icon-img' src={isExpanded ? closeIcon : addIcon} mode='aspectFit' />
                </View>
              )}
            </View>
          </View>

          {isExpanded && (
            <View className='expand-panel' catchMove>
              {EXPAND_ITEMS.map((item) => (
                <View
                  key={item.key}
                  className='expand-item'
                  onClick={() => handleExpandItemTap(item.key)}
                >
                  <View className='expand-icon-wrap'>
                    <Image className='expand-icon-img' src={item.icon} mode='aspectFit' />
                  </View>
                  <Text className='expand-label'>{item.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}