// ============================================================
// pillars · 官网首页「核心能力」区
//
// 与 trends / metrics / polar 一致：纯数据 + 导出 const，组件只负责渲染，
// 后续扩段只需追加项，不必改动 PillarsSection。
//
// 字段含义：
//   - num      : 序号（卡片左上角小数字）
//   - iconKey  : 标识图标（与 PillarsSection 的 SVG 渲染表一一对应）
//   - title    : 标题（中文，1 行内）
//   - summary  : 简介（中文，2-3 行）
//   - bullets  : 关键点（最多 4 项，Render 时渲染为带圆点的列表）
// ============================================================

export type PillarIconKey =
  | 'agent'
  | 'multimodal'
  | 'edge'
  | 'governance'

export interface Pillar {
  num: string
  iconKey: PillarIconKey
  title: string
  summary: string
  bullets: string[]
}

export const pillars: Pillar[] = [
  {
    num: '01',
    iconKey: 'agent',
    title: 'Agent 智能体引擎',
    summary:
      '基于 LangGraph 的多智能体编排与工具调用框架，将 LLM 的语言能力转化为稳定的执行能力。',
    bullets: [
      'Plan-Execute 双阶段规划',
      'HITL 人机协作钩子',
      'MCP / Function Call 工具协议',
      '自适应早停 / 成本上限'
    ]
  },
  {
    num: '02',
    iconKey: 'multimodal',
    title: '多模态理解与生成',
    summary:
      '原生支持文本、代码、图像、文档与结构化数据的混合输入输出，覆盖研发、设计、运营全场景。',
    bullets: [
      '流式 token / 事件级响应',
      '结构化产物（表格 / JSON / Mermaid）',
      '上下文压缩与长摘要',
      '可挂载私有知识库 / Embedding'
    ]
  },
  {
    num: '03',
    iconKey: 'edge',
    title: '云边双模运行',
    summary:
      '同一套 Agent 既能跑在云端高算力集群，也能跑在本地 Electron 桌面进程，断网可用、数据不离端。',
    bullets: [
      '本地 SQLite 会话持久化',
      'Electron 渲染端零依赖',
      'SafeStorage 保护 API Key',
      '云端 / 本地无缝切换'
    ]
  },
  {
    num: '04',
    iconKey: 'governance',
    title: '安全与治理',
    summary:
      '从 Prompt 注入防御到工具白名单、操作审计与可追溯事件流，企业级 AI 管控开箱即用。',
    bullets: [
      '工具调用权限沙箱',
      'LLM-as-Judge 双路径质检',
      '全量 trace / 反馈回流',
      'CSP 与 IPC 通道白名单'
    ]
  }
]
