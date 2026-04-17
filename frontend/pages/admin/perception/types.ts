// 问题感知模块类型定义

import type { SaveStatus } from '../types';

// 模块信息
export interface PerceptionModuleInfo {
  title: string;
  description: string;
  placeholder: string;
}

// 模块配置
export const PERCEPTION_CONFIG: PerceptionModuleInfo = {
  title: '问题感知模块',
  description: '配置问题感知相关的提示词',
  placeholder: '输入问题感知相关的提示词模板...',
};

// Props接口
export interface PerceptionEditorProps {
  content: string;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onToggleFullscreen: () => void;
}
