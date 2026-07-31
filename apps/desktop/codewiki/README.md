# Pioneering Desktop Code Wiki

本目录为 Pioneering Desktop 桌面端的代码 Wiki 文档，覆盖业务逻辑分析、问题诊断、改进建议，以及面向后端 Agent 对接的架构与功能评估。

## 文档索引

| 文档 | 内容 |
|------|------|
| [01-business-logic.md](./01-business-logic.md) | 业务逻辑概述：主要功能模块、数据流向、核心处理流程 |
| [02-issues-diagnosis.md](./02-issues-diagnosis.md) | 问题诊断：代码规范、潜在 Bug、性能瓶颈、安全隐患、可维护性 |
| [03-improvement-suggestions.md](./03-improvement-suggestions.md) | 改进建议：针对已发现问题的可操作优化方向 |
| [04-agent-capability-assessment.md](./04-agent-capability-assessment.md) | Agent 能力现状评估：对标成熟 AI Agent 应用的缺失分析 |
| [05-agent-refactor-plan.md](./05-agent-refactor-plan.md) | Agent 架构重构与功能扩展方案 |
| [06-file-index.md](./06-file-index.md) | 关键文件索引与阅读地图 |
| [07-shadcn-message-feasibility.md](./07-shadcn-message-feasibility.md) | shadcn/ui 官方 AI 聊天组件替换可行性分析 |
| [08-task-pipeline-timeline-ui.md](./08-task-pipeline-timeline-ui.md) | 任务模式右侧面板时间轴 UI 优化方案 |
| [09-productization-plan.md](./09-productization-plan.md) | 产品化落地方案 |
| [10-desktop对接modu-agent.md](./10-desktop对接modu-agent.md) | Desktop 对接 modu-agent 的架构与功能评估 |
| [11-middle-column-layout-analysis.md](./11-middle-column-layout-analysis.md) | 中间栏布局分析报告：结构拆解、WorkBuddy 对比、P1–P7 问题与优化方案 |

## 代码版本

- 项目：`pioneering-desktop@0.1.0`
- 技术栈：Electron 42 + React 19 + TypeScript + Tailwind v4 + electron-vite
- 状态管理：Zustand（业务域）+ Jotai（UI 原子态）
- 审查范围：`apps/desktop/src` 全量代码
