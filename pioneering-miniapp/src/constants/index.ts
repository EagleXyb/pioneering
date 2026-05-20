export const AGENT_MODES = {
  BRAINSTORM: 'brainstorm',
  ANALYZE: 'analyze',
  CREATE: 'create',
  EVALUATE: 'evaluate',
} as const;

export type AgentMode = (typeof AGENT_MODES)[keyof typeof AGENT_MODES];

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  [AGENT_MODES.BRAINSTORM]: '头脑风暴',
  [AGENT_MODES.ANALYZE]: '深度分析',
  [AGENT_MODES.CREATE]: '创意生成',
  [AGENT_MODES.EVALUATE]: '方案评估',
};

export const AGENT_MODE_DESCRIPTIONS: Record<AgentMode, string> = {
  [AGENT_MODES.BRAINSTORM]: '发散思维，碰撞创意火花',
  [AGENT_MODES.ANALYZE]: '多维度剖析，洞察问题本质',
  [AGENT_MODES.CREATE]: '聚焦输出，生成完整方案',
  [AGENT_MODES.EVALUATE]: '客观评估，优化决策路径',
};
