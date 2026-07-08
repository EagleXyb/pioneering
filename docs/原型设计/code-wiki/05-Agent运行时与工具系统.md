# 05 - Agent 运行时与工具系统

## Agent 运行时 (`src/renderer/src/lib/agent/`)

Agent 运行时是 OpenCowork 的核心，它将用户输入 → LLM API 调用 → 工具执行 → 响应生成的循环串联起来。

### 核心类型 (`types.ts`)

```typescript
// Agent 循环配置
export interface AgentLoopConfig {
  maxIterations: number
  provider: ProviderConfig
  tools: ToolDefinition[]
  systemPrompt: string
  workingFolder?: string
  signal: AbortSignal
  enableParallelToolExecution?: boolean
  // ...
}

// 工具调用运行时状态
export type ToolCallStatus =
  | 'streaming'
  | 'pending_approval'
  | 'running'
  | 'completed'
  | 'error'
  | 'canceled'

export interface ToolCallState {
  id: string
  name: string
  input: Record<string, unknown>
  status: ToolCallStatus
  output?: ToolResultContent
  error?: string
  requiresApproval: boolean
  // ...
}
```

### 工具注册表 (`tool-registry.ts`)

全局工具注册表，所有工具在使用前必须注册：

- `registerTool(name, definition)` — 注册单个工具
- `unregisterTool(name)` — 注销工具
- `getToolDefinition(name)` — 获取工具定义
- `getAllTools()` — 获取所有注册工具

### 系统提示词构建 (`system-prompt.ts`)

根据会话模式、上下文、记忆文件等动态构建系统提示词：

```
[模式提示] + [记忆文件] + [目标上下文] + [动态上下文] + [工具定义]
```

### 上下文压缩 (`context-compression.ts`)

当上下文长度接近模型限制时，自动启动压缩：

1. 发送 `context_compression_start` 事件
2. 将早期消息汇总压缩
3. 保留关键信息（任务、计划、目标）
4. 发送 `context_compressed` 事件

### 记忆文件系统 (`memory-files.ts`)

分层记忆架构：

```
┌──────────────────────┐
│   全局记忆文件         │
│  ~/.open-cowork/     │
│  memory/             │
│  ├── SOUL.md         │ — 当前人格设定
│  ├── USER.md         │ — 用户偏好
│  └── MEMORY.md       │ — 全局记忆
├──────────────────────┤
│   项目级记忆文件       │
│  <project>/.agents/  │
│  ├── AGENTS.md       │ — 项目 Agent 设定
│  ├── SOUL.md         │ — 项目人格覆盖
│  └── MEMORY.md       │ — 项目记忆
└──────────────────────┘
```

### 会话运行时路由器 (`session-runtime-router.ts`)

根据会话模式选择不同的运行路径：

- `chat` / `clarify` — 简单对话
- `cowork` — 完整工具执行
- `code` — 代码专用路径
- `acp` — 架构控制路径

### 并发限制器 (`concurrency-limiter.ts`)

限制同时运行的 Agent 数量，避免资源竞争：

- 全局并发上限
- 会话级并发控制
- 队列等待机制

## 子代理系统 (`src/renderer/src/lib/agent/sub-agents/`)

### 架构

```
SubAgentDefinition
  ├── name: string
  ├── systemPrompt: string
  └── tools: string[]

SubAgentRegistry
  ├── register(subAgent)
  ├── get(name)
  └── getAll()
```

### 文件列表

| 文件 | 功能 |
|------|------|
| `types.ts` | 子代理类型定义 |
| `registry.ts` | 子代理注册表 |
| `catalog.ts` | 子代理目录（从 IPC 加载） |
| `default-system-prompt.ts` | 默认系统提示词 |
| `events.ts` | 子代理事件跟踪 |
| `create-tool.ts` | 创建子代理工具定义 |
| `resolve-tools.ts` | 子代理工具解析 |
| `input-message.ts` | 子代理输入消息处理 |
| `limits.ts` | 子代理并发/深度限制 |
| `runtime-cache-policy.ts` | 运行时缓存策略 |
| `workspace-protocol.ts` | 工作空间协议 |
| `builtin/index.ts` | 内置子代理定义 |

### 子代理执行流程

1. Agent 调用子代理工具
2. 子代理入队等待执行机会
3. 创建独立的子代理会话
4. 子代理使用其自己的系统提示词和工具集
5. 事件流通过 `sub_agent_*` 事件同步到主会话
6. 子代理完成，结果返回给主 Agent

## 团队系统 (`src/renderer/src/lib/agent/teams/`)

### 架构

```
TeamMember       — 团队成员定义
TeamTask         — 团队任务
TeamMessage      — 团队消息
TeamRuntime      — 团队运行时

团队模式：Lead Coordinator Pattern
  主 Agent 作为协调者，创建和管理子 Agent 团队
```

### 团队工具

| 工具 | 文件 | 功能 |
|------|------|------|
| `TeamCreate` | `tools/team-create.ts` | 创建团队成员 |
| `SendMessage` | `tools/send-message.ts` | 向团队成员发送消息 |
| `TeamStatus` | `tools/team-status.ts` | 检查团队状态 |
| `TeamDelete` | `tools/team-delete.ts` | 删除团队成员 |

### 事件机制

团队通过 Inbox Poller 机制进行异步通信：

- `events.ts` — 团队事件发布/订阅
- `inbox-poller.ts` — 收件箱轮询器
- `team-native-control.ts` — 团队原生控制

## 工具系统 (`src/renderer/src/lib/tools/`)

### 工具注册流程

工具注册采用分阶段模式：

```typescript
// src/renderer/src/lib/tools/index.ts
registerAllTools():  // 一次性注册所有核心工具
  1. registerTaskTools()     — 任务管理
  2. registerFsTools()       — 文件系统
  3. registerSearchTools()   — 搜索
  4. registerBashTools()     — Shell 执行
  5. registerWidgetTools()   — 小部件
  6. registerAskUserTools()  — 询问用户
  7. registerPlanTools()     — 计划
  8. registerCronTools()     — 定时任务
  9. registerNotifyTool()    — 通知
  10. registerGoalTools()    — 目标追踪
  11. registerMemoryTools()  — 记忆系统
  12. refreshDynamicToolCatalog()  — 动态工具目录（技能/子代理）
  13. registerCodeCompatibleTools() — 代码兼容工具
  14. registerTeamTools()    — 团队工具
```

### ToolContext

每个工具执行时接收 `ToolContext`：

```typescript
interface ToolContext {
  sessionId: string
  workingFolder?: string
  signal: AbortSignal
  provider: ProviderConfig
  // ...
}
```

### 25+ 工具列表

| 工具 | 文件 | 功能 |
|------|------|------|
| `Read` | `fs-tool.ts` | 读取文件 |
| `Write` | `fs-tool.ts` | 写入文件 |
| `Edit` | `fs-tool.ts` | 编辑文件 |
| `Glob` | `fs-tool.ts` | 文件模式匹配 |
| `Grep` | `search-tool.ts` | 文本搜索 |
| `Bash` | `bash-tool.ts` | Shell 命令执行 |
| `WebSearch` | `web-search-tool.ts` | 网页搜索 |
| `TodoCreate` | `todo-tool.ts` | 创建任务 |
| `TodoUpdate` | `todo-tool.ts` | 更新任务 |
| `TodoDelete` | `todo-tool.ts` | 删除任务 |
| `AskUser` | `ask-user-tool.ts` | 询问用户 |
| `PlanModeEnter` | `plan-tool.ts` | 进入计划模式 |
| `PlanModeExit` | `plan-tool.ts` | 退出计划模式 |
| `CronCreate` | `cron-tool.ts` | 创建定时任务 |
| `CronDelete` | `cron-tool.ts` | 删除定时任务 |
| `Notify` | `notify-tool.ts` | 发送通知 |
| `GoalCreate` | `goal-tool.ts` | 创建目标 |
| `GoalComplete` | `goal-tool.ts` | 完成目标 |
| `MemoryUpdate` | `memory-tool.ts` | 更新记忆文件 |
| `WidgetCreate` | `widget-tool.ts` | 创建小部件 |
| `Browser` | `browser-tool.ts` | 浏览器操作 |
| `Skill` | `skill-tool.ts` | 技能执行 |
| `TeamCreate` | `teams/tools/` | 创建团队 |
| `SendMessage` | `teams/tools/` | 发送消息 |
| `TeamStatus` | `teams/tools/` | 团队状态 |
| `TeamDelete` | `teams/tools/` | 删除团队 |
| `CodeCompatible` | `code-compatible-tool.ts` | 代码兼容模式 |

## 提示词系统 (`src/renderer/src/lib/prompts/`)

### 提示词加载器 (`prompt-loader.ts`)

- 从 `resources/prompts/` 加载系统提示词文件
- 每个模式（chat/clarify/cowork/code/acp）有自己的提示词模板
- 支持动态注入上下文（记忆文件、目标、动态上下文）

### 系统提示词文件

模式提示词通过 `src/renderer/src/lib/prompts/prompt-loader.ts` 加载，结合 `resources/prompts/` 目录下的 MD 文件组成完整的系统提示词。

## 事件协议 (`src/shared/agent-stream-protocol.ts`)

Agent 运行时与 UI 之间的事件流定义，40+ 事件类型：

### 生命周期事件
- `loop_start` / `iteration_start` / `iteration_end` / `loop_end`

### 流式 Delta 事件
- `text_delta` / `thinking_delta` / `tool_use_args_delta`

### 消息事件
- `message_end` — 消息完成（含用量统计）

### 工具事件
- `tool_use_streaming_start` / `tool_use_args_delta` / `tool_use_generated`
- `tool_call_start` / `tool_call_update` / `tool_call_approval_needed` / `tool_call_result`

### 子代理事件
- `sub_agent_queued` / `sub_agent_start` / `sub_agent_iteration`
- `sub_agent_text_delta` / `sub_agent_end`
- 以及完整的 `sub_agent_tool_*` 事件链

### 错误和重试
- `request_retry` / `error`

### 调试和压缩
- `request_debug` / `context_compression_start` / `context_compressed`

每个事件打包为 `AgentStreamEnvelope`：

```typescript
interface AgentStreamEnvelope {
  v: 1                    // 协议版本
  runId: string           // 运行 ID
  sessionId: string       // 会话 ID
  seq: number             // 序列号
  events: AgentStreamEvent[]  // 事件列表
}
```