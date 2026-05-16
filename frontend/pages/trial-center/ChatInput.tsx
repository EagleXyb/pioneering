import React from 'react';
import { GlobeLock, Waypoints, ShipWheel, SquareSlash } from 'lucide-react';
import { PROJECT_OPTIONS, MODEL_MAP, PROVIDER_LIST } from '@shared/constants';
import { MAX_INPUT_LENGTH } from './types';

interface ChatInputProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  isInputFocused: boolean;
  onInputFocusChange: (focused: boolean) => void;
  canSend: boolean;
  isGenerating: boolean;
  selectedProject: string;
  selectedModel: string;
  isProjectDropdownOpen: boolean;
  isModelDropdownOpen: boolean;
  onToggleProjectDropdown: () => void;
  onToggleModelDropdown: () => void;
  onSelectProject: (id: string) => void;
  onSelectModel: (model: string) => void;
  onSend: () => void;
  onStop: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  projectDropdownRef: React.RefObject<HTMLDivElement | null>;
  modelDropdownRef: React.RefObject<HTMLDivElement | null>;
}

const ChatInput: React.FC<ChatInputProps> = ({
  inputValue,
  onInputChange,
  isInputFocused,
  onInputFocusChange,
  canSend,
  isGenerating,
  selectedProject,
  selectedModel,
  isProjectDropdownOpen,
  isModelDropdownOpen,
  onToggleProjectDropdown,
  onToggleModelDropdown,
  onSelectProject,
  onSelectModel,
  onSend,
  onStop,
  onKeyDown,
  textareaRef,
  projectDropdownRef,
  modelDropdownRef,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= MAX_INPUT_LENGTH) {
      onInputChange(value);
    }
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 200) + 'px';
  };

  return (
    <footer className="chat-footer">
      <div className={`input-box ${isInputFocused ? 'focused' : ''}`}>
        <div className="input-area">
          <textarea
            ref={textareaRef}
            className="input-textarea"
            placeholder="通过我们的互动，体验从创意生成到方案落地的全流程，感受创新的力量！"
            value={inputValue}
            onChange={handleChange}
            onFocus={() => onInputFocusChange(true)}
            onBlur={() => onInputFocusChange(false)}
            onKeyDown={onKeyDown}
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
            <div className="project-selector" ref={projectDropdownRef}>
              <div className="project-selector-trigger" onClick={onToggleProjectDropdown}>
                {selectedProject === 'normal' && <Waypoints size={18} strokeWidth={1.5} />}
                {selectedProject === 'professional' && <GlobeLock size={18} strokeWidth={1.5} />}
                {selectedProject === 'task' && <ShipWheel size={18} strokeWidth={1.5} />}
                <span>{PROJECT_OPTIONS.find(o => o.id === selectedProject)?.name || '普通模式'}</span>
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
                  {PROJECT_OPTIONS.map((option) => (
                    <div
                      key={option.id}
                      className={`project-option ${selectedProject === option.id ? 'selected' : ''}`}
                      onClick={() => {
                        onSelectProject(option.id);
                        onToggleProjectDropdown();
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
              <div className="model-selector-trigger" onClick={onToggleModelDropdown}>
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
                  {PROVIDER_LIST.map(p => (
                    <React.Fragment key={p.id}>
                      <div className="model-group-label">{p.name}</div>
                      {MODEL_MAP[p.id].map(m => (
                        <div
                          key={m.id}
                          className={`model-option ${selectedModel === m.id ? 'selected' : ''}`}
                          onClick={() => { onSelectModel(m.id); onToggleModelDropdown(); }}
                        >
                          {m.name}
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            <button
              className={`send-btn ${canSend || isGenerating ? 'active' : ''}`}
              disabled={!canSend && !isGenerating}
              onClick={isGenerating ? onStop : onSend}
              title={isGenerating ? '停止生成' : '发送'}
            >
              {isGenerating ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
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
  );
};

export default ChatInput;
