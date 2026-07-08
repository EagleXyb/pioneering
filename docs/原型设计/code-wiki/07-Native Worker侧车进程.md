# 07 - Native Worker 侧车进程

## 概述

Native Worker 是一个独立的 .NET 10.0 Native AOT 进程，作为 Electron 主进程的"侧车"（sidecar）运行。它负责处理计算密集型任务，包括 Agent 运行时、数据库操作、文件处理等，减轻主进程的负担。

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| .NET | 10.0 | 运行时框架 |
| Native AOT | — | 预编译为原生二进制（无 JIT） |
| Named Pipes | Win32 | Windows 进程间通信 |
| Unix Domain Sockets | — | macOS/Linux 进程间通信 |
| MessagePack | — | 二进制序列化帧协议 |

## IPC 通信

### 通信协议

```
┌─────────────────────────────────────────────────┐
│  MessagePack 帧协议                               │
│                                                   │
│  [4字节长度头][MessagePack 编码的请求/响应体]      │
│  ─────────────── ───────────────────────────────  │
│  Big-Endian     │  MessagePack 序列化数据          │
│  UInt32         │                                 │
│                                                    │
│  请求格式: { "method": "xxx", "args": {...} }      │
│  响应格式: { "ok": true, "data": ... }             │
│           { "ok": false, "error": "..." }          │
└─────────────────────────────────────────────────┘
```

### 主进程侧的 Worker Manager

`src/main/lib/native-worker.ts` 负责：

1. **启动**：生成 Worker 进程，等待连接
2. **连接**：创建 Named Pipe / Unix Socket
3. **心跳**：`worker/ping` 定期检查
4. **路由验证**：`worker/routes` 确认可用方法
5. **请求路由**：发送请求并等待响应
6. **关闭**：优雅终止 Worker 进程

```typescript
class NativeWorkerManager {
  async ensureStarted(): Promise<void>    // 启动 Worker
  async invoke<T>(method: string, args: unknown): Promise<T>  // 调用方法
  async stop(): Promise<void>             // 停止 Worker
  async getRoutes(): Promise<string[]>    // 获取可用方法列表
}
```

## 架构

### 进程架构

```
Program.cs
    │
    ▼
WorkerHost
    │
    ▼
WorkerDispatcher  ←── MessagePack 帧解码/编码
    │
    ├── System 模块
    ├── File 模块
    ├── Git 模块
    ├── Db 模块
    ├── Sync 模块
    ├── Settings 模块
    ├── Config 模块
    ├── ChannelConfig 模块
    ├── Skill 模块
    ├── Extension 模块
    ├── AgentRuntime 模块（核心！~40+ 文件）
    ├── AgentChange 模块
    ├── OpenAIImages 模块
    ├── OpenAIAudio 模块
    ├── Web 模块
    ├── McpConfig 模块
    ├── UserContent 模块
    ├── Shell 模块
    ├── Terminal 模块
    ├── Ssh 模块
    └── Extensions 模块
```

### WorkerDispatcher

WorkerDispatcher 是请求路由的核心：

- 接收 Named Pipe 上的 MessagePack 帧
- 解码请求方法名和参数
- 根据方法名路由到对应模块的处理函数
- 编码响应并写回 Pipe

## 20 个模块

### 1. System 模块
- `worker/ping` — 心跳检查
- `worker/routes` — 获取所有可用路由
- `system/info` — 系统信息
- `system/version` — 版本信息

### 2. File 模块
- 文件读写操作
- 文件搜索和遍历
- 文件元数据

### 3. Git 模块
- Git 状态查询
- Git 操作（add/commit/push/pull）
- Git diff 和日志

### 4. Db 模块
- SQLite 数据库连接管理
- 所有数据库 CRUD 操作
- 事务支持

### 5. Sync 模块
- WebDAV 同步引擎
- 三路合并（push/pull/twoway）
- 冲突检测

### 6. Settings 模块
- 应用设置读写
- 设置缓存管理

### 7. Config 模块
- 配置管理
- 配置文件读写

### 8. ChannelConfig 模块
- 消息渠道配置管理
- 渠道状态管理

### 9. Skill 模块
- 技能元数据管理
- 技能加载和验证

### 10. Extension 模块
- 扩展元数据管理
- 扩展配置

### 11. AgentRuntime 模块（核心！）

这是最重要、最复杂的模块，约 40+ 个文件。

#### 支持的 LLM 提供商

| 提供商 | API 类型 |
|--------|---------|
| Anthropic | Messages API （Claude） |
| OpenAI | Responses API （GPT） |
| Google | Gemini API |

#### 工具执行引擎

Agent 运行时支持在 .NET 侧执行 10+ 类工具：

| 工具类别 | 说明 |
|---------|------|
| 文件工具 | Read / Write / Edit / Glob / Grep |
| Shell 工具 | Bash 命令执行 |
| SSH 工具 | 远程服务器命令执行 |
| 网页工具 | 网页搜索和抓取 |
| 子代理工具 | 创建和管理子代理 |
| 团队工具 | 创建和管理团队 |
| 技能工具 | 加载和执行技能 |
| MCP 工具 | 调用 MCP 服务器工具 |
| 扩展工具 | 执行自定义扩展工具 |
| 记忆工具 | 读写记忆文件 |
| 图片生成 | DALL-E / Stable Diffusion 等 |
| 桌面自动化 | 鼠标/键盘/GUI 操作 |

#### 流式响应处理

```
LLM API 流式响应
    │
    ├── text_delta → 文本增量
    ├── thinking_delta → 思考过程增量
    ├── tool_use_args_delta → 工具调用参数增量
    └── message_end → 消息完成
          │
          ▼
    AgentStreamEnvelope 编码
          │
          ▼
    Named Pipe 写入 → Electron 主进程 → 渲染进程
```

### 12. AgentChange 模块
- Agent 变更审核
- 变更记录管理

### 13. OpenAIImages 模块
- DALL-E 图片生成
- 图片编辑和变体

### 14. OpenAIAudio 模块
- 语音转文字（Whisper）
- 文字转语音（TTS）

### 15. Web 模块
- HTTP 请求处理
- 网页内容抓取

### 16. McpConfig 模块
- MCP 服务器配置管理
- MCP 工具列表缓存

### 17. UserContent 模块
- 用户内容管理
- 内容审核

### 18. Shell 模块
- Shell 命令执行
- 输出流管理

### 19. Terminal 模块
- 终端会话管理
- PTY 分配

### 20. Ssh 模块
- SSH 连接管理
- SFTP 文件传输

## 启动流程

```
Electron 应用启动
    │
    ├── 1. getNativeWorker().ensureStarted()
    │       │
    │       ├── 查找 Worker 可执行文件路径
    │       ├── 生成管道名称（UUID）
    │       ├── 创建 Named Pipe 服务器
    │       ├── spawn Worker 进程，传入 --ipc <pipeName>
    │       ├── 等待 Worker 连接
    │       ├── 发送 worker/ping 验证
    │       ├── 发送 worker/routes 获取可用方法列表
    │       └── 返回 ready
    │
    ├── 2. registerAllMessagePackHandlers()
    ├── 3. 继续其他启动步骤
    │
    └── 应用关闭
            │
            └── stopNativeWorker()
                    ├── 发送关闭信号
                    ├── 等待进程退出（超时 5s）
                    └── 强制终止（如果超时）
```

## 与 Electron 主进程的职责分工

| 职责 | 由谁处理 |
|------|---------|
| 窗口管理 | Electron 主进程 |
| 原生菜单和托盘 | Electron 主进程 |
| 文件对话框 | Electron 主进程 |
| Agent 运行时逻辑 | Native Worker |
| 数据库操作 | Native Worker |
| LLM API 调用 | Native Worker |
| 设置管理 | Native Worker |
| 同步引擎 | Native Worker |
| 工具执行 | 渲染进程（UI 工具）/ Native Worker（后台工具） |
| SSH 连接管理 | Electron 主进程 |
| MCP 客户端管理 | Electron 主进程 |
| 消息渠道管理 | Electron 主进程 |