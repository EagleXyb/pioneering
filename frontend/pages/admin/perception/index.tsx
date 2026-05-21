// 问题感知模块编辑器

import React from 'react';
import { BasePromptEditor } from '../components/BasePromptEditor';
import { PERCEPTION_CONFIG } from './types';
import type { PerceptionEditorProps } from './types';

export const PerceptionEditor: React.FC<PerceptionEditorProps> = (props) => {
  return (
    <BasePromptEditor
      title={PERCEPTION_CONFIG.title}
      description={PERCEPTION_CONFIG.description}
      placeholder={PERCEPTION_CONFIG.placeholder}
      content={props.content}
      saveStatus={props.saveStatus}
      isFullscreen={props.isFullscreen}
      onContentChange={props.onContentChange}
      onSave={props.onSave}
      onToggleFullscreen={props.onToggleFullscreen}
    />
  );
};
