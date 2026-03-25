// Prompt 管理模块

import React from 'react';
import { PromptModule, SaveStatus } from './types';
import './PromptManagement.css';

// 导入各模块组件
import { GlobalSettings } from './globalPrompt';
import { PerceptionEditor } from './perception';
import { RetrievalEditor } from './retrieval';
import { GenerationEditor } from './generation';
import { EvaluationEditor } from './evaluation';

interface PromptManagementProps {
  prompts: Record<PromptModule, string>;
  activeModule: PromptModule;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
  onPromptChange: (module: PromptModule, value: string) => void;
  onSavePrompt: (module: PromptModule) => void;
  onToggleFullscreen: () => void;
}

export const PromptManagement: React.FC<PromptManagementProps> = ({
  prompts,
  activeModule,
  saveStatus,
  isFullscreen,
  onPromptChange,
  onSavePrompt,
  onToggleFullscreen,
}) => {
  switch (activeModule) {
    case 'global-settings':
      return (
        <div className="prompt-management">
          <GlobalSettings
            prompts={prompts}
            onPromptChange={onPromptChange}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
          />
        </div>
      );

    case 'perception':
      return (
        <div className="prompt-management">
          <PerceptionEditor
            content={prompts['perception']}
            saveStatus={saveStatus}
            isFullscreen={isFullscreen}
            onContentChange={(value) => onPromptChange('perception', value)}
            onSave={() => onSavePrompt('perception')}
            onToggleFullscreen={onToggleFullscreen}
          />
        </div>
      );

    case 'retrieval':
      return (
        <div className="prompt-management">
          <RetrievalEditor
            content={prompts['retrieval']}
            saveStatus={saveStatus}
            isFullscreen={isFullscreen}
            onContentChange={(value) => onPromptChange('retrieval', value)}
            onSave={() => onSavePrompt('retrieval')}
            onToggleFullscreen={onToggleFullscreen}
          />
        </div>
      );

    case 'generation':
      return (
        <div className="prompt-management">
          <GenerationEditor
            content={prompts['generation']}
            saveStatus={saveStatus}
            isFullscreen={isFullscreen}
            onContentChange={(value) => onPromptChange('generation', value)}
            onSave={() => onSavePrompt('generation')}
            onToggleFullscreen={onToggleFullscreen}
          />
        </div>
      );

    case 'evaluation':
      return (
        <div className="prompt-management">
          <EvaluationEditor
            content={prompts['evaluation']}
            saveStatus={saveStatus}
            isFullscreen={isFullscreen}
            onContentChange={(value) => onPromptChange('evaluation', value)}
            onSave={() => onSavePrompt('evaluation')}
            onToggleFullscreen={onToggleFullscreen}
          />
        </div>
      );

    default:
      return null;
  }
};