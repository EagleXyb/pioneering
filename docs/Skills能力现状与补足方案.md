# Skills 能力现状分析与补足方案

| 项 | 内容 |
|---|---|
| 文档状态 | 现状分析（已完成） + 补足方案（待评审） |
| 日期 | 2026-10-20 |
| 分析范围 | `apps/web/src`、`packages/modu-agent`、`apps/backend-ts`（仅取 `/skills` 出口用于闭合端到端判断） |
| 不在范围 | Python 旧后端 `apps/backend/ModuAgent`（同构实现，能力等价，不重复计入）、`apps/desktop` |
| 结论 | Skills 在内核层是「可用的最小可插拔闭环」，在产品层仅为「只读展示壳」，端到端链路不完整 |

---

## 目录

- [0. 结论速览](#0-结论速览)
- [1. 能力地图](#1-能力地图)
- [2. 前端 UI 层](#2-前端-ui-层)
- [3. Agent 接入层](#3-agent-接入层)
- [4. 管理层](#4-管理层)
- [5. 端到端链路完整性判定](#5-端到端链路完整性判定)
- [6. 补足方案总纲](#6-补足方案总纲)
  - [6.0 行业基准：成熟产品怎么做](#60-行业基准成熟产品怎么做)
  - [6.0.5 选型结论：C 为主干，B 为子层，A 借格式，D 不做](#605-选型结论c-为主干b-为子层a-借格式d-不做)
- [7. P0：打通「选择 → 执行」](#7-p0打通选择--执行)
- [8. P1：技能激活与管理面](#8-p1技能激活与管理面)
- [9. P1：定义格式、版本与依赖](#9-p1定义格式版本与依赖)
- [10. P2：权限与治理](#10-p2权限与治理)
- [11. P1-c：渐进式披露 与 P2：生命周期](#11-p1-c渐进式披露-与-p2生命周期)
- [12. 实施计划](#12-实施计划)
  - [12.1 任务清单与类型标注](#121-任务清单与类型标注)
  - [12.2 改造优先级排序](#122-改造优先级排序)
  - [12.3 迭代切片与调整触发器](#123-迭代切片与调整触发器)
- [13. 测试与验收](#13-测试与验收)
- [14. 风险与取舍](#14-风险与取舍)
- [15. 附录](#15-附录)

---

## 0. 结论速览

| 链路 | 状态 | 一句话 |
|---|---|---|
| **发现**（用户看到技能） | ⚠️ 半通 | 列表能取到、能搜索、能勾选，但勾选结果**不进入任何请求** |
| **配置**（增删 / 启停技能） | ❌ 不通 | 无写接口、无管理 UI、无持久化，只能改 `config.yaml` + 重启 |
| **执行**（Agent 真正用上） | ⚠️ 条件通 | 内核有可用最小闭环，但 `skills.enabled` 默认 false 且本仓库未开启，与 UI 选择完全无关 |

三点定性：

1. **内核可用**：抽象、发现、注册、工具降解、提示聚合、异常隔离、失败降级六件事均已实现，且遵守「默认关闭 / 默认等价 / 逐项隔离」的工程纪律。
2. **产品不可用**：前端具备完整的展示工艺（搜索、多选、徽标、空态、错误重试、无障碍），但没有任何写通路，勾选状态是纯本地幻觉（`localStorage`）。
3. **治理空白**：无存储、无版本、无权限、无生命周期、无审计；`manifest`、`requiredScopes()`、`preconditions()`、`teardown()` 属于「声明即终点」的死代码。

**当前部署实测结论**：`packages/modu-agent/config.yaml` 无 `skills` 段 → `skills.enabled=false`、`auto_discover_dirs=[]`；唯一示例技能 `MathSkill` 既不在可扫描目录结构中、也未从 `skills/index.ts` 再导出。因此 `GET /skills` 实际返回 `{ skills: [], total: 0 }`，前端技能菜单长期停留在空态引导文案。

---

## 1. 能力地图

### 1.1 三层职责与实际落点

```
┌──────────────────────────── 前端 UI 层（apps/web/src） ────────────────────────────┐
│ CapabilityBar → SkillPicker ──→ useSkillOptions ──→ api/skills.getSkills()          │
│                      │                    │                                          │
│                      │                    └─→ localStorage['skill-select:<mode>']      │
│                      └─→ 徽标数字（唯一消费者）                                       │
│                                                                                      │
│  ✗ 无 management UI   ✗ 选择不进请求体   ✗ 无 activation 动作                        │
└───────────────────────────────────┬──────────────────────────────────────────────────┘
                                    │ GET /skills（只读）
┌───────────────────────────────────▼──── 后端出口（apps/backend-ts）─────────────────┐
│ routes/skills.ts：registry.listSkills() ∪ SkillLoader.discover(dirs)  → SkillBrief[] │
│  ✗ 无 POST/PUT/DELETE   ✗ 无角色/租户过滤（仅 authGuard 登录校验）                    │
└───────────────────────────────────┬──────────────────────────────────────────────────┘
                                    │ 进程内调用
┌───────────────────────────────────▼──── Agent 接入层（packages/modu-agent）─────────┐
│ create_agent ──(skills.enabled)──→ SkillLoader.loadFromConfig                       │
│                                        ├─ discover：<dir>/<skill>/skill.{js,ts}      │
│                                        ├─ setup()                                    │
│                                        └─ registry.registerSkill                     │
│                                              ├─ _skills.set(name, skill)            │
│                                              └─ tools → SkillToolWrapper → _tools    │
│                                                                                      │
│ effectiveSystemPrompt ← SkillPromptAggregator.aggregate(base, registry)              │
│ tools ← build_langchain_tools(null /*全量*/, configurable.tools) → bind_tools        │
│                                                                                      │
│  ✗ 无 per-request / per-session 选择   ✗ 无 load_skill / 渐进式披露                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 概念辨析（避免同名混淆）

| 名词 | 实体 | 位置 | 与本主题关系 |
|---|---|---|---|
| **Skills（技能）** | `BaseSkill` → 工具集 + 提示片段 | `modu-agent/src/skills` | **本文主题** |
| **Plugins（插件）** | MCP Server（远程工具） | `useMcpPlugins` + `/mcp/*` | 同排 UI 的对照物，管理能力显著更强 |
| **Capabilities（能力清单）** | 模型能力元数据（alias/provider/context） | `apps/web/src/api/capabilities.ts` | **无关**，仅命名相近 |
| **配置能力注册表** | 配置键 → 能力 → 消费模块的审计清单 | `modu-agent/src/config/capability-registry.ts` | 审计用途，**未登记 `skills`** |
| **Scenario Packs（场景包）** | 领域 prompt + 护栏 + 配置覆盖 | `modu-agent/packs/*.yaml` | 更新的插件化体系，`capabilities` 不含 skill |

---

## 2. 前端 UI 层

### 2.1 已实现能力

**入口位置**：仅 pro / task 两个模式的输入框底部能力条；chat 模式刻意不带（符合模式分层约束）。

```
AnalysisInput / TaskInput
  → <CapabilityBar mode="pro|task">     // 21 行组合组件
      → <SkillPicker mode>              // 本文主体
      → <PluginPicker>                  // 对照物：MCP 插件
```

```18:24:apps/web/src/components/CapabilityBar/CapabilityBar.tsx
export function CapabilityBar({ mode, disabled }: Props) {
  return (
    <>
      <SkillPicker mode={mode} disabled={disabled} />
      <PluginPicker disabled={disabled} />
```

**`SkillPicker`（Popover 面板）已具备的交互**：

- 胶囊按钮：`Pickaxe` 图标 + "技能"文案 + 选中数量徽标 + 展开箭头；`aria-label` 随选中数变化（`选择技能，已选 N 个`）；
- 上弹面板与输入框等宽（`PopoverAnchor` 锚定 `.chat-input-card`），列表行 = 图标 + 名称 + 描述 + 勾选态；`active` 技能额外渲染「已加载」标签；
- 多选，勾选后面板**不关闭**（非模态语义，测试有断言）；
- 底部固定搜索框，按 `name / description / tags` 三字段过滤；
- 三态覆盖：loading（Spinner）、error（错误文案 + 重试）、empty（"暂无可用技能。在 modu-agent 配置 `skills.auto_discover_dirs` 后重启服务即可接入"）。

```122:158:apps/web/src/components/CapabilityBar/SkillPicker.tsx
          {!loading &&
            !error &&
            filtered.map((s) => {
              const checked = isSelected(s.name);
              return (
                <button
                  key={s.name}
                  type="button"
                  className={`capability-item${checked ? ' is-selected' : ''}`}
                  onClick={() => toggleSkill(s.name)}
```

**`useSkillOptions`（数据层）**：

- 列表来自 `GET /skills`，**模块级缓存**（pro / task 共用一次请求），失败不缓存、可 `reload()` 重试；
- 选中态按模式持久化 `localStorage['skill-select:<mode>']`（JSON 字符串数组），切模式时重读；
- 暴露 `skills / loading / error / selected / isSelected / toggleSkill / reload`。

```76:106:apps/web/src/hooks/useSkillOptions.ts
export function useSkillOptions(mode: AppMode): UseSkillOptionsReturn {
  const [skills, setSkills] = useState<SkillBrief[]>(skillsCache ?? []);
  const [loading, setLoading] = useState(skillsCache === null);
  ...
  useEffect(() => {
    fetchSkills()
      .then((list) => { if (!alive) return; setSkills(list); setLoading(false); })
```

**`api/skills.ts`**：`SkillBrief { name, description, version, tags, toolCount, active }`，只读单接口 `GET /skills`。

### 2.2 调用链

```
SkillPicker.onClick(item)
  → useSkillOptions.toggleSkill(name)          // 只写 localStorage，无网络
  → setState → 徽标 +1

SkillPicker.mount / reload
  → useSkillOptions.fetchSkills（模块级 inflight + cache）
  → api/skills.getSkills()
  → api/client.get('/skills')
  → backend GET /skills（authGuard）
  → registry.listSkills() + SkillLoader.discover(auto_discover_dirs)
```

### 2.3 能力边界与明显缺失

| # | 缺失 | 证据 |
|---|---|---|
| **U1** | **选中结果不参与请求**。`AgentCompletionBody` 只有 `sessionId / message / stream / agentMode / model / messageId / truncateAfter`，无 `skills` 字段；`selected` 除徽标外无任何消费者 | `apps/web/src/api/agent.ts:45-62`；全仓 `useSkillOptions` 仅被 `SkillPicker` 引用 |
| **U2** | 无「启用 / 停用 / 安装」动作。同排 `PluginPicker` 有「添加插件 / 管理插件」两个功能入口 + 点击即连接/断开 + toast 反馈，技能菜单只有勾选 | `PluginPicker.tsx:119-152` vs `SkillPicker.tsx:93-158` |
| **U3** | 无管理面。设置对话框分区为 `general / appearance / notification / chat / mcp / account / help / about`，**无 skills 分区** | `apps/web/src/store/settingsDialogStore.ts:13-14` |
| **U4** | 未激活技能可被勾选：`active=false` 的行只多一个（不会出现的）标签、仍可 toggle，用户会误以为"选中即启用" | `SkillPicker.tsx:127-134` |
| **U5** | 不展示 `version / tags / toolCount`（`SkillBrief` 有字段但 UI 未用），无技能详情、无工具清单预览 | `SkillPicker.tsx:138-150` |
| **U6** | 缓存不可失效：`skillsCache` 模块级常驻，只有手动 `reload`；后端配置变更后需刷新页面再点「重试」 | `useSkillOptions.ts:15-34` |
| **U7** | 无执行态归属：工具调用行是通用卡片，仅靠正则把 `skill|library` 映射为「加载技能」，与本仓库 TypeScript 内核无对应工具（历史遗留映射） | `apps/web/src/lib/toolAction.ts:46` |
| **U8** | 已规划未落地：方案文档 T4.6 明确「请求体无 `skills`，需扩展 `skills?: string[]`」，验收项全部未勾选 | `apps/web/docs/三模式Agent能力分层实施方案.md:1196-1228` |

---

## 3. Agent 接入层

### 3.1 对象模型：Skill = 工具集 + 提示片段

`BaseSkill` 把 Skill 降解为图可见的两类产物，**图 / 节点 / ReAct 循环对 Skill 完全无感知**。

```14:73:packages/modu-agent/src/core/interfaces/skill.ts
export abstract class BaseSkill {
  abstract name(): string
  abstract description(): string
  abstract version(): string
  tags(): string[] { return [] }
  examples(): Array<Record<string, string>> { return [] }
  preconditions(): Record<string, any> { return {} }
  requiredScopes(): string[] { return [] }
  tools(): BaseTool[] { return [] }
  systemPromptFragment(): string | null { return null }
  isAvailable(): boolean { return true }
  setup(): void {}
  teardown(): void {}
}
```

### 3.2 注册：`SkillLoader` + `ComponentRegistry.registerSkill`

**加载器**（目录扫描 + 白名单 + 逐项隔离）：

- 约定 `<base>/<skill>/skill.{js,ts}`，`import()` 后取模块级 `skill` 实例或 `skills` 数组，按 `name()` 去重；
- 单个导入失败只 `logger.error`，绝不阻断启动；
- `loadFromConfig()` 首行门控 `skills.enabled`（默认 false，直接 return），再按 `skills.active` 白名单逐个 `setup()` + `registerSkill()`；未命中白名单只告警跳过。

```112:146:packages/modu-agent/src/skills/loader.ts
  async loadFromConfig(): Promise<void> {
    if (!this._config.get('skills.enabled', false)) {
      logger.debug('Skills disabled (skills.enabled=false), skipping load')
      return
    }
    const active: string[] = this._config.get('skills.active', []) || []
    const discoverDirs: string[] = this._config.get('skills.auto_discover_dirs', []) || []
```

**注册中心**（Skill 注册 = 工具就位）：

```731:761:packages/modu-agent/src/core/registry.ts
  registerSkill(skill: BaseSkill): void {
    if (!skill.isAvailable()) { /* warning + return */ }
    this._skills.set(skill.name(), skill)
    for (const tool of skill.tools()) {
      if (this._tools.has(tool.name())) {
        // 工具名冲突 → 只跳过该工具并 warning，Skill 条目仍保留
        continue
      }
      this.registerTool(_skillToolWrapperFactory(tool, skill.name()))
```

要点：注册是**全局单例、进程级**（`getRegistry()`），不是会话级；工具名冲突不产生任何可观测报告面。

### 3.3 运行时装配（两个唯一接线点，均在 `create_agent`）

```619:628:packages/modu-agent/src/graph/factory.ts
  // P1: Skills 动态加载（默认关闭，gated by skills.enabled，零风险）
  if (runtimeConfig.get('skills.enabled', false)) {
    const loader = new SkillLoader(getRegistry(), runtimeConfig)
    await loader.loadFromConfig()
```

```795:804:packages/modu-agent/src/graph/factory.ts
  if (runtimeConfig.get('skills.enabled', false)) {
    effectiveSystemPrompt = SkillPromptAggregator.aggregate(
      effectiveSystemPrompt, getRegistry(),
    )
```

时序：`create_agent` → 内置组件/prompt 注册 → **Skills 加载(619)** → 构建 LLM → 默认工具注册(650) / MCP 发现(671) → `build_langchain_tools(null, configurable.tools)`（**null = 注册表全量**）→ `bind_tools` → 编译图 → 系统提示词聚合。

因此技能工具与内置工具在图中**完全同权**，作为普通 function-calling 工具暴露给 LLM。

### 3.4 提示注入：`SkillPromptAggregator`

- 遍历 `registry.listSkills()`，渲染为 `[Skill: <name> v<version>]\n<systemPromptFragment 或 description>`，并附 `examples` 的「输入 / 输出」行；
- 无片段时**原样返回 base**（字符等价、零行为变化）；异常降级返回 base。

```24:47:packages/modu-agent/src/skills/prompt-aggregator.ts
  static aggregate(base: string | null, registry: ComponentRegistry): string | null {
```

### 3.5 执行与隔离：`SkillToolWrapper`

```68:117:packages/modu-agent/src/skills/adapter.ts
export class SkillToolWrapper extends BaseTool {
  async invoke(params, context) {
    try { return await this._inner.invoke(params, context) }
    catch (e) {
      return {
        status: 'error',
        error_code: 'SKILL_EXECUTION_FAILED',
        data: { message: String(e), skill: this._skillName },
      }
    }
```

- 包装后 `name / description / parametersSchema / requiresApproval` 全透传 → 注册中心 / 图 / function-calling 视角无差异；
- 工厂在模块加载时注入 registry（`setSkillToolWrapperFactory`），规避 ESM 循环依赖；
- 异常被吞成标准错误字典 → `wrap_modu_tool` 序列化为 JSON 字符串回给 LLM，**不会炸图**。

### 3.6 能力边界与缺失

| # | 问题 | 说明 / 证据 |
|---|---|---|
| **A1** | **无按请求 / 会话的技能选择与路由**。`create_agent` 的 `configurable` 只认 `model / system_prompt / tools / domain / plan_execute_enabled` 等，没有 `skills`；技能集由进程级白名单决定，「用哪个技能」完全交给 LLM 凭工具描述自选 | `factory.ts:614-628`；`agent-bridge.ts:41-48` 的图缓存 key 也不含技能 |
| **A2** | **无渐进式披露（progressive disclosure）**。没有 `SKILL.md` / `load_skill` / 「技能目录 + 按需展开」；提示片段全量常驻注入，`examples` 无 token 预算、无相关性筛选（`few-shot-selector` 是独立 feature flag，且示例库默认为空，与 `BaseSkill.examples()` 不连通） | `prompt-aggregator.ts:37-46`；`skills/few-shot-selector.ts` |
| **A3** | **HITL fail-closed 可能静默删技能工具**：`requiresApproval()` 恒 true 的技能工具，在 `tools.human_in_loop.enabled=false` 且 `perception.clarification.enabled=false` 时被从绑定集剔除，仅打 error 日志 | `factory.ts:692-727` |
| **A4** | **能力矩阵把技能工具判为「未知」**：`registerTool` 自动派生 `task_types:['default']`、`requires_confirmation:true`（`derived:true` 又在审批/串行判定中被排除）。一旦 `tool_capability_matrix.enabled=true`，技能工具在 research / coding 任务筛选中被过滤 | `tools/tool-registry.ts:171-211` |
| **A5** | **子 Agent 不继承技能提示**：`build_subagent_subgraph` 的 system prompt 走 PromptRegistry 模板，不经 `SkillPromptAggregator`；工具集同源，因此子 Agent「有工具、无技能指令」 | `graph/subgraph/builder.ts:55-79` |
| **A6** | **技能级可观测性缺失**：指标粒度是 `toolCallName`，无 skill 归属；wrapper 只在失败时打日志，无成功计数、无耗时、无审计事件 | `tool-adapter.ts:328-359`、`adapter.ts:104-114` |
| **A7** | **示例技能是死代码**：`MathSkill` 只在自身文件导出 `skill`，**未从 `skills/index.ts` 再导出**，也不存在 `<skill>/skill.js` 目录结构 → 即使打开开关也无法被发现；包 `exports` 只暴露 `./skills → dist/skills/index.js` | `skills/math-skill.ts:47-48`、`skills/index.ts`、`package.json` |
| **A8** | 生产环境 `.ts` 技能不可用：`discover()` 只探 `skill.js` / `skill.ts` 并直接 `import()`，无转译 / 沙箱；发布后的 dist 树里第三方 `.ts` 不会被加载 | `skills/loader.ts:64-96` |
| **A9** | 重复加载语义：每次 `create_agent` 都跑 `loadFromConfig()`，但 `getSkill(name)!==undefined` 即跳过 → 幂等；然而**从白名单移除后不生效**（无 `unregisterSkill` 调用） | `skills/loader.ts:127-131`；`unregisterSkill` 仅测试使用 |

---

## 4. 管理层

### 4.1 已实现

- **存储**：文件系统目录（`skills.auto_discover_dirs`） + 进程内 `ComponentRegistry._skills` Map。**无数据库表**（`schema.prisma` 中 `skill` 零命中）。
- **定义**：TypeScript 类（`extends BaseSkill`），需编译进 dist，或提供 ESM `skill.js`。
- **配置面**：默认声明齐全且默认关闭。

```201:205:packages/modu-agent/src/config/runtime-config.ts
  skills: {
    enabled: false,
    auto_discover_dirs: [],
    active: [],
  },
```

- **只读查询 API**（全仓唯一技能端点，`authGuard` 保护）：合并「已注册（`active:true`）」+「目录发现未激活（`active:false`）」，去重后返回；发现失败只 warn、返回已注册部分。

```47:93:apps/backend-ts/src/routes/skills.ts
      async () => {
        for (const s of Object.values(registry.listSkills())) { /* active: true */ }
        const dirs = (config.get('skills.auto_discover_dirs', []) ?? []) as unknown
        const discovered = await new SkillLoader(registry, config).discover(dirs.map(String))
```

- **元数据工具**：`plugin-manifest.ts` 提供 `validateManifest / parseManifest / loadManifestFromFile`（`name / version / capabilities / dependencies / entry`），但**零消费者**（仅 `config/index.ts` re-export + 测试引用），且注释明示「loader 可选用，但默认路径不依赖」。
- **加载隔离**：逐项 try/catch + 告警，永不阻断启动（也是架构文档反复引用的「隔离范式」模板）。

### 4.2 缺失矩阵

| 维度 | 现状 | 缺口 |
|---|---|---|
| **存储** | 目录 + 内存 Map | 无 DB / 对象存储、无安装包上传、无租户 / 工作区隔离、无技能 - 用户关系 |
| **定义** | 代码即定义 | 无声明式定义（`SKILL.md` / YAML / JSON 元数据 + 提示 + 工具映射），纯提示型技能编写门槛高；`plugin-manifest` 未接入 |
| **版本** | `version()` 字符串 | 仅用于提示头与 `GET /skills` 返回；无 semver 校验、无依赖解析、无升级 / 回滚 / 兼容性检查、UI 不展示 |
| **权限** | `requiredScopes()` / `preconditions()` **声明但零消费**；`/skills` 仅校验「已登录」 | 无技能级授权、无最小权限执行、无越权审计；发现即 `import()`，被配置目录内的代码以**进程全权限**执行（无签名 / 沙箱 / 来源校验） |
| **生命周期** | 首次 `create_agent` 时 `setup()`；`teardown()` **全仓零调用**；`unregisterSkill()` 仅测试调用 | 无热插拔（改 `active` 需重启：`getConfig` 单例一次性加载 YAML，无 reload API）、无健康检查、无灰度、无启停 API、无使用统计 / 计费 |
| **治理** | 只有 console 日志 | 无审计、无变更记录、无调用配额；`capability-registry` 未登记 `skills` 能力（配置审计门禁覆盖不到），`packs/*.yaml` 的 `capabilities` 也不含 skill |

### 4.3 与 MCP 插件（同排功能）的管理能力对比

| 能力 | Skills | MCP 插件 |
|---|---|---|
| 列表查询 | ✅ `GET /skills` | ✅ `GET /mcp/servers` |
| 新增 / 安装 | ❌ | ✅ `AddPluginDialog` + 写接口 |
| 启停 | ❌ | ✅ 点击即连接 / 断开 + toast |
| 管理入口 | ❌ | ✅ 「管理插件」→ 设置 mcp 分区 |
| 运行时生效 | 仅进程重启 | 即时 |
| 生命周期 | 无 teardown | start / stop |

---

## 5. 端到端链路完整性判定

### 5.1 三条链路分别验证

**① 发现链路（部分通路）**

```
SkillPicker → useSkillOptions → GET /skills → registry.listSkills()
                                            → SkillLoader.discover(dirs)
```

能列出「已激活」与「仅发现」两类并区分标签 → **发现闭环成立**。

但本仓库实际配置为 `skills.enabled=false` 且 `config.yaml` 无 `skills` 段，`auto_discover_dirs=[]`，唯一示例 `MathSkill` 无法被扫描 → `GET /skills` 返回空，UI 永远走空态。`packages/evals/config/global.yaml` 亦显式 `skills.enabled: false`，说明评测链路也不覆盖 Skills。

**② 配置链路（断链）**

无任何写入路径：无 `POST/PUT/DELETE /skills`、无激活 / 停用 API、无设置页、无 DB。用户的「勾选」只是 `localStorage` 里的一个数字，**不改变后端任何状态**。新增技能必须：放代码到被扫描目录 → 改 YAML 的 `active` → 重启进程。

**③ 执行链路（内通外断）**

内核侧确实可达：开启开关 + 有效技能目录后，`SkillLoader` → `registerSkill` → `SkillWrapper` 进全局工具表 → `build_langchain_tools(全量)` → `bind_tools` → ReAct `ToolNode` 执行 → 异常隔离为 `SKILL_EXECUTION_FAILED`；提示片段进 system prompt。该链有单测覆盖（`tests/skills/adapter.test.ts`、`prompt-aggregator.test.ts`、`tests/core/registry.test.ts`）。

但它与前端、与用户选择、与会话维度**完全没有连接**：没有 `skill` 字段贯穿 `agent/completions` → `agent-bridge` → `create_agent`。因此「用户在 UI 里挑技能 → Agent 按技能执行」这条端到端语义**不存在**。

### 5.2 证据清单

| 判定 | 关键证据（文件:行） |
|---|---|
| 列表可用，选择无效 | `apps/web/src/api/agent.ts:45-62`（无 `skills` 字段） |
| 无激活 / 管理 | `apps/backend-ts/src/routes/skills.ts:32-95`（仅 GET） |
| 无 per-request 技能 | `packages/modu-agent/src/graph/factory.ts:614-628`（`configurable` 无 skills） |
| 全量注入 | `packages/modu-agent/src/graph/adapters/tool-adapter.ts:382-427`（`toolNames=null` → 全量） |
| 进程级注册 | `packages/modu-agent/src/core/registry.ts:731-761` |
| 默认关闭 | `packages/modu-agent/src/config/runtime-config.ts:201-205` + `config.yaml` 无 skills 段 |
| 示例技能不可达 | `packages/modu-agent/src/skills/math-skill.ts:47-48`、`skills/index.ts` |
| 规划未落地 | `apps/web/docs/三模式Agent能力分层实施方案.md:1196-1228`（T4.6） |

### 5.3 结论

1. **内核能力达到「可用最小闭环」**，具备成为产品能力的技术基础；
2. **产品能力停留在「只读展示」**，端到端语义缺失；
3. **管理与治理基本空白**；
4. 整体判定：**Skills 是「框架级实验能力（P1/P2 已落地、产品化未启动）」**，不能按已交付能力对外承诺。

---

## 6. 补足方案总纲

### 6.0 行业基准：成熟产品怎么做

> 本节用于给方案定形：先对齐行业事实标准，再决定我们改什么、不改什么。结论先给：**技能是「文件」，不是「代码」；发现只注入元数据，加载分三层；执行必须在沙箱；管理像应用商店（版本不可变 + 作用域 + 管理员审批）**。本仓库这四条恰好全部反向，差距不在"能力有无"，而在"形态不对"。

#### 6.0.1 四种形态

**A. 文件系统型 —— Anthropic Agent Skills（事实标准）**

- 定义：一个目录 + `SKILL.md`，YAML frontmatter 至少含 `name` / `description`，正文为指令；同目录可放脚本、模板、参考资料。
- **渐进式披露三层**（官方文档口径）：

| 层 | 加载时机 | Token 成本 | 内容 |
|---|---|---|---|
| L1 元数据 | 始终（启动时） | 约 100 token / 技能 | frontmatter 的 `name` + `description` |
| L2 指令 | 技能被触发时 | < 5k token | `SKILL.md` 正文 |
| L3+ 资源 | 按需 | 访问前为零 | 打包文件；脚本经 bash 执行，**只有输出进上下文** |

- 执行：运行在带文件系统 + bash 的代码执行沙箱里，技能挂载为目录，模型用普通文件命令按需读取。
- 关键点：**不注册成 N 个 function-calling 工具**，而是「一个目录 + 一层按需读取」，把「工具数量」与「上下文消耗」解耦。

**B. 平台资源型 —— OpenAI Skills API**

- 上传即资源：`POST /v1/skills`（文件夹多文件或 zip，有体积上限），**版本不可变**（`SkillVersion`），用 `default_version` 指针切换；删默认版本前必须先改指向，删最后一个版本才删技能。
- 两种引用：`skill_reference`（按 id + 版本引用已上传技能）/ `inline_skill`（随请求内联）。
- 执行：在 hosted shell 容器内；另有官方 curated skills 作为首批能力。
- 关键点：**技能成为一等平台资源**（CRUD + 版本 + 内容下载），天然支持回滚与审计。

**C. 应用平台型 —— Copilot Studio / GPTs / 扣子 / Dify**

- 声明式 manifest：instructions + capabilities（知识、动作、开场白）+ 动作的 OpenAPI 描述。
- 三层发布链路：**编辑态 → 发布态（版本）→ 渠道 / 商店**，带审核、管理员发布策略、租户级 DLP 与身份（Entra / OAuth）。
- 关键点：**权限不写在 prompt 里**，落在发布策略 + 管理员开关 + 身份授权上。

**D. 协议注册型 —— MCP Registry**

- `server.json` 描述「怎么装、怎么连、能力是什么」；命名空间用 **DNS 验证**（如 `io.github.user/server`），包归属做**包仓库校验**，Registry Base URL 白名单。
- 关键点：注册表只做**发现 + 安装元数据**，不托管执行；接不接由客户端决定。

> 行业分工已经清晰：**Skills = 知识与流程（prompt + 脚本），MCP = 系统连接（工具与数据）**。本仓库把两者放在同排 UI（技能 / 插件）方向正确，但技能侧只学了 MCP 的"列表"，没学技能侧的"内容形态"。

#### 6.0.2 逐层对照

> 四种形态**不是互斥选项**：实际产品几乎都是组合（国内 C 端 = C + B + D，Anthropic = A + B）。本仓库的选型结论见 **6.0.5**。

| 维度 | 成熟做法 | 本仓库现状（见第 2–5 章） |
|---|---|---|
| 定义 | 声明式 `SKILL.md` / `manifest.json`，非研发也能写，脚本可选 | TS 类 `extends BaseSkill`，必须编译进 dist |
| 发现 | 只注入 `name + description`（~100 token/技能），正文不预载 | 全量注入 `systemPromptFragment` + 全部 examples |
| 选择 | 模型按 description 自选 + 用户可显式（@提及 / 会话级挂载 / 平台开关） | 模型全量可见；UI 勾选**不进请求** |
| 执行 | 先加载技能内容，再按其指引调工具 / 脚本；脚本在沙箱 | 技能工具直接混入全量工具表，与内置工具同权 |
| 版本 | 不可变版本 + 默认指针 + 回滚 + 内容下载 | `version()` 字符串，只用于拼提示头 |
| 作用域 | org / workspace / user 三级，管理员启用 | 进程级全局注册表，与用户无关 |
| 权限 | 运行时策略校验 scope；市场审核 + 管理员发布策略 | `requiredScopes()` / `preconditions()` 声明后零消费 |
| 安全 | 一律当不可信代码：沙箱、网络出口控制、体积限制、命名空间验证 | 配置目录内 `import()`，**进程全权限** |
| 可观测 | 技能级调用量、加载次数、token 成本、内容版本 | 仅工具名粒度指标 |

#### 6.0.3 五条"反直觉但都这么做"的决策

1. **不给每个技能建一堆工具，只给一个"技能入口"。**
   5 个工具 × 20 个技能 = 100 个 schema 常驻，必然挤爆上下文；成熟产品用「目录 + load」解耦。
2. **技能是"会话级挂载"，不是"进程级注册"。**
   否则多租户、按用户授权、按会话回滚都无处表达（本仓库 `ComponentRegistry` 单例正是这个瓶颈）。
3. **版本不可变，发布即冻结，用指针切换。**
   可变版本会立刻摧毁审计与回滚（OpenAI 的 `default_version` 即此思路）。
4. **description 是唯一路由键，因此被当作一等公民。**
   成熟产品对它有长度约束、要求写清"何时使用 / 何时不要用"，并会迭代打磨；我们目前只把它当一行副标题。
5. **权限落在发布链路与运行时策略上，不落在提示里。**
   声明 scope 而不校验，等于没有权限。

#### 6.0.4 对本方案的三条修正（已落到后续章节）

| 原方案 | 修正 | 理由 | 落点 |
|---|---|---|---|
| 渐进式披露排在 **P2** | 提前为 **P1-c** | 成熟产品把它当**默认形态**而非优化项；技能超过 10 个时全量注入先崩，届时再做等于返工 | 第 11 章 11.1 |
| P0 只做「按请求裁剪工具」 | P0 同时预留 `load_skill` 的**状态位与接口**（`state.loaded_skills`、`aggregate({ catalogOnly })`），先空实现 | 否则从"绑工具"迁移到"技能入口"是二次重构 | 第 7 章 7.8 |
| 版本放到 P2「治理」 | 版本在 **P1-b** 就做**内容寻址（sha256）+ 版本快照 + 默认指针** | 版本是存储层属性，不是治理层属性；后补需重写注册与缓存键 | 第 9 章 9.3 |

**一条必须坚持的边界**：不要把"代码即技能"照搬进多租户 SaaS。本仓库当前是 `import()` 进程内执行，`SkillToolWrapper` 只防异常外泄、**不是沙箱**；成熟产品全部在容器 / VM 内跑脚本。这条差异必须写进对外承诺（见 10.2）。

#### 6.0.5 选型结论：C 为主干，B 为子层，A 借格式，D 不做

**一句话**：国内主流 C 端 Agent（豆包 / 千问 / 元宝）都是「**C 为主干 + B 为技能载体 + D 为连接器**」的组合，**A 只存在于模型供应商侧，终端用户完全看不到**；因此本仓库应采 **C（应用平台型）为主类型**，B 降为内嵌存储层、A 只借定义与加载格式、D 不做（已有 MCP 通道覆盖）。

**① 三家拆解（按产品交互判型，不看宣传话术）**

| 产品 | 用户实际看到什么 | 类型判定 | 依据 |
|---|---|---|---|
| **豆包** | 对话页左侧「插件 / 技能」→ 插件市场 → 添加 → **会话内勾选本次启用**（可多选）；「工作」模式有**技能管理：上传技能包（压缩包 / 文件夹，自动解析）或手动创建**；侧边栏拆为「技能 · 连接器 · 工作伙伴」 | **C（外壳）+ B（技能包托管）**，插件市场为 D 雏形 | 公开教程口径的插件市场 + 会话勾选 + 工作模式技能上传 |
| **千问（Qwen Chat + 百炼 / ADP）** | 消费端是内置能力胶囊；开发侧是智能体应用 + **MCP 市场 / 自定义 MCP**；技能工作台支持**手写 `SKILL.md` 或上传 zip（≤50MB，元信息由包内 SKILL.md 解析）**，设置归属（个人 → 租户全员）、绑定测试智能体后发布 | **C + B + D 三层齐全** | 阿里云智能体平台文档《技能开发与 MCP 接入》《Agent MCP》 |
| **元宝** | 品牌智能体专区 + 智能体对话，能力来自知识库 + 插件；C 端不暴露技能包管理；创作侧原为「元器」，**2026-11-09 停服**并要求迁移至腾讯云 ADP | **C 最重，D 通过插件 / MCP，B 成分弱** | 腾讯新闻 2026-10-15 元器停服公告 |

**② 三个关键事实**

1. **C 端没有 A**：用户没有文件系统、没有 bash；`SKILL.md` 只是"内容组织格式"，载体是平台资源（B），执行由平台托管。
2. **C 端必须做成 C**：审核、计费 / 限额、灰度、管理员管控、下架，只有应用平台型能承载。
3. **能力越界交给 D**：联网、地图、数据库、企业系统走连接器 / MCP，不塞进技能——豆包把「技能 · 连接器 · 工作伙伴」拆成三栏正是这个分工。

> **反面教材**：元器做了一整套智能体创作 + 分发 + 插件市场，2026-11 停服、要求迁移到 ADP。**平台型生态的运营成本远高于技能本身**，这部分成本必须显式计入选型。

**③ 本仓库的硬约束（决定了哪些不能选）**

| 约束 | 事实 | 对选型的影响 |
|---|---|---|
| 无沙箱 | `SkillLoader` 直接 `import()` 技能模块，进程全权限 | **A 出局**：会把"异常隔离"升级为 RCE 面 |
| 全局单例 | `ComponentRegistry` 进程级，无会话 / 租户作用域 | 纯 B 的"上传即用 + 多版本共存"缺隔离前提 |
| 无角色 / 租户 | `authGuard` 只校验登录，`users` 无 role | C 的发布策略需补，但成本最低（admin 白名单即可） |
| 已有 MCP 管理面 | `PluginPicker` 已具备添加 / 启停 / 管理入口 + 写接口 | C 的交互**有现成范本可复刻** |
| `BaseSkill` 结构 | 提示片段 + 工具集 + 元数据 | 与 C 的"指令 + 动作 + 清单"同构，加 manifest 即可 |
| 无对象存储 / 审核 | 只有本地文件系统 + PG | B 只能做"本地目录内容的版本化"，**不开放上传** |

**④ 为什么选 C（四条）**

1. **用户结构就是 C**：管理员配置 + 终端用户勾选 + 平台侧发布，与豆包 / 千问的技能市场同一形态，不是开发者文件系统。
2. **复用已有范式**：MCP 插件已跑通「列表 → 添加 / 启停 → 管理页 → 即时生效」，技能沿用同一套，UI 与接口可复制，边际成本最低。
3. **与 `BaseSkill` 同构**：`manifest` ↔ 清单、`promptFiles` ↔ `systemPromptFragment`、`tools()` ↔ 动作；P1-a / P1-b 本质是给现有结构补"发布态 + 归属 + 启用"。
4. **正好补管理层空白**：C 天然要求发布 / 启用 / 下架 / 作用域 / 审核，恰是第 4 章列出的全部缺失项；换 A 或 D 都补不到这一层。

**⑤ B / A / D 的定位（不是并列选项，是层次）**

| 类型 | 在本方案中的地位 | 具体落点 | 边界 |
|---|---|---|---|
| **B** | **子层**：存储与版本 | 9.3 内容寻址 + 快照 + 默认指针 + 回收 | **不开放上传**（无对象存储 / 审核 / 沙箱） |
| **A** | **只借格式**：定义与加载策略 | 9.1 `manifest.json` + `prompts/system.md`；11.1 目录注入 + `load_skill` | **不借执行**（不引入技能脚本 / bash） |
| **D** | **不做** | 工具接入继续走既有 `/mcp/servers` | 无第三方生态与多客户端，registry 无消费者 |

**⑥ 类型 → 阶段映射**

| 类型 | 对应交付 | 阶段 |
|---|---|---|
| **C（主干）** | 设置页 skills 分区、激活 / 停用 / 回滚 API、`active` 发布态、管理员白名单、`skill_states` 归属 | P1-a / P1-b |
| **B（子层）** | sha256 内容寻址、`.snapshots` 冻结快照、`default_version` 指针、回收策略 | P1-b（9.3） |
| **A（借格式）** | `manifest.json` + `prompts/system.md`、L1 目录注入、`load_skill`、`state.loaded_skills` | P1-b（9.1）/ P1-c |
| **D（不做）** | 继续用 MCP 插件，技能不另立协议 | — |

**一句话记忆**：**产品面学豆包 / 千问（C），版本层学 OpenAI（B），内容格式学 Anthropic（A），连接器继续用 MCP（D）。**

### 6.1 目标（按可验证的业务语句表述）

> 用户在 pro / task 输入框选中若干技能并发送消息后，**该轮对话只能使用被选技能的提示与工具**；未选择时行为与今天完全一致（无技能，或按服务端默认策略）。管理员可在设置页启用 / 停用技能，停用后新会话立即不再暴露其工具，**无需重启服务**。

### 6.2 设计原则

1. **默认等价**：`skills` 字段缺省时保持现状（不改变任何既有会话行为），沿用仓库既有的「gated + 默认关闭 + 字符等价」范式。
2. **最小侵入接线**：只在既有 3 个接缝上动手——请求 DTO、`configurable`、`create_agent` 的两个 skills 门控点；不重写工具绑定链路。
3. **与既有机制对齐**：图缓存（`agent-bridge` LRU 8）、工具白名单（`configurable.tools`）、HITL 审批、能力矩阵、可观测指标全部复用，不另起一套。
4. **能力可降级**：技能不存在 / 未激活 / 加载失败 → 忽略该项并告警，请求继续执行（fail-soft，与 `SkillLoader` 的隔离语义一致）。
5. **先打通再治理**：P0 只解决「选择 → 执行」，不做权限、不做市场；但**渐进式披露提前到 P1-c**（成熟产品的默认形态，不是可选项）。
6. **形态对齐行业标准**：技能定义声明式化、选择会话级化、版本不可变化、权限运行时代化（见 6.0）。
7. **不做"影子能力"**：任何 UI 上可见的状态（勾选 / 启用）必须有服务端语义支撑，否则宁可不显示。

### 6.3 目标架构

```
前端
  skillSelectionStore(mode)  ← 单一事实源（替代 SkillPicker 内部 useState）
        │  读写
        ├─ SkillPicker（展示 + 勾选）
        └─ useAgentChat / usePlanExecuteChat（发送时读 selected，注入 body.skills）

后端
  AgentChatRequestSchema.skills?: string[] | null
        │
  streamAgentCompletion(opts.skills)
        │  configurable.skills = normalize(skills)      ← 排序 + 去重 + 上限
        │  graphCacheKey 纳入 skills
        ▼
  create_agent({ configurable: { skills } })
        │  resolveSkillSelection(runtimeConfig, configurable.skills)
        │     → { skillNames, toolNames, promptSkills }
        ├─ SkillLoader.loadFromConfig()（不变，仍注册全量已激活技能）
        ├─ build_langchain_tools(null, effectiveToolNames)   ← 只绑定被选技能的工具
        └─ SkillPromptAggregator.aggregate(base, registry, { only: skillNames })
             ↑ P0 额外预留两个插槽（空实现，默认关闭）：
               · aggregate({ catalogOnly: true })  —— 只注入技能目录（L1）
               · state.loaded_skills?: string[]    —— 已加载技能（L2 状态，P1-c 启用）
```

**形态演进路线**（对齐 6.0 的事实标准，避免二次重构）：

```
P0 现状形态：  绑全部被选技能的工具 + 全文注入
P1-c 目标形态：绑 load_skill + 被选技能的工具（按需）+ 目录注入 + 正文按需加载
```

**关键取舍**：选择「按需裁剪 + 图缓存」还是「全量绑定 + 运行时守卫」？

| 方案 | 做法 | 优点 | 缺点 | 建议 |
|---|---|---|---|---|
| **A（推荐）按需裁剪** | `configurable.skills` 参与工具白名单与提示聚合，图缓存按选择分片 | 语义干净、token 最省、工具不可见即不可调用 | 组合多时图重建变多（LRU 8 需评估） | **MVP 采用**；技能数 ≤ 10、常用组合 ≤ 8 时足够 |
| **B 全量绑定 + 守卫** | 图不重建，工具节点前拦截未选技能工具并返回错误 | 零重建、切换零成本 | 工具 schema 全量进 prompt（token 膨胀）、模型可能反复试错 | 技能数量爆炸 / 组合不可枚举时切换 |

### 6.4 分阶段概览

| 阶段 | 目标 | 人日 | 交付判据 |
|---|---|---|---|
| **P0** | 选择 → 执行打通（含 `load_skill` 插槽） | 4.0 | 选 `math` 后同轮对话工具集只含 `math` 工具；不选与今天字符等价 |
| **P1-a** | 激活 / 停用 API + 设置页 | 2.5 | 管理面可启停，新会话即时生效（无重启） |
| **P1-b** | 声明式定义 + manifest + 不可变版本 | 3.0 | 可通过目录投放技能；版本冻结、可回滚、可校验依赖 |
| **P1-c** | 渐进式披露（目录注入 + `load_skill`） | 2.5 | 技能数 20 时 L1 注入 ≤ 2k 字符，正文按需加载 |
| **P2-a** | 权限与治理（scope / 审计 / 指标） | 3.0 | `requiredScopes` 生效，技能级调用可计量 |
| **P2-b** | 生命周期与健康检查 | 1.0 | 热卸载可用、失败自动摘除 |

> 与初版相比：P0 +0.5（插槽）、P1-b +1.0（版本）、渐进式披露从 P2-b（原 3.5 中占 2.5）提到 P1-c（2.5）、P2-b 缩为纯生命周期 1.0。总量 14.5 → **16.0 人日**。

---

## 7. P0：打通「选择 → 执行」

### 7.1 协议层（前端 ↔ 后端）

**前端 `AgentCompletionBody`**（`apps/web/src/api/agent.ts`）新增：

```ts
/** 本轮启用的技能名（空数组 = 明确不使用任何技能；省略 = 服务端默认策略） */
skills?: string[];
```

`AgentResumeBody` 同步新增 `skills?: string[]`（见 7.5 resume 一致性）。

**后端 Schema**（`apps/backend-ts/src/schemas/agent.ts`）：

```ts
skills: z.array(z.string().min(1).max(64)).max(20).nullable().optional(),
```

约束：`max(20)` 防止恶意长列表撑爆图缓存；`min(1)` 与 `LoginRequestSchema` 的既有风格一致。

### 7.2 后端桥接层

`apps/backend-ts/src/core/agent-bridge.ts`：

1. `streamAgentCompletion` 的 opts 增加 `skills?: string[] | null`；
2. 归一化后写入 `configurable.skills`：

```ts
function normalizeSkills(input?: string[] | null): string[] | undefined {
  if (input === undefined || input === null) return undefined
  return [...new Set(input.map(s => s.trim()).filter(Boolean))].sort()
}
```

3. `graphCacheKey` 纳入 `skills`（**必须**，否则不同选择会命中同一图）：

```ts
const key = JSON.stringify({
  model: ..., system_prompt: ..., plan_execute: ..., domain: ...,
  skills: configurable.skills ?? null,   // ← 新增
})
```

4. 缓存容量评估：`GRAPH_CACHE_LIMIT` 由 8 提到 16，或改为「无 skills 覆盖时走 `get_runner()`、有覆盖时走 LRU」的现状分支（现状已如此，成本可控）。**注意**：`create_agent` 会重复执行 MCP 发现与 checkpointer 装配，若实测重建耗时 > 300ms，则加一条 `skills` 组合的短 TTL 缓存或退回方案 B。

### 7.3 内核层（modu-agent）

新增 `packages/modu-agent/src/skills/selection.ts`（纯函数、可单测）：

```ts
export interface SkillSelection {
  /** 参与提示聚合的技能名（undefined = 全部已激活） */
  promptSkills: string[] | undefined
  /** 允许绑定的工具名（undefined = 不裁剪，保持现状） */
  toolNames: string[] | undefined
  /** 被忽略的选择项（不存在 / 未激活 / 无可绑定工具） */
  ignored: string[]
}

export function resolveSkillSelection(
  registry: ComponentRegistry,
  selected?: string[] | null,
): SkillSelection
```

语义：

- `selected === undefined` → 全部返回 `undefined`（**零行为变化**，兼容所有既有宿主）；
- `selected === []` → `promptSkills=[]`、`toolNames=[]`（显式「不使用技能」；注意不能返回 `undefined`，否则 `build_langchain_tools` 会理解为全量）；
- `selected = ['math']` → 只保留已注册（`registry.getSkill` 命中且 `isAvailable()`）的技能，工具名取其 `skill.tools().map(name)`；缺失项进 `ignored` 并 `logger.warning`。

`factory.ts` 两处改造（保持门控不变）：

```ts
// 619 处：加载侧不变
if (runtimeConfig.get('skills.enabled', false)) { await loader.loadFromConfig() }

// 679 处：工具绑定前插入裁剪
const selection = runtimeConfig.get('skills.enabled', false)
  ? resolveSkillSelection(getRegistry(), configurable['skills'])
  : { promptSkills: undefined, toolNames: undefined, ignored: [] }

const effectiveToolNames =
  selection.toolNames !== undefined
    ? [...(configurable['tools'] ?? []), ...selection.toolNames]
    : (configurable['tools'] ?? null)
let tools = build_langchain_tools(null, effectiveToolNames, runtimeConfig)

// 795 处：提示聚合加 only 参数
effectiveSystemPrompt = SkillPromptAggregator.aggregate(
  effectiveSystemPrompt, getRegistry(), { only: selection.promptSkills },
)
```

**注意 `effectiveToolNames` 的合并语义**：`configurable.tools` 是宿主白名单，`skills` 是增量；两者都为空时仍是 `null`（全量），避免把默认工具（datetime/web_search 等）裁掉。更稳妥的写法是把「默认工具集 + 技能工具集」显式算出并集，测试中固化。

`SkillPromptAggregator.aggregate` 签名向后兼容：

```ts
static aggregate(base: string | null, registry: ComponentRegistry, opts?: { only?: string[] })
```

`opts.only === undefined` → 走现有逻辑（全量）；`[]` → 直接返回 base；非空 → 只聚合命中的技能（顺序按 `only` 稳定排序，保证提示字符可复现）。

### 7.4 前端接线

**问题**：当前 `selected` 住在 `SkillPicker` 的 hook 实例里，发送方（`useAgentChat` / `usePlanExecuteChat`）读不到；而 `SkillPicker` 被 `CapabilityBar` 包在 `AnalysisInput` / `TaskInput` 内部，prop 透传需穿 3 层。

**方案**：新增 zustand store（与 `settingsDialogStore` 同范式），把「列表 + 选中」提升为按模式的单一事实源。

`apps/web/src/store/skillSelectionStore.ts`：

```ts
interface SkillSelectionState {
  byMode: Record<AppMode, { selected: string[] }>
  toggle: (mode: AppMode, name: string) => void
  setSelected: (mode: AppMode, names: string[]) => void
  reset: (mode: AppMode) => void
}
```

- `useSkillOptions` 保留列表职责（fetch / cache / reload），**选中态改为读写 store**（`localStorage` 持久化逻辑迁移到 store，保持 key `skill-select:<mode>` 不变 → 用户既有选择不丢）；
- 发送路径（`useAgentChat` / `usePlanExecuteChat`）构造 body 时经 `getSelectedSkills(mode)` 读取；**仅当选择非空时携带 `skills`**。

**空选择的最终语义（2026-10-20 决策）**：

| 状态 | 是否发 `skills` | 服务端行为 |
|---|---|---|
| 从未选择 / 已清空 | 不发 | 默认：全部已启用技能（`skills.active`） |
| 勾选 ≥ 1 个 | 发数组 | 仅该子集 |

职责分层：`skills.active` 是管理员决定的「可用集合」，会话勾选是用户决定的「本轮子集」——**默认全可用、勾选即收窄**。协议层仍保留 `[]` = 明确不使用（供未来「不使用技能」开关），当前 UI 不产生该值。菜单底部已加说明文案：「未勾选时使用全部已启用技能；勾选后仅使用所选技能。」

**UI 同步修正（同批做，成本低）**：

- `active === false` 的技能行改为 disabled + 文案「需管理员启用」，禁止勾选（消除 U4）；
- 列表行补充 `v{version} · {toolCount} 个工具`（消除 U5，代价 1 行）；
- 折叠区加一行提示：「技能影响本轮可用工具，仅在 pro / 任务模式生效」。

### 7.5 resume 一致性（易漏点）

HITL 暂停后 `POST /agent/resume` 会用 `create_agent` 重建图（plan_execute 分支已如此）。若 resume 时没带同样的 `skills`，可能出现「暂停时有 `math` 工具、恢复后图里没有该工具」→ 中断点工具不可用 / unknown tool。

**已落地方案（2026-10-20）**：

1. 用户消息落库时把本轮选择写入 `chat_messages.metadata.skills`（`extraMetadata` → DB 列 `metadata`，**免迁移**）；编辑重发路径同样同步（保留其他 metadata 键，清空时删除 `skills` 键）。
2. resume 端点新增 `resolveResumeSkills(prisma, { sessionId, userId, requested })`：
   - 请求体显式给出（含 `[]`）→ 原样采用；
   - 未给出（旧客户端 / 跨端恢复）→ 回读最近一条用户消息的 `metadata.skills`；
   - 回读失败 / 无记录 → `undefined`（服务端默认）。
3. 单测固化（`test/agent-skills-selection.test.ts`）：请求体优先、空数组不查库、回读命中、无记录降级、DB 异常不阻断。

> 边界：`agent_runs.messageId` 指向的是 **assistant** 消息（续写定位用），不能作为技能选择载体，故选择存于用户消息。

### 7.6 兼容与降级清单

| 场景 | 行为 |
|---|---|
| 未传 `skills` | 与今天完全一致（全局已激活技能全量注入） |
| 传 `[]` | 本轮不使用任何技能，默认内置工具仍可用 |
| 传不存在的技能名 | 忽略 + 告警，其余照常；前端提示「技能已下线，已自动忽略」 |
| `skills.enabled=false` | `resolveSkillSelection` 不参与（返回 undefined），请求不报错 |
| 图缓存未命中 | 正常 `create_agent`；命中则复用 |

### 7.7 P0 改动文件清单

| 文件 | 改动 |
|---|---|
| `apps/web/src/api/agent.ts` | `AgentCompletionBody` / `AgentResumeBody` 增 `skills` |
| `apps/web/src/store/skillSelectionStore.ts` | **新增**：按模式的选择状态 |
| `apps/web/src/hooks/useSkillOptions.ts` | 选中态接 store；列表职责不变 |
| `apps/web/src/components/CapabilityBar/SkillPicker.tsx` | 用 store；`active=false` 禁用；补 version/toolCount |
| `apps/web/src/modes/pro/hooks/useAgentChat.ts`、`apps/web/src/modes/task/hooks/usePlanExecuteChat.ts` | 发送时注入 `skills` |
| `apps/backend-ts/src/schemas/agent.ts` | `skills` 字段 |
| `apps/backend-ts/src/core/agent-bridge.ts` | 归一化、`configurable.skills`、`graphCacheKey`、resume 复用 |
| `packages/modu-agent/src/skills/selection.ts` | **新增**：`resolveSkillSelection` + `catalog` 字段 |
| `packages/modu-agent/src/skills/prompt-aggregator.ts` | `opts.only` + 预留 `opts.catalogOnly` |
| `packages/modu-agent/src/graph/factory.ts` | 工具裁剪 + 提示聚合传参 |
| `packages/modu-agent/src/graph/state.ts` | 新增可选字段 `loaded_skills?: string[]`（默认不写） |
| `packages/modu-agent/src/skills/index.ts` | 导出 `resolveSkillSelection` |

> 交付纪律：改 `modu-agent/src` 后必须 `npm run build`（backend-ts 运行时加载 `dist`）。

### 7.8 为渐进式披露预留插槽（0.5 人日，P0 内完成）

目的：避免 P1-c 从"绑工具"迁到"技能入口"时二次重构。**P0 只留插槽、不启用**，开关关闭时字符等价。

1. **状态位**：`AgentState` 增加可选 `loaded_skills?: string[]`（`graph/state.ts`），默认不写入；`STATE_SCHEMA_VERSION` 不变（新增可选字段，向后兼容）。用途：记录"本会话已加载正文的技能"，供 L2 按需加载与 resume 复用。
2. **选择器返回目录**：`resolveSkillSelection` 增加返回 `catalog: Array<{ name, summary }>`，其中 `summary` 取 `description` 首句（截断 40 字符）。P0 不使用，P1-c 直接消费。
3. **提示聚合开关**：

```ts
// 预留签名（P0 实现但默认 false；P1-c 打开）
static aggregate(
  base: string | null,
  registry: ComponentRegistry,
  opts?: { only?: string[]; catalogOnly?: boolean },
): string | null
// catalogOnly=true：只注入 `[Skills]\n- math: 数学计算…\n- writer: …`（L1）
// catalogOnly=false/undefined：现有全文片段逻辑（L2，P0 行为）
```

4. **单测固化**：`catalogOnly=true` 且无技能 → 返回 base 原样；有技能 → 只含 `name + summary`，**不含**正文与 examples；`catalogOnly` 未传时与旧实现字符等价。

> 这 0.5 人日买的是"P1-c 不需要改 factory 的接线形状"，只改 `opts` 取值与 `tools` 是否绑定 `load_skill`。

---

## 8. P1：技能激活与管理面

### 8.1 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/skills` | 既有，补 `enabledForUser`（可选）、`source`（`builtin`/`dir`）、`error`（发现失败原因） |
| `POST` | `/skills/:name/activate` | 加入白名单并热注册；返回最新 `SkillBrief` |
| `POST` | `/skills/:name/deactivate` | 移出白名单并 `unregisterSkill`；返回最新 `SkillBrief` |
| `POST` | `/skills/reload` | 重新扫描目录（开发态用），返回 diff |

鉴权（已落地）：新增 `adminGuard`（`apps/backend-ts/src/plugins/admin.ts`），读环境变量 `ADMIN_USER_IDS`（逗号分隔）；**未配置时一律 403（fail-closed）**，不为加角色字段而迁移 `users` 表。

> 已实现（L3-1）：三个写接口按上表落地；持久化用 `SKILLS_STATE_PATH`（默认 `./data/skills.state.json`），启动时 `applyPersistedSkillState()` 用文件覆盖 `skills.active`；启用/停用后调用 `syncFromConfig()` + `invalidateAgentGraphCache()`，实现「无需重启」。

**持久化策略（按风险从低到高）**：

1. **MVP（零迁移）**：写入 `apps/backend-ts/data/skills.state.json`（`{active: string[], updatedAt, updatedBy}`），启动时与 `config.yaml` 的 `skills.active` 合并（**文件优先，YAML 作为基线**）；
2. **V2**：新增 `skill_states` 表（`name PK, active, updated_by, updated_at`），按仓库既有惯例「单独补表 SQL + `schema.prisma` 追加 model」，不跑 `db push`。

### 8.2 热生效机制

`loadFromConfig()` 目前是「已注册则跳过、从不反注册」，无法停用。改造：

```ts
async syncFromConfig(): Promise<{ added: string[]; removed: string[] }> {
  const desired = new Set(this._config.get('skills.active', []))
  for (const name of desired) { /* setup + registerSkill（已注册则跳过） */ }
  for (const name of Object.keys(this._registry.listSkills())) {
    if (!desired.has(name)) {
      this._registry.unregisterSkill(name)          // 同时移除其工具
      this._registry.getSkill(name)?.teardown()      // 首次真正接线 teardown
    }
  }
  return { added, removed }
}
```

配套：`unregisterSkill` 需**同时移除该技能贡献的工具**（当前实现只删 `_skills` 条目，工具残留 → 停用后工具仍可调用，这是必须修的缺陷）。

激活 / 停用后需使图缓存失效：`agent-bridge` 暴露 `invalidateAgentGraphCache()`（或在 `skill_states` 版本号变化时让 `graphCacheKey` 变化）。最简做法：维护全局 `skillsRevision` 计数器，纳入 `graphCacheKey`。

### 8.3 设置页 UI

新增 `settings` 的 `skills` 分区（与 `mcp` 分区同构）：

- 顶部：`skills.enabled` 总开关（关闭时下方全部只读并提示）；
- 列表：名称 / 版本 / 标签 / 工具数 / 来源 / 状态徽标（已启用 / 已发现未启用 / 加载失败 + 错误摘要）；
- 行操作：启用 / 停用（带 loading + toast）、查看工具清单（抽屉）；
- 底部操作：重新扫描、打开 `auto_discover_dirs` 说明。

`SkillPicker` 菜单顶部同步加「管理技能」入口（跳设置页 `skills` 分区），与 `PluginPicker` 的「管理插件」对齐（消除 U2 / U3）。

---

## 9. P1：定义格式、版本与依赖

### 9.1 声明式技能目录（兼容现有 TS 技能）

```
skills/<name>/
  manifest.json     # {name, version, description, tags, capabilities, dependencies, entry, promptFiles}
  skill.js          # ESM：export const skill = new XxxSkill()（保持兼容）
  prompts/
    system.md       # 可选：纯提示型技能直接用 markdown 作为 systemPromptFragment
```

`SkillLoader` 增强（**保持向后兼容**：无 `manifest.json` 时按现状处理）：

1. 读 `manifest.json` → `validateManifest`（现有函数）→ 校验失败**拒绝加载**并记录 `error`（在 `GET /skills` 返回）；
2. 版本语义：`version` 必须是 semver（正则 `^\d+\.\d+\.\d+`），供 UI 展示与后续依赖解析；
3. 依赖：`dependencies: string[]` 解析为「同名技能必须存在且已注册」，缺失则跳过并告警（不做版本区间，第一版只做存在性）；
4. 纯提示型技能：若 `entry` 缺省但存在 `prompts/system.md`，由 loader 合成一个只实现 `systemPromptFragment()` 的 `DeclarativeSkill`（约 40 行），使非研发同学也能投放技能；
5. 安全：目录必须在 `auto_discover_dirs` 白名单下（现状已隐式满足），追加 `path.resolve` 前缀校验与 `..` 过滤，防路径穿越。

> 已实现（L3-2）：`SkillLoader` 读取并校验 `manifest.json`（非法即跳过，`GET /skills` 可见 `error`）；无 `skill.{js,ts}` 但有 `prompts/system.md` 时合成 `DeclarativeSkill`；`dependencies` 做存在性过滤；`isInsideDir()` 拦截 `..` 与解析到扫描根之外的目录；隐藏目录（`.snapshots`）不参与发现。

### 9.2 把 `MathSkill` 变成可达示例

- 新增 `packages/modu-agent/skills/math/{manifest.json, skill.js}`（编译后投放）或直接在 `skills/index.ts` 导出 `MathSkill` 并提供「内置技能快照」入口；
- 目的：让 P0 的端到端验证**有对象可测**，同时作为格式示范。当前 `MathSkill` 是不可达死代码（A7）。

### 9.3 不可变版本与内容寻址

对应 6.0.3 第 3 条：**版本是存储层属性，不是治理层属性**，因此必须在 P1-b 与 manifest 一起落地，不能后补（后补要重写注册表结构与图缓存键）。

**1）内容指纹**

```ts
interface LoadedSkillMeta {
  name: string
  version: string            // semver（manifest 强制）
  contentHash: string        // sha256(manifest + 全部文件内容 + 文件相对路径)，排序后计算
  loadedAt: number
  sourcePath: string
}
```

- 计算范围：`manifest.json` + 技能目录下所有文件（排除 `node_modules/`、`.git/`、`__pycache__/`），按相对路径排序后串接再 `sha256` → **同内容必同 hash，跨机器可复现**。
- 用途：`GET /skills` 返回 `contentHash`（前端可做"内容已变更"提示）；`skillsRevision = sha256(所有 contentHash 排序拼接 + active 列表)`，作为图缓存键的一部分（P1-a 已引入 `skillsRevision`，此处扩展其定义）。

**2）版本快照与默认指针**

```
skills/<name>/                 # 工作副本（可覆盖）
skills/.snapshots/<name>/<version>+<hash8>/   # 冻结快照（只读）
skills/.state.json             # { "<name>": { "default_version": "1.2.0", "hash": "..." } }
```

- 首次加载：复制工作副本到快照目录（只读），记录 `default_version`；
- 内容变化但 `version` 未变 → **拒绝热切换**并告警（"版本必须递增"），避免"同版本不同内容"的审计黑洞；
- 内容与版本均变化 → 生成新快照，`default_version` 指向新版本，旧快照保留；
- 回滚：`POST /skills/:name/rollback { version }` 只改指针 + 重新注册，不动文件。

**3）注册表结构变化**

`ComponentRegistry.listSkills()` 的返回从 `{name, description, version, tags, tool_count}` 扩展为附加 `contentHash / sourcePath / defaultVersion`（**附加字段，不破坏既有调用方**）；`SkillBrief` 同步扩展（前端可选消费）。

**4）清理策略**

快照按 `keep_last_n`（默认 5）+ `max_age_days`（默认 90）清理；清理前校验不是 `default_version` 且无 run 引用（引用记录可选，先做前两条）。

**5）存储取舍**

| 阶段 | 存储 | 说明 |
|---|---|---|
| P1-b | 文件系统（`.snapshots` + `.state.json`） | 零迁移，单机即可验证完整版本/回滚语义 |
| V2（多实例） | DB 表 `skill_versions(name, version, content_hash, manifest, created_at)` + 对象存储放内容 | 按仓库惯例「单独补表 + schema.prisma 追加」，不跑 `db push` |

> 已实现（L3-2）的指针语义：`record.defaultVersion` 在 `pinned=false` 时随工作副本版本自动前移（正常升级）；`POST /skills/:name/rollback` 置 `pinned=true` 并指向目标版本，此后工作副本再改也不会自动覆盖，直到管理员再次显式切换。开关 `skills.versioning.enabled` 默认 true；关闭后只跳过指纹/快照，发现逻辑不变。

---

## 10. P2：权限与治理

### 10.1 权限模型

| 层级 | 机制 | 落点 |
|---|---|---|
| 平台级 | `skills.enabled` 总开关 | 既有 |
| 站点级 | `skills.active` 白名单 | 既有 + P1 写接口 |
| 用户级（可选） | `skill_states(user_id, name, active)` 或套餐字段 | 新表 / 增量字段 |
| 执行级 | `BaseSkill.requiredScopes()` → 与 `req.user` 的 scopes 比对 | `resolveSkillSelection` 增加 `principal` 入参 |

`requiredScopes` 语义建议：`['skill:<name>']` 由 loader 自动生成兜底，技能可声明更细的 `['net:http']`、`['fs:write']`；未满足则**不绑定该技能**（fail-closed），并在 `GET /skills` 返回 `disabledReason`。

### 10.2 安全边界（必须显式承认）

技能发现本质是**在服务进程内 `import()` 并执行第三方代码**（`setup()` / `invoke()` 均为进程全权限）。因此：

- 生产环境 `auto_discover_dirs` 必须指向**只读、受控**目录，且不建议开放「上传即加载」；
- 若未来要支持用户上传技能，必须走子进程 / 容器隔离，**不能复用当前 `SkillToolWrapper` 的 try/catch 当作安全边界**（它只防异常外泄，不防越权）；
- 报告与文档中应避免把「加载隔离」表述为「沙箱」。

### 10.3 可观测

- 指标：`skill_invocation_total{skill,tool,status}`、`skill_activation_total{skill,action}`、`skill_tool_schema_tokens{skill}`（提示膨胀度）；
- 工具调用现有指标已按 `toolName` 记录（`tool-adapter.ts:328-359`），只需在 `SkillToolWrapper` 里补 `skill` 标签上下文（通过 `context` 透传或 `AsyncLocalStorage`）；
- 审计：`skill_states` 变更 + 技能首次注册 / 卸载写入结构化日志（现有 logger 即可，`observability.logging.structured=true`）。

---

## 11. P1-c：渐进式披露 与 P2：生命周期

### 11.1 渐进式披露（P1-c，2.5 人日）

**为什么提到 P1**：6.0 已确认这是成熟产品的默认形态（Anthropic L1 ~100 token/技能、L2 < 5k、L3 访问前为零）。本仓库当前是"L2 全文常驻 + 全部工具 schema 常驻"，技能数一多必然先崩，属于形态问题而非优化项。

#### 11.1.1 三态模型与我们要落的两态

| 层 | 成熟做法 | 本仓库落点 |
|---|---|---|
| L1 目录 | `name + description` 常驻 | **P1-c 落地**：`aggregate({ catalogOnly: true })` |
| L2 正文 | 触发时读 `SKILL.md` | **P1-c 落地**：`load_skill(name)` 工具返回正文 + examples |
| L3 资源 | 脚本 / 模板，访问前零成本 | 暂不做（本仓库无技能级文件沙箱；异步，见 11.1.5） |

#### 11.1.2 目录注入格式与预算

```
[Skills]
- math: 数学计算与表达式求值能力（工具：calculator）
- writer: 长文写作与结构化成稿（工具：doc_writer）
调用 load_skill(name) 获取完整指令；未加载前不要假设其细节。
```

- 每技能一行，`summary` 取 `description` 首句并截断 40 字符；总预算 `skills.catalog_max_chars`（默认 2000），超限按"已选 > 常用 > 字母序"截断并告警；
- 与既有 `MarkdownPromptAggregator` 的字符预算范式一致，可复用其截断标记；
- **不注入 examples**（examples 属 L2，进 `load_skill` 返回值）。

#### 11.1.3 `load_skill` 工具契约

```ts
// name: load_skill
// params: { name: string }
// returns: { status, data: { skill, version, contentHash, instructions, examples } }
// 副作用：state.loaded_skills = union(prev, [name])
```

- 幂等：重复加载返回同一正文并提示"已加载"（不再重复注入，避免上下文累积）；
- 未知 / 未选 / 未激活技能 → `{ status:'error', error_code:'SKILL_NOT_AVAILABLE' }`（**fail-soft**，不炸图）；
- 正文超 `skills.load_max_chars`（默认 6000）截断并标记；
- 注册条件：`skills.enabled=true` **且本轮至少选了一个技能** 时才注册 `load_skill`，避免无技能会话凭空多一个空工具。

#### 11.1.4 状态与恢复

- `state.loaded_skills: string[]`（P0 已预留字段）；
- 多轮：同一 thread 内已加载技能不再目录注入，改注入"已加载"一行（`[Skills] loaded: math`），防止重复；
- resume：`streamAgentResume` 复用 checkpoint 里的 `loaded_skills`，无需重新加载；若技能已下线（停用 / 版本删除），resume 时告警并降级为目录态（不阻断）。

#### 11.1.5 工具 schema 的解耦（诚实说明）

LangGraph 的工具集在**建图时固定**，无法在运行中动态加入。因此 P1-c 只能解决"**提示膨胀**"，不能解决"**工具 schema 膨胀**"：

| 阶段 | 做法 | 解决什么 | 代价 |
|---|---|---|---|
| P1-c（必做） | 技能工具仍按选择预先绑定；目录 + 正文按需 | 提示 token（主要成本） | 无 |
| 可选下一阶段 | 单入口 `invoke_skill_tool(skill, tool, args)`，工具实现放技能侧 | 工具 schema token | 模型调用准确率下降，需评测对比（`packages/evals`） |

> 成熟产品之所以能做到彻底解耦，是因为它们给模型的是 **bash + 文件系统**（脚本执行、只有输出进上下文）。我们没有技能级沙箱，因此**不建议**为了对齐而引入"技能脚本执行"，除非先补 10.2 的隔离能力。

#### 11.1.6 门控与度量

- 门控：`skills.progressive_disclosure.enabled`（默认 false）——关闭时走 P0 的全文注入，**字符等价**；
- 度量：`skill_catalog_chars`、`skill_loaded_total{skill}`、`load_skill_hit_rate`（加载后是否真被使用，可用后续工具调用推断）；
- 灰度：先在一个技能集（如 `math`）上开启，对比 token 与任务成功率再全量。

### 11.2 生命周期补全（P2，1.0 人日）

| 阶段 | 现状 | 目标 |
|---|---|---|
| 发现 | 每次 `create_agent` 扫目录 | 增加 mtime + `contentHash` 缓存，避免重复 `readdir` / 重复哈希 |
| 注册 | `registerSkill` | 冲突显式上报（`conflicts: [{skill, tool, existingOwner}]`） |
| 卸载 | 无 | `unregisterSkill` 连带工具 + `teardown()` |
| 健康 | 仅 `isAvailable()` 一次 | `healthCheck()` 定时（可选），失败自动从绑定集摘除并告警 |
| 热更新 | 无 | `POST /skills/reload` + `skillsRevision`（定义见 9.3）使图缓存失效 |
| 清理 | 无 | 快照按 `keep_last_n` / `max_age_days` 回收（9.3） |

---

## 12. 实施计划

### 12.1 任务清单与类型标注

**类型标签**（对应 6.0.5 的选型）：**C** = 平台面（管理 / 启用 / 选择 / 发布 / 治理）｜**A** = 定义格式与加载策略｜**B** = 存储与版本｜**D** = 协议接入（本方案无）。

| 阶段 | # | 类型 | 任务 | 主要文件 | 人日 | 依赖 |
|---|---|---|---|---|---|---|
| **P0** | 0.1 | **C** | `resolveSkillSelection` 纯函数（含 `catalog`）+ 单测 | `modu-agent/src/skills/selection.ts` | 0.5 | — |
| | 0.2 | **A** | `SkillPromptAggregator` 支持 `only`（+ 预留 `catalogOnly` 签名） | `skills/prompt-aggregator.ts` | 0.3 | 0.1 |
| | 0.3 | **C** | `factory` 工具裁剪 + 提示传参 | `graph/factory.ts` | 0.5 | 0.1 |
| | 0.4 | **C** | 请求 DTO + `configurable.skills` + 图缓存 key + resume 复用 | `schemas/agent.ts`、`agent-bridge.ts` | 0.7 | 0.3 |
| | 0.5 | **C** | 前端 store + 发送接线 + picker 修正 | `store/skillSelectionStore.ts`、`useSkillOptions.ts`、`SkillPicker.tsx`、两个 chat hook | 1.0 | 0.4 |
| | 0.6 | **A** | 端到端冒烟（造一个可达技能） | `skills/math/{manifest.json,skill.js}` | 0.5 | 0.5 |
| | 0.7 | **A** | `load_skill` 插槽（`state.loaded_skills` + `catalogOnly` 空实现 + 单测） | `graph/state.ts`、`prompt-aggregator.ts` | 0.5 | 0.2 |
| **P1-a** | 1.1 | **C** | `unregisterSkill` 连带工具（修缺陷） | `core/registry.ts` | 0.3 | — |
| | 1.2 | **C** | `syncFromConfig` + `skillsRevision` + 缓存失效 | `skills/loader.ts`、`agent-bridge.ts` | 0.7 | 1.1 |
| | 1.3 | **C** | 激活 / 停用 / 重扫 API + 持久化 | `routes/skills.ts`、`data/skills.state.json` | 1.0 | 1.2 |
| | 1.4 | **C** | 设置页 `skills` 分区 + Picker「管理技能」入口 | 新增 `SettingsSkillsSection.tsx` 等 | 0.5 | 1.3 |
| **P1-b** | 2.1 | **A** | loader 接 manifest（版本 / 依赖 / 纯提示型） | `skills/loader.ts`、`DeclarativeSkill` | 1.5 | — |
| | 2.2 | **A** | 路径安全校验 + 冲突上报 | `skills/loader.ts`、`core/registry.ts` | 0.5 | 2.1 |
| | 2.3 | **B** | 内容寻址（sha256）+ 版本快照 | `skills/versioning.ts`、`loader.ts` | 0.7 | 2.1 |
| | 2.4 | **B / C** | 默认版本指针 + 回滚接口 | `skills/versioning.ts`、`routes/skills.ts` | 0.3 | 2.3 |
| **P1-c** | 3.1 | **A** | 目录注入（L1）+ 字符预算 | `prompt-aggregator.ts`、`selection.ts` | 0.7 | 0.7 |
| | 3.2 | **A** | `load_skill` 工具（L2，正文 + examples） | `skills/load-skill-tool.ts`、`factory.ts` | 1.0 | 3.1 |
| | 3.3 | **A** | `loaded_skills` 进状态 + 多轮 / resume 复用 | `graph/state.ts`、`agent-bridge.ts` | 0.5 | 3.2 |
| | 3.4 | **C** | 门控 / 指标 / 灰度对比 | `runtime-config.ts`、`observability` | 0.3 | 3.3 |
| **P2-a** | 4.1 | **C** | `requiredScopes` 校验 + `disabledReason` | `selection.ts`、`routes/skills.ts` | 1.5 | P1 |
| | 4.2 | **C** | 技能级指标 / 审计 | `skills/adapter.ts`、`observability` | 1.0 | 4.1 |
| | 4.3 | **C** | 安全边界文档 + 目录权限说明 | 文档 | 0.5 | — |
| **P2-b** | 5.1 | **C** | `healthCheck` + 失败自动摘除 | `BaseSkill`、`loader` | 0.7 | P1-a |
| | 5.2 | **B** | 快照回收（`keep_last_n` / `max_age_days`） | `skills/versioning.ts` | 0.3 | 2.3 |

**类型分布**：C 13 项 / A 8 项 / B 3 项 / D 0 项 —— 与 6.0.5 的选型一致：**主干是 C（平台面），A/B 为支撑能力，D 不投入**。若评审时发现某项被标成 A 却承担了管理职责，说明该任务放错了层，应拆成"C 的入口 + A 的实现"。

合计：**P0 4.0 人日；P1 8.0 人日（a 2.5 / b 3.0 / c 2.5）；P2 4.0 人日，总计 16.0 人日**。

### 12.2 改造优先级排序

#### 12.2.1 排序判据（按权重）

1. **依赖扇出**：有多少任务在等它（决定是否能并行 / 是否卡关键路径）；
2. **可感知闭环**：是否消除"UI 有入口、后端无响应"的缺陷（对应 U1 / A1）；
3. **返工风险**：不做是否会导致后续重写（形态正确性，见 6.0）；
4. **单位人日收益**：0.3 人日的缺陷修复优先于 1.5 人日的锦上添花。

**四级分层**

| 级别 | 定义 | 任务 | 人日 |
|---|---|---|---|
| **L1 阻断** | 不做则后续无法验证或无法生效 | 0.1 / 0.2 / 0.3 / 0.4 / 0.5 / 0.6 / 0.7 | 4.0 |
| **L2 形态** | 不做则技能一多就要重做（返工成本 > 现做成本） | 3.1 / 3.2 / 3.3 / 3.4 | 2.5 |
| **L3 运维** | 让"启用 / 停用 / 版本"从假动作变成真能力 | 1.1 / 1.2 / 1.3 / 1.4 / 2.1 / 2.2 / 2.3 / 2.4 | 5.5 |
| **L4 治理** | 规模与合规触发，不影响当前闭环 | 4.1 / 4.2 / 4.3 / 5.1 / 5.2 | 4.0 |
| **Won't** | 本期明确不做（见 6.0.5） | D 类 registry、技能上传、脚本执行 / 沙箱、技能市场 | — |

> 注意 L2（形态）排在 L3（运维）之前：**先崩的是上下文，不是管理页**。技能数一多，全量注入会先把 token 打爆，而管理页只是"用起来不方便"。

#### 12.2.2 总排序（24 项，按执行顺序）

| # | 任务 | 级别 | 人日 | 累计 | 为什么排在这里 |
|---|---|---|---|---|---|
| 1 | **0.1** `resolveSkillSelection` | L1 | 0.5 | 0.5 | 扇出最大（0.2/0.3/0.4/0.5/4.1/4.2 均依赖），纯函数、零风险，必须先落地 |
| 2 | **0.2** `aggregate(only)` | L1 | 0.3 | 0.8 | 与 0.3 配套；缺它则"选了技能但提示仍全量"，语义不完整 |
| 3 | **0.3** `factory` 工具裁剪 | L1 | 0.5 | 1.3 | 让选择第一次真正影响工具集（A1 的核心修复） |
| 4 | **0.4** DTO + `configurable` + cache + resume | L1 | 0.7 | 2.0 | 打通前后端唯一通道；resume 一致性在此一并解决（R4） |
| 5 | **0.5** 前端 store + 发送接线 | L1 | 1.0 | 3.0 | U1「勾选不生效」在此消失，是用户唯一能直接感知的修复 |
| 6 | **0.6** 造一个可达技能 | L1 | 0.5 | 3.5 | **没有可测对象，前 5 项全部无法验收**（A7 死代码） |
| 7 | **0.7** `load_skill` 插槽 | L1 | 0.5 | 4.0 | 0.5 人日买"后续不重写 factory 接线"，紧接 P0 尾声做最省 |
| 8 | **3.1** 目录注入（L1） | L2 | 0.7 | 4.7 | 先把"全量正文"降为"目录"，是 token 治理的最大单点收益 |
| 9 | **3.2** `load_skill`（L2） | L2 | 1.0 | 5.7 | 与 3.1 成对：只有目录没有按需加载，模型拿不到正文 |
| 10 | **3.3** `loaded_skills` 状态 | L2 | 0.5 | 6.2 | 多轮 / resume 不重复注入；不做会在长会话里反复膨胀 |
| 11 | **3.4** 门控 / 指标 / 灰度 | L2 | 0.3 | 6.5 | 形态切换必须可回滚（默认关闭），否则无法灰度 |
| 12 | **1.1** `unregisterSkill` 连带工具 | L3 | 0.3 | 6.8 | **缺陷修复，必须早于 1.3**：否则"停用"只是删条目，工具仍可调用（假动作） |
| 13 | **1.2** `syncFromConfig` + revision | L3 | 0.7 | 7.5 | 让白名单变化能生效、让图缓存能失效，是 1.3 的前置 |
| 14 | **1.3** 激活 / 停用 / 重扫 API | L3 | 1.0 | 8.5 | 管理层第一次具备写能力，配套持久化 |
| 15 | **1.4** 设置页 skills 分区 | L3 | 0.5 | 9.0 | 有 API 无 UI 等于半成品；与 MCP 分区同构，成本低 |
| 16 | **2.1** manifest（版本 / 依赖 / 纯提示型） | L3 | 1.5 | 10.5 | 让非研发可投放技能；也是 2.3 的结构前提 |
| 17 | **2.2** 路径安全 + 冲突上报 | L3 | 0.5 | 11.0 | 与 2.1 同批：开放目录即需要前缀校验（安全）与冲突可见（运维） |
| 18 | **2.3** 内容寻址 + 快照 | L3 | 0.7 | 11.7 | 版本是存储层属性，晚做要重写注册结构与缓存键 |
| 19 | **2.4** 默认指针 + 回滚 | L3 | 0.3 | 12.0 | 有了快照才有回滚；接口小、价值直观（事故恢复） |
| 20 | **4.1** `requiredScopes` 校验 | L4 | 1.5 | 13.5 | 多租户 / 对外承诺出现前不阻塞；一旦出现必须提前（见 12.3 触发器） |
| 21 | **4.2** 技能级指标 / 审计 | L4 | 1.0 | 14.5 | 依赖 4.1 的主体标识，单独做只能得到工具级数据 |
| 22 | **4.3** 安全边界文档 | L4 | 0.5 | 15.0 | 纯文档；越早写越能约束实现，但可与其他任务并行 |
| 23 | **5.1** `healthCheck` + 自动摘除 | L4 | 0.7 | 15.7 | 技能数量少时人工巡检足够；> 10 个才需要自动化 |
| 24 | **5.2** 快照回收 | L4 | 0.3 | 16.0 | 纯磁盘治理，最后做；但**必须在对外开放上传之前**完成 |

#### 12.2.3 最小可用切片（可独立交付、可独立验收）

| 切片 | 内容 | 人日 | 交付后可验证什么 | 已知偏差 |
|---|---|---|---|---|
| **S1 冒烟切片** | 0.1 + 0.3 + 0.4 + 0.5 + 0.6 | **3.2** | 勾选 → 请求带 `skills` → 工具集随之变化（可 e2e 断言） | 提示仍全量注入（0.2 未做） |
| **S2 完整 P0** | S1 + 0.2 + 0.7 | 4.0 | 提示也按选择裁剪；插槽就位 | 无 |
| **S3 形态切片** | S2 + 3.1~3.4 | 6.5 | 目录注入 + 按需加载，20 技能 ≤ 2k 字符 | 工具 schema 仍预绑定（11.1.5） |
| **S4 运维切片** | S3 + 1.1~1.4 | 9.0 | 管理面启停即时生效，无需重启 | 无版本控制 |
| **S5 版本切片** | S4 + 2.1~2.4 | 12.0 | 版本冻结 / 回滚 / 依赖校验 | 无上传、无权限 |
| **S6 治理切片** | S5 + 4.x + 5.x | 16.0 | scope 生效、可审计、可自动摘除 | 仍无沙箱（长期边界） |

#### 12.2.4 关键路径与依赖扇出

```
0.1 ──┬─→ 0.2 ─→ 0.7 ─→ 3.1 ─→ 3.2 ─→ 3.3 ─→ 3.4
      ├─→ 0.3 ─→ 0.4 ─→ 0.5 ─→ 0.6 ─→ (S1 验收)
      └─→ 4.1 ─→ 4.2

1.1 ─→ 1.2 ─→ 1.3 ─→ 1.4
2.1 ─┬─→ 2.2
     └─→ 2.3 ─→ 2.4 ─→ 5.2
```

- **关键路径**：`0.1 → 0.3 → 0.4 → 0.5 → 0.6`（3.2 人日）→ 决定"最早什么时候能让用户看见效果"；
- **第二关键路径**：`0.2 → 0.7 → 3.1 → 3.2 → 3.3`（3.0 人日）→ 决定"什么时候不必担心规模"；
- **扇出最高**：`0.1`（6 处直接依赖），因此它虽小，必须第一个做。

#### 12.2.5 三条反直觉结论

1. **0.6（造一个可达技能）排第 6，而不是最后**：本仓库唯一示例 `MathSkill` 是不可达死代码，没有它，前面 5 项在验收时只能"看代码正确"，无法"看行为正确"。
2. **1.1（`unregisterSkill` 连带工具）排在管理面第一位，而不是夹在 1.3 里**：现状只删 `_skills` 条目、不删工具 → "停用"会变成假动作；先修再开放写接口，避免上线即带洞。
3. **L2（渐进式披露）整体排在 L3（管理面）之前**：管理页缺少只影响"效率"，上下文超限直接影响"能不能用"；且后补形态要重写 `factory` 的接线形状（7.8 已花 0.5 人日买断这个风险）。

### 12.3 迭代切片与调整触发器

**迭代划分**（与 12.2 排序一致）：

- **第一迭代 = P0 + P1-c（6.5 人日）**：把"选择 → 执行"打通，同时获得目录注入 + 按需加载的**正确形态**，避免后续返工；
- **第二迭代 = P1-a + P1-b（5.5 人日）**：管理面 + 版本治理（此时才需要多技能共存）；
- P2 按技能数量与合规要求触发。

| 迭代 | 内容 | 人日 | 累计 | 出口条件（可验收） |
|---|---|---|---|---|
| **迭代 1** | S3 = P0 + P1-c（0.1–0.7 + 3.1–3.4） | 6.5 | 6.5 | 勾选生效 + 目录注入 + 按需加载；20 技能目录 ≤ 2k 字符 |
| **迭代 2** | P1-a + P1-b（1.1–1.4 + 2.1–2.4） | 5.5 | 12.0 | 管理面启停即时生效；版本冻结 / 回滚可用 |
| **迭代 3**（按需） | P2-a + P2-b（4.x + 5.x） | 4.0 | 16.0 | scope 生效、技能级可计量、失败自动摘除 |

**为什么把 P1-c 放进迭代 1 而不是迭代 2**：它只依赖 0.7（插槽），与 1.x / 2.x 无耦合；一旦延后，`factory` 的工具绑定形状会先按"全量被选技能工具"固化，之后改"绑 `load_skill` + 按需"要动同一处接线与测试基线。

**调整触发器**（满足任一条件即重排优先级，无需重写本文档）

| 触发条件 | 优先级变化 | 理由 |
|---|---|---|
| 技能数 ≤ 2 且 3 个月内无增长 | P1-c 可降到 P1-a 之后（省 2.5 人日） | token 压力尚未出现 |
| 已有技能 > 5 个，或单个正文 > 4k 字符 | P1-c 立即执行（**不得延后**） | 每轮对话都在烧 context，长会话会先崩 |
| 出现第二个消费方（桌面端 / 第三方 API） | P1-b（manifest）上调到 P1-c 之前；重新评估 D 类 | 定义格式需先冻结，否则多端各写一套 |
| 对外承诺多租户 / SaaS | 4.1 上调到管理面开放之前 | 先开写接口再补权限 = 上线即越权 |
| 需要技能执行外部脚本 | **冻结 A 的执行面与上传**，先评估沙箱 | 当前 `import()` 为进程全权限（10.2） |
| 技能停用 / 回滚发生过一次事故 | 1.1 / 2.3 / 2.4 上调，并补审计（4.2） | 说明"假动作"已造成实际影响 |
| P0 实测图重建耗时 > 300ms | 切方案 B（全量绑定 + 运行时守卫，见 6.3） | 组合枚举导致缓存命中率过低 |

**排序变更规则**：任何重排必须同步更新 12.2.2 的"累计"列与 12.2.3 的切片人日；新增任务先判定级别（L1–L4）再插入，不允许"插队但不分级"。

### 12.4 实施进度与偏差记录

> 每个级别完成后均执行：目标单测 → 三端全量回归（web / modu-agent / backend-ts）→ 无新增失败方可进入下一级。

**已完成**

| 级别 | 范围 | 关键交付 | 回归结果 |
|---|---|---|---|
| **L1** | 0.1–0.7 | `selection.ts`（选择/裁剪/目录摘要）、`aggregate(only)`、factory 裁剪、请求 DTO + 图缓存键 + resume、前端 `skillSelectionStore`、可达 `math` 技能、`loaded_skills`/`catalogOnly` 插槽 | modu 1287 passed（7 既定 sqlite 失败）；backend 214 passed；web 580 passed |
| **L2** | 3.1–3.4 | 目录注入（L1，预算 2000 字符）、`load_skill`（L2，预算 6000 字符，白名单 + fail-soft）、`shouldEnableProgressiveDisclosure` 门控、装配冒烟 | modu 1305 passed（7 既定）；backend 214 passed |
| **L3-1** | 1.1–1.4 | `unregisterSkill` 连带工具回收（精确实例）、`syncFromConfig` + `skillsRevision` + 图缓存失效、`activate/deactivate/reload` API + 文件持久化 + `ADMIN_USER_IDS` 守卫、设置页技能分区（启停/重扫/提示） | 见本节末「L3-1 回归」 |
| **L3-2** | 2.1–2.4 | manifest 校验 + 纯提示型技能（`DeclarativeSkill`）、路径逃逸防护、依赖存在性过滤、内容 sha256 + 快照 + 默认指针（`pinned` 回滚语义）、`GET /skills` 增 `contentHash/fromSnapshot/error/conflicts`、`POST /skills/:name/rollback` | 见本节末「L3-2 回归」 |
| **L4** | 4.1–4.3 / 5.1–5.2 | `resolveSkillSelection` 支持 `scopes`（fail-closed，未提供则不校验）、`record_skill_invocation{skill,tool,status}` 指标、重启前后一致的审计日志（activate/deactivate/rollback/prune）、`BaseSkill.healthCheck()` 与 sync 前后置判定、`cleanupSnapshots()` + `POST /skills/prune` | 见本节末「L4 回归」 |

**三项语义决策（2026-10-20，已落地）**

| # | 决策 | 结论 |
|---|---|---|
| ① | 空选择语义 | 不发 `skills` = 服务端默认（全部已启用）；`[]` 保留为"明确不用"。菜单底部文案已说明 |
| ② | `loaded_skills` | 不做状态接线（工具无法写图状态）；正文由消息历史承载，`load_skill` 可重放自愈。字段标注为保留、恒为空 |
| ③ | resume 选择 | 落 `chat_messages.metadata.skills`（免迁移），resume 请求体优先、缺失回读；编辑重发同步更新 |

**L3-1 回归**：`apps/backend-ts` 32 文件 / 235 passed；`apps/web` 587 passed；`packages/modu-agent` 1313 passed（7 项既有 sqlite 环境失败）。

**L3-2 回归**：modu 新增 `versioning-declarative.test.ts` 13 例；backend 新增 rollback/conflicts 4 例；三端全量见本轮记录（web 未改动，沿用 587）。

**L3-2 实现要点（回滚语义）**

- 内容指纹：`sha256(排序后的相对路径 + 文件内容)`，同内容必同指纹；
- 快照：`<base>/.snapshots/<name>/<version>+<hash8>/`，首次发现自动生成（`skills.versioning.enabled` 默认 true）；
- 版本状态：`<base>/.state.json`，`{ name: { defaultVersion, versions, pinned } }`；
- **正常升级**：工作副本版本变化且 `pinned=false` → 默认指针自动前移；
- **显式回滚**：`POST /skills/:name/rollback` 置 `pinned=true` 并指向目标版本，`discover` 从快照加载（`fromSnapshot=true`），工作副本再怎么改都不会自动覆盖；
- **同版本改内容**：记 `conflict`，默认指针不动，`GET /skills` 返回 `error="同版本内容变更（版本未递增）"`；
- 工具名冲突：`GET /skills` 返回 `conflicts: [{skill, tool, existing}]`，让「静默跳过的工具」可见。

**L4 回归**：modu `tests/skills` 8 文件 / 104 例（新增 scopes 5、healthCheck 2、快照回收 4）；backend 技能相关 3 文件 / 26 例（新增 prune 2）。三端全量见本节末。

**L4 实现要点**

- **权限 scope**：`resolveSkillSelection(registry, selected, { scopes })`。**未提供 `scopes` = 不校验**（向后兼容）；提供数组时技能 `requiredScopes()` 必须全部命中，否则忽略（fail-closed）。宿主经 `configurable.scopes` 注入，backend 暂未接入身份 scope。
- **技能级指标**：`modu_agent_skill_invocations_total{skill,tool,status}`；`SkillToolWrapper` 记录耗时并复用工具延迟直方图。
- **审计**：`[skills.audit] activate|deactivate|rollback|prune` 结构化日志（含操作者 id），随 `observability.logging.structured` 输出。
- **健康检查**：`BaseSkill.healthCheck()`（默认 true，抛错按健康处理）；`syncFromConfig` 注册前判定，已注册但在白名单中的技能若健康检查失败会被移除。
- **快照回收**：`cleanupSnapshots(baseDir, {keepLast=5, maxAgeDays=90, dryRun})`；**默认版本快照永不删除**；`POST /skills/prune`（管理员）按 `auto_discover_dirs` 逐个执行。

**已知限制**

1. 管理面持久化为**单机文件**（`data/skills.state.json`）——多实例部署下各实例状态不一致，需改为共享存储（DB 表）后再开放多副本。
2. `ADMIN_USER_IDS` 为**环境变量白名单**，无角色概念；管理员变更需重启（配置在进程启动时解析）。
3. `requiredScopes` 的 scope 来源尚未接入身份体系：backend 未传 `configurable.scopes`，因此**当前实际不生效**（内核能力已就绪，接入时无需改内核）。
4. 启用技能后若 `setup()` 抛错，白名单已写入但注册失败 → 接口返回 500 并保留白名单，需「重新扫描」重试（fail-soft，但白名单与注册状态可能短暂不一致）。
5. 回滚只影响**新装载**；已在内存中的旧图通过 `skillsRevision` 失效重建，但已运行中的会话不受影响。
6. 快照回收需**管理员手动触发**（或外部定时任务调 `/skills/prune`），进程内未内置定时器。
7. 技能仍在进程内 `import()` 执行，**无沙箱**；`requiredScopes` 只限制"能否加载"，不限制加载后代码的行为。

---

## 13. 测试与验收

### 13.1 单元测试

| 对象 | 关键用例 |
|---|---|
| `resolveSkillSelection` | 未传 → 全 undefined；`[]` → 空集；命中；未注册 / 未激活 → `ignored`；重复 / 大小写归一 |
| `SkillPromptAggregator.aggregate` | `only=undefined` 与旧行为**字符等价**；`only=[]` 返回 base；`only=['a']` 不含 b 片段 |
| `registry.unregisterSkill` | 条目与工具同时移除；他人工具不被误删；重复卸载返回 false |
| `syncFromConfig` | 增 / 删 diff 正确；`teardown` 被调用一次；失败项不影响其他项 |
| `normalizeSkills` | 去重、排序、截断上限 |
| `graphCacheKey` | 含 skills 时不同选择不同 key |
| `SkillPromptAggregator({ catalogOnly: true })` | 仅含 `name + summary`，不含正文与 examples；无技能返回 base；`catalogOnly` 未传时与旧实现字符等价 |
| `load_skill` 工具 | 重复加载幂等且不重复注入；未知 / 未选技能返回 `SKILL_NOT_AVAILABLE`；超长截断标记；`loaded_skills` 正确并集 |
| `versioning` | 同内容同 hash；内容变而版本未变 → 拒绝并告警；快照只读；回滚只改指针不动文件 |

### 13.2 集成测试（backend-ts，Fastify decorate prisma 桩，与既有 `test/agent-persist-continue.test.ts` 同范式）

1. `POST /agent/completions` 带 `skills:['math']` → 断言传给 `create_agent` 的 `configurable.skills` 与 `tools` 白名单；
2. 带不存在的技能 → 200 且 `ignored` 告警，不报错；
3. resume 场景：暂停态记录 `skills` → 恢复图工具集一致；
4. `POST /skills/x/activate` 后 `GET /skills` 中 `active=true`，且 `graphCacheKey` 变化（用 spy 断言 LRU miss）；
5. 渐进式披露：开启门控 + `skills:['math']` → 首轮 system prompt 只含 `[Skills]` 目录（断言不含正文关键字）；模型调用 `load_skill('math')` 后次轮上下文含正文与 examples；
6. `loaded_skills` 恢复：暂停 / 恢复后 `state.loaded_skills` 与暂停前一致，且不重复注入目录。

### 13.3 端到端冒烟（人工，写入 `apps/web/docs/冒烟测试清单.md`）

1. 默认部署（`skills.enabled=false`）：技能菜单空态，发送消息不报错，行为与今天一致；
2. 开启 `skills.enabled=true` + 投放 `math` 技能：列表出现「math / 已加载」，勾选徽标 = 1；
3. 发送「计算 (1+2)*3」：工具卡片出现 calculator 调用，回答含 9；
4. 取消勾选后重发：本轮无 calculator 调用（验证裁剪生效）；
5. 设置页停用 `math`：列表变「未启用」，新会话不再出现该工具（**不重启进程**）；
6. 刷新页面：勾选态从 `localStorage` 恢复；
7. 渐进式披露开启后重放第 3 步：首轮工具面板只出现 `load_skill`（而非 `calculator`），加载后第二轮才出现 `calculator`；
8. 版本回滚：改 `manifest.version` 后重新扫描 → 快照新增、`default_version` 前移；`POST /skills/math/rollback {version:'1.0.0'}` 后 `GET /skills` 的 `contentHash` 回到旧值。

### 13.4 回归基线（不得退化）

- `apps/web`：`npx tsc -b` 0 错误；`npx vitest run` 全绿（当前 473 例）；
- `packages/modu-agent`：`npx tsc -p tsconfig.build.json --noEmit`；`npx vitest run --minWorkers=1 --maxWorkers=4`（全量超时需 Start-Process 写日志再读）；
- `apps/backend-ts`：`npx vitest run` 全绿。

---

## 14. 风险与取舍

| ID | 风险 | 影响 | 缓解 |
|---|---|---|---|
| **R1** | 按需裁剪导致图重建变多（每套 skills 组合一张图） | 首字延迟抖动 | 归一化 + LRU 16 + 实测重建耗时；> 300ms 切方案 B |
| **R2** | `effectiveToolNames` 合并错误，误删默认工具 | 模型能力突降 | 显式并集计算 + 「未选技能时与今天字符等价」的回归断言 |
| **R3** | 停用技能后工具残留 | 安全 / 语义不一致 | 必做 `unregisterSkill` 连带工具（P1-1.1），并加单测 |
| **R4** | resume 未带 skills → 中断点工具不可用 | HITL 恢复失败 | 7.5 的持久化 + 单测 |
| **R5** | 技能提示全量注入挤占上下文 | 长会话质量下降 | **P1-c 渐进式披露**（已提前）；过渡期加 `system_prompt_max_chars` 预算与告警 |
| **R6** | 把「加载隔离」误当安全边界 | 越权执行 | 10.2 的显式边界说明 + 禁止上传即加载 |
| **R7** | 前端空选择语义歧义（空数组 vs 缺省） | 用户以为「没选 = 自动」 | 在 Picker 空态与发送前提示中固定一种语义并在文档写明（建议：空数组 = 明确不用技能） |
| **R8** | 渐进式披露提前后，`loaded_skills` 与 checkpoint 状态不一致（多轮 / resume） | 重复注入或正文丢失 | 状态位在 P0 预留、P1-c 才启用；resume 复用 checkpoint 并做「技能已下线」降级 |
| **R9** | 目录注入未设预算 → 技能多时又变成新的膨胀源 | 换一种方式爆上下文 | `catalog_max_chars`（默认 2000）+ 截断告警 + `skill_catalog_chars` 指标 |
| **R10** | 版本快照无限增长（磁盘） | 运维成本 | `keep_last_n=5` / `max_age_days=90`，且不删 `default_version` |

**是否值得做**：值得，且**第一迭代做 P0 + P1-c（6.5 人日）**，第二迭代 P1-a + P1-b（5.5 人日）。

理由的变化（相对初版）：初版建议"只做 P0 + P1-a"，前提是"渐进式披露属优化项"。对齐 6.0 的行业基准后，这个前提不成立——成熟产品把**目录注入 + 按需加载**当作默认形态；若我们先按"全量注入 + 全工具绑定"交付，技能数量一上来就要重做工具接线与提示路径，返工成本远高于现在多花的 2.5 人日。P2 的权限体系仍按"技能真实增长（≥ 10 个）或出现多租户需求"触发。

---

## 15. 附录

### 15.1 关键文件索引

| 层 | 文件 | 职责 |
|---|---|---|
| UI | `apps/web/src/components/CapabilityBar/{CapabilityBar,SkillPicker,PluginPicker}.tsx` | 入口 / 技能面板 / 插件面板 |
| UI | `apps/web/src/hooks/useSkillOptions.ts` | 列表缓存 + 选择持久化 |
| UI | `apps/web/src/api/skills.ts`、`api/agent.ts` | 接口契约 |
| UI | `apps/web/src/store/settingsDialogStore.ts` | 设置分区路由（待新增 skills） |
| 后端 | `apps/backend-ts/src/routes/skills.ts` | 唯一技能端点（只读） |
| 后端 | `apps/backend-ts/src/core/agent-bridge.ts` | `configurable` 组装 / 图缓存 |
| 内核 | `packages/modu-agent/src/core/interfaces/skill.ts` | Skill 抽象 |
| 内核 | `packages/modu-agent/src/skills/{loader,adapter,prompt-aggregator,few-shot-selector}.ts` | 发现 / 降解 / 提示 / 示例 |
| 内核 | `packages/modu-agent/src/skills/{selection,versioning,load-skill-tool}.ts`（**待新增**） | 选择裁剪 / 版本与内容寻址 / L2 按需加载 |
| 内核 | `packages/modu-agent/src/core/registry.ts:731-788` | 注册 / 反注册 / 列表 |
| 内核 | `packages/modu-agent/src/graph/factory.ts:619-628,795-804` | 两个接线点 |
| 内核 | `packages/modu-agent/src/config/{runtime-config,plugin-manifest}.ts` | 配置默认值 / manifest 校验 |

### 15.2 与既有规划的关系

- `apps/web/docs/三模式Agent能力分层实施方案.md` 的 **T4.6** 已把 `skills?: string[]` 列为待办（本文 P0 即其最小可交付子集，不含附件 / 引用 / 知识库）；
- `packages/docs/Agent架构分层解耦实施计划.md` 把 `skills/loader.ts` 作为「隔离范式」参照模板并明确「不动」——本文的 P0 不改其发现逻辑，只在 `factory` 侧新增选择裁剪，符合该约束；
- `Scenario Packs`（`packs/*.yaml`）与 Skills 目前互不相干，`capabilities` 字段不含 skill；若后续要让场景包声明「随包启用某技能」，在 `scenario-host.ts` 的注册面上增加 `skill` 类别即可（复用 `registerSkill`）。

### 15.2.1 与行业标准的对应关系

| 行业事实标准 | 本文落点 | 说明 |
|---|---|---|
| `SKILL.md` + frontmatter（name / description） | 9.1 `manifest.json` + `prompts/system.md` | 保留 TS 技能兼容，新增声明式路径 |
| 三层渐进式披露（~100 token / < 5k / 零成本） | 11.1 L1 目录 + L2 `load_skill`；L3 暂不做 | 无技能级沙箱，故不引入脚本层 |
| 版本不可变 + 默认指针（OpenAI `default_version`） | 9.3 内容寻址 + 快照 + 指针 + 回滚 | 版本属存储层，P1-b 落地 |
| 作用域（org / workspace / user） | 10.1 三级权限模型 | 用户级为可选 |
| 命名空间验证 / 包归属校验（MCP Registry） | 9.1 路径白名单 + 前缀校验；10.2 边界声明 | 暂无签名与来源验证，列为 P2 之后 |
| 沙箱执行脚本 | **不做** | 与当前架构冲突，明确写入对外边界 |

### 15.3 术语

| 术语 | 含义 |
|---|---|
| 技能（Skill） | 一组工具 + 一段 system prompt 片段（+ 可选 examples）的可插拔封装 |
| 激活（active） | 服务端白名单命中、已在 `ComponentRegistry` 注册 |
| 选择（selected） | 用户在某一轮对话中勾选的技能集合 |
| 渐进式披露 | 只注入技能目录，正文按需加载（工具 schema 解耦另议，见 11.1.5） |
| L1 / L2 / L3 | 目录元数据 / 正文指令 / 打包资源，对应 Anthropic 三层加载 |
| 内容寻址 | 以内容 sha256 标识版本，保证"同内容同指纹、可复现、可回滚" |
| fail-soft | 技能加载失败只告警跳过，绝不阻断请求 |
| fail-closed | 权限 / 审批不满足时**移除**能力，而非放行 |
