# 01 · 项目架构总览

## 1. 技术栈

| 层 | 技术 | 版本/说明 |
| --- | --- | --- |
| 运行时 | Electron | `electron.vite.config.ts` 通过 `electron-vite` 构建；主进程、预加载、渲染进程三段式 |
| 语言 | TypeScript | 全量 TS，`tsconfig.json` 继承根 tsconfig，开启 `paths` 别名 `@/*`、`@shared/*` |
| 渲染层框架 | React 18 | 函数组件 + Hooks |
| 路由 | react-router-dom v6 | `createHashRouter`（桌面端用 hash 路由） |
| 状态管理 | Zustand + Jotai | 全局 store 用 Zustand；细粒度 UI/派生状态用 Jotai atoms |
| UI 组件库 | shadcn/ui（Radix UI） | `components/ui/*` 为基于 Radix 的本地源码组件；`components.json` 配置风格 |
| 样式 | Tailwind CSS | `tailwind.config.ts` + `src/renderer/src/styles/index.css`，CSS 变量主题 |
| Markdown | react-markdown + remark-gfm + rehype-highlight + rehype-sanitize | 统一在 `MarkdownRenderer` |
| 虚拟列表 | @tanstack/react-virtual | 会话列表、消息列表（旧路径）使用 |
| 构建 | electron-vite | 三进程统一构建，HMR 支持渲染进程 |
| 包管理 | pnpm workspace | 根 `package.json` 管理 monorepo |

## 2. 进程模型

```
┌──────────────────────────────────────────────────────────┐
│ Main Process (src/main)                                  │
│  index.ts → 创建 BrowserWindow、注册 IPC handlers        │
│  ipc-handlers.ts → 文件/剪贴板/对话框/窗口控制等本地能力 │
│  menu.ts / menu-template.ts → 应用菜单                   │
│  window-config.ts → 窗口尺寸/单实例/默认配置             │
└──────────────────────────────────────────────────────────┘
            │ contextBridge (src/preload/index.ts)
            ▼
┌──────────────────────────────────────────────────────────┐
│ Renderer Process (src/renderer)                          │
│  React 应用，通过 window.xxxApi 访问主进程能力           │
│  HTTP/SSE 直接访问后端；本地能力走 IPC                   │
└──────────────────────────────────────────────────────────┘
```

- **主进程**：唯一入口 `src/main/index.ts`，负责窗口生命周期、原生菜单、IPC 注册。所有原生操作集中在 `ipc-handlers.ts`。
- **预加载**：`src/preload/index.ts` 通过 `contextBridge` 暴露 `window.fileApi` / `clipboardApi` / `windowApi` / `systemApi` 等命名空间，类型声明在 `src/preload/index.d.ts`。
- **渲染进程**：`src/renderer/src/main.tsx` 挂载 React 应用，`App.tsx` 配置路由与全局 Provider。
- **共享层**：`src/shared/*` 同时被主进程与渲染进程引用，定义 IPC 通道名、类型、菜单模板。

## 3. 目录结构

```
apps/desktop/
├── electron.vite.config.ts        # electron-vite 构建配置（main/preload/renderer）
├── electron-builder.yml           # 打包配置（按需）
├── components.json                # shadcn/ui 风格配置
├── tsconfig.json                  # TS 配置（paths: @/*, @shared/*）
├── package.json                   # 依赖与脚本
├── resources/                     # 打包资源（图标等，见 resources.d.ts）
├── codewiki/                      # 本代码维基
└── src/
    ├── main/                      # 主进程
    │   ├── index.ts               # 入口：创建窗口、注册 IPC
    │   ├── ipc-handlers.ts        # IPC handler 实现
    │   ├── menu.ts                # 应用菜单构建
    │   ├── window-config.ts       # 窗口配置与单实例
    │   └── resources.d.ts         # 资源文件类型声明
    ├── preload/
    │   ├── index.ts               # contextBridge 暴露 API
    │   └── index.d.ts             # 全局 window 类型补充
    ├── shared/                    # 主/渲染共享
    │   ├── index.ts               # 统一导出
    │   ├── types.ts               # 核心类型定义
    │   ├── ipc-channels.ts        # IPC 通道名常量
    │   └── menu-template.ts       # 菜单模板
    └── renderer/
        ├── index.html
        └── src/
            ├── main.tsx           # React 挂载入口
            ├── App.tsx            # 路由与全局 Provider
            ├── pages/             # 路由页面（ChatPage、HomePage、…）
            ├── layouts/           # 布局（RootLayout）
            ├── components/        # UI 组件
            │   ├── chat/          # 对话区（消息、输入、trace、欢迎页）
            │   ├── sidebar/       # 侧边栏（导航、会话列表）
            │   ├── context-panel/ # 上下文面板
            │   ├── preview/       # Artifact 预览面板
            │   ├── settings/      # 设置对话框
            │   ├── layout/        # 布局壳
            │   ├── common/        # 通用组件
            │   └── ui/            # shadcn/ui 基础组件（本地源码）
            ├── stores/            # Zustand stores
            ├── atoms/             # Jotai atoms
            ├── hooks/             # 自定义 Hooks
            ├── services/          # 服务层
            │   ├── api/           # HTTP 客户端（auth/chat/agent/agui）
            │   ├── ipc.ts         # 渲染侧 IPC 封装
            │   ├── stream-handler.ts   # SSE 流处理
            │   └── trace-builder.ts    # trace 树构建
            ├── lib/               # 工具函数
            │   ├── utils.ts       # cn 等通用工具
            │   ├── constants.ts   # 常量
            │   ├── feature-flags.ts
            │   ├── genId.ts
            │   ├── trace-utils.ts
            │   ├── extractCodeBlocks.ts
            │   ├── embedded-tool-results.ts
            │   ├── input/         # 输入区文档模型
            │   ├── dev/           # 开发期工具
            │   └── welcome/       # 欢迎引导
            ├── platform/          # 平台适配（响应式、面板切换）
            ├── menu/              # 渲染进程菜单动作
            ├── mocks/             # 开发期 mock
            ├── types/             # 渲染层补充类型
            └── styles/            # 全局样式
```

## 4. 构建与运行

- `pnpm dev`（根脚本）：启动 electron-vite dev server，渲染进程 HMR。
- `pnpm build`：构建三进程产物。
- `electron.vite.config.ts` 配置了 main/preload/renderer 三段，渲染进程支持 React HMR 与路径别名。

## 5. 路由配置

`App.tsx` 使用 `createHashRouter`（桌面端 hash 路由），主要路由：

| 路径 | 组件 | 说明 |
| --- | --- | --- |
| `/` | `ChatPage` | 默认对话页（会话视图） |
| `/home` | `HomePage` | 首页/欢迎 |
| `/workspace` | `WorkspacePage` | 工作区 |
| `/assistant` | `AssistantPage` | 助理管理 |
| `/skills` | `SkillsPage` | 技能 |
| `/plugins` | `PluginsPage` | 插件 |
| `/automation` | `AutomationPage` | 自动化任务 |
| `/more` | `MorePage` | 更多 |

所有页面共用 `RootLayout`，布局包含 `Sidebar` + 主内容区 + 可选 `ContextPanel` / `ArtifactPanel`。

## 6. 样式方案

- **Tailwind CSS** 为主，`tailwind.config.ts` 定义设计 token 与插件。
- `styles/index.css` 定义 CSS 变量主题（亮/暗），shadcn/ui 组件通过 `cn()`（`lib/utils.ts`，等价 `clsx + tailwind-merge`）合并类名。
- 组件库为 shadcn/ui 本地源码（`components/ui/*`），便于按需定制。
