# Agent 配置机制分析报告

> 分析范围：`packages/modu-agent/src/`（TypeScript 源码，共 11 个 `*.ts` 配置相关文件集中于 `src/config/`）
> 分析日期：2026-08-21（基于 V2.2 分支代码现状复核）
> 分析目标：梳理 `packages/modu-agent` 的 Agent 配置机制——是否支持 `.md` 文档配置、YAML 分层配置，以及各项优化能力（P0–P4）的真实落地情况

---

## 结论先行（基于代码现状）

1. **`.md` 文档配置机制「已实现且当前实际生效」**。代码中存在完整的 Markdown 配置加载与注入链路（`src/config/markdown-loader.ts` + `markdown-prompt-aggregator.ts`，由 `src/graph/factory.ts` 在 `react_optimization.markdown_prompt.enabled` 开关下接入）。`DEFAULT_CONFIG` 中该开关默认为 `false`，但**包根目录已存在 `config.yaml`（内容为 `markdown_prompt.enabled: true`）及 `AGENTS.md`/`SOUL.md`/`USER.md`/`MEMORY.md` 四个文档**——因此在本包环境下 `getConfig()` 会加载该 YAML 覆盖默认开关，`create_agent()` 实际会注入 AGENTS/SOUL（→system_prompt）与 USER（→runtime_context，eager），MEMORY（lazy）不注入。
2. **YAML 分层配置「已落地」**。`getConfig()` 在未指定 `MODU_CONFIG_PATH` 时，会尝试加载包根 `config.yaml`、做类型安全校验后深度合并到 `DEFAULT_CONFIG`（失败/缺失则降级到 `fromEnv`）。零外部依赖（内置最小 YAML 子集解析器）。
3. **首次安装初始化模板「已实现」**。`init-defaults.ts` 提供幂等生成 `AGENTS.md/SOUL.md/USER.md/MEMORY.md + config.yaml` 默认模板的能力，但目前**仅导出、未被 `getConfig()` 自动调用**（需宿主显式调用）。
4. **大量 P2/P3 规划项「尚未落地」**。原报告将 `llm-as-judge / early-stop / testing / rag / behavior / sandbox / factory-config / mcp-config` 等描述为已落地模块，但当前代码中**这些独立 config 子模块均不存在**（仅有 `feedback.*`、`mcp.*` 等配置块，以及 `factory.ts` 内联逻辑）。详见第 6 节「未落地项」。

> 说明：本文档为对 `packages/modu-agent` 源码的复核结果。下文所有「✅ 已落地」「❌ 未落地」标记均以当前代码事实为准；原文档中将其作为「实施记录」描述的未落地项已校正。

---

## 1）当前配置系统的实现方式

配置核心集中在 `packages/modu-agent/src/config/runtime-config.ts`，是一个名为 `RuntimeConfig` 的内存配置对象，多种来源按以下方式组合：

```text
RuntimeConfig（内存单例）
  ├─ DEFAULT_CONFIG（内置默认，react_optimization.* 等默认关闭）
  ├─ 可选 config.yaml 分层覆盖（loadConfigYamlValidated → deepMerge，类型安全校验）
  ├─ 可选 MODU_CONFIG_PATH 指定的 JSON 文件（原逻辑，零侵入保留）
  ├─ 环境变量（fromEnv，兜底降级链路）
  └─ overrideConfig(...)（测试隔离用）
```

入口 `getConfig(override?)`（`runtime-config.ts:560`）：

- 若 `override` 显式传入 → 直接作为单例（测试隔离）。
- 若 `process.env.MODU_CONFIG_PATH` 指定 → 走原 JSON `fromFile` 加载（零侵入）。
- 否则 → 尝试 `loadConfigYamlValidated(DEFAULT_CONFIG)`：
  - 成功 → `deepMergeConfig(DEFAULT_CONFIG, validated.cleaned)` → 附带来源溯源（base/file/dropped）。
  - 失败/缺失 → 降级 `RuntimeConfig.fromEnv()`，标注环境变量来源。
  - **等价原行为**：解析失败或文件缺失时一律回退 `fromEnv`，与未接入 YAML 前完全等价（不引入新缺陷）。

`RuntimeConfig` 关键方法（`runtime-config.ts`）：`get(keyPath, default?)`（点分路径取值，返回浅拷贝）、`set`、`update`（返回旧值并触发回调）、`updateMany`（批量原子更新）、`registerChangeCallback`（返回注销函数）、`asDict()`（深拷贝）、`getSources()`（来源溯源）；类工厂 `fromFile`/`fromEnv`；模块级 `getConfig`/`resetConfig`/`overrideConfig`。变更通知基于 `EventEmitter`（异常隔离），支持热更新。

### 1.1 内置默认配置 DEFAULT_CONFIG

位于 `runtime-config.ts` 顶部，涵盖 `llm`、`memory`、`perception`、`feedback`、`observability`、`mcp`、`streaming`、`event_bus`、`skills`、`react_optimization` 等模块。所有 P0/P1 优化项均通过 `react_optimization.*` 下的 feature flag 控制，**默认关闭（低风险项默认开启除外）**，满足风险登记表 R-01~R-12 的「字段全 optional + 异常降级 + 默认关闭高风险项」。

```text
react_optimization:
  complexity_assessment.enabled          = false   // P0-1
  cot_anchor.enabled                     = false   // P0-2
  observation_distillation.enabled       = true    // P0-3（异常自动降级）
  adaptive_termination.enabled           = false   // P0-4
  prompt_composer.enabled                = false   // P1-4
  tool_capability_matrix.enabled         = false   // P1-5
  markdown_prompt.enabled                = false   // P1（Markdown 文档配置注入）
  action_guardrails.enabled              = false   // P2-1
  few_shot.enabled                       = false   // P2-2
  parallel_tools.enabled                 = false   // P2-3
```

---

## 2）Markdown 文档配置机制（P1，✅ 已落地；因包根 config.yaml 当前实际生效）

这是原报告「结论」中被误判为「不支持」的机制。代码实际已实现完整链路：

### 2.1 约定文件与 frontmatter

`src/config/markdown-loader.ts` 按约定文件名扫描**包根目录**（`getPackageRoot() = path.resolve(__dirname, '..', '..')`）：

| 文件名 | 默认注入目标 `inject_to` | 默认加载方式 `load` |
|--------|--------------------------|---------------------|
| `AGENTS.md`  | `system_prompt`（行为准则/SOP）   | `eager`（常驻） |
| `SOUL.md`    | `system_prompt`（人格/语气/边界）  | `eager`（常驻） |
| `USER.md`    | `runtime_context`（用户画像）      | `eager`（常驻） |
| `MEMORY.md`  | `runtime_context`（长期记忆）      | `lazy`（按需）  |

每个文档通过 YAML frontmatter 声明元信息（`MarkdownMeta`）：

```yaml
---
inject_to: system_prompt      # system_prompt | runtime_context | none
load: eager                  # eager | lazy
priority: 0                  # 数值越大越靠前
cascade_level: global        # global < project < user（层级级联）
cascade: true
---
正文内容...
```

`parseFrontmatter()` 复用 `yaml-loader.ts` 的最小 YAML 子集解析器，解析失败返回空对象（不抛异常，走降级）。`parseMarkdownDoc()` 输出结构化 `MarkdownDoc { name, content, meta, injectTo, source }`。

> 注：原报告指出的「全仓 0 个 `AGENTS.md` 等文件」**已过时**。当前包根已存在 `AGENTS.md`/`SOUL.md`/`USER.md`/`MEMORY.md` 四个文件。它们的 frontmatter 与 `init-defaults.ts` 的 `DEFAULT_TEMPLATES` 一致（如 AGENTS.md：`inject_to: system_prompt, load: eager, cascade_level: global`）。

### 2.2 加载与聚合

- `loadMarkdownDocs({ onlyLoad?: 'eager'|'lazy' })`：扫描 4 个约定文件 + `config/domains/<domain>.md` 领域适配目录，返回 `MarkdownDoc[]`。文件缺失/frontmatter 非法 → 返回空数组（纯增强、零侵入）。
- `MarkdownPromptAggregator`（`markdown-prompt-aggregator.ts`）：
  - `aggregateToSystemPrompt(base, docs, budget)`：过滤 `inject_to=system_prompt` 且 `cascade!==false` 的文档，按层级→优先级→文档名确定性排序后并入 system prompt。
  - `collectRuntimeContext(docs, budget)`：收集 `inject_to=runtime_context` 的文档作为 runtime context。
  - 长度预算（`MarkdownBudget`，对应原报告 4.5 风险①「Token 膨胀」）：`systemPromptMaxChars=8000`、`runtimeContextMaxChars=4000`，超限字符级截断并追加 `[truncated]`。
  - 无相关文档时返回 `base` 原样（行为等价现状）。

### 2.3 在 factory 中的接入点（gated）

`src/graph/factory.ts:531-564`：

```ts
let markdownRuntimeContext = configurable['runtime_context'] ?? null
if (runtimeConfig.get('react_optimization.markdown_prompt.enabled', false)) {
  const mdDocs = loadMarkdownDocs({ onlyLoad: 'eager' })
  const budget = {
    systemPromptMaxChars: runtimeConfig.get('react_optimization.markdown_prompt.system_prompt_max_chars', 8000),
    runtimeContextMaxChars: runtimeConfig.get('react_optimization.markdown_prompt.runtime_context_max_chars', 4000),
    truncateMarker: '\n\n[truncated]',
  }
  const aggregated = MarkdownPromptAggregator.aggregateFromDocs(effectiveSystemPrompt, mdDocs, budget)
  effectiveSystemPrompt = aggregated.systemPrompt ?? effectiveSystemPrompt
  // runtimeContext 优先级：宿主显式传入 configurable['runtime_context'] > Markdown 文档
  if (configurable['runtime_context'] === undefined || configurable['runtime_context'] === null) {
    markdownRuntimeContext = aggregated.runtimeContext || null
  }
}
```

`markdownRuntimeContext` 进一步被 P1-4 的 `PromptComposer`（位于 `src/reasoning/prompt-composer.ts`，**不在 config 目录**）在 `react_optimization.prompt_composer.enabled` 开启时组装为 `runtimeContext` 层。

**关键事实**：`DEFAULT_CONFIG` 中 `markdown_prompt.enabled = false`，但包根 `config.yaml` 将其覆盖为 `true`（经 `loadConfigYamlValidated` 类型校验后深度合并），因此**该链路在当前包环境下实际生效**：AGENTS.md/SOUL.md 并入 system prompt，USER.md 进入 runtimeContext，MEMORY.md 因 `load: lazy` 不参与常驻注入（仅宿主显式调用 `loadMarkdownDocs({ onlyLoad: 'lazy' })` 时加载）。

---

## 3）YAML 分层配置（P0，✅ 已落地）

`src/config/yaml-loader.ts`（零外部依赖，内置最小 YAML 子集解析器）：

- `findConfigYaml()`：在包根查找 `config.yaml`/`config.yml`，不存在返回 `null`。
- `parseYamlSubset(text)`：递归下降解析——支持 2 空格缩进嵌套 map、块列表（`- key: value` 列表项为 map 可继续嵌套）、裸/引号标量、数字、`true/false`、`null`、行内注释。不支持多文档/锚点/多行文本块（`|`/`>`），遇到无法识别结构抛错，由上层降级。
- `loadConfigYamlValidated(base, filePath?)`：解析后对照 `base`（通常为 `DEFAULT_CONFIG` 深拷贝）做**类型安全校验**（`validateAgainstBase`）：
  - 仅校验 override 中已存在于 base 的键；新增键放行（不做类型假设）。
  - 标量类型必须一致（`typeof` 比较），不符则丢弃该键并告警（借鉴 Trae 的 int 强校验，对应原报告 4.5 风险②）。
  - 返回 `{ cleaned, droppedKeys }`；文件缺失/解析失败返回 `null`。
- `deepMergeConfig(base, override)`：对象递归合并、数组/标量覆盖，语义与 `RuntimeConfig._deepMerge` 一致。

接入点即第 1 节的 `getConfig()` 路径，解析成功则与 `DEFAULT_CONFIG` 深度合并，失败降级 `fromEnv`。

---

## 4）首次安装初始化模板（P4，✅ 已实现，❌ 未被自动调用）

`src/config/init-defaults.ts`：

- `DEFAULT_TEMPLATES`：内置 5 个模板——`AGENTS.md`、`SOUL.md`、`USER.md`、`MEMORY.md`、`config.yaml`（其中 `config.yaml` 含 `react_optimization.markdown_prompt.enabled: true` + 长度预算，使首次安装即可用 Markdown 注入）。
- `initDefaultConfigFiles({ rootDir?, templates? })`：**幂等**——只写入不存在的文件，已存在则跳过（绝不覆盖用户修改）；单文件失败隔离（`skipped`）；原子写入（先写临时文件再 `rename`）。
- `hasDefaultConfigFiles(rootDir?)`：判断是否已初始化。

**与代码不符的更正**：原报告 P4 称「`init-defaults` 接到了 `getConfig()` 启动时自动调用」。实际代码中 `initDefaultConfigFiles` 仅在 `src/config/index.ts` 中被导出，**未在 `getConfig()` 或任何启动路径中自动调用**。它作为「供宿主显式调用一次」的能力存在（如打包安装脚本），不会在每次 `getConfig()` 时触发。包根当前的 `config.yaml` + 4 个 `.md` 文件内容与 `DEFAULT_TEMPLATES` 逐字一致，应为历史某次 `initDefaultConfigFiles()` 调用（或照模板手动创建）的产物。

> ⚠️ **导入路径注意**：`package.json` 的 `exports` 仅定义了 `.`、`./core`、`./graph`、`./mcp`、`./skills` 子路径，**不含 `./config`**。`init-defaults.ts` 源码注释中示例的 `import { initDefaultConfigFiles } from '@pioneering/modu-agent/config'` 在当前 package.json 下**会导入失败**（`ERR_PACKAGE_PATH_NOT_EXPORTED`）。正确方式是从主入口导入：`import { initDefaultConfigFiles } from '@pioneering/modu-agent'`（`src/index.ts` 已 `export * from './config/index.js'`）。

---

## 5）已落地的基础配置子模块（✅ 真实存在）

位于 `src/config/`，均由 `index.ts`（barrel）统一导出：

| 文件 | 主要导出 | 说明 |
|------|----------|------|
| `runtime-config.ts` | `RuntimeConfig`、`getConfig`、`resetConfig`、`overrideConfig`、`DEFAULT_CONFIG` | 配置核心单例 |
| `yaml-loader.ts` | `loadConfigYaml`、`loadConfigYamlValidated`、`deepMergeConfig`、`findConfigYaml`、`parseYamlSubset` | P0 YAML 分层加载 |
| `markdown-loader.ts` | `loadMarkdownDocs`、`parseFrontmatter`、`parseMarkdownDoc`、`findConventionalMarkdownDocs`、`getPackageRoot`、`MarkdownDoc` | P1 Markdown 加载 |
| `markdown-prompt-aggregator.ts` | `MarkdownPromptAggregator`、`DEFAULT_MARKDOWN_BUDGET`、`estimateTokens` | P1 注入聚合 + 长度预算 |
| `memory-md-persistence.ts` | `serializeMemoryToMarkdown`、`parseMemoryFromMarkdown`、`writeMemoryToMarkdownFile`、`readMemoryFromMarkdownFile` | P2-6 记忆 Markdown 持久化（config 层，graph 未直接引用） |
| `knowledge-index.ts` | `KnowledgeIndex` | P3-8 知识索引（config 层，graph 未直接引用） |
| `plugin-manifest.ts` | `validateManifest`、`parseManifest`、`loadManifestFromFile` | P3-9 插件清单校验 |
| `schemas.ts` | `PerceptionInputSchema`、`MemoryQuerySchema`、`ToolCallSchema`、`LLMCallSchema`、`FeedbackSignalSchema` 等多 schema + `isValidContextWindow` | 配置/数据校验 schema |
| `snapshot.ts` | `buildConfigSnapshot`、`buildDebugConfigHandler`、`maskSensitiveValues` | `/debug/config` 溯源快照（含来源 + 敏感值脱敏） |
| `init-defaults.ts` | `initDefaultConfigFiles`、`hasDefaultConfigFiles`、`DEFAULT_TEMPLATES` | P4 首次安装初始化 |

> 注意：`factory.ts` 中引用的 `PromptComposer` 位于 `src/reasoning/prompt-composer.ts`（**不是** `config/` 模块）；测试 `tests/reasoning/prompt-composer.test.ts` 存在。

---

## 6）未落地项（原报告误标为「已实施」）

以下能力在原报告中以「实施记录」形式描述，但**当前代码中对应的独立 config 子模块均不存在**（已用 code-explorer 在 `src/` 全量搜索验证，0 命中）。相关能力若以其他形式存在，已在备注中说明：

| 原报告声称项 | 代码现状 | 备注 |
|--------------|----------|------|
| `config/llm-as-judge.ts` | ❌ 不存在 | LLM-as-Judge 逻辑分散在 `factory.ts` 的 `_build_judge_llm()`（行 204–245）+ `feedback/quality-monitor.ts`/`loop-controller.ts`/`evolution/evolution-orchestrator.ts`，通过 `feedback.*` 配置键（`quality_monitor_mode` 等）控制，非独立 config 子模块 |
| `config/mcp-config.ts` | ❌ 不存在 | MCP 配置是 `runtime-config.ts` 的 `mcp: { enabled, default_timeout, servers }` 块（行 255–259），实现在 `src/mcp/`；factory 第 487 行按 `mcp.enabled` 接入 |
| `config/early-stop.ts` | ❌ 不存在 | 搜索 `earlyStop/early-stop/early_stop` 在 `src/` 0 命中；终止判定由 `src/graph/termination-engine.ts`（`shouldTerminate()`）+ `react_optimization.adaptive_termination` 承载 |
| `config/testing-config.ts` | ❌ 不存在 | `src/config/` 中 0 命中 |
| `config/rag-config.ts` | ❌ 不存在 | 无独立 RAG 模块（`Retriever/VectorStore/retrieval` 等标识符 0 命中）；底层向量检索能力在 `memory/chroma.ts`（`ChromaLongTermMemory`）与 `skills/few-shot-selector.ts`（`DynamicFewShotSelector` MMR 检索），非标准 RAG |
| `config/behavior-config.ts` | ❌ 不存在 | 搜索 `behavior/Behaviour` 在 `src/` 与 `dist/` 均 0 命中 |
| `config/sandbox-config.ts` | ❌ 不存在 | 无独立沙箱配置模块（`sandbox` 标识符 0 命中）；沙箱**功能**实际存在：`tools/code-executor.ts` 的 `CodeExecutorTool`（源码白名单校验 + `child_process.execFile` 子进程隔离执行，注释自称"白名单沙箱"），经 `tools.human_in_loop.sensitive_tools` 接入审批 |
| `config/factory-config.ts` | ❌ 不存在 | `factoryConfig/factory-config` 标识符 0 命中（仅存在 `graph/factory.ts` 图构建文件，无对应配置模块） |
| `config/feedback-config.ts` | ❌ 不存在为独立模块 | `feedback` 是 `runtime-config.ts` 的配置块（行 228–237），非子模块文件 |
| P3 多项独立模块（如 `config/rag`、`config/behavior`） | ❌ 未落地 | 见上 |

**结论**：P0、P1、P4 及基础配置子模块（schemas/snapshot/knowledge-index/plugin-manifest/memory-md-persistence）确为代码事实；P2（guardrails/few-shot/parallel-tools/feedback-judge 等）部分能力以 `react_optimization.*` flag 或 `feedback.*` 块形式存在，但原报告所写的独立 config 子模块文件并未创建；P3 的多数「独立模块」尚未落地。

---

## 7）原报告风险登记表（4.5）的缓解现状

| 风险 | 描述 | 代码现状 |
|------|------|----------|
| 风险① Token 膨胀 | AGENTS.md 等过大撑爆上下文 | ✅ `MarkdownPromptAggregator` 已有字符预算（`systemPromptMaxChars=8000`/`runtimeContextMaxChars=4000`）+ `[truncated]` 截断；lazy 文档（MEMORY）按需加载 |
| 风险② 类型安全 | 环境层误写静默失效 | ✅ `loadConfigYamlValidated` 对照 `DEFAULT_CONFIG` 做标量类型校验，不符字段丢弃并告警（返回 `droppedKeys`） |
| 风险③ 来源溯源 | 配置来自哪层不可见 | ✅ `RuntimeConfig` 构造时记录 `sources`（base/file/dropped），`snapshot.ts` 的 `buildConfigSnapshot` 提供 `/debug/config` 溯源 + 敏感值脱敏 |
| 风险 层级 cascade | 多层级 AGENTS.md 覆盖顺序 | ✅ `CASCADE_LEVEL_ORDER = [global, project, user]` + priority + 文档名确定性排序 |

---

## 8）测试现状（✅ 已修正）

- 测试框架：**vitest**（`package.json` 脚本 `"test": "vitest run"`，依赖 `vitest ^2.0.0`）。
- 测试文件：共 **52 个** `*.test.ts`，位于 `tests/` 下按模块分目录（`config/`、`graph/`、`feedback/`、`mcp/`、`evolution/`、`reasoning/`、`tools/`、`skills/`、`perception/`、`orchestration/`、`observability/`、`memory/`、`core/`）。无 `__tests__/` 目录。
- **更正**：原报告「596 例通过 + 7 例 sql-query 失败」的截图数字无法在当前代码状态中复现核实，且测试组织已为 vitest（非原报告暗示的 pytest 风格）。请以实际运行 `npm test`（即 `vitest run`）的结果为准；config 相关测试涵盖 `yaml-loader`、`markdown-loader`、`markdown-prompt-aggregator`、`runtime-config`、`init-defaults`、`schemas`、`snapshot` 等。

---

## 9）配置机制总览（现状）

```text
配置来源（优先级由高到低，getConfig 组合）：
  override 参数（测试）> MODU_CONFIG_PATH(JSON) > config.yaml(YAML 分层) > 环境变量(fromEnv) > DEFAULT_CONFIG

运行时注入（factory.ts，全部 gated by feature flag；本包环境因包根 config.yaml 而 markdown_prompt 实际开启）：
  SkillPromptAggregator.aggregate            → 技能提示（既有）
  [react_optimization.markdown_prompt.enabled]（DEFAULT_CONFIG=false，包根 config.yaml 覆盖为 true）
    ├─ loadMarkdownDocs(eager)               → 扫描 AGENTS/SOUL/USER/MEMORY + domains
    ├─ MarkdownPromptAggregator.aggregateFromDocs
    │     ├─ inject_to=system_prompt  → 并入 system prompt（带长度预算截断）
    │     └─ inject_to=runtime_context → markdownRuntimeContext（优先级低于宿主显式传入）
  [react_optimization.prompt_composer.enabled]（默认 false，未在包根 config.yaml 开启）
    └─ PromptComposer.compose(systemCore + domain + taskSpec + runtimeContext)

首次安装（被动能力，需宿主显式调用 initDefaultConfigFiles）：
  AGENTS.md / SOUL.md / USER.md / MEMORY.md / config.yaml（markdown_prompt.enabled: true）
  注：包根当前这套文件与 DEFAULT_TEMPLATES 逐字一致，即模板已生成；且 config.yaml 使注入生效
```

---

## 10）建议（面向后续迭代）

1. **`.md` 配置的默认策略已"事实开启"，应显式化**：包根 `config.yaml` 已将 `markdown_prompt.enabled` 覆盖为 `true`，即本包环境 `create_agent()` 会真实注入 AGENTS/SOUL/USER。需注意两点：① npm 发布时包根 `config.yaml` + 4 个 `.md` 会随包分发（package.json 无 `files` 限制），**下游安装即被注入"pioneering 编码助手"人格**——对宿主是隐性副作用，应在文档中显式说明或提供关闭方式；② 宿主若自行调用 `initDefaultConfigFiles`，写入的是其 `rootDir`（默认包根），路径语义需与运行目录核对。
2. **`package.json` exports 补 `./config` 子路径**（或修正 `init-defaults.ts` 注释与本文档示例）：当前 `@pioneering/modu-agent/config` 导入会失败，正确入口是主入口 `@pioneering/modu-agent`。
3. **补齐「声明未写、消费已存在」的配置键**：`plan_execute.planner_max_tokens`（`graph/plan-execute/planner.ts:435`）、`plan_execute.step_retry.default_max_attempts` / `default_base_delay`（`graph/plan-execute/dispatcher.ts:622,626`）被消费但 `DEFAULT_CONFIG.plan_execute` 未声明（靠 `get` fallback 掩盖）。应在 `DEFAULT_CONFIG` 补声明，否则 YAML 校验（仅校验已存在键）无法保护这些键的类型安全。
4. **把未落地规划项与代码对齐**：原报告 P2/P3 中大量「独立 config 子模块」尚未创建。若确实需要（如 `llm-as-judge`、`sandbox`、`rag`），应新建对应模块并接入 `factory.ts`，或将该报告相关章节改写为「规划/待办」而非「实施记录」。
5. **快照可观测性已具备**：`/debug/config` 溯源 + 类型丢弃告警已可支撑「配置为何不生效」的排查，建议在部署后保留该能力。

---

## 11）短板治理实施记录（2026-08-21，已落地）

> 针对架构评估中的三条真实短板（消费点分散、环境变量游离、文档失真），以「纯增强、不修改既有业务逻辑、默认行为等价」为原则落地两个新模块，并接入 `/debug/config` 溯源快照。

### 11.1 环境变量统一治理 —— 新增 `src/config/env.ts`

- **`ENV_VAR_REGISTRY`**：全量环境变量注册表（28 项），与源码 `process.env` 逐处核对（2026-08-21）。每项记录 `name`/`category`/`sensitive`/`consumers`/`inRuntimeConfig`/`configKey`/`description`。覆盖 LLM 四家 provider 专属变量（`MODU_{GLM|DEEPSEEK|QWEN|OPENAI}_{API_KEY|BASE_URL|MODEL}`）+ 通用 `LLM_API_KEY/BASE_URL/DEFAULT_MODEL` + `MODU_LLM_PROVIDER/TEMPERATURE/MEMORY_STRATEGY` + Chroma（`MODU_CHROMA_IN_MEMORY/PATH`）+ 工具根目录（`MODU_FILE_OPS_ROOT`/`MODU_DOC_WRITER_ROOT`）+ 检索/代理（`TAVILY_API_KEY`、`HTTP(S)_PROXY` 大小写 4 项）+ `MODU_CONFIG_PATH`。（`PATH` 属系统变量，排除不计。）
- **`collectEnvSources({ maskSensitive })`**：仅列出**当前进程已设置**的环境变量，敏感值（api_key/token/secret 等）脱敏为 `***`；未设置的不出现。
- **`readEnvVar` / `groupEnvVarsByCategory` / `auditEnvVars`**：读取、分组、审计（统计已注册/未注册/敏感已设置）。
- **性质**：纯数据 + 纯函数，零副作用；**不替代**各模块现有 `process.env.X` 读取（避免改动业务逻辑），作为「清单/审计层」与既有读取并存。

### 11.2 配置能力注册表 —— 新增 `src/config/capability-registry.ts`

- **`CAPABILITY_REGISTRY`**：配置能力清单（已实现 13 项 + 规划未落地 5 项），每项记录 `id`/`name`/`configPrefix`/`enabledKey`/`configKeys`/`implementation`/`defaultEnabled`/`status`。解决「消费点分散（100+ 处）缺清单」的短板，提供权威的「配置键 → 能力 → 消费模块」映射。
- **`UNDECLARED_CONSUMED_KEYS`**：显式登记「被消费但 `DEFAULT_CONFIG` 未声明」的 3 个键（`plan_execute.planner_max_tokens`、`plan_execute.step_retry.default_max_attempts`/`default_base_delay`），对应报告第 10 节建议 3。
- **`listCapabilities` / `listEnabledKeys` / `capabilityStatus`**：按状态过滤、枚举 feature flag、查询当前启用状态。
- **性质**：纯数据 + 纯函数，不接入 `factory.ts` 接线逻辑，与现有分散 `get()` 调用并存。

### 11.3 接入溯源快照 —— 修改 `src/config/snapshot.ts`

- `buildConfigSnapshot` 在原有 `getSources()` 基础上，叠加 `collectEnvSources()` 结果（环境变量来源，脱敏），使 `/debug/config` 能回答「哪些环境变量生效、哪些是密钥」——补齐此前环境变量无法审计的短板。
- 合并顺序 `{ ...envSources, ...trackedSources, ...opts.sources }`：调用方显式 `sources` 仍为最高优先级，向后兼容；未设置的环境变量不注入，不影响既有快照结构。

### 11.4 导出 —— 修改 `src/config/index.ts`

- 新增导出 `env.ts` 与 `capability-registry.ts` 全部类型与函数。

### 11.5 测试与回归

- 新增 `tests/config/p5-env-capability.test.ts`（14 例，全绿）：注册表完整性/无重名、敏感标记、RuntimeConfig 映射、分组、读取/脱敏/审计、能力清单/开关枚举/状态查询、未声明键登记、planned 项空实现断言。
- `tests/config` 全绿（8 文件 128 例）；`tsc -p tsconfig.build.json --noEmit` 0 错误。
- 完整套件 **620 例通过，7 例失败**；失败全部来自 `tests/tools/sql-query.test.ts`（表名提取 16 例中 7 例），为**预先存在失败、与本次改动无关**（该测试仅依赖 `@/tools/sql-query.js`，不涉及 config/env/capability）。

### 11.6 待办（仍未落地，需后续决策）

- `package.json` `exports` 补 `./config` 子路径（第 10 节建议 2）。
- `DEFAULT_CONFIG.plan_execute` 补声明 `planner_max_tokens` / `step_retry.*`（第 10 节建议 3，现已由 `UNDECLARED_CONSUMED_KEYS` 显式登记，但尚未写入 DEFAULT_CONFIG 以获得 YAML 类型保护）。
- `.md` 配置「默认值二义性 + 发布隐性副作用」的显式化决策（第 10 节建议 1）。
