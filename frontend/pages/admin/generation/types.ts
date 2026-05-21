// 创意生成模块类型定义

import type { SaveStatus } from '../types';

// 模块信息
export interface GenerationModuleInfo {
  title: string;
  description: string;
  placeholder: string;
}

// 模块配置
export const GENERATION_CONFIG: GenerationModuleInfo = {
  title: '创意生成模块',
  description: '配置创意生成相关的提示词',
  placeholder: '输入创意生成相关的提示词模板...',
};

// Props接口
export interface GenerationEditorProps {
  content: string;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onToggleFullscreen: () => void;
}
