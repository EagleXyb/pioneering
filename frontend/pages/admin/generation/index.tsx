// 创意生成模块编辑器

import React from 'react';
import { BasePromptEditor } from '../components/BasePromptEditor';
import { GENERATION_CONFIG, GenerationEditorProps } from './types';

export const GenerationEditor: React.FC<GenerationEditorProps> = (props) => {
  return (
    <BasePromptEditor
      title={GENERATION_CONFIG.title}
      description={GENERATION_CONFIG.description}
      placeholder={GENERATION_CONFIG.placeholder}
      content={props.content}
      saveStatus={props.saveStatus}
      isFullscreen={props.isFullscreen}
      onContentChange={props.onContentChange}
      onSave={props.onSave}
      onToggleFullscreen={props.onToggleFullscreen}
      onReset={props.onReset}
    />
  );
};
