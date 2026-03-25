// 评估反馈模块类型定义

import { SaveStatus } from '../types';

// 模块信息
export interface EvaluationModuleInfo {
  title: string;
  description: string;
  placeholder: string;
}

// 模块配置
export const EVALUATION_CONFIG: EvaluationModuleInfo = {
  title: '评估反馈模块',
  description: '配置评估反馈相关的提示词',
  placeholder: '输入评估反馈相关的提示词模板...',
};

// Props接口
export interface EvaluationEditorProps {
  content: string;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onToggleFullscreen: () => void;
}
