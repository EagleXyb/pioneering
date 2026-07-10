# Pioneering Code Wiki

Pioneering 项目代码文档，提供完整的架构说明、模块文档和开发指南。

## 文档导航

| 编号 | 文档 | 说明 |
|------|------|------|
| 00 | [项目概述](00-项目概述.md) | 项目简介、核心特性、技术栈、目录结构、快速开始 |
| 01 | [系统架构](01-系统架构.md) | 整体架构图、核心数据流、分层说明、关键设计模式 |
| 02 | [ModuAgent核心框架](02-ModuAgent核心框架.md) | 核心接口、组件注册、LangGraph编排、各层组件详解 |
| 03 | [后端API服务](03-后端API服务.md) | FastAPI应用结构、API路由、Agent Bridge、配置说明 |
| 04 | [桌面端应用](04-桌面端应用.md) | Electron三进程架构、主进程/Preload/渲染进程、安全设计 |
| 05 | [Web端应用](05-Web端应用.md) | React应用结构、三种交互模式、认证系统、API客户端 |
| 06 | [配置参考](06-配置参考.md) | 所有配置项、环境变量、默认值、日志配置 |
| 07 | [开发指南](07-开发指南.md) | 环境搭建、本地开发、扩展指南、代码规范、测试、调试、部署 |
| 08 | [MCP能力扩展实施方案](08-MCP能力扩展实施方案.md) | 现有架构痛点分析、MCP Client设计、适配器设计、配置规范、落地步骤 |
| 10 | [TypeScript版Agent目录规划](10-TypeScript版Agent目录规划.md) | TS 重写 Agent 的目录归属、workspaces 接入、包内部结构、迁移路线 |

## 快速链接

- **项目根目录**: [d:\Administrator\Desktop\pioneering](file:///d:/Administrator/Desktop/pioneering)
- **后端API文档（启动后访问）**: http://localhost:9000/docs
- **核心入口**: [main.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py)
- **ModuAgent工厂**: [factory.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/factory.py)

## 服务地址

| 服务 | 地址 |
|------|------|
| Backend API | http://localhost:9000 |
| API Docs (Swagger) | http://localhost:9000/docs |
| Web Frontend | http://localhost:5173 |
| Marketing | http://localhost:9001 |
| Prometheus Metrics | http://localhost:9090 (可选) |

## 关键模块索引

### 后端核心 (ModuAgent)

| 模块 | 路径 |
|------|------|
| 核心接口 | [core/interfaces/](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/interfaces) |
| 组件注册中心 | [core/registry.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/registry.py) |
| LangGraph状态 | [modu_graph/state.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/state.py) |
| 图节点定义 | [modu_graph/nodes.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/nodes.py) |
| 图构建 | [modu_graph/graph.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/graph.py) |
| 运行器 | [modu_graph/runner.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/runner.py) |
| 组件工厂 | [modu_graph/factory.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/factory.py) |
| 感知管线 | [components/perception/pipeline.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/components/perception/pipeline.py) |
| 进化编排 | [evolution/evolution_orchestrator.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/evolution/evolution_orchestrator.py) |
| 运行时配置 | [config/runtime_config.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/config/runtime_config.py) |

### 后端应用 (FastAPI)

| 模块 | 路径 |
|------|------|
| 应用入口 | [app/main.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py) |
| Agent桥接层 | [app/core/agent_bridge.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py) |
| API路由 | [app/api/v1/](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1) |
| 应用配置 | [app/config.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/config.py) |

### 桌面端 (Electron)

| 模块 | 路径 |
|------|------|
| 主进程入口 | [src/main/index.ts](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/main/index.ts) |
| Preload桥接 | [src/preload/index.ts](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/preload/index.ts) |
| IPC通道定义 | [src/shared/ipc-channels.ts](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/shared/ipc-channels.ts) |
| 聊天组件 | [src/renderer/src/components/chat/](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat) |

### Web端 (React)

| 模块 | 路径 |
|------|------|
| 应用入口 | [src/main.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/main.tsx) |
| 聊天模式 | [src/modes/chat/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/chat) |
| Pro模式 | [src/modes/pro/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/pro) |
| 任务模式 | [src/modes/task/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task) |
| API客户端 | [src/api/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/api) |

## 如何阅读本文档

1. **新人入门**: 先读 [00-项目概述](00-项目概述.md) 了解整体，再读 [07-开发指南](07-开发指南.md) 搭建环境
2. **理解架构**: 读 [01-系统架构](01-系统架构.md) 掌握数据流和分层设计
3. **Agent开发**: 重点阅读 [02-ModuAgent核心框架](02-ModuAgent核心框架.md)，了解如何添加工具/感知器
4. **前端开发**: 根据目标平台读 [04-桌面端应用](04-桌面端应用.md) 或 [05-Web端应用](05-Web端应用.md)
5. **部署上线**: 参考 [06-配置参考](06-配置参考.md) 和 [07-开发指南](07-开发指南.md) 的部署章节
