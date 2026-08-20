# Agent 配置机制分析报告

> 分析范围：`packages/` 目录全部代码（核心在 `packages/modu-agent/src/`，共 125 个 TS 源文件）
> 分析日期：2026-08-20
> 分析目标：判断当前 Agent 是否支持通过 `.md` 文档文件（如 `AGENTS.md`、`SOUL.md`、`USER.md`、`user_profile.md`）进行配置

## 结论先行

**当前该 Agent 不支持通过 `.md` 文档文件进行配置**，不存在读取 `AGENTS.md` / `SOUL.md` / `USER.md` / `user_profile.md` 等作为配置的机制。

---

## 1）当前配置系统的实现方式

配置核心全部集中在 `packages/modu-agent/src/config/runtime-config.ts`，是一个名为 `RuntimeConfig` 的内存配置对象，多种来源按以下方式组合：

### a. 硬编码默认值（`DEFAULT_CONFIG`，`runtime-config.ts:18-318`）

绝大多数行为参数写死在源码里：LLM provider、温度、记忆策略、多 Agent 开关、工具超时/重试/人审（`tools.human_in_loop`）、各 `react_optimization` feature flag 等。这是当前最主要的配置方式。（注意：`DEFAULT_CONFIG` 中并无"权限门禁/gating"类字段；写操作防护由 `tools/tool-guardrails.ts` 的 `ACTION_GUARDRAILS` 注册表承担，受 `react_optimization.action_guardrails.enabled` 门控。）

### b. JSON 配置文件（唯一支持的文件加载，`runtime-config.ts:360-368`）

```typescript
static fromFile(filePath: string): RuntimeConfig {
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'))  // 仅 JSON.parse
  return new RuntimeConfig(data)
}
```

注意：使用 `JSON.parse`，**只认 JSON，不认 `.md`、不认 YAML、不解析 frontmatter**。

### c. 环境变量（`fromEnv()`，`runtime-config.ts:370-385`）

`fromEnv()` 仅将 **3 个**环境变量写入 `RuntimeConfig`：

- `MODU_LLM_PROVIDER` → `llm.default_provider`
- `MODU_LLM_TEMPERATURE` → `llm.temperature`
- `MODU_MEMORY_STRATEGY` → `memory.default_strategy`

> **注意**：若把"环境变量"理解为整个代码库实际读取的变量，则远不止 3 个。各模块散落读取约 20 个：`MODU_CONFIG_PATH`（`getConfig()`）；LLM 密钥/端点/模型（`MODU_{GLM|DEEPSEEK|QWEN|OPENAI}_{API_KEY|BASE_URL|MODEL}`、通用 `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_DEFAULT_MODEL`，经 `graph/adapters/llm-adapter.ts` 的 `_PROVIDER_CONFIG` 映射表与 `reasoning/llm/*` 子类解析）；Chroma（`MODU_CHROMA_IN_MEMORY`/`MODU_CHROMA_PATH`）；工具根目录（`MODU_DOC_WRITER_ROOT`/`MODU_FILE_OPS_ROOT`）；检索与代理（`TAVILY_API_KEY`、`HTTP(S)_PROXY`）等。即 LLM 连接类参数事实上已通过环境变量外部化，但**无统一清单、无集中校验**，与 `RuntimeConfig` 体系脱节。

### d. 全局初始化入口（`getConfig()`，`runtime-config.ts:515-528`）

```typescript
const configPath = process.env.MODU_CONFIG_PATH ?? ''
if (configPath) _config = RuntimeConfig.fromFile(configPath)
else _config = RuntimeConfig.fromEnv()
```

即 `MODU_CONFIG_PATH` 指向一个 **JSON 文件** 才生效。

### e. 运行时动态修改（代码内 API）

`get/update/updateMany/registerChangeCallback` + EventEmitter 热更新；`evolution` 模块可在运行时调参。这部分仍是代码驱动，非文档驱动。

### f. 角色 / System Prompt（另有一套，但同样非 `.md`）

`factory.ts:515` 的优先级链：`configurable['system_prompt']` > 传入 `systemPrompt` > `_DEFAULT_ANTI_HALLUCINATION_PROMPT`（硬编码兜底）。子 Agent 提示词模板硬性写死在 `subgraph/builder.ts:27` 的 `_SYSTEM_PROMPT_TEMPLATES`。

此外 `create_agent` 还有两个运行时注入点（均为代码/配置驱动，非文档驱动）：
- **SkillPromptAggregator**（`factory.ts:520`，gated by `skills.enabled`）：聚合已注册 Skill 的提示片段追加到系统提示词；
- **PromptComposer 四层组装**（`factory.ts:533`，gated by `react_optimization.prompt_composer.enabled`，默认关闭）：`systemCore + domain + taskSpec + runtimeContext` 四层拼接，其中 `domain`/`task_spec`/`runtime_context` 均来自 `configurable`；`runtimeContext` 层（用户画像、环境信息）即未来 `USER.md` 类文档的天然挂载点。

### 数据库

当前 Agent 运行时无任何数据库依赖。`packages/docs/角色提示词配置功能优化方案.md` 是一份**未来方案设计文档**（非已实现的代码），它规划用 SQLite + HTTP API 承载角色提示词——但截至当前代码，这套存储层**尚未落地**（`llm.prompt_template` 字段被该文档明确指出"形同虚设，从未被读取"）。

---

## 2）是否存在读取 / 加载 `.md` 文档作为配置的机制

**不存在。** 全仓检索结果：

- `packages/` 下 0 个 `AGENTS.md` / `SOUL.md` / `USER.md` / `user_profile.md` 文件。
- 所有 `.md` 文件都是**文档 / 分析报告**（`docs/` 下 9 个 `.md`，含本报告自身），与配置无关。
- 代码中对 `.md` 的全部引用都属于**工具能力**，而非配置加载：
  - `tools/doc-writer.ts`：*生成* `.md` 文档（写文件）
  - `tools/file-ops.ts`：`readFileSync` 读取任意文件**内容**（作为工具行为，不是配置解析）
  - `tools/search.ts` 的 `USER_AGENT` 是 HTTP 请求头，与用户画像无关
- 没有 `parseMarkdown`、`frontmatter`、`yaml.parse`、`.md` 配置加载器任何形式的实现；唯一的 `frontmatter` 字样出现在 `CODE_WIKI.md` 谈文档版本管理，与配置加载无关。
- `skills/loader.ts` 扫描的是 `<skill>/skill.{js,ts}` 代码模块，不是 `.md`。

---

## 3）若支持，支持哪些 `.md` 及其路径 / 优先级

**不适用**——当前不支持，故无此类文件、路径、优先级定义。

---

## 4）当前架构缺失的关键组件 & 实现 `.md` 配置需修改的模块

### 缺失的关键组件

1. **Markdown 配置解析层**：没有能够读取、解析 `.md`（含可选 YAML frontmatter 或结构化分段）为配置对象的模块。
2. **文件型配置发现与加载器**：现有 `fromFile` 仅做 `JSON.parse`，缺一个"按约定文件名扫描目录 → 解析 → 合并"的 loader。
3. **`.md` 配置 schema 与映射规则**：没有把 `AGENTS.md` / `SOUL.md` / `USER.md` 等语义映射到 `RuntimeConfig` 字段或 `configurable` 的约定。
4. **加载时机 / 优先级编排**：配置初始化在 `getConfig()`（`runtime-config.ts:515`），目前只有"JSON 文件 或 环境变量"二选一，缺 `.md` 文档层及其与默认 / JSON / 环境变量的合并顺序。

### 需修改 / 新增的模块

- **`config/runtime-config.ts`**（核心改动点）
  - 新增 `fromMarkdown(dirOrPath)` 类工厂方法；
  - `getConfig()`（`runtime-config.ts:515`）增加"扫描约定 `.md` 文件"分支及与 `MODU_CONFIG_PATH`(JSON)、`fromEnv()` 的合并优先级；
  - 可选：在 `DEFAULT_CONFIG` 增加指向 `.md` 文件路径的字段（如 `docs: { agents_md: 'AGENTS.md', ... }`）。
- **新增 `config/markdown-loader.ts`**（建议）：负责 glob 查找 `AGENTS.md` / `SOUL.md` / `USER.md` / `user_profile.md`，解析文本 / frontmatter，输出 `Record<string,any>` 交给 `RuntimeConfig._deepMerge`。
- **角色 / System Prompt 注入点 `graph/factory.ts:515`**：当前仅 `configurable['system_prompt']` 优先级最高。若要让 `SOUL.md` / `USER.md` 影响人格，需在此把解析出的文档内容注入 `effectiveSystemPrompt`（可经现有 `SkillPromptAggregator` / `PromptComposer` 路径聚合）。
- **子 Agent 提示词 `graph/subgraph/builder.ts:27`**：若希望 `AGENTS.md` 覆盖子 Agent 模板，需从配置读取而非硬编码。
- **`skills/loader.ts`**：若希望 `.md` 作为"技能说明 / 指令片段"被加载，可复用其 discover 机制扩展 `.md` 读取。
- **`config/index.ts`**：导出新增的 loader 与类型。

> 设计层面可参考已有的 `角色提示词配置功能优化方案.md`，它已确立"宿主负责来源、`configurable` 注入、SDK 不感知存储"的**控制反转**原则——实现 `.md` 配置时应同样通过 `configurable` / `RuntimeConfig` 注入，而非在 Agent 框架内硬编码文档路径。

---

## 5）总结

| 维度 | 现状 |
|------|------|
| 配置主来源 | 源码硬编码 `DEFAULT_CONFIG` |
| 文件配置 | 仅 JSON（`MODU_CONFIG_PATH` → `JSON.parse`） |
| 环境变量 | `fromEnv()` 仅 3 个写入 `RuntimeConfig`；另有约 20 个散落读取（LLM 密钥/端点/模型、Chroma、工具根目录、代理等），无统一治理 |
| 数据库 | 运行时无；角色配置 SQLite 方案仅为未落地的设计文档 |
| `.md` 文档配置 | **不支持**；`.md` 仅作"文档生成 / 读写工具"的内容，非配置 |
| `AGENTS` / `SOUL` / `USER` / `user_profile.md` | 全仓不存在，也无加载逻辑 |

**结论**：该 Agent 当前不读取任何 `.md` 作为配置。要支持，需新增 Markdown 解析加载层并接入 `config/runtime-config.ts` 的初始化与合并逻辑，必要时再打通 `factory.ts` 的 System Prompt 注入点。本报告仅分析现状，未做代码修改。

---

# 续篇：可配置项全景、格式选型与实践优化方案

> 分析日期：2026-08-20
> 目标：梳理 `packages/modu-agent/src` 下全部可配置项，按 `.md` / `.yaml` / `.json` 三类格式归类，对比成熟 Agent 产品配置实践，给出本项目配置机制优化方案。

---

## 一、当前 Agent 系统全部可配置项全景

基于 `runtime-config.ts`（`DEFAULT_CONFIG`）、`factory.ts`、`subgraph/builder.ts`、`prompt-composer.ts`、`domain-adapters.ts`、`skills/`、`mcp/`、`tools/`、`memory/`、`reasoning/llm/router.ts` 等模块，当前所有可配置项可归为 8 大类（字段名均与 `DEFAULT_CONFIG` 实际定义逐一核对）：

| 类别 | 具体可配置项（实际字段） | 当前载体 |
|------|------------|---------|
| 1. LLM 模型参数 | `llm.default_provider`、`llm.temperature`、`llm.max_tokens`、`llm.max_reasoning_iterations`、`llm.max_format_retries`、`llm.retry.max_attempts`、`llm.connection_pool.*`（4 项）、`llm.cost_tracking.enabled`、`llm.router.*`（enabled/default_route/routes/rules）、`llm.tool_call_pattern`；`llm.prompt_template`（**死配置**，从未被读取）。api_key/base_url/model **不在 `DEFAULT_CONFIG`**，经环境变量注入（`llm-adapter.ts` 的 `_PROVIDER_CONFIG` 映射：glm/deepseek/gpt/qwen 各自 `MODU_*_API_KEY/BASE_URL/MODEL` + 通用 `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_DEFAULT_MODEL`） | 硬编码 + 环境变量 |
| 2. 记忆策略 | 被读取的仅 3 个：`memory.checkpointer_type`、`memory.store_type`、`memory.chroma_persist_path`（factory.ts）；`memory.default_strategy`（默认 `'cache'`）、`memory.context_window`（`'last_5_turns'`）、`memory.enable_compression`（**均为死配置**，全代码无消费者） | 硬编码 |
| 3. 多 Agent 编排 / Plan-Execute | `orchestration.engine`（runner.ts 消费）、`orchestration.multi_agent.*`（enabled/max_subagents/consensus_strategy/consensus_quorum/subgraph_timeout_ms/consensus_failure_as_evolution_signal/use_llm_decompose/subagent_max_retries）、`orchestration.mode_router[]`（规则化路由分叉）、`plan_execute.*`（enabled/max_steps/max_replans/planner_temperature/continue_on_failure/compact_completed_steps/step_summary_max_chars） | 硬编码 |
| 4. 工具治理 | `tools.retry.*`（retry.ts）、`tools.human_in_loop.*`（enabled/approval_timeout_seconds/auto_reject_on_timeout/sensitive_tools，graph.ts/nodes.ts）、`tools.max_result_chars.*`（tool-adapter.ts）、`tools.result_cache.*`（tool-result-cache.ts）、`tools.rate_limit.*`（rate-limiter.ts）；`tools.default_timeout_ms`（**死配置**，无消费者）。另有 `tools.register_defaults`（**不在 `DEFAULT_CONFIG`**，factory.ts 以代码默认值 `true` 读取，控制是否注册 4 个内置工具）。写操作防护 `ACTION_GUARDRAILS` 为 `tool-guardrails.ts` 硬编码注册表（支持运行时 `registerGuardrail`，受 `react_optimization.action_guardrails.enabled` 门控）。**不存在** gating/allowlist/capabilities 类配置 | 硬编码 |
| 5. 推理/ReAct 优化 | `react_optimization` 下 **9 个具名开关**（各带子参数）：`complexity_assessment`、`cot_anchor`、`observation_distillation`、`adaptive_termination`、`prompt_composer`、`tool_capability_matrix`、`action_guardrails`、`few_shot`（max_examples/max_tokens_budget/min_quality_score/mmr_lambda）、`parallel_tools` | 硬编码 |
| 6. 提示词/角色设定 | 通用系统提示 `_DEFAULT_ANTI_HALLUCINATION_PROMPT`（factory.ts:65 硬编码兜底）、子 Agent 模板 `_SYSTEM_PROMPT_TEMPLATES`（builder.ts:27，research/coding/review/default）、`DOMAIN_ADAPTERS`（**初始为空注册表**，由宿主经 `registerDomainAdapter` 运行时注册，非硬编码字典）；运行时注入通道：`configurable['system_prompt'/'domain'/'task_spec'/'runtime_context']`、`SkillPromptAggregator`（gated by `skills.enabled`）、`PromptComposer` 四层组装（gated by `react_optimization.prompt_composer.enabled`，默认关闭） | 硬编码字符串 + `configurable` 运行时注入 |
| 7. 反馈/进化 | `feedback.*`（evolution_threshold/enable_evolution/min_sample_size/quality_monitor_mode/quality_monitor_llm_timeout/provider/temperature/max_tokens，由 evolution-orchestrator 消费）；evolution 模块（`ParameterTuneStrategy`）运行时调 `llm.temperature`/`llm.max_reasoning_iterations`；**无 `evolution.*` 配置段、无 `forced_name` 字段** | 硬编码 + 运行时调参 |
| 8. 可观测性/事件总线/感知/MCP/Skills | `observability.tracing.*`/`metrics.*`/`logging.*`、`event_bus.*`（max_log_size/event_ttl_ms/log_file_path/log_max_file_size_mb/log_domains）、`perception.*`（含 security.llm_judge、deep_parsing、fusion 权重等）、`mcp.enabled/default_timeout/servers`、`skills.enabled/auto_discover_dirs/active`；`streaming.chunk_size`（**死配置**，agui-adapter 硬编码 30） | 硬编码 |

**关键观察**：
1. 第 1–5、7、8 类本质是**结构化参数**（标量、枚举、嵌套对象），绝大部分写死在 `DEFAULT_CONFIG`；唯一例外是 LLM 连接三元组（api_key/base_url/model），它们已经通过约 12 个环境变量外部化。
2. 第 6 类（提示词/角色）是**自然语言文本**，兜底模板硬编码为字符串常量——但已具备三个运行时注入通道（`configurable`、`SkillPromptAggregator`、`PromptComposer`），其中 `PromptComposer` 的 `runtimeContext` 层（用户画像、环境信息）是未来 `USER.md` 类文档的天然挂载点。
3. **存在"死配置"先例**：`llm.prompt_template`、`memory.default_strategy/context_window/enable_compression`、`tools.default_timeout_ms`、`streaming.chunk_size` 均为"已声明、从未被读取"的字段（`角色提示词配置功能优化方案.md` 已指出 prompt_template 问题）。外置化之前应先清理声明与消费脱节的字段，否则配置文件将承载无效键。
4. "配置与代码耦合、无外部化"的痛点成立，但严重度需校准：真正完全硬编码的是**行为参数**（温度、编排、工具治理、feature flag）；连接类参数（密钥/端点/模型）已有环境变量机制，缺的是**统一清单与集中校验**，而非机制本身。

---

## 二、三类格式的适用场景、优缺点与选型依据

### 2.1 `.md`（Markdown）——适合"人类可读的自然语言指令"

**适用项**：提示词模板、角色/人格设定（`SOUL.md`）、岗位 SOP/行为准则（`AGENTS.md`）、用户画像（`USER.md`）、决策逻辑说明、领域适配说明、说明文档、记忆笔记（`MEMORY.md`）。

- 优点：① 人类直接编写与审阅，无需解析器；② 支持富文本（标题/列表/代码块），天然适合系统提示与 Few-shot；③ 版本管理友好（diff 直观）；④ 与"文件化上下文工程"范式对齐，生态共识强。
- 缺点：① 无原生 schema 校验，结构松散易出错；② 不适合表达嵌套参数或布尔/数值开关；③ 解析需约定（frontmatter 提取元数据 + 正文作 prompt）。
- 选型依据：**凡"写给 LLM 看、由人写给人审"的文本型配置 → `.md`**。

### 2.2 `.yaml`——适合"带注释的结构化配置"

**适用项**：模型参数、工具配置与超时、流程编排（多 Agent 路由策略）、环境变量/部署差异、权限/审批策略（如本项目对应的 `tools.human_in_loop`、`ACTION_GUARDRAILS` 规则）、记忆策略。

- 优点：① 支持注释，人类可维护性强；② 支持锚点/引用、块折叠，适合长配置；③ 表达嵌套对象/数组自然；④ 比 JSON 更适合手写。
- 缺点：① 缩进敏感，易因格式错误解析失败；② 无原生类型强校验（需额外 schema）；③ 不适合超大规模数据。
- 选型依据：**凡"机器读取、人类维护、需注释说明、含层级结构"的参数型配置 → `.yaml`**。

### 2.3 `.json`——适合"机器生成/交换的结构化数据"

**适用项**：结构化数据、API 返回值、知识库索引（向量/条目）、插件/技能元数据（manifest）、运行时快照、CI/CD 分发的配置、跨进程配置。

- 优点：① 语法严格、无歧义，解析快；② 标准库原生支持，语言无关；③ 适合程序读写与网络传输；④ 适合作为"派生/生成产物"。
- 缺点：① 不支持注释（维护性差）；② 超长嵌套可读性差；③ 不擅长存放自然语言段落。
- 选型依据：**凡"机器生成、程序交换、结构化索引/元数据、需严格校验" → `.json`**。

> **一句话原则**：`.md` 管"怎么说"（语义/指令），`.yaml` 管"怎么配"（参数/策略），`.json` 管"是什么/索引"（数据/元数据）。

---

## 三、成熟 Agent 产品配置管理实践对比

### 3.1 Claude Code / Cursor / Codex（AGENTS.md 范式）
- 采用**文件化上下文工程**：`CLAUDE.md` / `AGENTS.md` 作为项目级行为准则，纯 Markdown，会话启动时注入 System Prompt；支持按目录层级 cascade 合并。`.cursorrules`、`copilot-instructions.md` 同理。
- 特点：**Markdown 只管"指令与人格"，模型参数走各自独立的 JSON/设置文件**。

### 3.2 OpenClaw（技能生态 + 多通道）
- 核心在执行与 LLM 交互：System Prompt = 角色设定 + Memory + Skills + Context 动态拼接；以 **Skills 模块化 + Markdown 说明**驱动行为；无中心化大型配置文件，配置分散在 Skill 与 Prompt 模板中。
- 特点：强调**Prompt 工程而非参数治理**，配置轻、插件化。

### 3.3 Hermes Agent（自我进化记忆，Nous Research）
- 架构信念：Agent 是**持久化、随时间累积能力**的系统。干完活后自动把踩坑经验提炼为可复用 Skill，并以 **Markdown 自动沉淀记忆/经验**（`MEMORY.md` 类）；配置与记忆高度文件化、自演化。
- 特点：**Markdown 既是配置也是学习产物**，强调越用越聪明。

### 3.4 Trae-Agent（分层 YAML/JSON 治理，2026-06 解析文）
- **三层治理**：基础层 `base.yaml`（全局默认：log_level、max_concurrent_tasks、llm.model_name、tools.*.enabled）、环境层 `prod.yaml`/`dev.yaml`（覆盖 api_url、密钥、超时）、运行时层 `runtime.json`（进程 PID、负载等临时态）。
- **双格式单入口**：`config.load("config.yaml"|"config.json")` 按扩展名自动选解析器，统一映射为内存字典；JSON 用于机器分发（CI/CD、配置中心），YAML 用于人工维护（注释/锚点）；暴露 `/debug/config` 返回脱敏快照（含来源文件与行号）；类型校验（基础层定义 `timeout: int`，环境层写字符串报错而非静默转换）。
- 特点：**参数型配置走 YAML 分层 + JSON 机器分发，Markdown 用于带说明的 prompt 模板**。

### 3.5 综合对比表

| 产品 | 指令/人格 | 参数/策略 | 数据/元数据 | 核心治理思想 |
|------|----------|----------|------------|------------|
| Claude/Cursor/Codex | `AGENTS.md`/`CLAUDE.md`(MD) | 各自设置(JSON) | — | 文件化上下文工程 |
| OpenClaw | Skill+Prompt(MD) | 分散、轻量 | — | Prompt 工程驱动 |
| Hermes | Memory/Skill(MD,自演化) | 轻量 | Skill 元数据 | 持久化自我进化 |
| Trae-Agent | prompt 模板(MD) | `base/env.yaml` + `runtime.json` | — | 三层覆盖 + 类型校验 + 热重载就绪 |
| **本项目(modu-agent)** | **硬编码字符串（有 `configurable`/`PromptComposer` 注入通道但无文件层）** | **硬编码 `DEFAULT_CONFIG`** | **运行时内存，无文件** | **单文件 JSON(`MODU_CONFIG_PATH`) + 约 20 个散落环境变量（LLM 密钥/端点/模型等，无统一治理）** |

**共识结论**：行业普遍采用 **"Markdown 管指令与记忆、YAML 管参数与策略、JSON 管数据与机器分发"** 的三分法，并以"分层覆盖 + 源可追溯"保证治理质量。本项目的文件化配置仅落地了单 JSON 文件一项；环境变量数量不少但散落在各模块、无清单无校验，不构成体系；`.md`/`.yaml` 文档化配置层完全缺失，是最大的优化空间。

---

## 四、本项目配置机制优化方案

### 4.1 总体目标

将当前"硬编码 `DEFAULT_CONFIG` + 单 JSON 文件 + 散落环境变量（约 20 个，无统一治理）"升级为 **"三分格式 + 分层覆盖 + 源可追溯"** 的配置体系，对齐行业实践，同时保持 `RuntimeConfig` 现有内存模型与 `configurable` 注入方式不变（延续 `角色提示词配置功能优化方案.md` 的控制反转原则）。前置动作：清理已声明的死配置字段（`llm.prompt_template`、`memory.default_strategy/context_window/enable_compression`、`tools.default_timeout_ms`、`streaming.chunk_size` 等），避免外置化时把无效键带入配置文件。

### 4.2 配置分层与格式映射

```
配置来源（优先级从低到高，后者覆盖前者）：
  L0  代码内置 DEFAULT_CONFIG（硬编码兜底）
  L1  config.yaml           全局默认参数（模型/工具/记忆/权限/编排/可观测）
  L2  config.<env>.yaml     环境层（dev/prod：api_url、密钥、超时、开关）
  L3  config.runtime.json   运行时生成态（PID、负载、启动时间，不进版本库）
  L4  AGENTS.md             行为准则/工作流 SOP（注入 System Prompt）
  L5  SOUL.md               人格/语气/边界（注入 System Prompt）
  L6  USER.md               用户画像（注入 runtimeContext 层）
  L7  MEMORY.md             长期记忆/经验（按需加载）
  L8  configurable['*']     宿主运行时注入（最高优先级，覆盖一切）
```

**格式分工**：
- `.yaml`：`config.yaml` / `config.<env>.yaml` —— 承载第 1–5、7、8 类全部结构化参数（LLM、记忆、多 Agent、工具/权限、推理优化、反馈、可观测）。用 YAML 因需注释与人工维护。
- `.json`：`config.runtime.json`（运行时态）、`knowledge-index.json`（知识库索引）、`plugins/*.manifest.json`（技能/插件元数据）——机器生成与交换。
- `.md`：`AGENTS.md` / `SOUL.md` / `USER.md` / `MEMORY.md` / `DOMAIN/*.md`（领域适配说明）——纯文本指令与记忆，由 Markdown 加载器解析（frontmatter 提元数据 + 正文作 prompt）。

### 4.3 需要修改/新增的模块

1. **新增 `config/markdown-loader.ts`**
   - glob 查找约定 `.md`（`AGENTS.md`/`SOUL.md`/`USER.md`/`MEMORY.md`/领域目录）；
   - 解析 YAML frontmatter（如 `priority`、`inject_to: system_prompt|runtime_context`、`load: eager|lazy`）与正文；
   - 输出结构 `{ role: string, content: string, meta }` 交给聚合器。

2. **新增 `config/yaml-loader.ts` + 复用 `fromFile`**
   - `fromYaml(path)` 替代/扩展 `fromFile`，按扩展名自动选 `yaml`/`json` 解析器（借鉴 Trae 单入口）；
   - 支持 `base → env` 的 `_deepMerge` 与类型校验（基础层定义类型，覆盖层类型不符则报错）。

3. **改造 `config/runtime-config.ts`**
   - 新增 `loadLayered({ base, env, runtimeJson, docsDir })` 静态方法，按 L0–L8 顺序合并；
   - `getConfig()` 增加发现逻辑：默认扫 `./config`（或 `MODU_CONFIG_DIR`），读 `config.yaml` + `config.${NODE_ENV}.yaml` + 约定 `.md`；保留 `MODU_CONFIG_PATH`（JSON/YAML）向后兼容。
   - 增加 `sources: Record<string, string>` 溯源字段（类似 `/debug/config` 快照）。

4. **打通 System Prompt 注入点 `graph/factory.ts`（`create_agent` 内 `effectiveSystemPrompt` 组装段，约 513–547 行）**
   - 在现有 `PromptComposer` 四层（systemCore / domain / taskSpec / runtimeContext）基础上：
     - `SOUL.md` + `AGENTS.md` 合并进 `systemCore`/domain 层；
     - `USER.md`/`MEMORY.md` 注入 `runtimeContext` 层；
   - 沿用 `SkillPromptAggregator` 的聚合模式，新增 `MarkdownPromptAggregator`；
   - 注意：`PromptComposer` 当前由 `react_optimization.prompt_composer.enabled` 门控且**默认关闭**，`.md` 注入生效需同步开启该开关（或将其纳入 markdown-loader 的启用联动）。

5. **子 Agent 模板 `graph/subgraph/builder.ts:27`**
   - `_SYSTEM_PROMPT_TEMPLATES` 改为从 `config.agents.<role>.prompt` 或对应 `.md` 读取，去除硬编码。

6. **领域适配 `reasoning/domain-adapters.ts`**
   - `DOMAIN_ADAPTERS` 当前是**空注册表**（无内置领域，宿主经 `registerDomainAdapter` 运行时注入），优化点不是"去硬编码"，而是让注册表内容可从 `config/domains/<domain>.md` 批量加载（markdown-loader 解析 frontmatter 为 `DomainAdapter` 结构后调 `registerDomainAdapter`），注入 `PromptComposer` 的 domain 层。

7. **工具治理策略 `tools/`（人审、护栏、缓存、限流）**
   - 当前实际存在的硬编码项：`tools/tool-guardrails.ts` 的 `ACTION_GUARDRAILS` 规则注册表、`factory.ts` 的默认工具注册清单（`tools.register_defaults`）、各工具构造参数 → 外置到 `config.yaml` 的 `tools.human_in_loop` / `tools.action_guardrails` / `tools.register_defaults` 段，支持环境层覆盖（如 prod 收紧 `code_executor`、`sql_query`）；密钥类（`TAVILY_API_KEY` 等）保留环境变量注入，但纳入统一清单管理。
   - 说明：原文所提 `gating.rules`/`allowlist`/`capabilities` 配置在代码中并不存在，系笔误，已按实际机制更正。

8. **知识库索引与插件元数据**
   - 新增 `knowledge-index.json`（检索索引）、`plugins/<name>/manifest.json`（技能元数据：name/version/capabilities/dependencies），由 `memory/` 与 `skills/loader.ts` 消费。

9. **`config/index.ts`**：导出新增 loader 与类型；更新 `README`/文档说明格式与优先级。

### 4.4 落地路径建议（分阶段）
- **P0（低风险）**：先清理死配置字段（`llm.prompt_template`、`memory.default_strategy/context_window/enable_compression`、`tools.default_timeout_ms`、`streaming.chunk_size`），再新增 `yaml-loader` + 改造 `getConfig` 支持 `config.yaml` 分层，将 `DEFAULT_CONFIG` 抽为 `config.yaml` 默认值；保持 JSON 兼容。→ 解决"参数全硬编码"。
- **P1（中风险）**：实现 `markdown-loader` + `MarkdownPromptAggregator`，接入 `factory.ts`；外置 `AGENTS.md`/`SOUL.md`/`USER.md`，子 Agent 模板与领域适配外置。→ 解决"提示词/角色硬编码"。
- **P2（增强）**：`MEMORY.md` 持久化、`knowledge-index.json`、插件 manifest、配置溯源快照端点 `/debug/config`。→ 对齐 Hermes/Trae 的进化与可观测能力。

### 4.5 风险与注意
- **Token 膨胀**：Markdown 常驻会增加 System Prompt 长度（Hermes/Trae 均提示）。建议 `MEMORY.md` 按需加载、`AGENTS.md` 分层级 cascade，并对注入内容做长度预算。
- **类型安全**：YAML 覆盖需类型校验，避免环境层误写静默失效（借鉴 Trae 的 `int` 强校验）。
- **优先级清晰**：明确 L0–L8 覆盖顺序并文档化，避免"到底哪个值生效"的调试黑洞（提供溯源快照）。

---

## 五、小结

当前 `modu-agent` 的可配置项（8 大类）中，行为参数几乎全部硬编码于 `DEFAULT_CONFIG` 与字符串常量（连接类参数已由约 20 个散落环境变量承载但无统一治理，且存在若干"声明未消费"的死配置字段），文件化配置仅支持单 JSON 文件，`.md`/`.yaml` 文档化配置层完全缺失。对照 Claude/OpenClaw/Hermes/Trae 等成熟实践，行业已收敛为 **"Markdown 管指令与记忆、YAML 管参数与策略、JSON 管数据与元数据"** 的三分范式。本项目应沿 **"三分格式 + 分层覆盖（L0–L8）+ 源可追溯"** 路线改造，优先通过新增 `markdown-loader.ts` / `yaml-loader.ts` 并改造 `runtime-config.ts` 与 `factory.ts` 注入点来落地（复用已有的 `configurable` / `SkillPromptAggregator` / `PromptComposer` 注入通道），在保持 `configurable` 控制反转原则的前提下，实现配置与代码的彻底解耦。本续篇仅给出方案，未做代码修改。
