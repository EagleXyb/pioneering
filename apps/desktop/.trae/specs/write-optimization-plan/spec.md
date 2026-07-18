# 撰写《优化迭代方案》综合文档 Spec

## Why

`apps/desktop/codewiki/优化迭代方案.md` 当前为空文件。已有 codewiki 文档（01-05）从业务逻辑、问题诊断、改进建议、Agent 能力评估、Agent 重构方案五个角度分别展开了详尽分析，但缺乏一份**面向决策与落地**的综合文档：将分散的发现按"问题分类"重组，对标主流桌面端 AI Agent 产品（Workbuddy / Trae Work / Codex），并给出可执行的优化路径、优先级与预期收益。

用户需要一份结构化的迭代方案，按"问题分类 → 现状分析 → 对标差距 → 优化方案"的逻辑组织，作为后续重构工作的纲领性文档。

## What Changes

- 新增内容到 `apps/desktop/codewiki/优化迭代方案.md`（已存在的空文件）
- 文档结构遵循用户指定的"问题分类 → 现状分析 → 对标差距 → 优化方案"四段式逻辑
- 覆盖六大分析维度：架构设计、核心业务逻辑、组件层级与依赖、数据流向与 API 交互、状态管理、页面布局与样式
- 按"架构缺陷 / 逻辑冗余 / 性能瓶颈 / 维护性问题"四类问题组织
- 对标 Workbuddy、Trae Work、Codex 三款主流桌面端 AI Agent 产品的核心能力
- 每个问题给出：重构方向、优先级排序（P0-P3）、预期收益
- 复用已有 codewiki（01-05）的分析结论，不重复造轮子，而是综合升华

## Impact

- Affected specs: 无（本变更仅为文档撰写，不改动代码）
- Affected code: 仅 `apps/desktop/codewiki/优化迭代方案.md` 一个文件
- 依赖文档：`01-business-logic.md`、`02-issues-diagnosis.md`、`03-improvement-suggestions.md`、`04-agent-capability-assessment.md`、`05-agent-refactor-plan.md`、`06-file-index.md`
- 依赖外部知识：TRAE 产品知识（Workbuddy / Trae Work / Codex 能力对标）

## ADDED Requirements

### Requirement: 综合优化迭代方案文档

系统 SHALL 在 `apps/desktop/codewiki/优化迭代方案.md` 中提供一份完整的代码库优化迭代方案文档。

#### Scenario: 文档结构完整
- **WHEN** 读者打开 `优化迭代方案.md`
- **THEN** 文档包含：文档头部说明、六大维度现状综述、四类问题分类详述、对标差距矩阵、优化路线图、值得保留的亮点
- **AND** 每个问题条目按"现状分析 → 对标差距 → 优化方案（重构方向/优先级/预期收益）"四段式组织

#### Scenario: 六大维度全覆盖
- **WHEN** 审阅文档的"现状综述"章节
- **THEN** 覆盖：架构设计（双轨分裂/分层）、核心业务逻辑（流式/工具调用/上下文）、组件层级与依赖（ContextPanel mock/ToolCallCard 单薄）、数据流向与 API 交互（SSE/认证/降级）、状态管理（双库并存/无淘汰）、页面布局与样式（三栏/平台变量化）
- **AND** 每个维度引用具体文件与行号作为证据

#### Scenario: 对标产品能力矩阵
- **WHEN** 审阅"对标差距"章节
- **THEN** 包含 Workbuddy、Trae Work、Codex 三款产品与本项目的能力对比矩阵
- **AND** 矩阵覆盖：任务规划、HITL 人工确认、文件编辑 Diff 审查、终端执行、多轮记忆、中断恢复、工具编排、上下文管理、多 Agent 协作等核心能力

#### Scenario: 优化方案可执行
- **WHEN** 审阅每个问题的"优化方案"段落
- **THEN** 给出明确的重构方向（具体到文件/模块）
- **AND** 标注优先级（P0 立即 / P1 短期 / P2 中期 / P3 长期）
- **AND** 说明预期收益（性能/安全/可维护性/用户体验维度）

#### Scenario: 不重复已有文档
- **WHEN** 文档引用已有 codewiki 分析
- **THEN** 以链接形式指向 01-05 文档对应章节，而非复制全文
- **AND** 聚焦于"综合、对标、排序、落地"四项增量价值
