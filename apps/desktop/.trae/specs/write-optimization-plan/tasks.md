# Tasks

- [x] Task 1: 撰写《优化迭代方案》文档骨架与头部说明
  - [x] SubTask 1.1: 文档标题、定位说明、引用关系（指向 codewiki 01-05）
  - [x] SubTask 1.2: 六大维度现状综述章节（架构/业务逻辑/组件/数据流/状态/布局）
- [x] Task 2: 撰写"架构缺陷"问题分类章节
  - [x] SubTask 2.1: 双轨分裂问题（useAgentStore vs chatStore.agentMode）现状→对标→优化
  - [x] SubTask 2.2: 安全基线缺陷（S1/S2/S3 正则绕过、CSP、setWindowOpenHandler）现状→对标→优化
  - [x] SubTask 2.3: 类型层僵尸定义（AgentExecuteRequest/AgentStep/SSEChunk）现状→对标→优化
  - [x] SubTask 2.4: 协议层无任务语义（agui.ts 无 Plan/Step/Approval 事件）现状→对标→优化
- [x] Task 3: 撰写"逻辑冗余"问题分类章节
  - [x] SubTask 3.1: ContextPanel 三块 mock（DiffViewer/TerminalView/CodePreview）现状→对标→优化
  - [x] SubTask 3.2: InputArea 菜单项不一致 + dead code（ContextRing/toggleSidebar）现状→对标→优化
  - [x] SubTask 3.3: 状态管理两套持久化机制 + userAtom 占位 现状→对标→优化
  - [x] SubTask 3.4: sendMessage 过长 + '自定义' 硬编码 + 版本号重复 现状→对标→优化
- [x] Task 4: 撰写"性能瓶颈"问题分类章节
  - [x] SubTask 4.1: 消息列表无虚拟化 + MessageList 未 memo 现状→对标→优化
  - [x] SubTask 4.2: ConversationList 整 store 解构 + messages 引用不稳定 现状→对标→优化
  - [x] SubTask 4.3: 消息缓存无 LRU 淘汰 + 拖拽全局监听 现状→对标→优化
- [x] Task 5: 撰写"维护性问题"问题分类章节
  - [x] SubTask 5.1: 潜在 Bug 集合（B1 空气泡/B3 baseURL 污染/B5 大小校验/B8 自动滚动等）现状→对标→优化
  - [x] SubTask 5.2: 可访问性缺失（div onClick/aria-label/focus trap）现状→对标→优化
  - [x] SubTask 5.3: DevTools 生产暴露 + appStore 未持久化 + IPC 死快捷键 现状→对标→优化
- [x] Task 6: 撰写对标差距矩阵与优化路线图
  - [x] SubTask 6.1: Workbuddy / Trae Work / Codex vs 本项目核心能力矩阵
  - [x] SubTask 6.2: 分阶段优化路线图（P0-P3 优先级总览）
  - [x] SubTask 6.3: 值得保留的架构亮点清单

# Task Dependencies
- Task 1 为骨架，Task 2-5 依赖 Task 1 的章节框架（可并行撰写各自分类）
- Task 6 依赖 Task 2-5 的问题清单汇总后才能产出矩阵与路线图
- 所有 Task 复用 codewiki 01-05 已有分析结论，需先通读已有文档
