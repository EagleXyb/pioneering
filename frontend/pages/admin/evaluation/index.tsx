// 评估反馈模块编辑器

import React from 'react';
import { BasePromptEditor } from '../components/BasePromptEditor';
import { EVALUATION_CONFIG } from './types';
import type { EvaluationEditorProps } from './types';

export const EvaluationEditor: React.FC<EvaluationEditorProps> = (props) => {
  return (
    <BasePromptEditor
      title={EVALUATION_CONFIG.title}
      description={EVALUATION_CONFIG.description}
      placeholder={EVALUATION_CONFIG.placeholder}
      content={props.content}
      saveStatus={props.saveStatus}
      isFullscreen={props.isFullscreen}
      onContentChange={props.onContentChange}
      onSave={props.onSave}
      onToggleFullscreen={props.onToggleFullscreen}
    />
  );
};
