import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'katex/dist/katex.min.css';
import llmService from '../services/llmService';
import { useChat } from './trial-center/chat/hooks/useChat';
import Sidebar from './trial-center/sidebar/components/Sidebar';
import ChatInput from './trial-center/chat/components/ChatInput';
import TopNavbar from './trial-center/navbar/components/TopNavbar';
import ChatPanel from './trial-center/chat/components/ChatPanel';
import AgentProcessPanel from './trial-center/agent/components/AgentProcessPanel';
import type { AgentStep } from './trial-center/agent/components/AgentProcessPanel';
import HomeContent from './trial-center/home/components/HomeContent';
import './trial-center/styles/tokens.css';
import './trial-center/styles/layout.css';
import './trial-center/sidebar/styles/sidebar.css';
import './trial-center/chat/styles/chat.css';
import './trial-center/chat/styles/input.css';
import './trial-center/agent/styles/agent-panel.css';
import './trial-center/home/styles/home.css';
import './trial-center/navbar/styles/top-navbar.css';
import './trial-center/styles/dark-theme.css';
import './trial-center/styles/responsive.css';

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
    if (isAgentMode) return <ChatPanel messages={messages} onRetry={handleRetryMessage} className="professional-chat-container" />;
    return <ChatPanel messages={messages} onRetry={handleRetryMessage} />;
  };

  const renderInputFooter = (
    <div className="trial-input-footer">
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
                  {renderInputFooter}
                </div>
              </div>
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
            {!isInChatMode && <HomeContent />}
            {renderMainContent()}
          </div>
        </div>
        {renderInputFooter}
      </div>
    </div>
  );
};

export default TrialCenter;
