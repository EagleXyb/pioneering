import { View, Text, Textarea } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useRef, useEffect, useCallback } from 'react';
import './index.scss';

const EXPAND_ITEMS = [
  { key: 'image', label: '图片', icon: '🖼️' },
  { key: 'camera', label: '拍照', icon: '📷' },
  { key: 'file', label: '本地文件', icon: '📁' },
];

interface Message {
  id: number;
  type: 'user' | 'ai';
  content: string;
  isStreaming?: boolean;
}

export default function Incubation() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const chatAreaRef = useRef<any>(null);
  const streamingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (chatAreaRef.current) {
        chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
      }
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (streamingTimerRef.current) {
        clearTimeout(streamingTimerRef.current);
      }
    };
  }, []);

  const toggleExpand = () => {
    setIsExpanded((prev) => !prev);
  };

  const toggleVoiceMode = () => {
    setIsVoiceMode((prev) => !prev);
  };

  const closeExpandPanel = () => {
    if (isExpanded) {
      setIsExpanded(false);
    }
  };

  const handleExpandItemTap = (key: string) => {
    switch (key) {
      case 'image':
        Taro.chooseImage({
          count: 9,
          sizeType: ['compressed'],
          sourceType: ['album'],
        });
        break;
      case 'camera':
        Taro.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['camera'],
        });
        break;
      case 'file':
        Taro.chooseMessageFile({
          count: 10,
          type: 'all',
        });
        break;
      default:
        break;
    }
    setIsExpanded(false);
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
              ? { ...msg, content: fullText.substring(0, charIndex) }
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
            msg.id === aiMessageId ? { ...msg, isStreaming: false } : msg
          )
        );
        setIsSending(false);
        streamingTimerRef.current = null;
      }
    };

    streamingTimerRef.current = setTimeout(tick, 400);
  };

  const onSend = () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue || isSending) return;

    setIsSending(true);

    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      content: trimmedValue,
    };

    const aiMessageId = Date.now() + 1;
    const aiMessage: Message = {
      id: aiMessageId,
      type: 'ai',
      content: '',
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setInputValue('');
    scrollToBottom();

    simulateStreamingResponse(aiMessageId, '创意孵化助手正在思考中，请稍候...');
  };

  const canSend = inputValue.trim().length > 0 && !isSending;

  const onInputBarClick = (e: any) => {
    e.stopPropagation();
  };

  return (
    <View className='page' onClick={closeExpandPanel}>
      <View className='chat-area' ref={chatAreaRef}>
        {messages.length === 0 ? (
          <Text className='chat-placeholder'>对话区域</Text>
        ) : (
          <View className='message-list'>
            {messages.map((msg) => (
              <View key={msg.id} className={`message-item ${msg.type}`}>
                <View className='message-content'>
                  <View className='message-bubble'>
                    <Text className='message-text'>{msg.content}</Text>
                    {msg.type === 'ai' && msg.isStreaming && (
                      <Text className='streaming-cursor'>▎</Text>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <View
        className={`input-bar ${isExpanded ? 'expanded' : ''}`}
        onClick={onInputBarClick}
      >
        <View className='input-bar-inner'>
          {!isVoiceMode ? (
            <View className='input-field'>
              <Textarea
                className='input-textarea'
                value={inputValue}
                onInput={(e) => setInputValue(e.detail.value)}
                placeholder='发消息或按住说话'
                confirmType='send'
                onConfirm={onSend}
                autoHeight
                maxlength={-1}
              />
            </View>
          ) : (
            <View className='voice-hold-area'>
              <Text className='voice-hold-text'>按住 说话</Text>
            </View>
          )}

          <View className='action-row'>
            <View className='action-btn dropdown-btn'>
              <Text className='dropdown-icon'>💬</Text>
              <Text className='dropdown-text'>对话</Text>
              <Text className='dropdown-arrow'>∨</Text>
            </View>

            <View className='action-btn circle-btn' onClick={toggleVoiceMode}>
              <Text className='circle-icon'>{isVoiceMode ? '⌨️' : '🎤'}</Text>
            </View>

            {canSend ? (
              <View className='action-btn circle-btn send-btn' onClick={onSend}>
                <Text className='circle-icon'>➤</Text>
              </View>
            ) : (
              <View className='action-btn circle-btn' onClick={toggleExpand}>
                <Text className='circle-icon'>{isExpanded ? '∧' : '+'}</Text>
              </View>
            )}
          </View>
        </View>

        {isExpanded && (
          <View className='expand-panel'>
            {EXPAND_ITEMS.map((item) => (
              <View
                key={item.key}
                className='expand-item'
                onClick={() => handleExpandItemTap(item.key)}
              >
                <View className='expand-item-icon-wrap'>
                  <Text className='expand-item-icon'>{item.icon}</Text>
                </View>
                <Text className='expand-item-label'>{item.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
