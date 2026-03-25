// 知识检索模块类型定义

import { SaveStatus } from '../types';

// 模块信息
export interface RetrievalModuleInfo {
  title: string;
  description: string;
  placeholder: string;
}

// 模块配置
export const RETRIEVAL_CONFIG: RetrievalModuleInfo = {
  title: '知识检索模块',
  description: '配置知识检索相关的提示词',
  placeholder: '输入知识检索相关的提示词模板...',
};

// Props接口
export interface RetrievalEditorProps {
  content: string;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onToggleFullscreen: () => void;
  onReset: () => void;
}
