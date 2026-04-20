import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlobeLock, PanelLeftClose, PanelRightClose, ShipWheel, Waypoints, SquareCheckBig, SquareSlash, Lightbulb, ThumbsUp, ThumbsDown, Bookmark } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { PROJECT_OPTIONS } from '@shared/constants';
import { filterThinkingChain, extractThinkingChain } from '@shared/utils';
import llmService, { type ChatMessage } from '../services/llmService';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'loading' | 'success' | 'error' | 'block';
  error?: string;
  timestamp: number;
}

const MAX_INPUT_LENGTH = 4000;
const MAX_CONTEXT_MESSAGES = 20;
const REQUEST_TIMEOUT = 60000;

const TrialCenter: React.FC = () => {
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState('MiniMax-M2.7');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>('normal');
  const [inputValue, setInputValue] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [aiConfig, setAiConfig] = useState<{ apiKey: string; provider: string; model: string; prompt: string } | null>(null);
  const [showThinkingFor, setShowThinkingFor] = useState<Set<string>>(new Set());
  const [likedMessages, setLikedMessages] = useState<Set<string>>(new Set());
  const [dislikedMessages, setDislikedMessages] = useState<Set<string>>(new Set());
  const [bookmarkedMessages, setBookmarkedMessages] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });

  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAutoScrolling = useRef(false);

  const projectOptions = PROJECT_OPTIONS;

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
    const handleClickOutside = (event: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    isAutoScrolling.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => {
      isAutoScrolling.current = false;
    }, 500);
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
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<DisplayMessage>) => {
    setMessages(prev => prev.map(msg => msg.id === id ? { ...msg, ...updates } : msg));
  }, []);

  const getContextMessages = useCallback((): ChatMessage[] => {
    const contextMsgs = messages
      .filter(m => m.role !== 'system' && m.status === 'success')
      .slice(-MAX_CONTEXT_MESSAGES);
    return contextMsgs.map(m => ({ role: m.role, content: m.content }));
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isGenerating) return;

    if (trimmed.length > MAX_INPUT_LENGTH) {
      return;
    }

    const userMsg: DisplayMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: trimmed,
      status: 'success',
      timestamp: Date.now()
    };

    const assistantMsg: DisplayMessage = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      content: '',
      status: 'loading',
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputValue('');
    setIsGenerating(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const config = aiConfig || {
      apiKey: '',
      provider: 'minimax',
      model: selectedModel,
      prompt: ''
    };

    const controller = new AbortController();
    abortControllerRef.current = controller;

    timeoutRef.current = setTimeout(() => {
      controller.abort();
      updateMessage(assistantMsg.id, {
        status: 'error',
        error: '请求超时，请重试'
      });
      setIsGenerating(false);
    }, REQUEST_TIMEOUT);

    const contextMessages = getContextMessages();
    contextMessages.push({ role: 'user', content: trimmed });

    let accumulatedContent = '';

    await llmService.streamChat(
      config,
      contextMessages,
      {
        onChunk: (text: string) => {
          accumulatedContent += text;
          updateMessage(assistantMsg.id, {
            content: accumulatedContent,
            status: 'loading'
          });
        },
        onDone: () => {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          updateMessage(assistantMsg.id, {
            content: accumulatedContent,
            status: 'success'
          });
          setIsGenerating(false);
          abortControllerRef.current = null;
        },
        onError: (error: string) => {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          updateMessage(assistantMsg.id, {
            content: accumulatedContent || '',
            status: 'error',
            error
          });
          setIsGenerating(false);
          abortControllerRef.current = null;
        }
      },
      controller.signal
    );
  }, [inputValue, isGenerating, aiConfig, selectedModel, getContextMessages, updateMessage]);

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.status === 'loading');
    if (lastAssistantMsg) {
      updateMessage(lastAssistantMsg.id, {
        status: lastAssistantMsg.content ? 'success' : 'error',
        error: lastAssistantMsg.content ? undefined : '生成已停止'
      });
    }
    setIsGenerating(false);
  }, [messages, updateMessage]);

  const handleRetry = useCallback((messageId: string) => {
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    const userMsgIndex = msgIndex - 1;
    if (userMsgIndex < 0 || messages[userMsgIndex].role !== 'user') return;

    const userContent = messages[userMsgIndex].content;

    setMessages(prev => prev.slice(0, userMsgIndex + 1));

    const assistantMsg: DisplayMessage = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      content: '',
      status: 'loading',
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, assistantMsg]);
    setIsGenerating(true);

    const config = aiConfig || {
      apiKey: '',
      provider: 'minimax',
      model: selectedModel,
      prompt: ''
    };

    const controller = new AbortController();
    abortControllerRef.current = controller;

    timeoutRef.current = setTimeout(() => {
      controller.abort();
      updateMessage(assistantMsg.id, {
        status: 'error',
        error: '请求超时，请重试'
      });
      setIsGenerating(false);
    }, REQUEST_TIMEOUT);

    const contextMsgs = messages.slice(0, userMsgIndex).filter(m => m.role !== 'system' && m.status === 'success');
    const contextMessages: ChatMessage[] = contextMsgs.map(m => ({ role: m.role, content: m.content }));
    contextMessages.push({ role: 'user', content: userContent });

    let accumulatedContent = '';

    llmService.streamChat(
      config,
      contextMessages,
      {
        onChunk: (text: string) => {
          accumulatedContent += text;
          updateMessage(assistantMsg.id, {
            content: accumulatedContent,
            status: 'loading'
          });
        },
        onDone: () => {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          updateMessage(assistantMsg.id, {
            content: accumulatedContent,
            status: 'success'
          });
          setIsGenerating(false);
          abortControllerRef.current = null;
        },
        onError: (error: string) => {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          updateMessage(assistantMsg.id, {
            content: accumulatedContent || '',
            status: 'error',
            error
          });
          setIsGenerating(false);
          abortControllerRef.current = null;
        }
      },
      controller.signal
    );
  }, [messages, aiConfig, selectedModel, updateMessage]);

  const handleNewChat = useCallback(() => {
    if (isGenerating) return;
    setMessages([]);
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [isGenerating]);

  const showToast = useCallback((message: string) => {
    setToast({ show: true, message });
    setTimeout(() => {
      setToast({ show: false, message: '' });
    }, 2000);
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
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  }, []);

  const toggleLike = useCallback((messageId: string) => {
    setLikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
        setDislikedMessages(prev => {
          const s = new Set(prev);
          s.delete(messageId);
          return s;
        });
      }
      return newSet;
    });
  }, []);

  const toggleDislike = useCallback((messageId: string) => {
    setDislikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
        setLikedMessages(prev => {
          const s = new Set(prev);
          s.delete(messageId);
          return s;
        });
      }
      return newSet;
    });
  }, []);

  const toggleBookmark = useCallback((messageId: string) => {
    setBookmarkedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= MAX_INPUT_LENGTH) {
      setInputValue(value);
    }
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 200) + 'px';
  }, []);

  const canSend = inputValue.trim().length > 0 && inputValue.trim().length <= MAX_INPUT_LENGTH && !isGenerating;

  const renderMessageContent = (message: DisplayMessage) => {
    if (message.role === 'system') {
      return <div className="chat-message-system">{message.content}</div>;
    }

    if (message.role === 'user') {
      return (
        <div className="chat-message-row user-row">
          <div className="chat-message-bubble user-bubble">
            <div className="chat-message-text">{message.content}</div>
          </div>
        </div>
      );
    }

    const thinkingContent = extractThinkingChain(message.content);
    const filteredContent = filterThinkingChain(message.content);
    const showThinking = showThinkingFor.has(message.id);

    return (
      <div className="chat-message-row assistant-row">
        <div className="chat-message-bubble assistant-bubble">
          {message.status === 'loading' && !message.content && (
            <div className="chat-skeleton">
              <div className="skeleton-line skeleton-line-long"></div>
              <div className="skeleton-line skeleton-line-medium"></div>
              <div className="skeleton-line skeleton-line-short"></div>
            </div>
          )}
          {thinkingContent && (
            <button
              className="thinking-toggle-btn"
              onClick={() => toggleThinkingDisplay(message.id)}
            >
              <Lightbulb className={`thinking-icon ${message.status === 'loading' ? 'animate' : ''}`} />
              <span>思考过程</span>
              <svg
                className={`thinking-arrow ${showThinking ? 'expanded' : ''}`}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
          {showThinking && thinkingContent && (
            <div className="thinking-content">
              {thinkingContent}
            </div>
          )}
          {(message.content) && (
            <div className="chat-message-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
              >
                {filteredContent}
              </ReactMarkdown>
              {message.status === 'loading' && <span className="chat-cursor">▊</span>}
            </div>
          )}
          {message.status === 'error' && (
            <div className="chat-message-error">
              <span className="error-text">{message.error || '网络异常，请重试'}</span>
              <button className="retry-btn" onClick={() => handleRetry(message.id)}>
                重新生成
              </button>
            </div>
          )}
          {message.status === 'success' && message.content && (
            <div className="chat-message-actions">
              <button className={`action-btn ${likedMessages.has(message.id) ? 'action-btn-active' : ''}`} onClick={() => toggleLike(message.id)} title="点赞">
                <ThumbsUp size={14} />
              </button>
              <button className={`action-btn ${dislikedMessages.has(message.id) ? 'action-btn-active' : ''}`} onClick={() => toggleDislike(message.id)} title="反对">
                <ThumbsDown size={14} />
              </button>
              <button className={`action-btn ${bookmarkedMessages.has(message.id) ? 'action-btn-active' : ''}`} onClick={() => toggleBookmark(message.id)} title="收藏">
                <Bookmark size={14} />
              </button>
              <div className="action-divider"></div>
              <button className="action-btn" onClick={() => handleCopyMessage(message.content)} title="复制">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
              </button>
              <button className="action-btn" onClick={() => handleRetry(message.id)} title="重新生成">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 4v6h6"/>
                  <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="trial-center-container">
      {toast.show && (
        <div className="toast">
          {toast.message}
        </div>
      )}
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-content">
          <div className="sidebar-header">
            <div className="sidebar-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
              <div className="logo-circle">IAC</div>
              <span className="logo-text">IAC Incubator</span>
            </div>
            <div className="sidebar-header-actions">
              <button
                className="sidebar-action-btn"
                title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              >
                {isSidebarCollapsed ? <PanelRightClose size={16} strokeWidth={2} /> : <PanelLeftClose size={16} strokeWidth={2} />}
              </button>
              <button className="sidebar-action-btn" title="新建任务">
                <SquareCheckBig size={16} strokeWidth={2} />
              </button>
            </div>
          </div>

          <button className="new-task-btn-sidebar" onClick={handleNewChat} disabled={isGenerating}>
            <SquareCheckBig size={16} strokeWidth={2} />
            新建任务
          </button>

          <div className="sidebar-footer" ref={userMenuRef}>
            <div
              className="user-info"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              style={{ cursor: 'pointer' }}
            >
              <div className="user-avatar-sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8"/>
                </svg>
              </div>
              <span className="user-name">admin</span>
            </div>
            {isUserMenuOpen && (
              <div className="user-menu">
                <div className="user-menu-header">
                  <div className="user-avatar-large">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="8" r="4"/>
                      <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8"/>
                    </svg>
                  </div>
                  <div className="user-menu-info">
                    <div className="user-menu-name">xueyb</div>
                  </div>
                </div>
                <div className="user-menu-divider"></div>
                <div className="user-menu-item">
                  <span>管理账号</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                </div>
                <div className="user-menu-item">
                  <span>语言</span>
                  <div className="user-menu-item-right">
                    <span>简体中文</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
                <div className="user-menu-item">
                  <span>主题</span>
                  <div className="user-menu-item-right">
                    <span>亮色</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
                <div className="user-menu-item">
                  <span>设置</span>
                </div>
                <div className="user-menu-divider"></div>
                <div className="user-menu-item logout">
                  <span>退出登录</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="main-content">
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
                      <div className="tool-icon">
                        {tool.icon}
                      </div>
                      <h3 className="tool-name">{tool.title}</h3>
                      <p className="tool-desc">{tool.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {isInChatMode && (
            <div className="chat-container" ref={chatContainerRef} onScroll={handleScroll}>
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

          <footer className="footer">
            <div className={`input-box ${isInputFocused ? 'focused' : ''}`}>
              <div className="input-area">
                <textarea
                  ref={textareaRef}
                  className="input-textarea"
                  placeholder="通过我们的互动，体验从创意生成到方案落地的全流程，感受创新的力量！"
                  value={inputValue}
                  onChange={handleTextareaChange}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={isGenerating}
                />
                {inputValue.length > MAX_INPUT_LENGTH * 0.8 && (
                  <div className={`char-count ${inputValue.length > MAX_INPUT_LENGTH ? 'exceeded' : ''}`}>
                    {inputValue.length}/{MAX_INPUT_LENGTH}
                  </div>
                )}
              </div>
              <div className="toolbar">
                <div className="toolbar-left">
                  <div className="project-selector" style={{ position: 'relative' }} ref={projectDropdownRef}>
                    <div
                      className="project-selector-trigger"
                      onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                    >
                      {selectedProject === 'normal' && <Waypoints size={18} strokeWidth={1.5} />}
                      {selectedProject === 'professional' && <GlobeLock size={18} strokeWidth={1.5} />}
                      {selectedProject === 'task' && <ShipWheel size={18} strokeWidth={1.5} />}
                      <span>{selectedProject === 'normal' ? '普通模式' : selectedProject === 'professional' ? '专业模式' : '任务模式'}</span>
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        style={{ transform: isProjectDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                      >
                        <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    {isProjectDropdownOpen && (
                      <div className="project-dropdown">
                        {projectOptions.map((option) => (
                          <div
                            key={option.id}
                            className={`project-option ${selectedProject === option.id ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedProject(option.id);
                              setIsProjectDropdownOpen(false);
                            }}
                          >
                            <div className="project-option-icon">
                              {option.id === 'normal' && <Waypoints size={20} strokeWidth={1.5} />}
                              {option.id === 'professional' && <GlobeLock size={20} strokeWidth={1.5} />}
                              {option.id === 'task' && <ShipWheel size={20} strokeWidth={1.5} />}
                            </div>
                            <div className="project-option-main">
                              <div className="project-option-header">
                                <div className="project-option-name">{option.name}</div>
                                {selectedProject === option.id && (
                                  <svg className="project-option-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                )}
                              </div>
                              <div className="project-option-desc">{option.description}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="toolbar-icons">
                    <div className="toolbar-icon" title="使用 / 调用命令和技能">
                      <SquareSlash size={16} strokeWidth={1.5} />
                    </div>
                    <div className="toolbar-icon" title="上传文件">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="toolbar-right">
                  <div className="model-selector" ref={modelDropdownRef}>
                    <div
                      className="model-selector-trigger"
                      onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                    >
                      <span>{selectedModel}</span>
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        style={{ transform: isModelDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                      >
                        <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    {isModelDropdownOpen && (
                      <div className="model-dropdown">
                        <div className="model-option" onClick={() => { setSelectedModel('MiniMax-M2.7'); setIsModelDropdownOpen(false); }}>MiniMax-M2.7</div>
                        <div className="model-option" onClick={() => { setSelectedModel('GPT-4'); setIsModelDropdownOpen(false); }}>GPT-4</div>
                        <div className="model-option" onClick={() => { setSelectedModel('Claude-3'); setIsModelDropdownOpen(false); }}>Claude-3</div>
                      </div>
                    )}
                  </div>
                  <button 
                    className={`send-btn ${canSend || isGenerating ? 'active' : ''}`} 
                    disabled={!canSend && !isGenerating} 
                    onClick={isGenerating ? handleStopGeneration : handleSend}
                    title={isGenerating ? '停止生成' : '发送'}
                  >
                    {isGenerating ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    ) : (
                      <svg width="18" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 19V5M12 5L5 12M12 5L19 12"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </main>

      <style>{`
        .trial-center-container {
          min-height: 100vh;
          display: flex;
          background: #EEF0F2;
        }

        .sidebar {
          width: 230px;
          background: #E9EAEB;
          border-right: none;
          display: flex;
          flex-direction: column;
          position: relative;
          transition: width 0.3s ease;
        }

        .sidebar.collapsed {
          width: 48px;
        }

        .sidebar.collapsed .sidebar-content {
          width: 48px;
          padding: 20px 6px 20px 6px;
          overflow: hidden;
        }

        .sidebar.collapsed .sidebar-logo,
        .sidebar.collapsed .new-task-btn-sidebar,
        .sidebar.collapsed .sidebar-footer {
          display: none;
        }

        .sidebar.collapsed .sidebar-header {
          justify-content: center;
          margin-bottom: 0;
        }

        .sidebar.collapsed .sidebar-header-actions {
          margin-right: 0;
          flex-direction: column;
        }

        .sidebar-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 20px 10px 20px 12px;
          background: #EEEFF2;
          width: 230px;
          transition: width 0.3s ease, padding 0.3s ease;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          gap: 11px;
          margin-bottom: 32px;
        }

        .sidebar-logo {
          display: flex;
          align-items: center;
          gap: 7px;
          flex: 1;
        }

        .logo-circle {
          width: 25px;
          height: 25px;
          border-radius: 50%;
          background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
        }

        .logo-text {
          font-size: 13px;
          font-weight: 500;
          color: #333;
        }

        .sidebar-header-actions {
          display: flex;
          align-items: center;
          gap: 0;
          margin-right: -8px;
        }

        .sidebar-action-btn {
          width: 27px;
          height: 27px;
          border: none;
          border-radius: 3px;
          background: transparent;
          color: #6B7280;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }

        .sidebar-action-btn::after {
          content: attr(title);
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          top: calc(100% + 8px);
          background: white;
          color: #333;
          border: 1px solid #333;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          white-space: nowrap;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s, visibility 0.2s;
          z-index: 100;
          pointer-events: none;
        }

        .sidebar-action-btn:hover::after {
          opacity: 1;
          visibility: visible;
        }

        .sidebar-action-btn:hover {
          background: #E5E7EB;
          color: #374151;
        }

        .new-task-btn-sidebar {
          width: 100%;
          height: 36px;
          padding: 10px;
          background: #DEE0E4;
          color: #666;
          border: none;
          border-radius: 3px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .new-task-btn-sidebar:hover {
          background: #C8C9CA;
        }

        .new-task-btn-sidebar:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .sidebar-footer {
          margin-top: auto;
          position: relative;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 3px;
          transition: background 0.2s;
        }

        .user-info:hover {
          background: #F5F5F5;
        }

        .user-avatar-sidebar {
          width: 32px;
          height: 32px;
          background: white;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #666;
        }

        .user-name {
          font-size: 14px;
          color: #333;
        }

        .user-menu {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translate(-50%, -8px);
          width: 210px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          margin-bottom: 8px;
          z-index: 1000;
        }

        .user-menu-header {
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-avatar-large {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .user-menu-info {
          flex: 1;
        }

        .user-menu-name {
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }

        .user-menu-divider {
          height: 1px;
          background: #E5E7EB;
        }

        .user-menu-item {
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 14px;
          color: #666;
          cursor: pointer;
          transition: background 0.2s;
        }

        .user-menu-item:hover {
          background: #F9FAFB;
        }

        .user-menu-item-right {
          display: flex;
          align-items: center;
          gap: 4px;
          color: #999;
        }

        .user-menu-item.logout {
          color: #EF4444;
        }

        .user-menu-item.logout:hover {
          background: #FEF2F2;
        }

        .main-content {
          flex: 1;
          padding: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #EEEFF2;
        }

        .toast {
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #333;
          color: white;
          padding: 10px 20px;
          border-radius: 6px;
          font-size: 14px;
          z-index: 9999;
          animation: toastFadeIn 0.3s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        @keyframes toastFadeIn {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        .main-wrapper {
          background: white;
          border-radius: 8px;
          border: none;
          box-shadow: 3px 4px 6px -1px rgba(0, 0, 0, 0.1), 3px 2px 4px -1px rgba(0, 0, 0, 0.06);
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          padding: 8px;
          position: relative;
          overflow: hidden;
        }

        .hero-section {
          text-align: center;
          margin-bottom: 0px;
        }

        .hero-content {
          opacity: 0;
          transform: translateY(20px);
        }

        .hero-content.animate-in {
          animation: fadeInUp 0.6s ease forwards;
          margin-top: 160px;
          margin-bottom: 125px;
        }

        @keyframes fadeInUp {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .hero-title {
          font-size: 42px;
          font-weight: 600;
          color: #333;
          margin-bottom: 15px;
        }

        .hero-subtitle {
          font-size: 16px;
          color: #666;
          font-weight: 400;
        }

        .tools-section {
          margin-bottom: 20px;
        }

        .tools-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          width: 880px;
          max-width: 100%;
          margin: 0 auto;
          margin-top: 50px;
        }

        .tool-card {
          background: white;
          padding: 24px 16px;
          border-radius: 5px;
          text-align: left;
          border: 1px solid #F0F0F0;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .tool-card:hover {
          border-color: #E0E0E0;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .tool-icon {
          margin-bottom: 16px;
        }

        .tool-name {
          font-size: 15px;
          font-weight: 600;
          color: #333;
          margin-bottom: 6px;
        }

        .tool-desc {
          font-size: 12px;
          line-height: 1.5;
          color: #999;
        }

        .non-chat-content {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }

        .footer {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          background: white;
          padding-top: 16px;
          z-index: 10;
        }

        .input-box {
          background: white;
          border-radius: 8px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 2px 16px rgba(0, 0, 0, 0.06);
          transition: all 0.2s ease;
          width: 800px;
          max-width: 100%;
          margin: 0 8px 8px 8px;
        }

        .input-box.focused {
          border-color: rgba(139, 92, 246, 0.3);
          box-shadow: 0 2px 20px rgba(139, 92, 246, 0.12);
        }

        .input-area {
          padding: 16px 20px 12px;
          border-radius: 5px 5px 0 0;
          border-bottom: none;
          position: relative;
        }

        .input-textarea {
          width: 100%;
          min-height: 24px;
          max-height: 200px;
          border: none;
          outline: none;
          resize: none;
          font-size: 14px;
          line-height: 1.6;
          color: #333;
          font-family: inherit;
          background: transparent;
        }

        .input-textarea::placeholder {
          color: #999;
        }

        .input-textarea:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .char-count {
          position: absolute;
          right: 20px;
          bottom: 14px;
          font-size: 11px;
          color: #999;
        }

        .char-count.exceeded {
          color: #EF4444;
        }

        .toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          border-top: none;
          border-radius: 0 0 5px 5px;
          height: 55px;
        }

        .toolbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .project-selector {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: #F5F5F5;
          border-radius: 3px;
          cursor: pointer;
          color: #666;
          font-size: 12px;
          transition: all 0.2s;
          height: 32px;
          position: relative;
        }

        .project-selector-trigger {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
        }

        .project-selector span {
          line-height: 1;
        }

        .project-selector:hover {
          background: #EBEBEB;
        }

        .project-dropdown {
          position: absolute;
          bottom: 100%;
          left: 0;
          margin-bottom: 8px;
          background: white;
          border: 1px solid #E5E7EB;
          border-radius: 5px;
          box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
          min-width: 230px;
          width: max-content;
          max-width: 260px;
          z-index: 10;
          padding: 6px 0;
        }

        .project-option {
          padding: 10px 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: background 0.15s;
          margin: 0;
          border-radius: 4px;
        }

        .project-option:hover {
          background: #F0F4FF;
        }

        .project-option.selected {
          background: #F0F4FF;
        }

        .project-option-icon {
          width: 28px;
          height: 28px;
          background: transparent;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #333;
          flex-shrink: 0;
        }

        .project-option-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .project-option-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
        }

        .project-option-name {
          font-size: 14px;
          font-weight: 500;
          color: #6B7280;
          white-space: nowrap;
        }

        .project-option-check {
          color: #22C55E;
          flex-shrink: 0;
        }

        .project-option-desc {
          font-size: 12px;
          color: #9CA3AF;
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .toolbar-icons {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .toolbar-icon {
          width: 32px;
          height: 32px;
          background: transparent;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }

        .toolbar-icon::after {
          content: attr(title);
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(100% + 8px);
          background: #333;
          color: white;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 12px;
          white-space: nowrap;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s, visibility 0.2s;
          z-index: 100;
          pointer-events: none;
        }

        .toolbar-icon:hover::after {
          opacity: 1;
          visibility: visible;
        }

        .toolbar-icon:hover {
          background: #F5F5F5;
          color: #666;
        }

        .toolbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .model-selector {
          position: relative;
        }

        .model-selector-trigger {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: transparent;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          color: #666;
          font-family: inherit;
          transition: all 0.2s;
          height: 32px;
        }

        .model-selector-trigger:hover {
          color: #333;
          background: #F5F5F5;
        }

        .model-dropdown {
          position: absolute;
          bottom: 100%;
          right: 0;
          margin-bottom: 4px;
          background: white;
          border: 1px solid #E5E7EB;
          border-radius: 8px;
          box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.12);
          min-width: 140px;
          z-index: 10;
        }

        .model-option {
          padding: 10px 14px;
          cursor: pointer;
          font-size: 13px;
          color: #333;
          transition: background 0.15s;
        }

        .model-option:hover {
          background: #F5F5F5;
        }

        .send-btn {
          width: 30px;
          height: 30px;
          background: #E5E5E5;
          border: none;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          cursor: not-allowed;
          transition: all 0.2s;
        }

        .send-btn.active {
          background: #A78BFA;
          color: white;
          cursor: pointer;
        }

        .send-btn.active:hover {
          background: #8B5CF6;
        }

        .stop-btn {
          width: 30px;
          height: 30px;
          background: #EF4444;
          border: none;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          cursor: pointer;
          transition: all 0.2s;
        }

        .stop-btn:hover {
          background: #DC2626;
        }

        .chat-container {
          flex: 1;
          overflow-y: auto;
          padding: 20px 0;
          position: relative;
          scroll-behavior: smooth;
          min-height: 0;
        }

        .chat-welcome {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          margin-bottom: 16px;
          font-size: 14px;
          font-weight: 500;
          color: #8B5CF6;
        }

        .chat-welcome-icon {
          display: flex;
          align-items: center;
        }

        .chat-message-wrapper {
          padding: 4px 20px;
        }

        .chat-message-row {
          display: flex;
          align-items: flex-start;
          margin-bottom: 16px;
          width: 100%;
        }

        .user-row {
          justify-content: flex-end;
          max-width: 800px;
          margin-left: auto;
          margin-right: auto;
        }

        .assistant-row {
          justify-content: flex-start;
          max-width: 800px;
          margin-left: auto;
          margin-right: auto;
        }

        .chat-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .chat-message-bubble {
          border-radius: 8px;
          padding: 12px 16px;
          line-height: 1.6;
          word-break: break-word;
        }

        .user-bubble {
          background: #8B5CF6;
          color: white;
          border-bottom-right-radius: 2px;
          max-width: 480px;
        }

        .user-bubble .chat-message-text {
          text-align: right;
        }

        .assistant-bubble {
          background: transparent;
          color: #333;
          border-bottom-left-radius: 2px;
          max-width: 800px;
          transition: background 0.2s ease;
        }

        .assistant-bubble:hover {
          background: #F7F8FA;
        }

        .assistant-bubble .chat-message-markdown {
          text-align: left;
          max-width: 784px;
        }

        .chat-message-text {
          font-size: 14px;
          white-space: pre-wrap;
        }

        .chat-message-markdown {
          font-size: 14px;
        }

        .chat-message-markdown p {
          margin: 0 0 8px 0;
        }

        .chat-message-markdown p:last-child {
          margin-bottom: 0;
        }

        .chat-message-markdown pre {
          background: #1E1E2E;
          color: #CDD6F4;
          padding: 12px 16px;
          border-radius: 6px;
          overflow-x: auto;
          margin: 8px 0;
          font-size: 13px;
          line-height: 1.5;
        }

        .chat-message-markdown code {
          background: rgba(139, 92, 246, 0.1);
          color: #7C3AED;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 13px;
          font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        }

        .chat-message-markdown pre code {
          background: none;
          color: inherit;
          padding: 0;
          font-size: 13px;
        }

        .chat-message-markdown ul,
        .chat-message-markdown ol {
          padding-left: 20px;
          margin: 8px 0;
        }

        .chat-message-markdown li {
          margin: 4px 0;
        }

        .chat-message-markdown blockquote {
          border-left: 3px solid #8B5CF6;
          padding-left: 12px;
          margin: 8px 0;
          color: #666;
        }

        .chat-message-markdown table {
          border-collapse: collapse;
          width: 100%;
          margin: 8px 0;
        }

        .chat-message-markdown th,
        .chat-message-markdown td {
          border: 1px solid #E5E7EB;
          padding: 8px 12px;
          text-align: left;
          font-size: 13px;
        }

        .chat-message-markdown th {
          background: #F5F5F5;
          font-weight: 600;
        }

        .chat-message-markdown a {
          color: #8B5CF6;
          text-decoration: none;
        }

        .chat-message-markdown a:hover {
          text-decoration: underline;
        }

        .chat-message-markdown h1,
        .chat-message-markdown h2,
        .chat-message-markdown h3,
        .chat-message-markdown h4 {
          margin: 12px 0 8px 0;
          font-weight: 600;
        }

        .chat-message-markdown h1 { font-size: 20px; }
        .chat-message-markdown h2 { font-size: 18px; }
        .chat-message-markdown h3 { font-size: 16px; }
        .chat-message-markdown h4 { font-size: 15px; }

        .chat-message-markdown hr {
          border: none;
          border-top: 1px solid #E5E7EB;
          margin: 12px 0;
        }

        .chat-cursor {
          display: inline-block;
          animation: blink 1s step-end infinite;
          color: #8B5CF6;
          font-weight: bold;
          margin-left: 2px;
        }

        @keyframes blink {
          50% { opacity: 0; }
        }

        .chat-loading-dots {
          display: flex;
          gap: 4px;
          padding: 4px 0;
        }

        .chat-loading-dots span {
          width: 6px;
          height: 6px;
          background: #8B5CF6;
          border-radius: 50%;
          animation: dotPulse 1.4s ease-in-out infinite;
        }

        .chat-loading-dots span:nth-child(2) {
          animation-delay: 0.2s;
        }

        .chat-loading-dots span:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes dotPulse {
          0%, 80%, 100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          40% {
            opacity: 1;
            transform: scale(1);
          }
        }

        .chat-skeleton {
          padding: 4px 0;
        }

        .skeleton-line {
          height: 14px;
          background: linear-gradient(90deg, #E5E7EB 25%, #F3F4F6 50%, #E5E7EB 75%);
          background-size: 200% 100%;
          animation: skeletonShimmer 1.5s infinite;
          border-radius: 4px;
          margin-bottom: 8px;
        }

        .skeleton-line:last-child {
          margin-bottom: 0;
        }

        .skeleton-line-long {
          width: 100%;
        }

        .skeleton-line-medium {
          width: 75%;
        }

        .skeleton-line-short {
          width: 50%;
        }

        @keyframes skeletonShimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }

        .chat-message-error {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 8px;
        }

        .error-text {
          color: #EF4444;
          font-size: 13px;
        }

        .retry-btn {
          padding: 4px 12px;
          background: transparent;
          border: 1px solid #EF4444;
          border-radius: 4px;
          color: #EF4444;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }

        .retry-btn:hover {
          background: #FEF2F2;
        }

        .chat-message-actions {
          display: flex;
          gap: 4px;
          margin-top: 8px;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .chat-message-wrapper:hover .chat-message-actions {
          opacity: 1;
        }

        .action-btn {
          width: 28px;
          height: 28px;
          background: transparent;
          border: none;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          cursor: pointer;
          transition: all 0.2s;
        }

        .action-btn:hover {
          background: #E5E7EB;
          color: #666;
        }

        .action-btn-active {
          color: #8B5CF6;
          background: rgba(139, 92, 246, 0.1);
        }

        .action-btn-active:hover {
          background: rgba(139, 92, 246, 0.15);
          color: #7C3AED;
        }

        .action-divider {
          width: 1px;
          height: 16px;
          background: #E5E7EB;
          margin: 0 4px;
        }

        .scroll-bottom-btn {
          position: sticky;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          width: 32px;
          height: 32px;
          background: white;
          border: 1px solid #E5E7EB;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #666;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transition: all 0.2s;
          z-index: 10;
          margin: 0 auto;
        }

        .scroll-bottom-btn:hover {
          background: #F5F5F5;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .chat-message-system {
          text-align: center;
          color: #999;
          font-size: 13px;
          padding: 8px 0;
        }

        .thinking-toggle-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border: none;
          padding: 0;
          border-radius: 4px;
          font-size: 13px;
          color: #6B7280;
          cursor: pointer;
          margin-bottom: 8px;
          transition: color 0.2s;
        }

        .thinking-toggle-btn:hover {
          color: #4B5563;
        }

        .thinking-icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }

        .thinking-icon.animate {
          animation: thinkingPulse 1.5s ease-in-out infinite;
        }

        @keyframes thinkingPulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1) rotate(0deg);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.1) rotate(180deg);
          }
        }

        .thinking-arrow {
          transition: transform 0.2s ease;
        }

        .thinking-arrow.expanded {
          transform: rotate(90deg);
        }

        .thinking-content {
          background: #F9FAFB;
          border: 1px solid #E5E7EB;
          border-radius: 6px;
          padding: 12px 14px;
          margin-bottom: 12px;
          font-size: 13px;
          color: #4B5563;
          white-space: pre-wrap;
          max-height: 460px;
          overflow: auto;
          line-height: 1.6;
        }

        @media (max-width: 1024px) {
          .tools-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .trial-center-container {
            flex-direction: column;
          }

          .sidebar {
            width: 100%;
            border-right: none;
            border-bottom: 1px solid #D1D1D1;
          }

          .sidebar-content {
            padding: 12px 16px;
          }

          .main-wrapper {
            padding: 24px 20px;
          }

          .tools-grid {
            grid-template-columns: 1fr;
          }

          .chat-message-bubble {
            max-width: 90%;
          }
        }

        @media (prefers-color-scheme: dark) {
          .trial-center-container {
            background: #1C1C1F;
          }

          .sidebar {
            background: #2C2C2E;
            border-color: #3A3A3C;
          }

          .sidebar-content,
          .main-content {
            background: #1C1C1F;
          }

          .new-task-btn-sidebar,
          .user-avatar-sidebar,
          .main-wrapper,
          .tool-card,
          .input-box,
          .model-dropdown,
          .project-selector {
            background: #3A3A3C;
            border-color: #48484A;
          }

          .logo-text,
          .hero-title,
          .tool-name,
          .model-option {
            color: #F5F5F7;
          }

          .new-task-btn-sidebar,
          .user-name,
          .hero-subtitle,
          .model-selector-trigger,
          .project-selector,
          .toolbar-icon,
          .input-textarea {
            color: #D1D1D6;
          }

          .input-textarea::placeholder {
            color: #98989D;
          }

          .tool-desc {
            color: #98989D;
          }

          .new-task-btn-sidebar:hover {
            background: #48484A;
          }

          .model-option:hover {
            background: #48484A;
          }

          .project-selector:hover {
            background: #48484A;
          }

          .project-dropdown {
            background: #2C2C2E;
            border-color: #3A3A3C;
          }

          .project-option:hover {
            background: #3A3A3C;
          }

          .project-option.selected {
            background: #3A3A3C;
          }

          .project-option-icon {
            background: transparent;
            color: #F5F5F7;
          }

          .project-option-name {
            color: #F5F5F7;
          }

          .project-option-desc {
            color: #98989D;
          }

          .toolbar-icon:hover {
            background: #48484A;
          }

          .send-btn {
            background: #48484A;
          }

          .send-btn.active {
            background: #7C3AED;
          }

          .send-btn.active:hover {
            background: #6D28D9;
          }

          .assistant-bubble {
            background: #2C2C2E;
            color: #F5F5F7;
          }

          .chat-message-markdown code {
            background: rgba(139, 92, 246, 0.2);
            color: #C4B5FD;
          }

          .chat-message-markdown pre {
            background: #1E1E2E;
          }

          .chat-message-markdown th {
            background: #3A3A3C;
          }

          .chat-message-markdown th,
          .chat-message-markdown td {
            border-color: #48484A;
          }

          .chat-message-markdown blockquote {
            color: #D1D1D6;
          }

          .action-btn:hover {
            background: #48484A;
            color: #D1D1D6;
          }

          .scroll-bottom-btn {
            background: #3A3A3C;
            border-color: #48484A;
            color: #D1D1D6;
          }

          .scroll-bottom-btn:hover {
            background: #48484A;
          }

          .chat-welcome {
            color: #C4B5FD;
          }

          .retry-btn {
            border-color: #F87171;
            color: #F87171;
          }

          .retry-btn:hover {
            background: rgba(239, 68, 68, 0.1);
          }
        }
      `}</style>
    </div>
  );
};

export default TrialCenter;
