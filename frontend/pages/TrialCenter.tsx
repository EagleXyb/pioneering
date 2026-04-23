import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'katex/dist/katex.min.css';
import { filterThinkingChain } from '@shared/utils';
import llmService from '../services/llmService';
import { useChat } from './trial-center/useChat';
import type { DisplayMessage } from './trial-center/types';
import Sidebar from './trial-center/Sidebar';
import { UserMessage, AssistantMessage, SystemMessage } from './trial-center/ChatMessage';
import ChatInput from './trial-center/ChatInput';
import './trial-center/TrialCenter.css';

const tools = [
  {
    id: 1,
    title: '网页获取',
    description: '研读在线论文，产出论文综述的文档',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <path d="M20 18h24v4H20zM20 30h16v4H20zM20 42h24v4H20z" fill="#9CA3AF"/>
        <circle cx="36" cy="30" r="8" stroke="#60A5FA" strokeWidth="2"/>
        <path d="M41 35l3 3" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    id: 2,
    title: '调研分析',
    description: '调研多个短视频平台，生成汇报PPT',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <rect x="16" y="16" width="32" height="32" rx="4" fill="white" stroke="#E5E7EB"/>
        <rect x="20" y="20" width="12" height="12" rx="2" fill="#F87171"/>
        <path d="M24 26l3 3 6-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="20" y="36" width="24" height="4" rx="1" fill="#E5E7EB"/>
      </svg>
    )
  },
  {
    id: 3,
    title: '数据挖掘',
    description: '挖掘市场增长数据，分析数据发展趋势',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <rect x="18" y="36" width="8" height="16" rx="2" fill="#60A5FA"/>
        <rect x="28" y="28" width="8" height="24" rx="2" fill="#60A5FA"/>
        <rect x="38" y="20" width="8" height="32" rx="2" fill="#60A5FA"/>
        <circle cx="18" cy="34" r="2" fill="#22C55E"/>
        <circle cx="28" cy="26" r="2" fill="#22C55E"/>
        <circle cx="38" cy="18" r="2" fill="#22C55E"/>
        <path d="M18 34L28 26L38 18" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  },
  {
    id: 4,
    title: '文件管理',
    description: '整理本地文件夹，列出Excel清单',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 20V48a4 4 0 004 4h32a4 4 0 004-4V16a4 4 0 00-4-4H28l-4-4H16a4 4 0 00-4 4v12z" fill="#60A5FA"/>
        <path d="M12 20h36a4 4 0 014 4v24a4 4 0 01-4 4H16a4 4 0 01-4-4V20z" fill="#3B82F6"/>
        <rect x="20" y="32" width="24" height="16" rx="5" fill="white"/>
        <rect x="24" y="36" width="16" height="2" rx="1" fill="#E5E7EB"/>
        <rect x="24" y="40" width="12" height="2" rx="1" fill="#E5E7EB"/>
      </svg>
    )
  }
];

const TrialCenter: React.FC = () => {
  const [selectedModel, setSelectedModel] = useState('MiniMax-M2.7');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>('normal');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiConfig, setAiConfig] = useState<{ apiKey: string; provider: string; model: string; prompt: string } | null>(null);
  const [showThinkingFor, setShowThinkingFor] = useState<Set<string>>(new Set());
  const [likedMessages, setLikedMessages] = useState<Set<string>>(new Set());
  const [dislikedMessages, setDislikedMessages] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });

  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAutoScrolling = useRef(false);

  const {
    messages,
    isGenerating,
    inputValue,
    setInputValue,
    canSend,
    handleSend,
    handleStopGeneration,
    handleRetry,
    handleNewChat,
  } = useChat();

  const isInChatMode = messages.length > 0;

  useEffect(() => {
    llmService.fetchAIConfig().then(config => {
      if (config) {
        setAiConfig(config);
        setSelectedModel(config.model);
      }
    });
  }, []);

  useEffect(() => {
    if (isInChatMode && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isInChatMode]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    isAutoScrolling.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { isAutoScrolling.current = false; }, 500);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (isAutoScrolling.current) return;
    const container = chatContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBottom(distanceFromBottom > 100);
    setIsScrolling(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => { setIsScrolling(false); }, 1500);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast({ show: true, message });
    setTimeout(() => { setToast({ show: false, message: '' }); }, 2000);
  }, []);

  const handleCopyMessage = useCallback(async (content: string) => {
    const contentToCopy = filterThinkingChain(content);
    try {
      await navigator.clipboard.writeText(contentToCopy);
      showToast('复制成功');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = contentToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('复制成功');
    }
  }, [showToast]);

  const toggleThinkingDisplay = useCallback((messageId: string) => {
    setShowThinkingFor(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) newSet.delete(messageId);
      else newSet.add(messageId);
      return newSet;
    });
  }, []);

  const toggleLike = useCallback((messageId: string) => {
    setLikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) newSet.delete(messageId);
      else {
        newSet.add(messageId);
        setDislikedMessages(p => { const s = new Set(p); s.delete(messageId); return s; });
      }
      return newSet;
    });
  }, []);

  const toggleDislike = useCallback((messageId: string) => {
    setDislikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) newSet.delete(messageId);
      else {
        newSet.add(messageId);
        setLikedMessages(p => { const s = new Set(p); s.delete(messageId); return s; });
      }
      return newSet;
    });
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(aiConfig, selectedModel);
    }
  }, [handleSend, aiConfig, selectedModel]);

  const renderMessageContent = (message: DisplayMessage) => {
    if (message.role === 'system') return <SystemMessage message={message} />;
    if (message.role === 'user') return <UserMessage message={message} />;
    return (
      <AssistantMessage
        message={message}
        showThinking={showThinkingFor.has(message.id)}
        isLiked={likedMessages.has(message.id)}
        isDisliked={dislikedMessages.has(message.id)}
        onToggleThinking={() => toggleThinkingDisplay(message.id)}
        onToggleLike={() => toggleLike(message.id)}
        onToggleDislike={() => toggleDislike(message.id)}
        onCopy={handleCopyMessage}
        onRetry={(msgId) => handleRetry(msgId, aiConfig, selectedModel)}
      />
    );
  };

  return (
    <div className="trial-center-container">
      {toast.show && <div className="toast">{toast.message}</div>}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onNewChat={handleNewChat}
        isGenerating={isGenerating}
      />
      <main className="trial-main-content">
        <div className="main-wrapper">
          {!isInChatMode && (
            <div className="non-chat-content">
              <section className="hero-section">
                <div className="hero-content animate-in">
                  <h2 className="hero-title">Innovation and Creation</h2>
                  <p className="hero-subtitle">激发创新潜能，孵化未来梦想</p>
                </div>
              </section>
              <section className="tools-section">
                <div className="tools-grid">
                  {tools.map((tool) => (
                    <div key={tool.id} className="tool-card">
                      <div className="tool-icon">{tool.icon}</div>
                      <h3 className="tool-name">{tool.title}</h3>
                      <p className="tool-desc">{tool.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
          {isInChatMode && (
            <div className={`chat-container ${isScrolling ? 'scrolling' : ''}`} ref={chatContainerRef} onScroll={handleScroll}>
              <div className="chat-welcome">
                <div className="chat-welcome-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" fill="#8B5CF6"/>
                    <path d="M8 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>IAC Incubator</span>
              </div>
              {messages.map((message) => (
                <div key={message.id} className="chat-message-wrapper">
                  {renderMessageContent(message)}
                </div>
              ))}
              <div ref={messagesEndRef} />
              {showScrollBottom && (
                <button className="scroll-bottom-btn" onClick={scrollToBottom}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12l7 7 7-7"/>
                  </svg>
                </button>
              )}
            </div>
          )}
          <ChatInput
            inputValue={inputValue}
            onInputChange={setInputValue}
            isInputFocused={isInputFocused}
            onInputFocusChange={setIsInputFocused}
            canSend={canSend}
            isGenerating={isGenerating}
            selectedProject={selectedProject}
            selectedModel={selectedModel}
            isProjectDropdownOpen={isProjectDropdownOpen}
            isModelDropdownOpen={isModelDropdownOpen}
            onToggleProjectDropdown={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
            onToggleModelDropdown={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            onSelectProject={setSelectedProject}
            onSelectModel={setSelectedModel}
            onSend={() => handleSend(aiConfig, selectedModel)}
            onStop={handleStopGeneration}
            onKeyDown={handleKeyDown}
            textareaRef={textareaRef}
            projectDropdownRef={projectDropdownRef}
            modelDropdownRef={modelDropdownRef}
          />
        </div>
      </main>
    </div>
  );
};

export default TrialCenter;
