# Pioneering 桌面 Agent 产品化落地方案

> 基于 WorkBuddy（腾讯云）、Trae、Cherry Studio、Claude Desktop 等业界桌面 Agent 产品的架构分析，
> 结合 pioneering 现有三层架构（`apps/desktop` + `apps/backend-ts` + `packages/modu-agent`）制定的产品化演进方案。
>
> 关联文档：`04-agent-capability-assessment.md`、`05-agent-refactor-plan.md`、`优化迭代方案.md`

---

## 一、现状诊断

### 1.1 当前架构

```
┌────────────────────────────────────────────────────┐
│ apps/desktop (Electron 壳)                          │
│   主进程：窗口/文件/剪贴板 (IPC)                       │
│   渲染进程：React UI + AG-UI SSE 客户端 (agui.ts)     │
└──────────────────┬─────────────────────────────────┘
        HTTP + SSE (AG-UI 协议, 127.0.0.1:8088)
                   ▼
┌────────────────────────────────────────────────────┐
│ apps/backend-ts (Fastify)                           │
│   routes/agent.ts → core/agent-bridge.ts            │
│   认证 / Prisma DB / 会话持久化                       │
└──────────────────┬─────────────────────────────────┘
            进程内 import（npm workspace）
                   ▼
┌────────────────────────────────────────────────────┐
│ packages/modu-agent (LangGraph Agent 运行时)         │
│   感知→记忆→ReAct 循环→工具/MCP→反馈→记忆更新          │
└────────────────────────────────────────────────────┘
```

### 1.2 产品化缺口（对照 WorkBuddy）

| 维度 | WorkBuddy | pioneering 现状 | 缺口等级 |
|---|---|---|---|
| 开箱即用 | 单安装包，双击即用 | 需手动启动 backend-ts 进程 | ★★★ 致命 |
| 执行模式 | 云端沙箱 + 本地执行双模路由 | 仅本地单模 | ★★ 重要 |
| 记忆机制 | 本地 Markdown 文件 + 云端 Memory | ChromaStore 向量（默认关闭） | ★★ 重要 |
| 技能生态 | Skills 一次编写多端运行 | skills 模块已有但未产品化 | ★★ 重要 |
| 配置管理 | 桌面端可视化配置 | LLM key 靠后端环境变量；token 存内存 Map 重启丢失 | ★★★ 致命 |
| HITL 审批 | 敏感操作弹窗审批 | `requiresApproval()` 钩子已有，UI 未接通 | ★★ 重要 |
| 多端入口 | 桌面 / 企微 / 飞书 / 钉钉 | 仅桌面 + Web | ★ 一般 |

### 1.3 现有资产盘点（可直接复用）

- **AG-UI 事件协议**：桌面 `agui.ts` 与 `AGUIStreamAdapter` 已形成稳定契约（20 种事件），是所有方案的不变量。
- **modu-agent 纯 TypeScript**：无 Python 依赖，可内嵌 Electron、可 bundle 成 sidecar —— 这是相比同类项目的稀缺优势。
- **HITL 基础设施**：`BaseTool.requiresApproval()` + `resume_stream()` 已实现，只差 UI 回环。
- **SqliteSaver / ChromaStore**：本地持久化能力已具备。
- **MCP 客户端**：`src/mcp/` 完整（Stdio/SSE 传输 + 发现 + 生命周期），仅默认关闭。

---

## 二、目标产品形态

**定位**：开箱即用的本地优先（local-first）桌面 AI Agent 工作台，参照 WorkBuddy 的"厚 Agent 核 + 薄交互壳"哲学。

**核心原则**（源自 WorkBuddy 启发）：

1. **薄壳原则**：Electron 只做 UI 与系统能力入口，agent 核心保持进程/包级独立，未来可复用到 CLI、Web、IM 机器人多端。
2. **双模执行**：本地执行为默认（数据安全），云端模式为可选（连接远程 backend-ts，服务团队版）。
3. **文件式记忆优先**：人类可读、可审计的 Markdown 记忆为主，向量检索为辅。
4. **审批回环内建**：高危工具必须经用户批准，这是桌面 Agent 的信任底线。

---

## 三、总体技术方案：Sidecar 双模架构

在此前讨论的方案 A（Sidecar）与方案 C（混合模式）基础上合并演进：

```
┌───────────────────────────────────────────────────────────────┐
│ Pioneering Desktop（单安装包）                                   │
│                                                                │
│  ┌─────────────┐    IPC     ┌──────────────────────────────┐  │
│  │ 渲染进程      │◄──────────►│ 主进程                        │  │
│  │ React UI     │            │  ├ SidecarManager（新增）      │  │
│  │ agui.ts(复用) │            │  ├ SecretsService（新增）      │  │
│  └──────┬──────┘            │  └ 现有 IPC handlers          │  │
│         │                   └──────────┬───────────────────┘  │
│         │ HTTP+SSE (AG-UI)             │ utilityProcess.fork   │
│         ▼                              ▼                       │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Sidecar: server.mjs（backend-ts + modu-agent 打包产物）     │ │
│  │  ├ 本地模式：SQLite + 文件记忆 + 本地工具执行                │ │
│  │  └ MCP 子进程管理（stdio spawn）                            │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
         │
         │ （可选）云端模式：baseURL 切到远程 backend-ts
         ▼
   远程 backend-ts（团队版：多用户/认证/共享会话）
```

**为什么选 Sidecar 而非主进程内嵌（Cherry Studio 模式）：**

1. AG-UI SSE 契约零改动，渲染端 `agui.ts`、`chatStore` 完全复用。
2. backend-ts 的路由/持久化/StreamContext 逻辑全部保留，不需要在主进程重建会话存储。
3. Agent 崩溃不拖垮 UI 进程，可独立重启。
4. 同一份 sidecar 产物即是远程部署产物，天然支撑双模（对齐 WorkBuddy"同源底座"思想）。
5. 未来接入 CLI / IM 机器人时，直接复用 sidecar HTTP 接口。

---

## 四、分阶段落地计划

### Phase 1：单包化（P0，预计 2 周）—— 解决"开箱即用"

#### 1.1 Sidecar 打包（backend-ts 侧）

- 新增 `apps/backend-ts/scripts/bundle.ts`，用 esbuild 将 `src/index.ts` + `@pioneering/modu-agent` bundle 为单文件 `dist-bundle/server.mjs`：
  - external：`better-sqlite3`、`@prisma/client`、`chromadb` 等 native/重依赖，单独复制到 `dist-bundle/node_modules/`。
  - Prisma：预生成 client + 复制对应平台 query engine；本地模式 datasource 指向 `app.getPath('userData')/pioneering.db`。
- 环境变量改为启动参数/注入：`PORT`（动态）、`DATA_DIR`、`MODE=local`。

#### 1.2 主进程 SidecarManager（desktop 侧）

新增 `apps/desktop/src/main/sidecar-manager.ts`：

```ts
class SidecarManager {
  async start(): Promise<{ port: number }>  // 动态端口 + utilityProcess.fork + /health 轮询就绪
  async stop(): Promise<void>               // 优雅退出，超时 SIGKILL
  onCrash(cb): void                         // 崩溃自动重启（指数退避，最多 3 次）
}
```

- 启动时序：`app.whenReady()` → 启 sidecar → health 就绪 → 通过 IPC 把 `baseURL` 注入渲染进程 → 加载 UI。
- 退出时序：`app.on('before-quit')` → `stop()`。

#### 1.3 electron-builder 配置

```jsonc
// apps/desktop/package.json → build
{
  "files": ["out", "package.json"],
  "extraResources": [
    { "from": "../backend-ts/dist-bundle", "to": "server" }
  ],
  "asarUnpack": ["**/*.node"]
}
```

- 将 `apps/desktop` 加入根 `package.json` workspaces，统一依赖管理。
- CI：`npm run bundle -w @pioneering/backend && npm run build:mac -w desktop`。

#### 1.4 配置与密钥安全化

- 替换主进程内存 Map store：引入 `electron-store` + `safeStorage` 加密。
- 新增设置页「模型与密钥」：用户填写 LLM API key（deepseek/glm/gpt/qwen）→ 加密落盘 → 启动 sidecar 时经 env 注入（替代现在的后端环境变量方式）。
- 本地模式跳过登录鉴权（sidecar 以 `MODE=local` 启动时签发本地 token）。

**验收标准**：从 dmg/nsis 安装后双击即可完整使用 Agent 功能，无需任何终端操作。

### Phase 2：双模执行 + HITL 审批（P1，预计 3 周）—— 对齐 WorkBuddy 核心竞争力

#### 2.1 本地/云端双模切换

- 设置页新增「运行模式」：`本地模式`（默认，连 sidecar）/ `云端模式`（连远程 backend-ts，团队版）。
- 复用现有 `ApiConnectionSection` 的 baseURL 探活逻辑，增加模式标识与数据迁移提示。
- 会话数据归属：本地会话存本地 SQLite，云端会话存远端 DB，UI 侧按 badge 区分。

#### 2.2 HITL 审批回环（打通已有钩子）

现状：`modu-agent` 的 `requiresApproval()` + `resume_stream()` 已实现，backend-ts 与 UI 未接通。

- backend-ts：`/agent/completions` 流中转发 `APPROVAL_REQUIRED` 事件（AG-UI 扩展事件）；新增 `POST /agent/executions/:id/approve|reject` → 调 `resume_stream()`。
- desktop：`agui.ts` 增加 `APPROVAL_REQUIRED` 分支 → `chatStore` 挂起状态 → `ToolCallCard` 渲染「批准 / 拒绝」按钮 → 审批结果回传后流恢复。
- 默认策略（借鉴 WorkBuddy 敏感操作判定）：`file-ops`（写/删）、`code-executor`、`sql-query`（写操作）、`http-request`（非 GET）默认需审批；`calculator`、`search`、`datetime` 免审批。设置页提供白名单管理。

#### 2.3 高危工具沙箱加固

- `code-executor` 限制工作目录至会话工作区（`userData/workspaces/<sessionId>`）。
- `file-ops` 复用 desktop 主进程已有的路径白名单校验思路，在 sidecar 内做二次校验。

**验收标准**：Agent 执行写文件/跑代码前 UI 弹审批卡片；拒绝后 Agent 收到反馈并调整策略；本地/云端模式可在设置页一键切换。

### Phase 3：文件式记忆 + Skills 产品化（P1.5，预计 3 周）—— WorkBuddy 式差异化

#### 3.1 文件式记忆（`.pioneering/memory/`）

借鉴 WorkBuddy 的 `.workbuddy/memory/YYYY-MM-DD.md` 机制：

- modu-agent 新增 `FileMemoryStore`（实现现有 `BaseMemory` 接口）：
  - 会话结束（`memory_update` 节点）时由 LLM 生成当日工作摘要，追加写入 `<DATA_DIR>/memory/YYYY-MM-DD.md`。
  - `memory_query` 节点：加载最近 N 天记忆文件 + 现有 ChromaStore 语义检索，两路合并注入上下文。
- 双层记忆架构：**Markdown 文件层**（人类可读、可审计、可手改）+ **向量层**（语义召回），文件层为 source of truth，向量层为索引。
- 桌面端新增「记忆」面板：按日历浏览/编辑/删除记忆条目（直接读写 md 文件）。

#### 3.2 Skills 技能面板

现状：`modu-agent/src/skills/`（SkillLoader / SkillPromptAggregator / SkillToolWrapper）已实现，默认关闭。

- 定义 skill 包格式：`<DATA_DIR>/skills/<name>/skill.json`（名称/描述/提示词/依赖工具/触发条件）。
- backend-ts 暴露 `GET/POST /agent/skills`（列表/启停/安装）。
- 桌面端新增「技能」页：技能卡片列表、开关、从本地文件夹导入。
- 内置 3~5 个示范技能（对齐 WorkBuddy"内置技能包"策略）：日报助手、文件整理、数据分析、会议纪要。

#### 3.3 MCP 可视化管理

- 打开 `mcp.enabled`，配置文件放 `<DATA_DIR>/mcp.json`（对齐 Claude Desktop 的配置格式，降低生态迁移成本）。
- 桌面端新增「MCP 服务器」设置区：增删改 server、连接状态、工具列表预览。
- sidecar 负责 MCP 子进程生命周期（复用 `ServerLifecycleManager`）。

**验收标准**：用户可在 UI 中查看/编辑 Agent 记忆；可安装启停技能；可添加 stdio MCP server 并在对话中调用其工具。

### Phase 4：多端入口与生态（P2，预计 4 周+）

- **定时/后台任务**：sidecar 常驻 + 任务调度器（cron），对齐 WorkBuddy 云端沙箱的"定时任务"能力（本地版实现）。
- **系统托盘 + 全局快捷键**：最小化到托盘持续运行，快捷键唤起快速指令输入框（薄壳入口极致化）。
- **IM 机器人入口**（可选）：backend-ts 增加企微/飞书 webhook 路由，复用同一 agent 核（验证"一次编写多端运行"）。
- **技能 SDK 与分发**：skill 包签名校验、版本管理，为技能市场预留。

---

## 五、关键技术决策记录（ADR）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | agent 核集成方式 | Sidecar 子进程（非主进程内嵌） | AG-UI 契约零改动；进程隔离；同源产物支撑双模；多端复用 |
| 2 | 壳↔核协议 | 保留 AG-UI over HTTP/SSE | 已稳定运行；换 ACP/IPC 收益不抵改造成本；Phase 4 若接 Zed 生态再评估 ACP |
| 3 | 本地数据库 | SQLite（Prisma + SqliteSaver 双份收敛为单库） | 免部署；modu-agent checkpointer 已支持 |
| 4 | 密钥存储 | `safeStorage` OS 级加密 + electron-store | 替换内存 Map；不引入 keytar native 依赖 |
| 5 | 记忆架构 | Markdown 文件层 + 向量索引层 | WorkBuddy 验证的可审计模式；文件为真、向量为索引 |
| 6 | MCP 配置格式 | 兼容 Claude Desktop `mcp.json` | 用户可直接迁移已有 MCP 配置，生态借力 |
| 7 | 审批策略 | 工具级默认策略 + 用户白名单 | 复用 `requiresApproval()`；安全与流畅度平衡 |

---

## 六、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Prisma engine 跨平台打包复杂 | Phase 1 延期 | 备选：本地模式改用 `better-sqlite3` 直写（modu-agent SqliteSaver 已用），Prisma 仅保留云端模式 |
| esbuild bundle ESM/CJS 互操作问题（LangChain 依赖链复杂） | sidecar 启动失败 | 保底方案：不 bundle，`extraResources` 整体复制 `node_modules`（体积换稳定），后续再优化 |
| native 模块 ABI 与 Electron 不匹配 | 崩溃 | sidecar 用 `utilityProcess`（Node ABI 同 Electron）或独立 Node runtime 分发；CI 三平台构建验证 |
| 端口占用/防火墙弹窗 | 首启体验差 | 动态端口 + 仅监听 127.0.0.1；长期可评估切 Unix socket / named pipe |
| 本地模式跳过鉴权的安全边界 | 本机恶意进程调用 sidecar | sidecar 启动时生成一次性 token，经 IPC 注入渲染进程，所有请求校验 |

---

## 七、里程碑总览

```
Phase 1  单包化（2周）        ██████░░░░░░░░░░░░  开箱即用 = 产品成立的前提
Phase 2  双模+HITL（3周）     ░░░░░░██████░░░░░░  信任与安全 = 桌面 Agent 底线
Phase 3  记忆+Skills（3周）   ░░░░░░░░░░░░██████  差异化能力 = 留存的理由
Phase 4  多端+生态（4周+）    ░░░░░░░░░░░░░░░░██  规模化 = 增长曲线
```

**北极星验收**：新用户从下载安装包到完成第一个"带工具调用 + 审批 + 记忆沉淀"的 Agent 任务，全程 ≤ 5 分钟、零终端操作。
