# ModuAgent 高紧迫度重构任务规范

## 一、背景与目标

根据 `docs/重构/agent重构&优化方案.md` 中第 6.5 节的优化优先级矩阵，识别出三个高紧迫度（🔴 高）任务：

| 任务 | 影响面 | 紧迫度 | 阶段 |
|------|--------|--------|------|
| 补齐 feedback/evolution 空壳 | 核心能力缺失 | 🔴 高 | 阶段三 |
| 补齐 langgraph 缺失能力 | 功能对等 | 🔴 高 | 阶段一 |
| 收敛双轨，删除 Coordinator 上帝类 | 维护性 | 🔴 高 | 阶段一 |

本文档定义这三个高紧迫度任务的实现规范。

---

## 二、任务一：补齐 feedback 模块

### 2.1 问题描述

`feedback/` 模块（6 个文件）在 ARCHITECTURE.md 中被描述为"反馈驱动"的核心能力，但实际完全为空壳。系统承诺的自评估、质量监控能力缺失。

### 2.2 实现范围

#### 2.2.1 `feedback/loop_controller.py` - 反馈循环控制器

实现 `FeedbackLoop(BaseFeedbackLoop)` 抽象类：

```python
class FeedbackLoop(BaseFeedbackLoop):
    """反馈循环控制器：评估响应质量，决定是否触发进化。"""

    async def evaluate(
        self,
        output: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """评估单次输出的质量。

        评估维度：
        - 相关性（relevance）：回答与问题的关联程度
        - 完整性（completeness）：回答是否完整覆盖问题
        - 准确性（accuracy）：事实性错误的数量
        - 工具效用（tool_effectiveness）：工具调用是否成功

        Returns:
            评估结果字典，包含各维度得分和综合得分
        """

    def should_evolve(
        self,
        metrics: Dict[str, float],
        threshold: float,
    ) -> bool:
        """判断是否应触发进化。

        条件：综合得分低于阈值 且 样本量足够。
        """
```

#### 2.2.2 `feedback/quality_monitor.py` - 质量监控器

实现基于 LLM-as-Judge 的质量评估：

```python
class QualityMonitor:
    """基于规则的响应质量监控器。"""

    def evaluate(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """评估响应质量（基于规则）。

        规则：
        - 空响应 → 0分
        - 包含"不知道"/"无法回答" → 扣分
        - 工具调用失败 → 扣分
        - 低置信度感知 → 降低预期
        """
```

#### 2.2.3 `feedback/metrics/accuracy.py` - 准确性指标

```python
class AccuracyMetrics:
    """工具调用准确性指标。"""

    def calculate(
        self,
        tool_results: List[Dict[str, Any]],
        expected_results: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, float]:
        """计算工具调用准确性。

        指标：
        - tool_success_rate：工具调用成功率
        - avg_execution_time：平均执行时间
        - error_rate：错误率
        """
```

#### 2.2.4 `feedback/metrics/efficiency.py` - 效率指标

```python
class EfficiencyMetrics:
    """系统效率指标。"""

    def calculate(
        self,
        usage: Dict[str, int],
        iteration_count: int,
        latency_ms: float,
    ) -> Dict[str, float]:
        """计算效率指标。

        指标：
        - token_efficiency：token 效率（output_tokens / input_tokens）
        - iteration_efficiency：迭代效率（有用输出 / 迭代次数）
        - tokens_per_second：吞吐量
        """
```

#### 2.2.5 `feedback/evolution_signal.py` - 进化信号定义

```python
@dataclass
class EvolutionSignal:
    """进化信号数据结构。"""

    signal_type: str
    source: str
    timestamp: float
    metrics: Dict[str, float]
    context: Dict[str, Any]
    severity: str  # "low" / "medium" / "high"


class EvolutionSignalCollector:
    """进化信号收集器：从 EventBus 订阅事件并生成进化信号。"""

    def __init__(self, report_interval: int = 100):
        self._signals: List[EvolutionSignal] = []
        self._counters: Dict[str, int] = defaultdict(int)
        self._report_interval = report_interval

    def on_agent_event(self, event: AgentEvent) -> None:
        """EventBus 订阅回调：收集推理事件。"""

    def get_signals(self) -> List[EvolutionSignal]:
        """获取累积的进化信号。"""
```

### 2.3 验收标准

- [ ] `FeedbackLoop.evaluate()` 返回包含 `relevance/completeness/accuracy/tool_effectiveness` 的评估结果
- [ ] `QualityMonitor.evaluate()` 正确识别低质量响应（空响应/工具失败等）
- [ ] `AccuracyMetrics.calculate()` 正确计算工具成功率
- [ ] `EfficiencyMetrics.calculate()` 正确计算 token 效率和迭代效率
- [ ] `EvolutionSignalCollector` 能从 EventBus 事件中收集信号

---

## 三、任务二：补齐 evolution 模块

### 3.1 问题描述

`evolution/` 模块（5 个文件）在 ARCHITECTURE.md 中被描述为"持续进化"的核心能力，但实际完全为空壳。系统的组件热替换、参数调优、版本回滚能力缺失。

### 3.2 实现范围

#### 3.2.1 `evolution/strategy/parameter_tune.py` - 参数调优策略

```python
class ParameterTuneStrategy:
    """基于反馈信号的参数调优策略。"""

    def __init__(
        self,
        config: RuntimeConfig,
        feedback_collector: EvolutionSignalCollector,
    ):
        """初始化参数调优器。

        调优参数：
        - temperature：温度参数（影响创造性）
        - max_iterations：最大迭代次数（影响深度）
        """

    def analyze_and_adjust(
        self,
        signals: List[EvolutionSignal],
    ) -> Dict[str, Any]:
        """分析进化信号并生成参数调整建议。

        策略：
        - 低准确性 → 降低 temperature（更保守）
        - 高迭代次数 → 降低 max_iterations（节省资源）
        - 高工具失败率 → 保持低 temperature
        """
```

#### 3.2.2 `evolution/strategy/component_swap.py` - 组件热替换策略

```python
class ComponentSwapStrategy:
    """基于质量对比的组件热替换策略。"""

    def __init__(
        self,
        registry: ComponentRegistry,
        feedback_collector: EvolutionSignalCollector,
    ):
        self._registry = registry
        self._feedback_collector = feedback_collector
        self._performance_history: Dict[str, List[float]] = defaultdict(list)

    def should_swap(
        self,
        component_name: str,
        current_version: str,
        candidate_version: str,
    ) -> bool:
        """判断是否应切换组件。

        条件：候选版本平均得分 > 当前版本平均得分 + 阈值
        """
```

#### 3.2.3 `evolution/registry/versioned_store.py` - 版本化存储

```python
class VersionedComponentStore:
    """组件版本快照存储。"""

    def __init__(self, storage_path: str = "evolution/versions"):
        self._storage_path = storage_path

    def save_version(
        self,
        component_name: str,
        version: str,
        state: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> None:
        """保存组件版本快照。"""

    def get_version(
        self,
        component_name: str,
        version: str,
    ) -> Optional[Dict[str, Any]]:
        """获取指定版本快照。"""

    def list_versions(
        self,
        component_name: str,
    ) -> List[str]:
        """列出组件的所有版本。"""

    def get_latest_version(
        self,
        component_name: str,
    ) -> Optional[str]:
        """获取组件的最新版本号。"""
```

#### 3.2.4 `evolution/registry/rollback_mechanism.py` - 回滚机制

```python
class RollbackMechanism:
    """基于质量回退的自动回滚机制。"""

    def __init__(
        self,
        version_store: VersionedComponentStore,
        registry: ComponentRegistry,
        rollback_threshold: float = 0.7,
    ):
        self._version_store = version_store
        self._registry = registry
        self._rollback_threshold = rollback_threshold

    def record_and_check(
        self,
        component_name: str,
        version: str,
        quality_score: float,
    ) -> bool:
        """记录质量得分并在需要时回滚。

        Returns:
            是否发生了回滚
        """

    def rollback_to_version(
        self,
        component_name: str,
        version: str,
    ) -> bool:
        """回滚到指定版本。

        流程：
        1. 从 version_store 获取版本快照
        2. 调用 registry.swap_component() 应用版本
        3. 记录回滚事件
        """
```

### 3.3 验收标准

- [ ] `ParameterTuneStrategy.analyze_and_adjust()` 根据信号调整 temperature/max_iterations
- [ ] `ComponentSwapStrategy.should_swap()` 基于 A/B 测试决定是否切换组件
- [ ] `VersionedComponentStore` 能保存和检索组件版本快照
- [ ] `RollbackMechanism.rollback_to_version()` 能恢复到指定版本
- [ ] 进化信号可触发组件热替换或参数更新

---

## 四、任务三：补齐 langgraph 缺失能力

### 4.1 问题描述

根据重构方案，`langgraph/` 已实现基础框架，但相比 legacy Coordinator 缺少以下能力：

1. **低置信度保守模式**：当感知置信度 < 0.5 时，动态降低 temperature
2. **记忆更新节点**：替代 fire-and-forget 的 `asyncio.create_task()`，确保可观测
3. **事件桥接完善**：SSE 细粒度事件映射、EvolutionSignalCollector 接入

### 4.2 实现范围

#### 4.2.1 低置信度保守模式（`langgraph/nodes.py`）

修改 `make_agent_node()` 工厂函数，支持动态 temperature：

```python
def make_agent_node(
    bound_llm: Any,
    system_prompt: Optional[str] = None,
    confidence_threshold: float = 0.5,
    conservative_temperature: float = 0.3,
) -> Callable[[ModuAgentState], dict]:
    """创建 agent 节点函数。

    新增功能：
    - 当感知置信度 < confidence_threshold 时，
      使用保守温度 conservative_temperature
    """
```

#### 4.2.2 记忆更新节点（`langgraph/nodes.py` 新增 `memory_update_node`）

```python
def memory_update_node(state: ModuAgentState) -> dict:
    """记忆更新节点：将对话历史写入长期记忆。

    替代 coordinator.py 中 fire-and-forget 的记忆更新，
    确保更新可观测、异常可追踪。

    流程：
    1. 从 messages 提取对话历史
    2. 调用 Store.put() 写入长期记忆
    3. 返回更新结果
    """
```

#### 4.2.3 增强事件桥接（`langgraph/adapters/event_bridge.py`）

```python
class LangGraphEventBridge:
    """增强版事件桥接器。"""

    def __init__(
        self,
        event_bus: Optional[EventBus] = None,
        evolution_collector: Optional[EvolutionSignalCollector] = None,
        trace_id: str = "",
        session_id: str = "",
        user_id: str = "",
    ) -> None:
        """初始化事件桥接器。

        新增：
        - evolution_collector: 进化信号收集器
        - 自动发布细粒度 SSE 事件
        """
```

新增 SSE 细粒度事件映射：
- `thinking` 事件：LLM 推理开始
- `tool_call_start` 事件：工具调用开始
- `tool_result` 事件：工具执行结果

#### 4.2.4 响应增强（`langgraph/nodes.py`）

修改 `response_node()` 以包含：
- 最终 AI 响应文本
- 工具执行结果摘要
- Token 使用量统计

### 4.3 验收标准

- [ ] `make_agent_node()` 支持低置信度时动态切换到保守温度
- [ ] `memory_update_node` 能将对话历史写入 Store
- [ ] `LangGraphEventBridge` 支持 SSE 细粒度事件（thinking/tool_call_start/tool_result）
- [ ] `response_node` 返回完整响应结构（response + tool_results + usage）
- [ ] `EvolutionSignalCollector` 已接入事件桥接

---

## 五、任务四：收敛双轨（Coordinator 删除）

### 5.1 前置条件

在确认以下条件全部满足后，方可删除 `coordinator.py`：

1. `langgraph/` 实现通过 `examples/single_agent.py` 验证功能对等
2. `feedback/` 和 `evolution/` 模块已实现并通过单元测试
3. `factory.py` 的 `create_agent()` 支持所有 legacy 配置
4. 双轨灰度切换（`get_runner()`）验证通过

### 5.2 删除范围

删除文件：
- `orchestration/coordinator.py`（1047 行）

修改文件：
- `langgraph/runner.py`：移除 `get_runner()` 的 legacy 分支
- `examples/single_agent.py`：移除 legacy 对比代码

### 5.3 验收标准

- [ ] `coordinator.py` 已删除
- [ ] `get_runner()` 仅返回 langgraph 版本
- [ ] `examples/single_agent.py` 仅使用 langgraph 版本
- [ ] 所有现有测试通过

---

## 六、依赖关系

```
任务一（feedback）
    ↓
    └─→ 任务二（evolution）依赖任务一的 EvolutionSignalCollector
            ↓
            └─→ 任务三（langgraph 增强）依赖 EvolutionSignalCollector
                    ↓
                    └─→ 任务四（收敛双轨）依赖任务一、二、三全部完成
```

---

## 七、关键文件清单

| 文件路径 | 内容 | 状态 |
|----------|------|------|
| `feedback/loop_controller.py` | 反馈循环控制器 | 待实现 |
| `feedback/quality_monitor.py` | 质量监控器 | 待实现 |
| `feedback/evolution_signal.py` | 进化信号收集器 | 待实现 |
| `feedback/metrics/accuracy.py` | 准确性指标 | 待实现 |
| `feedback/metrics/efficiency.py` | 效率指标 | 待实现 |
| `evolution/strategy/parameter_tune.py` | 参数调优策略 | 待实现 |
| `evolution/strategy/component_swap.py` | 组件热替换策略 | 待实现 |
| `evolution/registry/versioned_store.py` | 版本化存储 | 待实现 |
| `evolution/registry/rollback_mechanism.py` | 回滚机制 | 待实现 |
| `langgraph/nodes.py` | 增强感知节点/记忆更新节点 | 待修改 |
| `langgraph/adapters/event_bridge.py` | 增强事件桥接 | 待修改 |
| `langgraph/runner.py` | 移除 legacy 分支 | 待修改 |
| `orchestration/coordinator.py` | 上帝类 | 待删除 |
