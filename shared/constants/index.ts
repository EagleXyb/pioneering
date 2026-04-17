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
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder' },
    { id: 'deepseek-v2', name: 'DeepSeek V2' },
  ],
  glm: [
    { id: 'glm-4', name: 'GLM-4' },
    { id: 'glm-4v', name: 'GLM-4V' },
    { id: 'glm-3-turbo', name: 'GLM-3 Turbo' },
  ],
  minimax: [
    { id: 'abab-5.5', name: 'ABAB-5.5' },
    { id: 'abab-6', name: 'ABAB-6' },
  ],
  kimi: [
    { id: 'kimi-1', name: 'Kimi-1' },
    { id: 'kimi-2', name: 'Kimi-2' },
  ],
  qwen: [
    { id: 'qwen-2.5', name: 'Qwen-2.5' },
    { id: 'qwen-2', name: 'Qwen-2' },
    { id: 'qwen-1.5', name: 'Qwen-1.5' },
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
