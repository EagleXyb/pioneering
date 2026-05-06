export interface ProjectOption {
  id: string;
  name: string;
  description: string;
}

export const PROJECT_OPTIONS: ProjectOption[] = [
  {
    id: 'normal',
    name: '普通模式',
    description: '适配多元场景支持多轮对话',
  },
  {
    id: 'professional',
    name: '专业模式',
    description: '聚焦专业领域精准交付成果',
  },
  {
    id: 'task',
    name: '任务模式',
    description: '承接复杂任务高效推进落地',
  },
];

export const PROVIDER_LIST = [
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'glm', name: 'GLM' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'kimi', name: 'Kimi' },
  { id: 'qwen', name: 'Qwen' },
] as const;

export const MODEL_MAP: Record<string, { id: string; name: string }[]> = {
  deepseek: [
    { id: 'deepseek-v4-flash', name: 'Deepseek-V4-Flash' },
    { id: 'deepseek-v4-pro', name: 'Deepseek-V4-Pro' },
  ],
  glm: [
    { id: 'glm-5.1', name: 'GLM-5.1' },
    { id: 'glm-5v-turbo', name: 'GLM-5v-Turbo' },
    { id: 'glm-5.0-turbo', name: 'GLM-5.0-Turbo' },
  ],
  kimi: [
    { id: 'kimi-k2.6', name: 'Kimi-K2.6' },
    { id: 'kimi-k2.5', name: 'Kimi-K2.5' },
  ],
  minimax: [
    { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7' },
    { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5' },
  ],
  qwen: [
    { id: 'qwen-3.6plus', name: 'Qwen-3.6plus' },
  ],
};

export const PROMPT_MODULE_INFO: Record<
  string,
  { title: string; description: string; placeholder: string }
> = {
  perception: {
    title: '问题感知模块',
    description: '配置问题感知相关的提示词',
    placeholder: '输入问题感知相关的提示词模板...',
  },
  retrieval: {
    title: '知识检索模块',
    description: '配置知识检索相关的提示词',
    placeholder: '输入知识检索相关的提示词模板...',
  },
  generation: {
    title: '创意生成模块',
    description: '配置创意生成相关的提示词',
    placeholder: '输入创意生成相关的提示词模板...',
  },
  evaluation: {
    title: '评估反馈模块',
    description: '配置评估反馈相关的提示词',
    placeholder: '输入评估反馈相关的提示词模板...',
  },
  'global-settings': {
    title: '全局设置',
    description: '配置全局提示词',
    placeholder: '输入全局提示词模板...',
  },
};

export const DEFAULT_PROFILE = {
  name: '张三',
  email: 'zhangsan@example.com',
  phone: '138-0000-0000',
  location: '北京市海淀区',
  bio: '热爱创新，专注于产品设计和用户体验。致力于通过科技改变生活，让世界变得更美好。',
  company: '创新科技有限公司',
  position: '产品经理',
  joinDate: '2024-01-15',
  skills: ['产品设计', '用户体验', '创新思维', '项目管理', '数据分析'],
  achievements: [
    { label: '完成测评', value: '12' },
    { label: '创新项目', value: '8' },
    { label: '获得徽章', value: '15' },
    { label: '积分', value: '2,580' },
  ],
};
