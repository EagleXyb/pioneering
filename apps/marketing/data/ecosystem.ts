// ============================================================
// ecosystem · 官网首页「能力矩阵 / 产品矩阵」区
//
// 强化「Pioneering 不只是一个聊天框」的产品定位：
// 把核心能力按用户的典型使用路径组织起来，
// 强调桌面端 / 模型层 / 工具生态 三层结构。
//
// 字段：
//   - column  : 列标题（左侧小标）
//   - title   : 该列下子项标题
//   - desc    : 子项说明（1-2 行）
//   - items   : 子项细分条目
// ============================================================

export interface EcosystemColumn {
  column: string
  title: string
  desc: string
  items: string[]
}

export const ecosystemColumns: EcosystemColumn[] = [
  {
    column: '客户端',
    title: 'Pioneering Desktop',
    desc: '面向开发者的 AI Agent 工作台，开箱即用的多模型对话与本地持久化。',
    items: ['Electron 跨端', '本地 SQLite 会话', '全局快捷键 / 命令面板', '暗色 / 浅色 / 跟随系统']
  },
  {
    column: '引擎',
    title: 'modu-agent',
    desc: '模块化智能体运行时，统一编排 LLM、工具、记忆与策略，可独立部署。',
    items: ['LangGraph 状态机', 'Plan-Execute 双阶段', 'HITL / Tool 白名单', 'Markdown / YAML 策略文件']
  },
  {
    column: '生态',
    title: 'Tools & Skills',
    desc: '可扩展工具与技能协议 (MCP / Function Call)，按场景组装能力并对外复用。',
    items: ['MCP Server SDK', 'Skills 插件市场', 'Web Search / RAG / Code', '可视化 Trace 调试']
  }
]
