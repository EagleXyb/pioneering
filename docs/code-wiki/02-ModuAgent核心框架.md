# ModuAgent 核心框架

> **修订说明（2026-08-26，依据 `packages/modu-agent` 全量代码核对）**：
>
> 1. **模块位置整体迁移**：ModuAgent 已从旧 Python 版（`apps/backend/ModuAgent`）重写为 TypeScript 包 **`@pioneering/modu-agent` v0.1.0**，位于 [packages/modu-agent](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent)。ESM 包（`"type": "module"`），入口 `dist/index.js`，二级导出 `./core`、`./graph`、`./mcp`、`./skills`（依据：[package.json](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/package.json#L1-L13)）。旧 Python 版描述已全部移除。
> 2. **依赖关系**：硬依赖仅 5 项——`@langchain/core ^0.3`、`@langchain/langgraph ^0.2`、`@langchain/openai ^0.3`、`@modelcontextprotocol/sdk ^1.0`、`zod ^3.23`；OTel / better-sqlite3 / chromadb / prom-client 为可选依赖，缺失时自动降级（依据：[package.json](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/package.json#L18-L38)）。构建 `tsc -p tsconfig.build.json`，测试 `vitest run`（依据：[package.json](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/package.json#L14-L17)）。
> 3. **高级能力状态更新**：原文档"Plan-and-Execute ❌ / Skills 高级特性 ❌ / MCP 完全不具备"的结论全部过时——三者均已在 TS 版实现（分别见 P4 / P1 / MCP 集成章节），默认以配置开关关闭。
> 4. **新增章节**：配置层（config/）、图适配器层（graph/adapters/）、HITL 审批链路、已知限制与未实现项。

## 目录结构

```
packages/modu-agent/
├── src/
│   ├── config/              # 配置管理（RuntimeConfig 热更新 + schemas 校验
│   │                        #   + Markdown 提示注入 + 环境变量治理 + 首装默认模板）
│   ├── core/                # 核心抽象
│   │   ├── interfaces/      # 组件接口协议（action/llm/memory/perception/reasoning/feedback/skill）
│   │   ├── registry.ts      # 组件注册中心（11 类组件）
│   │   └── index.ts
│   ├── evolution/           # 进化机制（编排器/组件替换/参数调优/回滚/版本化存储）
│   ├── feedback/            # 反馈闭环（loop-controller/quality-monitor/evolution-signal
│   │   └── metrics/         #   + accuracy/efficiency 指标）
│   ├── graph/               # LangGraph 编排层
│   │   ├── adapters/        # LLM/工具/存储/事件/MCP 适配器 + 重试/限流/缓存/蒸馏
│   │   ├── plan-execute/    # Plan-and-Execute 模式（planner/dispatcher）
│   │   └── subgraph/        # 多 Agent 子图（supervisor/builder）
│   ├── mcp/                 # MCP 集成（client/discovery/lifecycle/transport/errors）
│   ├── memory/              # 记忆层（短期/观察/Chroma 长期）
│   ├── observability/       # 可观测性（OTel tracing/Prometheus 指标/结构化日志）
│   ├── orchestration/       # 多 Agent 协作
│   │   ├── communication/   # 消息总线（EventBus/AG-UI/流式）
│   │   └── patterns/        # 协作模式（consensus/delegation）
│   │   └── sensor-manager.ts
│   ├── perception/          # 感知层（pipeline/fusion/text/vision/audio/security）
│   ├── reasoning/           # 推理层（LLM 适配/router/复杂度评估/prompt 组装）
│   ├── skills/              # Skills 子系统（loader/adapter/few-shot/prompt 聚合）
│   ├── tools/               # 内置工具（8 个）+ 注册表 + 护栏 + 同步执行器
│   └── index.ts             # 顶层统一导出（14 个模块 barrel）
├── tests/                   # 测试套件（约 40 个文件，含 HITL e2e / react-news e2e）
├── AGENTS.md / SOUL.md / USER.md / MEMORY.md   # Markdown 提示注入模板（frontmatter 元数据驱动）
├── config.yaml              # 默认配置模板（首装自动生成）
└── package.json / tsconfig.json / vitest.config.ts
```

（依据：目录实测；[src/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/index.ts#L4-L20) 的模块层次注释；Markdown 模板 frontmatter 见 [AGENTS.md](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/AGENTS.md#L1-L12)）

## 核心接口 (core/interfaces/)

所有组件必须实现对应的抽象基类（TS `abstract class`），确保可插拔性。Python ABC 已替换为 TypeScript 抽象类，方法命名由 snake_case 改为 camelCase（如 `parameters_schema()` → `parametersSchema()`）。

### 行动接口

[BaseTool](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts#L25-L137)（含 HITL 钩子与工具元数据，**较旧版新增 4 个元方法**）：

```typescript
export abstract class BaseTool {
  abstract name(): string
  abstract description(): string
  abstract parametersSchema(): Record<string, any>   // JSON Schema 参数定义
  abstract invoke(params, context): Promise<Record<string, any>> | Record<string, any>

  // === HITL（P3-12.3.2）===
  requiresApproval(): boolean { return false }        // 静态敏感判定
  requiresApprovalFor(params, context): boolean       // 动态参数级判定（如 file_ops 写操作）
  onApprovalRejected(params): Record<string, any>     // 审批拒绝降级响应

  // === P4 Plan-and-Execute 工具元数据 ===
  providesRealtimeData(): boolean { return false }    // Planner 据此推断 step.requires_tool

  // === 工具元数据 ===
  version(): string { return '1.0.0' }                // semver，schema 升级兼容检测
  followUpTools(): string[] { return [] }             // 推荐后续工具，注入工具描述供 LLM 参考
}
```

[BaseActionExecutor](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts#L8-L16)：`execute(actionName, params, context)` / `listActions()`。

（依据：[action.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts#L25-L137)；旧版无 `requiresApprovalFor`/`providesRealtimeData`/`version`/`followUpTools`）

### Skill 接口（P1 新增）

[BaseSkill](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/skill.ts#L14-L73) 是一等公民抽象——Skill 在运行时对图完全透明，降解为「N 个 BaseTool + 一段 system prompt 片段」：

```typescript
export abstract class BaseSkill {
  abstract name(): string
  abstract description(): string        // 面向 LLM，注入 system prompt
  abstract version(): string
  tags(): string[]                       // 分类标签
  examples(): Array<Record<string, string>>  // few-shot 示例（few-shot-selector 消费）
  preconditions(): Record<string, any>   // 前置条件声明
  requiredScopes(): string[]             // 细粒度权限 scope
  tools(): BaseTool[]                    // 内含原子工具集合（可为空，纯提示型）
  systemPromptFragment(): string | null  // 专属指令片段
  isAvailable(): boolean                 // 健康检查，false 触发降级跳过
  setup(): void                          // 注册时初始化
  teardown(): void                       // 卸载清理
}
```

（依据：[skill.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/skill.ts#L14-L73)；旧版文档无此接口）

### 其他接口

[core/interfaces/](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces) 下还定义了 `perception.ts`（BasePerception/BaseSensor）、`reasoning.ts`（BaseReasoningEngine/BaseReasoningStrategy）、`memory.ts`（BaseMemory/BaseStorageAdapter）、`feedback.ts`（BaseFeedbackLoop/BaseEvolutionSignal）、`llm.ts`（**新增 ModuLLM 统一 LLM 接口与 LLMRouter 路由接口**，供统一 LLM 双轨抽象收敛）。接口契约与旧 Python 版语义等价，命名 camelCase 化。

（依据：[core/interfaces 目录](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces)；ModuLLM/LLMRouter 见 [factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L26) 导入）

## 组件注册中心 (core/registry.ts)

[ComponentRegistry](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L43-L309) 管理全局组件，**由旧版 10 类扩展为 11 类**（新增 `skill`）。

### 关键方法

| 方法 | 说明 |
|------|------|
| `registerReasoningEngine(name, engine)` | 注册推理引擎（首个注册自动成为活跃引擎） |
| `setActiveReasoningEngine(name)` / `getActiveReasoningEngine()` | 显式追踪活跃推理引擎（P2-8，避免多引擎时依赖 Map 插入顺序） |
| `registerTool(tool)` / `getTool(name)` / `listTools()` | 工具注册/查找/清单（含 name/description/parameters_schema） |
| `registerPerception(name, p)` / `getPerception(name)` | 感知器注册（pipeline 按 routing 查找） |
| `registerMemory` / `registerStorageAdapter` / `registerSensor` / `registerFeedbackLoop` / `registerEvolutionSignal` | 其余组件注册 |
| `registerSkill(skill)` | **P1 新增**：注册 Skill 时自动将内含工具经 `SkillToolWrapper` 包装后注册进 `_tools`（执行隔离）；`isAvailable()=false` 跳过；工具名冲突跳过该工具 |
| `unregisterSkill(name)` / `listSkills()` | Skill 卸载/清单（含 version/tags/tool_count） |
| `swapComponent(category, name, component)` | 运行时热替换（进化用），支持全部 11 类 |
| `listAll()` | 列出所有已注册组件 |

（依据：[registry.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L43-L57)（11 类字段）、[L59-L95](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L59-L95)（P2-8 活跃引擎）、[L206-L236](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L206-L236)（registerSkill 自动注册工具）、[L270-L292](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L270-L292)（swapComponent））

### 全局单例函数

```typescript
const registry = getRegistry()                    // 全局单例
getRegistry(overrideRegistryInstance)             // P2-1: 测试隔离用 override 参数
const { restore } = overrideRegistry(myRegistry)  // 测试用临时替换（手动 restore）
resetRegistry()                                   // 测试清理
setSkillToolWrapperFactory(factory)               // SkillToolWrapper 工厂注入（避免 ESM 循环依赖）
```

（依据：[registry.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L323-L353)、[L22-L30](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L22-L30)；旧版 `with override_registry(...)` 上下文管理器语法已替换）

## 配置层（config/，新增章节）

### RuntimeConfig

[runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L19-L259) 定义 `DEFAULT_CONFIG`，覆盖 llm / memory / orchestration / plan_execute / tools / skills / streaming / event_bus / perception / feedback / observability / mcp / react_optimization 共 13 个配置域，支持热更新与变更回调（变更回调联动 runner 的 debounce 缓存失效，见编排层）。

**配置优先级**：`DEFAULT_CONFIG` → `config.yaml`（[yaml-loader.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/yaml-loader.ts)，带 schema 校验，类型不符自动丢弃回退默认）→ 环境变量（`MODU_LLM_PROVIDER` / `MODU_LLM_TEMPERATURE` / `MODU_MEMORY_STRATEGY` / `MODU_CONFIG_PATH` 等进入 RuntimeConfig）→ 运行时 `configurable` 覆盖（create_agent 参数）。

（依据：[runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L19-L259)；环境变量注册表见 [env.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/env.ts#L53-L59)——纯审计清单层，集中登记约 34 处 `process.env` 读取并支持脱敏快照）

### Markdown 文档提示注入（P1）

[markdown-loader.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/markdown-loader.ts) 扫描项目根目录 `AGENTS.md` / `SOUL.md` / `USER.md` / `MEMORY.md`，按 frontmatter 元数据路由：

| 文档 | inject_to | load | cascade_level | 注入目标 |
|------|-----------|------|---------------|----------|
| AGENTS.md | system_prompt | eager | global | system prompt |
| SOUL.md | system_prompt | eager | project | system prompt |
| USER.md | runtime_context | eager | user | runtime context |
| MEMORY.md | runtime_context | lazy | user | runtime context（按需加载） |

[markdown-prompt-aggregator.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/markdown-prompt-aggregator.ts) 按 priority/文档名排序聚合，并按字符预算截断（`system_prompt_max_chars=8000` / `runtime_context_max_chars=4000`，可配置）。开关：`react_optimization.markdown_prompt.enabled`，**代码默认 false，但随包分发的 [config.yaml](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/config.yaml#L3-L8) 模板显式开启**。

（依据：[factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L544-L577)（注入逻辑）；模板 frontmatter 见 [MEMORY.md](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/MEMORY.md#L1-L8)）

### 其他配置模块

| 模块 | 职责 |
|------|------|
| schemas.ts | 配置数据校验 schema |
| init-defaults.ts | 首次安装自动生成默认模板（AGENTS/SOUL/USER/MEMORY.md + config.yaml） |
| capability-registry.ts | 配置键→能力→消费模块映射，审计配置消费面 |
| snapshot.ts | `/debug/config` 溯源快照（含环境变量脱敏清单） |
| memory-md-persistence.ts | MEMORY.md 长期记忆持久化（写入经验沉淀、读取还原） |
| plugin-manifest.ts / knowledge-index.ts | 插件清单 / 知识索引 |

（依据：[config/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/index.ts#L3-L110) 导出分组）

## 编排层 (graph/)

### 图状态 (state.ts)

[ModuAgentState](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L49-L158) 由旧版 TypedDict 改为 `Annotation.Root` 状态注解（带 reducer），**字段由 30+ 扩展至 40+**，并按模式分层（[L490-L578](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L490-L578)）：`CoreState` + `HITLModeState` + `MultiAgentModeState` + `PlanExecuteModeState` + `FeedbackModeState`。

**核心字段（含新增）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages` | reducer: `messagesStateReducer` | 消息历史（自动追加） |
| `perception_result` / `cleaned_text` / `sensitivity_level` 等 | 感知结果组 | 融合结果、清洗文本、敏感度 (0-5)、注入/PII 标记 |
| `knowledge` / `tool_results` / `response` / `usage` | 记忆/工具/响应 | 与旧版语义一致（tool_results 为追加 reducer） |
| `config_overrides` | Dict | 进化产生的 per-session 配置覆盖（P0-2） |
| `pending_tool_calls` / `approval_status` 等 | HITL 字段组 | 人工审批（P3-12.3.2） |
| `subtasks` / `subtask_results` / `blackboard` | 多 Agent 字段组 | **blackboard 为新增**：子 Agent 共享黑板（浅合并 reducer） |
| `plan` / `current_step_index` / `step_results` / `replan_count` / `plan_delta` 等 | **Plan-and-Execute 字段组（P4 新增）** | 计划/进度/步骤结果/重规划计数/SSE 增量 |
| `complexity_assessment` / `reasoning_round_count` / `observation_history` / `termination_advice` | **P0 优化字段组（新增）** | 复杂度分层/Thought 轮数/蒸馏历史/终止建议 |
| `observation_memory` | P1-2 新增 | Observation 三级记忆（整体替换 reducer） |
| `artifacts` | 新增 | 产物追踪（doc_writer 等生成的文件，供前端附件卡片） |
| `task_type` / `doc_writer_succeeded` / `doc_writer_fail_count` 等 | 新增 | 文档生成任务类型识别与强制闭环计数 |

**关键 reducer 语义**：`step_results` 空数组=清空（planner 重规划）、非空=追加（[L286-L297](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L286-L297)）；`doc_writer_succeeded` / `doc_final_answer_enforced` 使用 `||` 合并（一旦 true 永不重置，[L351-L364](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L351-L364)）；`mergeSubtaskResults` 右值优先（[L17-L24](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L17-L24)）。

**版本迁移机制（新增）**：`STATE_SCHEMA_VERSION = 1` 常量 + `migrate_state()` 按 checkpoint 中版本号迁移历史状态（v0→v1 移除僵尸 `history` 字段、补齐版本号）。

（依据：[state.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L49-L158)、[L172-L175](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L172-L175)、[L389-L407](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L389-L407)；旧版文档无 plan/artifacts/P0 优化字段与版本迁移）

### 图节点 (nodes.ts)

| 节点 | 创建方式 | 说明 |
|------|----------|------|
| `perception` | `perceptionNode` / `perceptionNodeSync` / `makePerceptionNode` | 异步/同步感知管线 |
| `memory_query` | `memoryQueryNode` / `makeMemoryQueryNode(store)` | 长期记忆检索 |
| `agent` | `makeAgentNode(llm)` | LLM 推理 + Function Calling |
| `tools` | LangGraph ToolNode（无工具时 `_noopToolsNode`） | 工具执行 |
| `tool_processor` | `makeToolResultProcessor()` | 工具结果后处理（蒸馏/artifacts/事件发布） |
| `doc_gen_enforce` | `docGenEnforceNode`（内置） | **新增**：文档生成任务强制调用 doc_writer 回环节点 |
| `doc_final_answer` | `docFinalAnswerNode`（内置） | **新增**：doc_writer 成功后注入最终回复提醒 |
| `finalize_response` | `responseNode`（内置） | 生成最终响应 |
| `feedback` | `makeFeedbackNode(orchestrator)` | 质量评估与进化信号 |
| `memory_update` | `memoryUpdateNode` / `makeMemoryUpdateNode(store)` | 写入长期记忆 |
| `human_review` | `makeHumanReviewNode()` | HITL 人工审批（interrupt） |
| `supervisor` / `subagent_run` / `consensus` | `makeSubagentNode(llm)` / `makeConsensusNode(judgeLlm)` 等 | 多 Agent 协作 |
| `planner` / `step_dispatch` / `step_finalize` | plan-execute 模块 | **P4 新增**：Plan-and-Execute |

**路由函数**：`routeAfterPerception`（L458，熔断→response / 正常→memory_query）、`routeAfterAgent`（L501，有 tool_calls→tools / 无→response，含任务类型强制约束）、`routeAfterHumanReview`（L2039）、`routeAfterMemoryQuery`（L2067，支持 mode_router 配置化分叉）。**模式路由已配置化**：`orchestration.mode_router` 规则表按顺序匹配决定 supervisor/planner/默认 ReAct（[runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L88-L95)）。

（依据：[nodes.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts#L210-L2409) 导出清单；节点注册见 [graph.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L472-L510)；旧版无 doc_gen_enforce/doc_final_answer/planner 系列节点）

### 图构建与拓扑 (graph.ts)

[buildModuGraph()](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L347) 构建 StateGraph，按配置开关插入模式节点：

```
START → perception → (memory_query) → [ReAct] agent ⇄ tools → tool_processor
                                          ↕ doc_gen_enforce / doc_final_answer（业务定制回环）
                              [HITL] human_review（敏感工具调用前 interrupt）
                              [多Agent] supervisor → subagent_run → consensus
                              [Plan]   planner → step_dispatch ⇄ step_finalize
                              → finalize_response → (feedback) → memory_update → END
```

[ModuGraph](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) 是 CompiledStateGraph 的 ES 包装类：透明委托底层方法（Proxy）、显式持有 `orchestrator` 引用（替代 monkey-patch）、提供 `.compiled` 访问。

（依据：节点注册与边连接 [graph.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L472-L647)；`_noopToolsNode` [L730](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L730)）

### 工厂 (factory.ts)

[create_agent()](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L434-L701) 为 **async** 主入口（Node.js 中 MCP 工具发现是异步的），按序完成：Skills 加载（gated）→ LLM 构建 → 默认工具注册 → MCP 工具发现注册（gated）→ 工具绑定 + LLM 重试包装 → checkpointer/store 构建 → system prompt 组装（默认防幻觉 prompt → Skill 聚合 → Markdown 注入 → PromptComposer 四层组装）→ 进化编排器/复杂度评估器/蒸馏器构建 → 图编译 → ModuGraph 包装。

```typescript
const graph = await create_agent()   // 注意：async

const graph = await create_agent({
  configurable: {
    llm_provider: 'deepseek', temperature: 0.5,
    tools: ['calculator', 'search_engine'],
    checkpointer_type: 'memory', store_type: 'chroma',
    system_prompt: '你是一个助手...',
    plan_execute_enabled: true,      // P4: per-request 启用 Plan-Execute
  },
})
```

**组件构建函数与关键机制：**

| 函数/机制 | 说明 |
|-----------|------|
| `build_checkpointer(type)` | memory/sqlite/none；**MemorySaver 为模块级惰性单例**（HITL 跨请求 resume 依赖共享 checkpoint，[L153-L162](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L153-L162)）；sqlite 路径当前硬编码 `checkpoints.db`，依赖缺失时回退 MemorySaver |
| `build_store(type)` | chroma/in_memory/none；chroma 支持 `memory.chroma_persist_path` 持久化，初始化失败回退内存（[L176-L196](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L176-L196)） |
| `_build_judge_llm()` | LLM-as-Judge 评估器（quality_monitor_mode=llm/hybrid 时构造，包装为 ModuLLM） |
| `_build_llm_router()` | LLMRouter（enabled 时 RuleBasedLLMRouter 按路由表构造，否则 Passthrough） |
| `_discover_and_register_mcp_tools()` | 从已连接 MCP Server 发现工具并幂等注册到 registry（[L359-L396](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L359-L396)） |
| 默认工具注册 | `tools.register_defaults=true` 时幂等注册无风险 4 件套：`datetime` / `search_engine` / `calculator` / `doc_writer`（[L479-L496](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L479-L496)）；code_executor/sql_query/file_ops/http_request 需宿主显式注册 |
| 默认 system prompt | 防幻觉底线约束（含语言一致性、禁止编造实时数据、工具预算、文档生成交付模板等约 28 条规则，[L75-L114](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L75-L114)）；宿主传入的 system_prompt 优先 |

（依据：[factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L434-L701)；旧版 `build_chat_model`/`build_langchain_tools` 已移至 adapters/llm-adapter.ts 与 adapters/tool-adapter.ts）

### 运行器 (runner.ts)

| 函数 | 行号 | 说明 |
|------|------|------|
| `run_sync(...)` | L513 | 非流式执行，返回完整结果 |
| `process_request_compat(...)` | L876 | 兼容旧请求协议的执行入口 |
| `resume_sync(...)` | L932 | HITL 恢复（`Command({resume})`，处理最终状态与错误） |
| `get_interrupt_state(...)` | L1105 | 查询当前是否处于 HITL 暂停状态 |
| `checkInterruptTimeout(...)` | L1171 | HITL 审批超时检查（超时自动 `resume_sync(approved=false)`） |
| `sweepExpiredInterrupts(...)` | L1263 | 批量清扫过期中断 |
| `get_runner(engine)` | L679 | 获取缓存的编译图 |
| `reset_runner_cache()` | L861 | 主动失效图缓存（配置热更新传导） |

**Runner 缓存机制（P1-12.2.6）**：编译图实例按 config hash 缓存；配置变更回调经 **100ms debounce** 合并后主动失效（`llm.*` 等参数级变更可经 config_overrides 软失效，下次 get_runner 的 hash 检测兜底重建）——旧版"每次请求重建图"的问题已修复。

（依据：[runner.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts#L67-L123)（缓存与 debounce 设计注释）、[L679](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts#L679)、[L749-L822](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts#L749-L822)；旧版 `stream_response` 已由 LangGraphEventBridge 流式事件桥接替代，见下）

### 适配器层 (graph/adapters/，新增章节)

| 适配器 | 职责 |
|--------|------|
| [event-bridge.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/event-bridge.ts#L35-L57) | LangGraphEventBridge：消费 LangGraph stream，将图事件映射为 EventBus 事件（perception/memory_query/agent/tools/planner/step_finalize → EventDomain/EventAction）并透传原始事件；替代旧版 `stream_response` |
| [llm-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/llm-adapter.ts#L53-L122) | `build_chat_model()`：构建 LangChain ChatOpenAI，复用 LLM 环境变量（provider→env 映射），支持 streaming/function calling |
| [modu-llm-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/modu-llm-adapter.ts#L108-L118) | `wrap_chat_model_as_modu()`：将 ChatOpenAI 包装为统一 ModuLLM 接口（支持 bindTools/withRetry），消除 areason/ainvoke 双轨抽象 |
| [tool-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts#L209-L220) | `wrap_modu_tool()` / `build_langchain_tools()`：BaseTool→StructuredTool 包装，集成重试/限流/缓存/结果截断 |
| [tool-orchestrator.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-orchestrator.ts#L61-L79) | 多工具编排（依赖检测、输出→输入占位符引用） |
| [mcp-tool-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts#L31-L112) | MCP 远程工具→BaseTool 适配（返回标准化 {status/data/error_code} 结构） |
| [store-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/store-adapter.ts#L38-L67) | ChromaStore/InMemoryStoreAdapter：长期记忆包装为 LangGraph BaseStore |
| [observation-distiller.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/observation-distiller.ts#L158-L220) | ObservationDistiller：工具结果三层蒸馏控 Token（默认启用，异常降级返回原始内容） |
| [retry.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/retry.ts#L76-L140) | `with_tool_retry` / `apply_llm_retry`：指数退避，仅重试瞬时网络/超时故障 |
| [rate-limiter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/rate-limiter.ts#L33-L141) | ToolRateLimiter：按工具名 token bucket（全局单例） |
| [tool-result-cache.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-result-cache.ts#L39-L145) | LRU+TTL 工具结果缓存（全局单例，仅对显式配置的工具启用） |

（依据：各文件行号如上；旧版文档仅提及 llm/tool/store/event 四类，retry 单独成节，其余为 TS 版新增）

### 终止引擎 (termination-engine.ts，新增)

[termination-engine.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/termination-engine.ts) 实现推理终止判定（置信度/信息增益历史 + 终止建议，advisory 模式采集 P0-4），配合 `routeAfterAgent` 的 reasoning_budget 终止与 recursionLimit 控制。

## 感知层 (perception/)

### 管线处理

[pipeline.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/pipeline.ts) 提供同步/异步两版管线：

1. **输入路由**：按 `input_type` 从 `perception.routing` 解析感知器链，逐个调用 `registry.getPerception(...)`，前序输出文本传递给后续处理器
2. **执行模式**：`run_perception_pipeline`（串行，L25-L114）/ `run_perception_pipeline_async`（首个感知器串行建立文本基线，其余 `Promise.all` 并行，L135-L200）
3. **结果融合**：PerceptionFusion 融合多路结果

```yaml
# 感知管线配置（默认值，runtime-config.ts L188-L200）
perception:
  routing:
    text: { pipeline: ["text_preprocessor", "llm_parser"] }
    image: { pipeline: ["image_processor", "text_preprocessor"] }
    audio: { pipeline: ["audio_processor", "text_preprocessor"] }
  fusion:
    strategy: weighted_average
    weights: { text: 0.5, image: 0.3, audio: 0.2 }
```

（依据：[runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L188-L200)）

### 内置感知器与实现状态

| 感知器 | 路径 | 功能 | 实现状态 |
|--------|------|------|----------|
| TextPreprocessor | text/rule-based.ts | 文本清洗、截断、语种检测、敏感词 0-5 分级（L19-L58）、安全检测 | ✅ 完整（语种检测为 TODO 桩，L644） |
| LLMParser | text/llm-parser.ts | LLM 深度解析（意图/实体/情感/质量） | ✅ LLM 路径完整；本地 NER/情感为 TODO（无 spaCy/SnowNLP 等价库，L145/L272/L287，仅由 LLM 填充） |
| SecurityGuard | security/guard.ts | Prompt Injection/PII/API Key 检测 + LLM 二次校验（llm_judge 配置）+ 失败回退关键词 | ✅ 完整（L96-L175） |
| 安全审计 | security/audit.ts | deny/allow/audit 审计事件发布到 EventDomain.SECURITY，失败不影响主流程 | ✅ 完整（L22-L124） |
| ImageProcessor | vision/image-processor.ts | 图像理解/OCR | ⚠️ **TODO 桩**（无 pytesseract/easyocr 等价库，L78/L88/L203） |
| Camera/麦克风 | vision/camera.py→camera.ts | 摄像头/麦克风传感器 | ⚠️ **TODO 桩**（无 OpenCV/PyAudio 等价库，传感器始终不可用，L67/L99/L212/L244） |
| ASRProcessor | audio/asr-processor.ts | 语音识别 | ⚠️ **TODO 桩**（接口等价保留，返回低置信度空结果，L16/L76/L235/L246/L266） |

### 融合策略 (fusion.ts)

[fusion.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/fusion.ts#L30-L143) 支持三种策略：`weighted_average`（按模态权重合并 confidence/quality/security/sensitivity 并计算融合 security_score）、`max_confidence`、`voting`。

（依据：fusion.ts L30-L65 分发、L67-L143 加权平均实现）

## 推理层 (reasoning/)

### LLM 适配器

所有 LLM 适配器继承 [BaseLLMReasoner](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts#L56-L89)（统一 `/chat/completions` 请求、连接池、usage 统计，`invoke` 实现 L168-L220）：

| 适配器 | 文件 | 提供商 |
|--------|------|--------|
| GPTReasoner | llm/gpt.ts | OpenAI（L1-L35，按优先级解析 API key/base URL/model） |
| DeepSeekReasoner | llm/deepseek.ts | DeepSeek |
| GLMReasoner | llm/glm.ts | 智谱 GLM |
| QwenReasoner | llm/qwen.ts | 通义千问 |
| LLMRouter | llm/router.ts | PassthroughLLMRouter / RuleBasedLLMRouter（按 rules 顺序匹配路由表） |
| CostTracker | llm/cost-tracker.ts | 成本核算（cost_tracking.enabled 默认 true，发布 COST 事件） |

主流程 LLM 统一通过 graph/adapters/llm-adapter.ts 的 `build_chat_model()` 构建（LangChain ChatOpenAI），自研 BaseLLMReasoner 路径与 LangChain 路径并存，经 `wrap_chat_model_as_modu` 统一为 ModuLLM 接口。

### 其他推理组件

| 组件 | 文件 | 说明 |
|------|------|------|
| ComplexityAssessor | complexity-assessor.ts | P0-1 复杂度分层评估（LLM 失败自动回退规则化评估） |
| PromptComposer | prompt-composer.ts | P1-4 四层 Prompt 解耦（systemCore + domain + taskSpec + runtimeContext） |
| CoTAnchors | cot-anchors.ts | P0-2 CoT 锚点 + 反思后缀 |
| DomainAdapters | domain-adapters.ts | 领域适配 |
| RuleEngine | symbolic/rule-engine.ts | 符号规则推理 |

（依据：[reasoning/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/index.ts#L1-L32) 导出清单）

### 重试机制 (graph/adapters/retry.ts)

`apply_llm_retry()` 为 LLM 调用添加指数退避重试：仅重试瞬时网络异常（不重试 4xx/格式错误）；配置 `llm.retry.max_attempts`（默认 2）。工厂中「先 bindTools 再 apply_retry」以规避 RunnableRetry 不支持 bind_tools（[factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L511-L515)）。

## 行动层 (tools/)

### 内置工具（8 个，较旧版新增 doc_writer）

| 工具 | 文件 | 功能 | 默认注册 | 审批 |
|------|------|------|----------|------|
| CalculatorTool | calculator.ts | 数学计算 | ✅ | 否 |
| DateTimeTool | datetime-tool.ts | 日期时间查询（strftime 格式化） | ✅ | 否 |
| SearchTool | search.ts | 网络搜索（Tavily API） | ✅ | 否 |
| DocWriterTool | doc-writer.ts（**新增**） | 文档生成（auto_name 生成 {title}_{YYYY-MM-DD}.md，写入 artifacts 追踪） | ✅ | 否 |
| CodeExecutorTool | code-executor.ts | 代码执行 | ❌ 需宿主注册 | 是 |
| FileOpsTool | file-ops.ts | 文件读写 | ❌ 需宿主注册 | 是（写操作，`requiresApprovalFor` 参数级判定） |
| HttpRequestTool | http-request.ts | HTTP 请求 | ❌ 需宿主注册 | 否 |
| SqlQueryTool | sql-query.ts | SQL 查询（强制参数化占位符，仅 SELECT） | ❌ 需宿主注册 | 是 |

默认注册受 `tools.register_defaults`（默认 true）控制，注册幂等（[factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L479-L496)）。

**审批判定链**：`requiresApprovalFor(params, context)`（参数级动态判定，回退 `requiresApproval()` 静态判定）∪ `tools.human_in_loop.sensitive_tools` 配置列表（默认 `["code_executor", "sql_query", "file_ops_write"]`）。

### 执行器与护栏

- SyncActionExecutor（synchronous-executor.ts L29）：同步执行器
- tool-guardrails.ts：工具安全护栏规则
- tool-registry.ts：工具能力矩阵

（依据：各工具类导出位置见 tools/ 目录 grep 结果；审批钩子见 [action.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts#L34-L73)；sensitive_tools 默认值见 [runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L116-L121)）

## 记忆层 (memory/)

| 组件 | 文件 | 说明 |
|------|------|------|
| InMemoryShortTermMemory | short-term-memory.ts | 内存短期缓存 |
| ChromaLongTermMemory | chroma.ts | ChromaDB 向量存储（`MODU_CHROMA_IN_MEMORY`/`MODU_CHROMA_PATH` 环境变量；持久化路径 `memory.chroma_persist_path`，默认 null=内存模式） |
| ObservationMemory | observation-memory.ts | P1-2 Observation 三级记忆（serialize 整体替换写入 state） |

**注意**：短期会话记忆由 LangGraph Checkpointer 管理（MemorySaver 惰性单例 / SqliteSaver 可选），长期记忆由 BaseStore 包装（ChromaStore / InMemoryStoreAdapter），经 store-adapter 接入图节点。

（依据：[memory/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/memory/index.ts#L1-L13)；chroma_persist_path 消费见 [factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L186-L191)；旧版"cache/short_term_memory.py、vector/chroma.py"路径已废弃）

## 反馈进化闭环

### 流程

```
response生成
    │
    ▼
feedback_node（图中节点，feedback.enable_evolution=true 时启用）
    │
    ├─→ FeedbackLoop.evaluate()
    │       ├─→ QualityMonitor.evaluate()
    │       │    ├─ rule模式：规则评估（默认）
    │       │    ├─ llm模式：LLM-as-Judge（独立 judge LLM，temperature=0）
    │       │    └─ hybrid模式：规则初筛 + LLM复核
    │       └─→ EvolutionSignal 收集
    │
    └─→ should_evolve? (evolution_threshold=0.6, min_sample_size=10)
            ├─ Yes → EvolutionOrchestrator
            │       ├─→ ParameterTuneStrategy → config_overrides 写入 State
            │       │    （下次请求经 _loadPrevConfigOverrides 应用新参数）
            │       └─→ ComponentSwapStrategy → swapComponent / 重建图
            └─ No → 结束
```

### 质量监控模式

| 模式 | 说明 |
|------|------|
| `rule` | 规则评估（默认，无需额外 LLM） |
| `llm` | 独立 LLM 评判（provider 优先级：configurable > feedback.quality_monitor_llm_provider > llm.default_provider） |
| `hybrid` | 规则初筛 + LLM 复核 |

### 进化策略

- **ParameterTuneStrategy**（parameter-tune.ts）：参数调优
- **ComponentSwapStrategy**（component-swap.ts）：组件替换
- **RollbackMechanism**（rollback-mechanism.ts）：版本回滚
- **VersionedComponentStore**（versioned-store.ts）：版本化组件存储，多版本并行

（依据：judge LLM 构造 [factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L217-L256)；config_overrides 跨请求应用 [runner.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts#L228-L279)；进化策略导出见 [evolution/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/evolution/index.ts#L1-L9)）

## 可观测性 (observability/)

| 模块 | 文件 | 功能 |
|------|------|------|
| LoggingConfig | logging-config.ts | 结构化日志配置（JSON 格式开关） |
| MetricsRegistry | metrics.ts | Prometheus 指标（prom-client 可选依赖） |
| Tracing | tracing.ts | OpenTelemetry 分布式追踪（OTel 为可选依赖） |
| TraceContext | trace-context.ts | trace_id 传播 |
| Exporters | exporters.ts | OTLP 导出器（gRPC/HTTP） |

**Span 埋点**：通过 `_span()` 辅助函数（[runner.ts L149](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts#L149)）统一埋点，Tracing 启用时创建 OTel span，未启用时退化为日志计时。所有配置默认关闭（observability.tracing.enabled=false 等）。

## 多 Agent 协作 (orchestration/)

### 消息总线

[EventBus](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts#L56-L166)：发布/订阅、domain/action/priority 过滤、request/response 匹配与超时；支持事件日志持久化（`event_bus.log_file_path`，TTL 与滚动大小可配置，[runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L176-L187)）。

### AG-UI 协议

[agui-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/agui-adapter.ts) 实现 AG-UI 流式协议转换：LangGraph stream 事件 → 前端标准事件（THINKING_START/END、TEXT_MESSAGE_CONTENT/END、TOOL_CALL_START/RESULT、RUN_ERROR 等），收集完整响应文本与工具调用记录。

### 协作模式

- **Consensus**（patterns/consensus.ts）：共识模式（majority_vote / weighted / llm_judge，`consensus_strategy` 配置；失败可转进化信号）
- **Delegation**（patterns/delegation.ts）：委派模式（Supervisor 拆分给 Subagent；v1.4 增强支持 LLM 驱动任务拆分 `use_llm_decompose` 默认开启、子 Agent 失败重试 `subagent_max_retries=1`，[runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L74-L87)）
- **SensorManager**（sensor-manager.ts）：传感器生命周期管理（start_sensors/stop_sensors）

## MCP 集成 (mcp/，新增章节)

**状态：已实现（旧版"完全不具备 MCP"的结论已过时），默认关闭（`mcp.enabled=false`）。**

| 模块 | 文件 | 功能 |
|------|------|------|
| MCPSession / MCPClient | client.ts | 单 Server 连接生命周期（L40-L158）/ 多连接管理器（L168-L239），`callTool` 支持 `server_name__tool_name` 或裸名路由（L276-L352） |
| Transport | transport.ts | 三种传输：Stdio（L94-L190，子进程+SDK 握手）/ SSE / WebSocket（L199-L350） |
| ToolDiscovery | discovery.ts | 工具发现缓存、`server__tool` 全名/裸名查找、`toBaseToolSchema()` 标准化（L21-L160） |
| ServerLifecycleManager | lifecycle.ts | stdio/auto_start Server 子进程生命周期跟踪清理（L22-L74） |
| 错误体系 | errors.ts | MCPConnectionError / MCPTimeoutError / MCPToolNotFound / MCPProtocolError（L12-L85） |

**接入链路**：宿主 lifespan 中 `MCPClient.start()` → `create_agent()` 时 `_discover_and_register_mcp_tools()` 幂等注册 → MCPToolAdapter 包装为 BaseTool → 与内置工具同一 registry → `build_langchain_tools()` 自动进入图。

（依据：SDK 依赖 [package.json](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/package.json#L24)；注册链路 [factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L498-L506)；mcp 配置默认值 [runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L255-L259)）

## Skills 子系统 (skills/，新增章节)

**状态：已实现（旧版"Skill 高级特性缺失"的结论大部分过时），默认关闭（`skills.enabled=false`）。**

| 组件 | 文件 | 功能 |
|------|------|------|
| BaseSkill 接口 | core/interfaces/skill.ts | 见核心接口章节（含 version/tags/examples/preconditions/requiredScopes 元数据——旧版判定为"缺失"的自描述元数据已具备） |
| SkillLoader | loader.ts | 按配置发现并加载 Skill（`skills.auto_discover_dirs` / `skills.active`） |
| SkillToolWrapper | adapter.ts | Skill 工具执行隔离包装（经 setSkillToolWrapperFactory 注入 registry） |
| SkillPromptAggregator | prompt-aggregator.ts | 聚合已注册 Skill 的 systemPromptFragment 注入 system prompt |
| FewShotSelector | few-shot-selector.ts | 按 Skill examples 选择 few-shot 示例 |
| MathSkill | math-skill.ts | 内置示例 Skill |

**接入链路**：`create_agent()` 中 `skills.enabled=true` 时 SkillLoader 加载 → `registerSkill()` 自动注册内含工具 → SkillPromptAggregator 聚合提示片段。单一集成点，失败时继续无 Skill 运行。

**仍存的差距**：无 Skill 市场/包分发格式（zip/wheel）、无 Skill 间链式调用编排。

（依据：加载入口 [factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L448-L457)、提示聚合 [L534-L542](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L534-L542)；skills 配置 [runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L165-L169)；导出清单 [skills/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/skills/index.ts#L1-L18)）

---

## 高级 Agent 模式能力深度分析

> 本节依据 TS 版代码重新核对，旧版"Plan-and-Execute ❌ / Skills 高级特性 ❌ / MCP ❌"的结论已全部过时。

### 一、Plan-and-Execute 模式分析

**结论（已更新）：P4 已实现完整 Plan-and-Execute 模式，默认关闭（`plan_execute.enabled=false`），与 multi_agent 模式互斥（multi_agent 优先）。**

**已具备的核心要素**（旧版判定为"缺失"的各项均已落地）：

| 要素 | 状态 | 代码依据 |
|------|------|----------|
| 显式 Planner 节点 | ✅ | `planner` 节点注册（[graph.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L507)）；Planner 使用未绑定工具的原始 LLM（规划阶段禁止工具，[factory.ts L678](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L678)） |
| 结构化 Plan 状态 | ✅ | `plan` / `current_step_index` / `step_results` / `replan_count` / `current_step` / `step_msg_baseline` / `plan_delta` 字段（[state.ts L562-L571](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L562-L571)） |
| 单步 Executor | ✅ | `step_dispatch` → agent → `step_finalize` 循环（[graph.ts L508-L509, L560](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L508-L560)）；step_finalize 按步截取 messages 增量并校验 requires_tool 步骤是否实际调用工具 |
| Replanner 机制 | ✅ | `max_replans=2` 重规划计数；planner 重规划返回空 step_results 清空旧结果（[state.ts L286-L297](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts#L286-L297) reducer 注释） |
| 步骤依赖 | ✅ | 串行步骤执行（current_step_index 递进） |
| 工具依赖推断 | ✅ | `BaseTool.providesRealtimeData()` 元数据供 Planner 推断 step.requires_tool（[action.ts L92-L94](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts#L92-L94)） |

**配置项**（[runtime-config.ts L98-L106](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L98-L106)）：`enabled=false` / `max_steps=10` / `max_replans=2` / `planner_temperature=0.2` / `continue_on_failure=false` / `compact_completed_steps=false` / `step_summary_max_chars=500`。支持 per-request 强制启用（`configurable.plan_execute_enabled=true`，[factory.ts L675-L677](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L675-L677)）。

**模式路由**：`orchestration.mode_router` 配置化规则表，multi_agent 命中优先于 planner（[runtime-config.ts L91-L95](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L91-L95)）。

### 二、Skills 能力分析

**结论（已更新）：Skill 已成为一等公民（P1 落地），具备多工具封装、动态加载、版本管理、前置条件、权限声明、few-shot 示例等高级特性；默认关闭。仍缺 Skill 市场/包分发与 Skill 间编排。**

与标准 Skills 生态的能力对比（更新版）：

| 能力维度 | 状态 | 依据 |
|----------|------|------|
| 基本调用 / JSON Schema / 注册发现 / 热替换 / 工具集筛选 | ✅ | registry + tool-adapter（同旧版） |
| HITL 审批 | ✅ | `requiresApprovalFor` 参数级动态判定（[action.ts L56-L61](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts#L56-L61)） |
| **自描述元数据** | ✅ 已具备 | `tags`/`examples`/`preconditions`/`requiredScopes`（[skill.ts L27-L44](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/skill.ts#L27-L44)） |
| **多工具封装（Skill 包）** | ✅ 已具备 | `tools()` + `systemPromptFragment()`（纯提示型 Skill 亦可） |
| **动态加载** | ✅ 已具备 | SkillLoader 按配置目录发现（`auto_discover_dirs`） |
| **版本管理** | ✅ 已具备 | `version()` + 工具级 `version()` semver |
| **Skill 组合/链式调用** | ❌ 仍缺失 | 无 Skill 间编排机制 |
| **Skill 包分发格式/市场** | ❌ 仍缺失 | 无 zip/wheel 分发格式 |

### 三、MCP 能力分析

**结论（已更新）：MCP 集成已完整实现（Client/Transport×3/Discovery/Lifecycle/错误体系/工具适配器），默认关闭，失败不影响 Agent 启动。**

| MCP 能力 | 状态 | 依据 |
|----------|------|------|
| MCP SDK 依赖 | ✅ `@modelcontextprotocol/sdk ^1.0` | [package.json L24](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/package.json#L24) |
| MCP Client 实现 | ✅ | [client.ts L40-L352](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/client.ts#L40-L352) |
| Server 生命周期管理 | ✅ | [lifecycle.ts L22-L74](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/lifecycle.ts#L22-L74) |
| Tool → BaseTool 适配器 | ✅ | [mcp-tool-adapter.ts L31-L112](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts#L31-L112) |
| MCP Resource / Prompt 模板 | ❌ 未实现 | client 仅覆盖 tools/list 与 tools/call |
| stdio / SSE 传输 | ✅（另有 WebSocket） | [transport.ts L94-L350](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/transport.ts#L94-L350) |
| 动态工具发现 | ✅ | discovery.ts + `_discover_and_register_mcp_tools` |

### 四、综合能力矩阵（更新版）

| 能力模式 | 支持程度 | 默认状态 | 代码依据 |
|----------|---------|---------|----------|
| **ReAct (思考-行动循环)** | ✅ 完整支持 | 默认路径 | graph.ts agent⇄tools 循环 |
| **Tool Calling (函数调用)** | ✅ 完整支持 | 默认启用 | bindTools + ToolNode |
| **Human-in-the-Loop** | ✅ 支持（含参数级动态审批 + 超时自动拒绝 + 过期清扫） | 代码默认 false；config.yaml 模板开启 | runner.ts L932/L1171/L1263；action.ts L56-L61 |
| **多 Agent 并行协作** | ✅ 支持（含 LLM 任务拆分、子 Agent 重试、共享黑板） | 默认关闭 | runtime-config.ts L74-L87；state.ts blackboard |
| **Plan-and-Execute** | ✅ **已实现**（旧版"不支持"结论过时） | 默认关闭 | plan-execute/ + graph.ts planner 节点 |
| **Skills** | ✅ **已实现**（一等公民，含元数据/版本/动态加载） | 默认关闭 | skills/ + skill.ts |
| **MCP 协议** | ✅ **已实现**（Client/3 种传输/发现/适配） | 默认关闭 | mcp/ + mcp-tool-adapter.ts |
| **反馈进化闭环** | ✅ 支持（rule/llm/hybrid 三模式） | 默认启用（enable_evolution=true） | factory.ts L604-L617 |
| **Markdown 提示注入** | ✅ 已实现 | 代码默认 false；config.yaml 模板开启 | factory.ts L552-L577 |

---

## 已知限制与未实现项（新增章节）

依据全量代码扫描（TODO/FIXME 标记 + 实现核对）：

| 项 | 说明 | 依据 |
|----|------|------|
| ASR 语音识别 | TODO 桩，返回低置信度空结果；建议接入 OpenAI Whisper API / Google Web Speech / ffmpeg | [asr-processor.ts L76/L235/L246/L266](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/audio/asr-processor.ts#L76) |
| 摄像头/麦克风传感器 | TODO 桩（无 OpenCV/PyAudio 等价库），传感器始终不可用 | [camera.ts L67/L99/L212/L244](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/vision/camera.ts#L67) |
| 图像 OCR | TODO 桩（无 pytesseract/easyocr 等价库，可考虑 tesseract.js） | [image-processor.ts L78/L88/L203](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/vision/image-processor.ts#L78) |
| 本地 NER/情感分析 | TS 版无 spaCy/SnowNLP 等价库，仅由 LLM 填充 | [llm-parser.ts L145/L272/L287](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/text/llm-parser.ts#L145) |
| 语种检测 | TODO，待集成 JS 语种检测库 | [rule-based.ts L644](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/text/rule-based.ts#L644) |
| Checkpoint 持久化 | 默认 MemorySaver（进程内存），应用重启丢失会话与 HITL 中断状态；sqlite 路径硬编码 `checkpoints.db` 且依赖缺失时静默回退内存 | [factory.ts L136-L162](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L136-L162) |
| 默认 system prompt 业务耦合 | 防幻觉 prompt 内含新闻搜索/doc_writer 文档生成的特定业务 SOP（规则 21-28），对非文档类业务是 Token 负担 | [factory.ts L93-L114](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L93-L114) |
| MCP Resource/Prompt | 仅覆盖 tools 能力面 | mcp/client.ts |
| MCP 工具发现参数冗余 | `_discover_and_register_mcp_tools` 的 runtimeConfig 参数未使用（仅保接口兼容） | [factory.ts L357-L361](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L357-L361) |
| config.yaml 模板与代码默认值分叉 | HITL 模板 `enabled: true` vs 代码默认 `false`（依赖"删除配置段=关闭"约定） | [config.yaml L17-L25](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/config.yaml#L17-L25) vs [runtime-config.ts L116-L121](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts#L116-L121) |
