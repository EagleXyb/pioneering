import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'katex/dist/katex.min.css';
import llmService from '../services/llmService';
import { useChat } from './trial-center/useChat';
import Sidebar from './trial-center/Sidebar';
import ChatInput from './trial-center/ChatInput';
import TopNavbar from './trial-center/modes/TopNavbar';
import NormalChatPanel from './trial-center/modes/NormalChatPanel';
import AgentChatPanel from './trial-center/modes/AgentChatPanel';
import AgentProcessPanel from './trial-center/AgentProcessPanel';
import type { AgentStep } from './trial-center/AgentProcessPanel';
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
  const [aiConfig, setAiConfig] = useState<{ apiKey: string; provider: string; model: string; prompt: string } | null>(null);

  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set());
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  const isAgentMode = selectedProject === 'professional' || selectedProject === 'task';

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

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(aiConfig, selectedModel);
    }
  }, [handleSend, aiConfig, selectedModel]);

  const handleRetryMessage = useCallback((messageId: string) => {
    handleRetry(messageId, aiConfig, selectedModel);
  }, [handleRetry, aiConfig, selectedModel]);

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

  const renderMainContent = () => {
    if (!isInChatMode) return null;
    if (isAgentMode) return <AgentChatPanel messages={messages} onRetry={handleRetryMessage} />;
    return <NormalChatPanel messages={messages} onRetry={handleRetryMessage} />;
  };

  const renderInputFooter = (
    <footer className="trial-input-footer">
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
    </footer>
  );

  if (isAgentMode && isInChatMode) {
    return (
      <div className="trial-center-container">
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onNewChat={handleNewChat}
          isGenerating={isGenerating}
          currentConversationId={conversationId}
          onSwitchConversation={handleSwitchConversation}
        />
        <div className="trial-main-area">
          <TopNavbar />
          <div className="agent-content-row">
            <div className="agent-left-area">
              <div className="trial-body agent-mode">
                <div className="main-wrapper professional-wrapper">
                  {renderMainContent()}
                </div>
              </div>
              {renderInputFooter}
            </div>
            <div className="agent-right-panel">
              <AgentProcessPanel
                steps={agentSteps}
                isRunning={isAgentRunning}
                onTerminate={handleTerminateAgent}
                onToggleStep={handleToggleAgentStep}
                collapsedSteps={collapsedSteps}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="trial-center-container">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onNewChat={handleNewChat}
        isGenerating={isGenerating}
        currentConversationId={conversationId}
        onSwitchConversation={handleSwitchConversation}
      />
      <div className="trial-main-area">
        <TopNavbar />
        <div className={`trial-body ${isAgentMode && isInChatMode ? 'agent-mode' : ''}`}>
          <div className={`main-wrapper ${isAgentMode && isInChatMode ? 'professional-wrapper' : ''}`}>
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
            {renderMainContent()}
          </div>
        </div>
        {renderInputFooter}
      </div>
    </div>
  );
};

export default TrialCenter;
