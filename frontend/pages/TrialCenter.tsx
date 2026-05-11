import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'katex/dist/katex.min.css';
import llmService from '../services/llmService';
import { useChat } from './trial-center/useChat';
import type { DisplayMessage } from './trial-center/types';
import Sidebar from './trial-center/Sidebar';
import { UserMessage, AssistantMessage, SystemMessage } from './trial-center/ChatMessage';
import ChatInput from './trial-center/ChatInput';
import AgentProcessPanel, { type AgentStep, type AgentStepStatus } from './trial-center/AgentProcessPanel';
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
  const [selectedModel, setSelectedModel] = useState('deepseek-v4-flash');
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
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set());
  const [isAgentRunning, setIsAgentRunning] = useState(false);

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
    conversationId,
    handleSwitchConversation,
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
    try {
      await navigator.clipboard.writeText(content);
      showToast('复制成功');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('复制成功');
    }
  }, [showToast]);

  const handleForward = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    const content = msg.answerContent || msg.content;
    if (navigator.share) {
      navigator.share({ title: 'IAC Incubator', text: content }).catch(() => {});
    } else {
      navigator.clipboard.writeText(content).then(() => showToast('链接已复制，可粘贴转发')).catch(() => showToast('转发失败'));
    }
  }, [messages, showToast]);

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

  const isProfessionalMode = selectedProject === 'professional';

  const handleToggleAgentStep = useCallback((stepId: string) => {
    setCollapsedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const handleTerminateAgent = useCallback(() => {
    setIsAgentRunning(false);
  }, []);

  useEffect(() => {
    if (isProfessionalMode && isInChatMode && agentSteps.length === 0) {
      setAgentSteps([
        {
          id: 'step_1',
          title: '分析基础架构与范式创新方向，包括扩散模型、MoE架构和多模态统一框架等',
          status: 'completed',
          progress: { current: 1, total: 5 },
        },
        {
          id: 'step_2',
          title: '探讨模型能力与性能优化方向，如可解释性、持续学习、多语言支持和事实幻觉缓解',
          status: 'completed',
          progress: { current: 2, total: 5 },
          subItems: [
            { id: 'sub_2_1', type: 'search', query: '百川大模型 金融性能', sourceCount: 6, sourceLabel: '资料', content: '调研显示大模型应用已覆盖三大方向：专业领域适配(如金融、医疗)、多模态能力扩展(如图文视频)及社会科学研究工具开发。接下来需补充具体性能指标、机器人操作实验场景及评测工具开源状态等信息。' },
            { id: 'sub_2_2', type: 'search', query: '百川大模型 金融风控 案例', sourceCount: 8, sourceLabel: '资料', content: '经查阅资料，我注意到百川大模型在金融风控领域有实际案例，但缺乏量化指标；Emu3机器人可通过预训练架构支持视觉语言动作建模；TRIP-Bench是旅行规划评测标准。接下来我需查找具体金融任务指标、机器人操作实验数据及TravelBench的开源状态。' },
            { id: 'sub_2_3', type: 'analysis', content: '研究显示，百川大模型金融性能表现优异，准确率超93%。Emu3通过回归架构支持机器人操作，但缺乏具体数据。已确认TravelBench开源状态。接下来将整合这些发现，完善专业领域适配、多模态能力和科研工具分析。', sourceCount: 5 },
          ],
        },
        {
          id: 'step_3',
          title: '研究应用场景与专业化方向，包括专业领域适配、多模态能力拓展和社会科学研究工具开发',
          status: 'completed',
          progress: { current: 3, total: 5 },
        },
        {
          id: 'step_4',
          title: '撰写研究报告',
          status: 'running',
          progress: { current: 4, total: 5 },
        },
        {
          id: 'step_5',
          title: '生成可视化报告',
          status: 'pending',
          progress: { current: 5, total: 5 },
        },
      ]);
      setIsAgentRunning(true);
    }
  }, [isProfessionalMode, isInChatMode, agentSteps.length]);

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
        onForward={handleForward}
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
        currentConversationId={conversationId}
        onSwitchConversation={handleSwitchConversation}
      />
      <main className={`trial-main-content ${isProfessionalMode && isInChatMode ? 'professional-mode' : ''}`}>
        <div className={`main-wrapper ${isProfessionalMode && isInChatMode ? 'professional-wrapper' : ''}`}>
          {!isInChatMode && (
            <div className="non-chat-content">
              <section className="trial-hero-section">
                <div className="trial-hero-content animate-in">
                  <h2 className="trial-hero-title">Innovation and Creation</h2>
                  <p className="trial-hero-subtitle">激发创新潜能，孵化未来梦想</p>
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
            <>
              {isProfessionalMode ? (
                <div className="professional-layout">
                  <div className="professional-left-panel">
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
                  </div>
                  <div className="professional-right-panel">
                    <AgentProcessPanel
                      steps={agentSteps}
                      isRunning={isAgentRunning}
                      onTerminate={handleTerminateAgent}
                      onToggleStep={handleToggleAgentStep}
                      collapsedSteps={collapsedSteps}
                    />
                  </div>
                </div>
              ) : (
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
            </>
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
