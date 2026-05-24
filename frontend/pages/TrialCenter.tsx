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
  const [aiConfig, setAiConfig] = useState<{ provider: string; model: string; prompt: string } | null>(null);

  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set());
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

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

  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    if (isRightPanelCollapsed) return;
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: rightPanelWidth };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - moveEvent.clientX;
      const newWidth = Math.min(420, Math.max(280, resizeRef.current.startWidth + delta));
      setRightPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [isRightPanelCollapsed, rightPanelWidth]);

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
      <div className="three-column-layout">
        <div className={`layout-column layout-left ${isSidebarCollapsed ? 'collapsed' : ''}`}>
          <Sidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            onNewChat={handleNewChat}
            isGenerating={isGenerating}
            currentConversationId={conversationId}
            onSwitchConversation={handleSwitchConversation}
          />
        </div>
        <div className="layout-column layout-center">
          <TopNavbar />
          <div className="main-wrapper professional-wrapper">
            {renderMainContent()}
            {renderInputFooter}
          </div>
        </div>
        <div
          className="resize-handle"
          onMouseDown={handleRightResizeStart}
        />
        <div
          className={`layout-column layout-right ${isRightPanelCollapsed ? 'collapsed' : ''}`}
          style={isRightPanelCollapsed ? undefined : { width: rightPanelWidth, minWidth: rightPanelWidth }}
        >
          <AgentProcessPanel
            steps={agentSteps}
            isRunning={isAgentRunning}
            isPanelCollapsed={isRightPanelCollapsed}
            onTogglePanel={() => setIsRightPanelCollapsed(!isRightPanelCollapsed)}
            onTerminate={handleTerminateAgent}
            onToggleStep={handleToggleAgentStep}
            collapsedSteps={collapsedSteps}
          />
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
