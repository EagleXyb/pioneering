// 知识检索模块编辑器

import React from 'react';
import { BasePromptEditor } from '../components/BasePromptEditor';
import { RETRIEVAL_CONFIG, RetrievalEditorProps } from './types';

export const RetrievalEditor: React.FC<RetrievalEditorProps> = (props) => {
  return (
    <BasePromptEditor
      title={RETRIEVAL_CONFIG.title}
      description={RETRIEVAL_CONFIG.description}
      placeholder={RETRIEVAL_CONFIG.placeholder}
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
