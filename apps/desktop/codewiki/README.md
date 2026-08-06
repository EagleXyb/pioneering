# CodeWiki · Desktop 应用

本目录是 `apps/desktop`（Electron + React + TypeScript 桌面端）的代码维基，文档内容与代码实现一一对应，随代码演进同步更新。

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [01-architecture.md](./01-architecture.md) | 项目架构总览：技术栈、进程模型、目录结构、构建配置 |
| [02-modules.md](./02-modules.md) | 核心模块功能描述（main / preload / shared / renderer 各层） |
| [03-component-tree.md](./03-component-tree.md) | 组件树与数据流（renderer 组件层级、状态流转、IPC 数据流） |
| [04-state-management.md](./04-state-management.md) | 状态管理方案（Zustand stores + Jotai atoms 详解） |
| [05-api-and-ipc.md](./05-api-and-ipc.md) | API 调用方式与 IPC 通道（HTTP 客户端、SSE 流、Electron IPC） |
| [06-types.md](./06-types.md) | 关键类型定义（shared/types、store state、组件 props） |
| [07-features.md](./07-features.md) | 已实现功能列表与待完善部分 |
| [08-tech-debt.md](./08-tech-debt.md) | 技术债务标注 |

## 阅读建议

- **新人快速上手**：先读 `01-architecture.md` 了解整体，再看 `02-modules.md` 与 `03-component-tree.md`。
- **接手特定功能**：直接查 `02-modules.md` 中对应模块节，再按 `03-component-tree.md` 的引用跳到具体组件。
- **排查 IPC / 接口问题**：查 `05-api-and-ipc.md`。
- **评估重构范围**：查 `08-tech-debt.md`。
