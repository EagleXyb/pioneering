# ModuAgent Skills 能力实施方案

> 配套文档：[02-ModuAgent核心框架.md](./02-ModuAgent核心框架.md) 中「二、Skills 能力分析」指出：
> 现有 `BaseTool` 已具备注册/发现/调用/热替换/HITL/重试等"类 Skill"基础能力，
> 但与成熟 Skills 生态的差距在于——**Skill 作为一等公民**的高级特性（多工具封装、自描述元数据、动态加载、版本管理、组合编排、权限声明）。
>
> 本方案在**不修改核心调用链**的前提下，通过"适配器 + 注册中心扩展 + 配置驱动"三件套，把 Skill 落地为可插拔单元。

---

## 0. 设计目标与硬约束

| 目标 | 说明 |
|------|------|
| 不侵入核心 | `graph.py` / `nodes.py` / `agent_node` 的**默认行为零变化**；新增逻辑全部通过「默认 None / 默认关闭」参数接入 |
| 复用而非重写 | 直接复用 `BaseTool` + `ComponentRegistry` + `tool_adapter` 三件套，Skill = (N 个工具) + (提示片段) + (元数据) |
| 可插拔 | 新增/删除 Skill 只需新增/删除模块或配置项，无需改图拓扑 |
| 零风险回退 | `skills.enabled` 默认 `False`（与 `tools.human_in_loop.enabled` / `orchestration.multi_agent.enabled` 一致），关闭时与现状完全等价 |
| 易回归 | 复用 `tests/conftest.py` 的 `fresh_registry` / `fresh_config` / `_cleanup_globals` 基座 |

---

## 1. Skill 接口规范与注册机制（可插拔）

### 1.1 `BaseSkill` 抽象基类（新增 `core/interfaces/skill.py`）

遵循 `core/interfaces/action.py` 中 `BaseTool` 的 ABC 风格，把"Skill 作为一等公民"所需的自描述与封装能力补齐：

```python
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from core.interfaces.action import BaseTool


class BaseSkill(ABC):
    # ---------- 身份与元数据（对应文档 2.1 的"自描述能力"）----------
    @abstractmethod
    def name(self) -> str: ...                      # Skill 唯一标识

    @abstractmethod
    def description(self) -> str: ...               # 面向 LLM 的能力描述（注入 system prompt）

    @abstractmethod
    def version(self) -> str: ...                   # 版本号（生态化能力，文档 2.1）

    def tags(self) -> List[str]:
        """分类标签，用于发现与按需加载。"""
        return []

    def examples(self) -> List[Dict[str, str]]:
        """few-shot 示例，可选，注入提示。"""
        return []

    def preconditions(self) -> Dict[str, Any]:
        """前置条件：所需配置/依赖/权限 scope（文档 2.1 前置条件）。"""
        return {}

    def required_scopes(self) -> List[str]:
        """细粒度权限声明（文档 2.1 权限控制）。"""
        return []

    # ---------- 封装性（对应文档 2.1 "一个 Skill 包含多个工具+prompt+资源"）----------
    def tools(self) -> List[BaseTool]:
        """该 Skill 暴露的原子工具集合（可为空，纯提示型 Skill）。"""
        return []

    def system_prompt_fragment(self) -> Optional[str]:
        """注入 LLM 的专属指令片段（如角色设定、工具使用规范）。"""
        return None

    # ---------- 生命周期 ----------
    def is_available(self) -> bool:
        """健康检查：依赖缺失/配置不全时返回 False，触发降级（见第 5 节）。"""
        return True

    def setup(self) -> None:
        """注册时一次性初始化（加载资源、建连接等）。异常被 Loader 隔离。"""
        pass

    def teardown(self) -> None:
        """卸载/进程退出时清理。"""
        pass
```

**为什么这样设计**：Skill 在运行时对图而言"透明"——它最终降解为 (1) 一组已注册到 `ComponentRegistry` 的 `BaseTool`，以及 (2) 一段附加的 system prompt。因此**图节点、ToolNode、ReAct 循环都不需要感知 Skill 的存在**。

### 1.2 注册中心增量扩展（`core/registry.py`）

在 `ComponentRegistry.__init__` 中新增一个 `_skills` 字典，并补齐 CRUD 方法。其余组件方法**保持原样**，仅扩展 `swap_component` 的映射表与 `list_all` 的输出：

```python
class ComponentRegistry:
    def __init__(self):
        # ... 原有 10 个字典保持不变 ...
        self._skills: Dict[str, "BaseSkill"] = {}   # 新增

    def register_skill(self, skill: "BaseSkill") -> None:
        if not isinstance(skill, BaseSkill):
            raise TypeError(f"skill must implement BaseSkill, got {type(skill)}")
        if not skill.is_available():
            logger.warning("Skill '%s' unavailable, skipped", skill.name())
            return
        self._skills[skill.name()] = skill
        # 自动注册 Skill 内含工具（可插拔关键：Skill 注册即工具就位）
        for tool in skill.tools():
            self.register_tool(tool)
        logger.info("Registered skill: %s (tools=%d)", skill.name(), len(skill.tools()))

    def get_skill(self, name: str) -> Optional["BaseSkill"]:
        return self._skills.get(name)

    def list_skills(self) -> Dict[str, Dict[str, Any]]:
        return {
            name: {
                "name": s.name(), "description": s.description(),
                "version": s.version(), "tags": s.tags(),
                "tool_count": len(s.tools()),
            }
            for name, s in self._skills.items()
        }

    def unregister_skill(self, name: str) -> bool:
        if name in self._skills:
            del self._skills[name]
            return True
        return False
```

`swap_component` 映射表（registry.py:163-175）追加 `"skill": self._skills`；`list_all`（:184-196）输出追加 `"skills": list(self._skills.keys())`。这两项均为**纯增量**，不影响既有 category。

### 1.3 可插拔性保证

- 新 Skill = 新建一个继承 `BaseSkill` 的类文件，**放 `components/skills/<skill_name>/` 目录**或直接 `register_skill()` 即可生效；
- 删除 Skill = 删除文件 / 移除注册调用，图拓扑不变；
- `register_skill` 内部自动把内含工具注册进 `_tools`，因此 Skill 与工具共享同一套 `build_langchain_tools` 通路（见第 3 节）。

---

## 2. 现有调用逻辑评估与低耦合集成点

### 2.1 现有调用链路（工具视角）

```
register_components()                        # examples/single_agent.py:34
   └─ registry.register_tool(SearchTool())   # 工具进入 ComponentRegistry._tools
create_agent(config)                         # modu_graph/factory.py:154
   └─ build_langchain_tools(tool_names, cfg) # tool_adapter.py:126
        └─ wrap_modu_tool(tool, cfg)         # tool_adapter.py:79  → LangChain StructuredTool
   └─ llm.bind_tools(tools)                  # factory.py:222
build_modu_graph(tools, llm, ...)            # graph.py:89
   └─ ToolNode(tools)                        # graph.py:188  ReAct 循环执行
make_agent_node(bound_llm, system_prompt)    # nodes.py:336
   └─ 注入 SystemMessage(system_prompt/感知/知识)  # nodes.py:381-406
```

### 2.2 集成点矩阵

| 集成点 | 文件:行 | 当前作用 | Skill 接入方式 | 耦合度 |
|--------|---------|----------|----------------|--------|
| 工具构建 | `tool_adapter.py:126` `build_langchain_tools` | 从 registry 批量产 LangChain 工具 | **不改**：Skill 工具已在 `_tools` 中 | 零（复用） |
| 工具包装 | `tool_adapter.py:79` `wrap_modu_tool` | BaseTool→StructuredTool | **不改**：Skill 工具走同一包装 | 零（复用） |
| 工具集筛选 | `factory.py:218` `configurable.get("tools")` | 决定加载哪些工具 | 扩展为 `tools` ∪ `skill→tools` | 低（增量） |
| 提示注入 | `nodes.py:381-406` `make_agent_node` | 注入 system prompt | 新增可选 `skill_prompt` 入参合并 | 低（默认 None） |
| 组件注册 | `single_agent.py:34` `register_components` | 注册内置组件 | 新增 `register_skill(...)` / SkillLoader 扫描 | 低（增量） |
| 配置 | `runtime_config.py:_DEFAULT_CONFIG` | 点分配置 | 新增 `skills` 段 | 零（独立命名空间） |
| 注册中心 | `registry.py` | 管理组件 | 新增 `_skills` + CRUD | 低（纯增量） |

### 2.3 为何是低耦合

1. **执行平面复用**：Skill 内含工具就是 `BaseTool`，天然复用 `wrap_modu_tool` / 重试 / HITL / ToolNode，图节点零改动。
2. **提示平面隔离**：Skill 提示只是 `make_agent_node` 注入的**额外** `SystemMessage`；不传则行为与现状完全一致。
3. **风险平面隔离**：`skills.enabled` 默认 `False`，关闭时所有新增代码路径不可达。

---

## 3. 通过抽象层 / 适配器模式引入 Skill（避免改核心代码）

### 3.1 新增目录结构

```
ModuAgent/
├── core/
│   ├── interfaces/
│   │   ├── action.py          # 不变
│   │   └── skill.py           # 新增 BaseSkill（§1.1）
│   └── registry.py            # 增量扩展（§1.2）
├── components/
│   ├── skills/                # 新增：各 Skill 实现
│   │   ├── base_skill.py      # 可选：BaseSkill 便捷基类（默认实现）
│   │   ├── math_skill/        # 示例 Skill（封装 calculator + 提示）
│   │   │   └── skill.py
│   │   └── ...
│   └── action/tools/          # 不变
├── skills/                    # 新增：动态加载器与聚合器
│   ├── loader.py              # SkillLoader：目录/配置发现+注册（适配器）
│   ├── adapter.py             # SkillAdapter：Skill→(tools, prompt) 降解
│   └── prompt_aggregator.py   # SkillPromptAggregator：合并提示片段
└── modu_graph/
    ├── factory.py             # 增量：create_agent 接受 skill_names（§3.3）
    └── nodes.py               # 增量：make_agent_node 接受 skill_prompt（§3.4）
```

### 3.2 关键模块（均为新增，零侵入）

**(a) `skills/adapter.py` — 适配器：Skill 降解为工具集 + 提示**

```python
class SkillAdapter:
    """把 BaseSkill 降解为图可消费的两类产物：工具名列表 + 提示片段。"""
    @staticmethod
    def tool_names(skill: BaseSkill) -> List[str]:
        return [t.name() for t in skill.tools()]

    @staticmethod
    def prompt_fragment(skill: BaseSkill) -> Optional[str]:
        frag = skill.system_prompt_fragment()
        if not frag:
            return None
        examples = "\n".join(f"- {e}" for e in skill.examples())
        return (f"[Skill: {skill.name()} v{skill.version()}]\n{frag}"
                + (f"\nExamples:\n{examples}" if examples else ""))
```

**(b) `skills/loader.py` — SkillLoader：动态发现与注册（对应文档 2.1 "动态加载"）**

采用**适配器/插件扫描**模式，支持三种来源，且每个 Skill 的导入/实例化被 `try/except` 隔离（见第 5 节）：

```python
class SkillLoader:
    def __init__(self, registry: ComponentRegistry, config: RuntimeConfig):
        self._registry = registry
        self._config = config

    def discover(self, paths: List[str]) -> List[BaseSkill]:
        """扫描目录，对每个模块 try/except 隔离，失败仅告警并跳过。"""
        ...

    def load_from_config(self) -> None:
        """读 skills.enabled / skills.auto_discover_dirs / skills.active，
        注册 active 技能及其工具。关闭时直接 return。"""
        if not self._config.get("skills.enabled", False):
            return
        for skill in self.discover(self._config.get("skills.auto_discover_dirs", [])):
            if skill.name() in self._config.get("skills.active", []):
                try:
                    skill.setup()
                    self._registry.register_skill(skill)   # 内部自动注册工具
                except Exception as e:                      # 加载隔离
                    logger.error("Skill '%s' failed to load: %s", skill.name(), e)
```

**(c) `skills/prompt_aggregator.py` — 提示聚合**

```python
class SkillPromptAggregator:
    @staticmethod
    def aggregate(base: Optional[str], registry: ComponentRegistry) -> Optional[str]:
        frags = [SkillAdapter.prompt_fragment(s) for s in registry.list_skills().values()]
        frags = [f for f in frags if f]
        if not frags:
            return base                                      # 无 Skill → 原样返回
        merged = (base or "") + "\n\n" + "\n\n".join(frags)
        return merged
```

### 3.3 `factory.py` 集成（增量，默认 None）

在 `create_agent` 中于 `factory.py:218-219` 之后追加 Skill→工具名展开。**注意默认 `skill_names=None` ⇒ 行为与现状完全一致**：

```python
    # 现有（不变）
    tool_names = configurable.get("tools")
    tools = build_langchain_tools(tool_names=tool_names, config=runtime_config)

    # 新增：Skill 展开（默认不可达，除非显式传入 skill_names 或 skills.enabled）
    skill_names = configurable.get("skill_names")
    if skill_names:
        from skills.adapter import SkillAdapter
        extra = []
        for sn in skill_names:
            sk = get_registry().get_skill(sn)
            if sk:
                extra.extend(SkillAdapter.tool_names(sk))
        if extra:
            tools = build_langchain_tools(tool_names=(tool_names or []) + extra, config=runtime_config)
```

> 若改用 `SkillLoader.load_from_config()` 在 `register_components()` 中预注册，则 `create_agent` 无需任何改动——工具已存在于 `_tools`，`build_langchain_tools()` 自然包含。这是**最推荐、耦合最低**的路径。

### 3.4 `nodes.py` 集成（提示注入，默认 None）

`make_agent_node`（`nodes.py:336`）新增可选参数 `skill_prompt: Optional[str] = None`，在 `nodes.py:382` 注入 base `system_prompt` 之后追加：

```python
        if system_prompt and (not messages or not isinstance(messages[0], SystemMessage)):
            messages.insert(0, SystemMessage(content=system_prompt))
        if skill_prompt:                                    # 新增，默认不传
            messages.insert(0, SystemMessage(content=skill_prompt))
```

调用方（`factory.py` / `graph.py`）在 `skills.enabled` 时通过 `SkillPromptAggregator.aggregate(...)` 生成 `skill_prompt` 并透传。**不启用时该参数为 `None`，插入逻辑被跳过，行为不变。**

### 3.5 动态加载 / 插件发现（对应文档 2.1）

- 目录扫描：`SkillLoader.discover()` 遍历 `skills.auto_discover_dirs`，按约定导入 `<skill>/skill.py` 中的 `Skill` 实例；
- Entry-points（可选进阶）：在 `pyproject.toml` 声明 `modu_agent.skills` group，支持第三方 wheel 分发（对应文档 2.1 "Skill 市场/仓库"）；
- 配置文件：写 `config/skills.yaml` 声明 `active` 列表与参数，运行时热加载。

---

## 4. 回归测试策略（确保不破坏现有功能）

复用 `tests/conftest.py` 的 `fresh_registry` / `fresh_config` / `_cleanup_globals`（autouse）基座，分层覆盖：

| 测试层 | 目标 | 手段 / 文件 | 是否阻断现有 |
|--------|------|-------------|--------------|
| 契约测试 | `BaseSkill` 实现符合接口；注册不污染既有工具 | `tests/core/test_skill_contract.py`：`register_skill` 后断言 `list_tools()` 仅增加 Skill 内含工具、图拓扑不变 | 否 |
| 适配器单测 | `SkillAdapter`/`SkillPromptAggregator` 降解正确 | `tests/skills/test_skill_adapter.py`：mock Skill → 断言 tool_names / prompt 片段 | 否 |
| 加载器单测 | 缺失依赖 Skill 被跳过、坏模块不崩 | `tests/skills/test_skill_loader.py`：构造 import 失败模块 → 断言仅 warning、registry 正常 | 否 |
| 工具适配器回归 | `build_langchain_tools` 对 Skill 工具产出与现有工具一致 | `tests/adapters/test_tool_adapter.py` 扩展：传入含 Skill 工具的 registry，断言 StructuredTool 数量/名一致 | 否 |
| 集成测试 | `create_agent()` + 示例 Skill 端到端 | `tests/langgraph/test_skill_integration.py`：注册 math_skill → `create_agent` → 工具可用、prompt 注入 | 否 |
| **基线回归（关键）** | 现有 7 工具 / 图 / 节点行为不变 | 运行现有 `tests/unit` `tests/adapters` `tests/integration` `tests/langgraph` 全量，关闭 `skills.enabled` 时结果与改造前**逐条一致** | — |
| 无 Skill 冒烟 | 默认路径等价性 | `tests/langgraph/test_no_skill_smoke.py`：断言 `skills.enabled=False` 时 `list_skills()=={}`、`skill_prompt is None`、图结构与改造前一致 | 否 |

**执行基线对比**：

```bash
# 改造前（基于当前分支 V1.5）
pytest tests/unit tests/adapters tests/integration tests/langgraph -q > baseline.txt

# 改造后
pytest tests/unit tests/adapters tests/integration tests/langgraph tests/skills -q > after.txt
diff <(grep PASSED baseline.txt) <(grep PASSED after.txt)   # 应无差异（仅新增用例）
```

**CI 门禁**：新增的 Skill 用例失败时阻断合并；但 `skills.enabled=False` 下的全量回归必须 100% 通过方能合入。

---

## 5. 异常处理与降级机制（防止 Skill 引入潜在缺陷）

| 风险点 | 机制 | 实现位置 |
|--------|------|----------|
| **Skill 模块导入/实例化失败** | 加载隔离：`SkillLoader` 对每个 Skill 包 `try/except`，失败仅 `logger.error` 并跳过，**不阻断 Agent 启动** | `skills/loader.py` |
| **Skill 依赖缺失** | `BaseSkill.is_available()` 健康检查；`register_skill` 内 `if not skill.is_available(): 跳过` | `core/registry.py`、`core/interfaces/skill.py` |
| **Skill 工具执行异常** | 复用 `wrap_modu_tool` 的指数退避重试（仅瞬时网络异常）；并新增 `SkillToolWrapper` 包裹 `invoke`，捕获所有异常返回标准化错误 | `modu_graph/adapters/tool_adapter.py`（新增 wrapper） |
| **错误结构一致性** | 降级返回 `{"status":"error","error_code":"SKILL_EXECUTION_FAILED","data":{...}}`，与现有 `CalculatorTool` 错误结构一致（见 `calculator.py:42-46`） | `skills/adapter.py` |
| **Skill 提示注入失败** | `SkillPromptAggregator.aggregate` 失败 → 返回 `base` 原提示，Agent 退化为无 Skill 提示运行 | `skills/prompt_aggregator.py` |
| **敏感 Skill 工具** | 复用现有 HITL：`BaseTool.requires_approval()` 返回 `True` → `human_review_node` 拦截（见 `nodes.py:241-258`、`graph.py:167`） | 不变（复用） |
| **权限越界** | `BaseSkill.required_scopes()` + `skills.active` 白名单，未声明 scope 的 Skill 不激活 | `skills/loader.py` |
| **可观测性** | Skill 调用包进 `_span()`（复用 `observability/tracing.py`），记录耗时/错误率指标；异常 `record_exception` | `observability/*`（复用） |
| **全局开关** | `skills.enabled` 默认 `False`，所有新增路径默认不可达，最坏情况与现状完全等价 | `config/runtime_config.py` |

**降级示意（执行隔离包装）**：

```python
def _safe_skill_invoke(tool: BaseTool, params, context):
    try:
        return tool.invoke(params, context)
    except Exception as e:                       # 任何异常都不外泄到图
        logger.error("Skill tool '%s' failed: %s", tool.name(), e)
        return {"status": "error",
                "error_code": "SKILL_EXECUTION_FAILED",
                "data": {"message": str(e)}}
```

---

## 6. 落地步骤（分阶段，每阶段可独立回滚）

1. **P1 接口与注册（零行为变更）**：新增 `core/interfaces/skill.py`、`registry.py` 增量方法（`_skills`/CRUD/`swap_component`/`list_all`）。仅扩展，不改调用链。
2. **P2 适配器与加载器**：新增 `skills/adapter.py` `loader.py` `prompt_aggregator.py`，含单测与契约测试。
3. **P3 接线（默认关闭）**：`factory.py` / `nodes.py` 加默认可选参数；`register_components()` 接入 `SkillLoader.load_from_config()`；`runtime_config` 加 `skills` 段（`enabled=False`）。
4. **P4 示例 Skill**：实现一个 `math_skill`（封装 calculator + 提示片段），跑集成测试。
5. **P5 回归门禁**：运行全量现有测试 + 新增 Skill 测试，对比基线，合入 CI。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 新增 Skill 改变 LLM 行为（提示污染） | `skills.enabled` 默认关；提示片段经 `SkillPromptAggregator` 隔离；集成测试断言无 Skill 时 prompt 不变 |
| Skill 工具名与内置工具冲突 | `register_tool` 以 `name()` 为 key 覆盖；`register_skill` 前校验 `tool_names` 不与 `_tools` 既有键冲突，冲突时 `logger.warning` 跳过该工具 |
| 加载器扫描第三方代码的安全风险 | 仅扫描白名单目录/`skills.active` 显式列表，不执行任意未声明模块；沙箱化 `setup()` |
| 与现有"扁平工具"心智模型冲突 | 文档与示例同步；Skill 对内是工具集合，对外是一等公民，两套视图并存不悖 |
| 回归遗漏 | 第 4 节基线与 CI 门禁强制全量现有用例 100% 通过 |

---

## 8. 与文档「Skills 能力分析」差距的对应

| 文档指出的差距（2.3/2.4） | 本方案覆盖 |
|--------------------------|-----------|
| 自描述元数据（场景/示例/前置条件） | `BaseSkill.examples()` / `preconditions()` / `tags()` |
| 多工具封装（Skill 包） | `BaseSkill.tools()` + `register_skill` 自动注册 |
| 动态加载（插件发现） | `SkillLoader.discover()` + 目录/entry_points |
| 版本管理 | `BaseSkill.version()` + 注册中心 `_skills` 版本追踪 |
| Skill 组合/链式调用 | 通过 `skills.active` 多 Skill 并存 + `SkillPromptAggregator` 合并（进阶可加编排节点） |
| 权限声明 | `BaseSkill.required_scopes()` + `skills.active` 白名单 |
| Skill 包分发格式 | entry-points / `skills.yaml`（进阶 wheel 分发） |

---

## 9. 实现进度（P1–P5 已完成）

| 阶段 | 交付物 | 状态 |
|------|--------|------|
| P1 | `core/interfaces/skill.py`（`BaseSkill`）；`core/registry.py` 增量（`_skills` + `register_skill`/`get_skill`/`list_skills`/`unregister_skill`，扩展 `swap_component`/`list_all`） | ✅ |
| P2 | `skills/` 包：`adapter.py`（`SkillAdapter`+`SkillToolWrapper`）、`loader.py`（`SkillLoader` 发现/加载隔离/幂等）、`prompt_aggregator.py`（`SkillPromptAggregator`） | ✅ |
| P3 | `config/runtime_config.py` 增加 `skills` 段（默认关闭）；`modu_graph/factory.py` 单一集成点（动态加载 + 提示聚合，gated by `skills.enabled`）；`examples/single_agent.py` 接入 `SkillLoader` | ✅ |
| P4 | `components/skills/math_skill/skill.py` 示例 Skill（封装 `CalculatorTool` + 提示片段 + 示例） | ✅ |
| P5 | `tests/skills/test_skills_core.py`、`tests/langgraph/test_skill_integration.py` | ✅ |

**测试验证（本机）**：
- 离线子集：`tests/skills` + `tests/core` → 30 passed
- 接线回归：`tests/adapters` + `tests/integration` + `tests/skills` + `tests/langgraph/test_skill_integration.py` → 67 passed, 1 skipped
- 图接线（`build_langchain_tools` → `ToolNode`）在非 langchain 环境自动 `importorskip`，安装依赖后 3 passed

**默认行为零变化**：`skills.enabled=False` 时所有新增路径不可达，`list_skills()=={}`，`build_langchain_tools()` 不凭空产生工具。


