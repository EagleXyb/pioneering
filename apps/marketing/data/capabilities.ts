// ============================================================
// capabilities · 官网「产品能力清单」区
//
// 行表型数据：num / title / detail / tags。
// tags 是右侧的小型标签 chip（最多 4 个）。
// ============================================================

export interface Capability {
  num: string
  title: string
  detail: string
  tags: string[]
}

export const capabilities: Capability[] = [
  {
    num: '1',
    title: '研发协作 · 多文件检索与代码改写',
    detail: '跨工作区检索上下文、定位符号定义、给出 diff 风格的代码改写建议并可一键应用。',
    tags: ['Workspace', 'Code Edit', 'HITL']
  },
  {
    num: '2',
    title: '专业问答 · 知识库 + 多模态附件',
    detail: '基于私有知识库（RAG）的检索增强回答，支持图片、PDF、表格等附件的混合解析。',
    tags: ['RAG', 'Multimodal', 'Attachment']
  },
  {
    num: '3',
    title: '工作流自动化 · 工具调用 + 计划审批',
    detail: '把重复任务封装为 Skills，Plan-Execute 双阶段调度，在关键节点触发人工审批。',
    tags: ['Plan-Execute', 'Skills', 'HITL']
  },
  {
    num: '4',
    title: '可视化调试 · 全链路 Trace',
    detail: '每一次 LLM 调用、工具执行、状态转移都有事件轨迹，支持时间线、Token 用量、回放。',
    tags: ['Trace', 'Lightbox', 'Token 计费']
  },
  {
    num: '5',
    title: '云边双模 · 本地优先，云端接力',
    detail: '默认本地 SQLite 持久化会话；无网 / 弱网场景自动降级，云端模型仅按需调用。',
    tags: ['Edge', 'SQLite', 'Cloud']
  }
]
