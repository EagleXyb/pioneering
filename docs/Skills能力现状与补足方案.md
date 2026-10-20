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
- [7. P0：打通「选择 → 执行」](#7-p0打通选择--执行)
- [8. P1：技能激活与管理面](#8-p1技能激活与管理面)
- [9. P1：定义格式、版本与依赖](#9-p1定义格式版本与依赖)
- [10. P2：权限与治理](#10-p2权限与治理)
- [11. P2：生命周期与渐进式披露](#11-p2生命周期与渐进式披露)
- [12. 实施计划](#12-实施计划)
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

### 6.1 目标（按可验证的业务语句表述）

> 用户在 pro / task 输入框选中若干技能并发送消息后，**该轮对话只能使用被选技能的提示与工具**；未选择时行为与今天完全一致（无技能，或按服务端默认策略）。管理员可在设置页启用 / 停用技能，停用后新会话立即不再暴露其工具，**无需重启服务**。

### 6.2 设计原则

1. **默认等价**：`skills` 字段缺省时保持现状（不改变任何既有会话行为），沿用仓库既有的「gated + 默认关闭 + 字符等价」范式。
2. **最小侵入接线**：只在既有 3 个接缝上动手——请求 DTO、`configurable`、`create_agent` 的两个 skills 门控点；不重写工具绑定链路。
3. **与既有机制对齐**：图缓存（`agent-bridge` LRU 8）、工具白名单（`configurable.tools`）、HITL 审批、能力矩阵、可观测指标全部复用，不另起一套。
4. **能力可降级**：技能不存在 / 未激活 / 加载失败 → 忽略该项并告警，请求继续执行（fail-soft，与 `SkillLoader` 的隔离语义一致）。
5. **先打通再治理**：P0 只解决「选择 → 执行」，不做权限、不做市场、不做渐进式披露。

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
```

**关键取舍**：选择「按需裁剪 + 图缓存」还是「全量绑定 + 运行时守卫」？

| 方案 | 做法 | 优点 | 缺点 | 建议 |
|---|---|---|---|---|
| **A（推荐）按需裁剪** | `configurable.skills` 参与工具白名单与提示聚合，图缓存按选择分片 | 语义干净、token 最省、工具不可见即不可调用 | 组合多时图重建变多（LRU 8 需评估） | **MVP 采用**；技能数 ≤ 10、常用组合 ≤ 8 时足够 |
| **B 全量绑定 + 守卫** | 图不重建，工具节点前拦截未选技能工具并返回错误 | 零重建、切换零成本 | 工具 schema 全量进 prompt（token 膨胀）、模型可能反复试错 | 技能数量爆炸 / 组合不可枚举时切换 |

### 6.4 分阶段概览

| 阶段 | 目标 | 人日 | 交付判据 |
|---|---|---|---|
| **P0** | 选择 → 执行打通 | 3.5 | 选 `math` 后同轮对话工具集只含 `math` 工具；不选与今天字符等价 |
| **P1-a** | 激活 / 停用 API + 设置页 | 2.5 | 管理面可启停，新会话即时生效（无重启） |
| **P1-b** | 声明式定义 + manifest + 版本校验 | 2.0 | 可通过目录投放技能并校验版本 / 依赖 |
| **P2-a** | 权限与治理（scope / 审计 / 指标） | 3.0 | `requiredScopes` 生效，技能级调用可计量 |
| **P2-b** | 生命周期 + 渐进式披露 | 3.5 | 热卸载可用；技能目录常驻、正文按需加载 |

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
- `useAgentChat.startRun` / `usePlanExecuteChat.startRun` 在构造 body 时读取 `useSkillSelectionStore.getState().byMode[mode].selected`，写入 `skills`（**空数组也要发**，语义 = 明确不用技能；若产品希望"空 = 服务端默认"，则空时不发字段，需在 UI 空态文案上说明）。

**UI 同步修正（同批做，成本低）**：

- `active === false` 的技能行改为 disabled + 文案「需管理员启用」，禁止勾选（消除 U4）；
- 列表行补充 `v{version} · {toolCount} 个工具`（消除 U5，代价 1 行）；
- 折叠区加一行提示：「技能影响本轮可用工具，仅在 pro / 任务模式生效」。

### 7.5 resume 一致性（易漏点）

HITL 暂停后 `POST /agent/resume` 会用 `create_agent` 重建图（plan_execute 分支已如此）。若 resume 时没带同样的 `skills`，可能出现「暂停时有 `math` 工具、恢复后图里没有该工具」→ 中断点工具不可用 / unknown tool。

处理：

1. 在 `agent_runs` 的 metadata 或 `chat_messages.metadata` 中记录本轮 `skills`（现成字段，免迁移）；
2. `streamAgentResume` 读取该记录并注入 `configurable.skills`（与既有 `_probePlanExecutePaused` 同一层处理）；
3. 单测固化：暂停时 `skills:['math']` → resume 构建的图 `toolNames` 相同。

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
| `packages/modu-agent/src/skills/selection.ts` | **新增**：`resolveSkillSelection` |
| `packages/modu-agent/src/skills/prompt-aggregator.ts` | `opts.only` |
| `packages/modu-agent/src/graph/factory.ts` | 工具裁剪 + 提示聚合传参 |
| `packages/modu-agent/src/skills/index.ts` | 导出 `resolveSkillSelection` |

> 交付纪律：改 `modu-agent/src` 后必须 `npm run build`（backend-ts 运行时加载 `dist`）。

---

## 8. P1：技能激活与管理面

### 8.1 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/skills` | 既有，补 `enabledForUser`（可选）、`source`（`builtin`/`dir`）、`error`（发现失败原因） |
| `POST` | `/skills/:name/activate` | 加入白名单并热注册；返回最新 `SkillBrief` |
| `POST` | `/skills/:name/deactivate` | 移出白名单并 `unregisterSkill`；返回最新 `SkillBrief` |
| `POST` | `/skills/reload` | 重新扫描目录（开发态用），返回 diff |

鉴权：新增 `adminGuard`（`users.role` 若不存在则先补字段，或在 env 里配置 `ADMIN_USER_IDS` 白名单——**推荐后者，零迁移**）。

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

### 9.2 把 `MathSkill` 变成可达示例

- 新增 `packages/modu-agent/skills/math/{manifest.json, skill.js}`（编译后投放）或直接在 `skills/index.ts` 导出 `MathSkill` 并提供「内置技能快照」入口；
- 目的：让 P0 的端到端验证**有对象可测**，同时作为格式示范。当前 `MathSkill` 是不可达死代码（A7）。

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

## 11. P2：生命周期与渐进式披露

### 11.1 生命周期补全

| 阶段 | 现状 | 目标 |
|---|---|---|
| 发现 | 每次 `create_agent` 扫目录 | 增加 mtime 缓存，避免重复 `readdir` |
| 注册 | `registerSkill` | 冲突显式上报（`conflicts: [{skill, tool, existingOwner}]`） |
| 卸载 | 无 | `unregisterSkill` 连带工具 + `teardown()` |
| 健康 | 仅 `isAvailable()` 一次 | `healthCheck()` 定时（可选），失败自动从绑定集摘除并告警 |
| 热更新 | 无 | `POST /skills/reload` + `skillsRevision` 使图缓存失效 |

### 11.2 渐进式披露（token 治理）

当技能数 > 10 或提示片段 > 3k 字符时，全量注入开始侵蚀上下文。目标形态：

- **常驻**：注入「技能目录」（`name + 一句话 + 何时使用`），约 20 字符 / 技能；
- **按需**：提供内置工具 `load_skill(name)`，返回该技能的完整 `systemPromptFragment` + `examples`（写入 runtime context / 下一轮 system 消息），并同时把该技能工具加入允许集；
- **状态**：`state.loaded_skills: string[]` 参与 checkpoint，保证多轮 / resume 一致；
- 门控：`skills.progressive_disclosure.enabled`（默认 false），与仓库「默认等价」纪律一致。

---

## 12. 实施计划

| 阶段 | # | 任务 | 主要文件 | 人日 | 依赖 |
|---|---|---|---|---|---|
| **P0** | 0.1 | `resolveSkillSelection` 纯函数 + 单测 | `modu-agent/src/skills/selection.ts` | 0.5 | — |
| | 0.2 | `SkillPromptAggregator` 支持 `only` | `skills/prompt-aggregator.ts` | 0.3 | 0.1 |
| | 0.3 | `factory` 工具裁剪 + 提示传参 | `graph/factory.ts` | 0.5 | 0.1 |
| | 0.4 | 请求 DTO + `configurable.skills` + 图缓存 key + resume 复用 | `schemas/agent.ts`、`agent-bridge.ts` | 0.7 | 0.3 |
| | 0.5 | 前端 store + 发送接线 + picker 修正 | `store/skillSelectionStore.ts`、`useSkillOptions.ts`、`SkillPicker.tsx`、两个 chat hook | 1.0 | 0.4 |
| | 0.6 | 端到端冒烟（造一个可达技能） | `skills/math/{manifest.json,skill.js}` | 0.5 | 0.5 |
| **P1-a** | 1.1 | `unregisterSkill` 连带工具（修缺陷） | `core/registry.ts` | 0.3 | — |
| | 1.2 | `syncFromConfig` + `skillsRevision` + 缓存失效 | `skills/loader.ts`、`agent-bridge.ts` | 0.7 | 1.1 |
| | 1.3 | 激活 / 停用 / 重扫 API + 持久化 | `routes/skills.ts`、`data/skills.state.json` | 1.0 | 1.2 |
| | 1.4 | 设置页 `skills` 分区 + Picker「管理技能」入口 | 新增 `SettingsSkillsSection.tsx` 等 | 0.5 | 1.3 |
| **P1-b** | 2.1 | loader 接 manifest（版本 / 依赖 / 纯提示型） | `skills/loader.ts`、`DeclarativeSkill` | 1.5 | — |
| | 2.2 | 路径安全校验 + 冲突上报 | `skills/loader.ts`、`core/registry.ts` | 0.5 | 2.1 |
| **P2-a** | 3.1 | `requiredScopes` 校验 + `disabledReason` | `selection.ts`、`routes/skills.ts` | 1.5 | P1 |
| | 3.2 | 技能级指标 / 审计 | `skills/adapter.ts`、`observability` | 1.0 | 3.1 |
| | 3.3 | 安全边界文档 + 目录权限说明 | 文档 | 0.5 | — |
| **P2-b** | 4.1 | `healthCheck` + 自动摘除 | `BaseSkill`、`loader` | 1.0 | P1-a |
| | 4.2 | 渐进式披露（`load_skill` + 目录注入 + 状态） | `skills/`、`graph/nodes.ts`、`state.ts` | 2.5 | P2-a |

合计：**P0 3.5 人日**；P1 4.5 人日；P2 7.0 人日。建议 P0 + P1-a（6 人日）作为一个迭代交付，其余按需。

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

### 13.2 集成测试（backend-ts，Fastify decorate prisma 桩，与既有 `test/agent-persist-continue.test.ts` 同范式）

1. `POST /agent/completions` 带 `skills:['math']` → 断言传给 `create_agent` 的 `configurable.skills` 与 `tools` 白名单；
2. 带不存在的技能 → 200 且 `ignored` 告警，不报错；
3. resume 场景：暂停态记录 `skills` → 恢复图工具集一致；
4. `POST /skills/x/activate` 后 `GET /skills` 中 `active=true`，且 `graphCacheKey` 变化（用 spy 断言 LRU miss）。

### 13.3 端到端冒烟（人工，写入 `apps/web/docs/冒烟测试清单.md`）

1. 默认部署（`skills.enabled=false`）：技能菜单空态，发送消息不报错，行为与今天一致；
2. 开启 `skills.enabled=true` + 投放 `math` 技能：列表出现「math / 已加载」，勾选徽标 = 1；
3. 发送「计算 (1+2)*3」：工具卡片出现 calculator 调用，回答含 9；
4. 取消勾选后重发：本轮无 calculator 调用（验证裁剪生效）；
5. 设置页停用 `math`：列表变「未启用」，新会话不再出现该工具（**不重启进程**）；
6. 刷新页面：勾选态从 `localStorage` 恢复。

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
| **R5** | 技能提示全量注入挤占上下文 | 长会话质量下降 | P2 渐进式披露；短期加 `system_prompt_max_chars` 预算与告警 |
| **R6** | 把「加载隔离」误当安全边界 | 越权执行 | 10.2 的显式边界说明 + 禁止上传即加载 |
| **R7** | 前端空选择语义歧义（空数组 vs 缺省） | 用户以为「没选 = 自动」 | 在 Picker 空态与发送前提示中固定一种语义并在文档写明（建议：空数组 = 明确不用技能） |

**是否值得做**：值得，但**只做 P0 + P1-a**。理由：这两段把「UI 有入口、后端无响应」的产品缺陷补齐，成本 6 人日、风险可控、全部复用既有机制；P2 的渐进式披露与权限体系应在技能数量真实增长（≥ 10 个）后再投入。

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
| 内核 | `packages/modu-agent/src/core/registry.ts:731-788` | 注册 / 反注册 / 列表 |
| 内核 | `packages/modu-agent/src/graph/factory.ts:619-628,795-804` | 两个接线点 |
| 内核 | `packages/modu-agent/src/config/{runtime-config,plugin-manifest}.ts` | 配置默认值 / manifest 校验 |

### 15.2 与既有规划的关系

- `apps/web/docs/三模式Agent能力分层实施方案.md` 的 **T4.6** 已把 `skills?: string[]` 列为待办（本文 P0 即其最小可交付子集，不含附件 / 引用 / 知识库）；
- `packages/docs/Agent架构分层解耦实施计划.md` 把 `skills/loader.ts` 作为「隔离范式」参照模板并明确「不动」——本文的 P0 不改其发现逻辑，只在 `factory` 侧新增选择裁剪，符合该约束；
- `Scenario Packs`（`packs/*.yaml`）与 Skills 目前互不相干，`capabilities` 字段不含 skill；若后续要让场景包声明「随包启用某技能」，在 `scenario-host.ts` 的注册面上增加 `skill` 类别即可（复用 `registerSkill`）。

### 15.3 术语

| 术语 | 含义 |
|---|---|
| 技能（Skill） | 一组工具 + 一段 system prompt 片段（+ 可选 examples）的可插拔封装 |
| 激活（active） | 服务端白名单命中、已在 `ComponentRegistry` 注册 |
| 选择（selected） | 用户在某一轮对话中勾选的技能集合 |
| 渐进式披露 | 只注入技能目录，正文与工具按需加载 |
| fail-soft | 技能加载失败只告警跳过，绝不阻断请求 |
| fail-closed | 权限 / 审批不满足时**移除**能力，而非放行 |
