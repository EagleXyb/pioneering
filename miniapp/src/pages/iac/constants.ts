import normalModeIcon from '../../assets/normal-mode.png';
import normalModeSelectedIcon from '../../assets/normal-mode-selected.png';
import professionalModeIcon from '../../assets/professional-mode.png';
import professionalModeSelectedIcon from '../../assets/professional-mode-selected.png';
import taskModeIcon from '../../assets/task-mode.png';
import taskModeSelectedIcon from '../../assets/task-mode-selected.png';
import imageIcon from '../../assets/image.png';
import cameraIcon from '../../assets/camera.png';
import localFilesIcon from '../../assets/local-files.png';

/* ==================== 类型定义 ==================== */

export type MessageStatus = 'loading' | 'streaming' | 'success' | 'error' | 'stopped';

export interface Message {
  id: number;
  type: 'user' | 'ai' | 'system';
  content: string;
  status?: MessageStatus;
  timestamp?: number;
}

export interface ModeOption {
  id: string;
  name: string;
  shortName: string;
  description: string;
  icon: string;
  selectedIcon: string;
}

export interface ModelItem {
  id: string;
  name: string;
  description: string;
}

export interface ExpandItem {
  key: string;
  label: string;
  icon: string;
}

/* ==================== 常量数据 ==================== */

export const PROJECT_OPTIONS: ModeOption[] = [
  {
    id: 'normal',
    name: '普通模式',
    shortName: '普通',
    description: '适配多元场景支持多轮对话',
    icon: normalModeIcon,
    selectedIcon: normalModeSelectedIcon,
  },
  {
    id: 'professional',
    name: '专业模式',
    shortName: '专业',
    description: '聚焦专业领域精准交付成果',
    icon: professionalModeIcon,
    selectedIcon: professionalModeSelectedIcon,
  },
  {
    id: 'task',
    name: '任务模式',
    shortName: '任务',
    description: '承接复杂任务高效推进落地',
    icon: taskModeIcon,
    selectedIcon: taskModeSelectedIcon,
  },
];

export const MODEL_LIST: ModelItem[] = [
  {
    id: 'deepseek-flash',
    name: 'DeepSeek V4-Flash',
    description: '适用简单问题，适合普通模式',
  },
  {
    id: 'deepseek-pro',
    name: 'DeepSeek V4-Pro',
    description: '复杂任务分析，适合专业模式',
  },
  {
    id: 'glm-5.1',
    name: '智谱 GLM-5.1',
    description: '长任务分析，适合任务模式',
  },
];

export const EXPAND_ITEMS: ExpandItem[] = [
  { key: 'image', label: '图片', icon: imageIcon },
  { key: 'camera', label: '拍照', icon: cameraIcon },
  { key: 'file', label: '文件', icon: localFilesIcon },
];

export const MOCK_RESPONSES: Record<string, string> = {
  normal:
    '您好！我是您的智能助手。很高兴为您服务，请问有什么可以帮助您的吗？我会尽力为您提供准确和有用的信息。',
  professional:
    '【专业分析】根据您提供的信息，我将为您进行深入分析。从专业角度来看，这个问题需要考虑多个维度：\n1. 技术可行性分析\n2. 市场前景评估\n3. 风险因素识别',
  task:
    '【任务规划】收到您的任务请求，开始进行分析...\n第一步：需求拆解\n第二步：资源调配\n第三步：执行监控\n任务规划完成，请确认是否开始执行。',
};

/* ==================== 工具函数 ==================== */

/** 生成唯一消息 ID */
export const generateId = () => Date.now();
