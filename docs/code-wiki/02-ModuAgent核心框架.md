# ModuAgent 核心框架

ModuAgent 是 Pioneering 项目的核心 AI Agent 框架，位于 [apps/backend/ModuAgent](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent)。

## 目录结构

```
ModuAgent/
├── components/              # 组件实现
│   ├── action/             # 行动层（工具、执行器）
│   ├── memory/             # 记忆层（缓存、向量存储）
│   ├── perception/         # 感知层（文本/图像/音频/安全/融合）
│   └── reasoning/          # 推理层（LLM适配、符号推理）
├── config/                 # 配置管理
├── core/                   # 核心抽象
│   ├── interfaces/         # 组件接口协议
│   └── registry.py         # 组件注册中心
├── evolution/              # 进化机制
│   ├── registry/           # 版本存储、回滚
│   └── strategy/           # 进化策略（组件替换、参数调优）
├── feedback/               # 反馈闭环
│   └── metrics/            # 评估指标
├── modu_graph/             # LangGraph 编排层
│   ├── adapters/           # LLM/工具/存储/事件适配
│   └── subgraph/           # 多Agent子图
├── observability/          # 可观测性（日志/指标/追踪）
├── orchestration/          # 多Agent协作
│   ├── communication/      # 消息总线、协议、流式
│   └── patterns/           # 协作模式（共识、委派）
├── examples/               # 示例代码
└── tests/                  # 测试套件
```

## 核心接口 (core/interfaces/)

所有组件必须实现对应的抽象基类（ABC），确保可插拔性。

### 感知接口

[perception.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/interfaces/perception.py)

```python
class BasePerception(ABC):
    @abstractmethod
    def perceive(
        self,
        input_type: str,           # 输入类型：text/image/audio
        raw_content: bytes,        # 原始内容
        language: Optional[str],   # 语言提示
        sensitivity_level: int,    # 敏感度级别
    ) -> Dict[str, Any]:
        """处理输入，返回感知结果"""
        pass

class BaseSensor(ABC):
    @abstractmethod
    def sensor_type(self) -> str: ...
    
    @abstractmethod
    def capture(self, context: Dict[str, Any]) -> bytes:
        """从环境捕获数据"""
        pass
```

### 推理接口

[reasoning.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/interfaces/reasoning.py)

```python
class BaseReasoningEngine(ABC):
    @abstractmethod
    def reason(
        self,
        prompt: str,
        context: Dict[str, Any],
        **kwargs,
    ) -> Tuple[str, Dict[str, int], List[Dict[str, Any]]]:
        """
        执行推理
        返回: (content, usage, tool_calls)
          - content: 响应文本
          - usage: token用量 {prompt_tokens, completion_tokens, total_tokens}
          - tool_calls: 工具调用列表 [{"tool", "parameters"}, ...]
        """
        pass

    @abstractmethod
    def stream(self, prompt: str, context: Dict[str, Any]) -> Generator[str, None, None]:
        """流式输出"""
        pass

class BaseReasoningStrategy(ABC):
    @abstractmethod
    def name(self) -> str: ...
    
    @abstractmethod
    def select_engine(self, context: Dict[str, Any]) -> BaseReasoningEngine:
        """根据上下文选择推理引擎"""
        pass
    
    @abstractmethod
    def should_fallback(self, error: Optional[Exception]) -> bool:
        """判断是否需要降级"""
        pass
```

### 行动接口

[action.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/interfaces/action.py)

```python
class BaseActionExecutor(ABC):
    @abstractmethod
    def execute(
        self,
        action_name: str,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """执行动作"""
        pass

    @abstractmethod
    def list_actions(self) -> List[str]: ...

class BaseTool(ABC):
    @abstractmethod
    def name(self) -> str: ...
    
    @abstractmethod
    def description(self) -> str: ...
    
    @abstractmethod
    def parameters_schema(self) -> Dict:
        """JSON Schema 格式的参数定义"""
        pass
    
    @abstractmethod
    def invoke(self, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """执行工具"""
        pass
    
    # HITL 支持
    def requires_approval(self) -> bool:
        """是否需要人工审批（敏感工具覆写）"""
        return False
    
    def on_approval_rejected(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """审批拒绝时的降级响应"""
        return {"status": "error", "error_code": "TOOL_APPROVAL_REJECTED", ...}
```

### 记忆接口

[memory.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/interfaces/memory.py)

```python
class BaseMemory(ABC):
    @abstractmethod
    def query(
        self,
        user_id: str,
        context_window: str,
        required_fields: List[str],
    ) -> Dict[str, Any]:
        """查询记忆"""
        pass

    @abstractmethod
    def update(
        self,
        user_id: str,
        new_data: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> bool:
        """更新记忆"""
        pass

class BaseStorageAdapter(ABC):
    @abstractmethod
    def adapter_type(self) -> str: ...
    
    @abstractmethod
    def load(self, key: str) -> Optional[Dict[str, Any]]: ...
    
    @abstractmethod
    def save(self, key: str, data: Dict[str, Any]) -> bool: ...
```

### 反馈接口

[feedback.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/interfaces/feedback.py)

```python
class BaseFeedbackLoop(ABC):
    @abstractmethod
    def evaluate(self, output: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """评估输出质量"""
        pass

    @abstractmethod
    def should_evolve(self, metrics: Dict[str, float], threshold: float) -> bool:
        """判断是否触发进化"""
        pass

class BaseEvolutionSignal(ABC):
    @abstractmethod
    def signal_type(self) -> str: ...
    
    @abstractmethod
    def generate(
        self,
        source: str,
        metrics: Dict[str, float],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """生成进化信号"""
        pass
```

## 组件注册中心 (core/registry.py)

[ComponentRegistry](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/registry.py#L16-L197) 是全局组件管理单例，负责所有组件的注册、查找和替换。

### 关键方法

| 方法 | 说明 |
|------|------|
| `register_reasoning_engine(name, engine)` | 注册推理引擎 |
| `set_active_reasoning_engine(name)` | 切换活跃推理引擎（P2-8） |
| `get_active_reasoning_engine()` | 获取当前活跃引擎 |
| `register_tool(tool)` | 注册工具（以 tool.name() 为 key） |
| `list_tools()` | 列出所有工具及其 schema |
| `register_perception(name, perception)` | 注册感知器 |
| `register_memory(name, memory)` | 注册记忆组件 |
| `swap_component(category, name, component)` | 运行时替换组件（进化用） |
| `list_all()` | 列出所有已注册组件 |

### 全局单例函数

```python
# 获取全局注册表
registry = get_registry()

# 测试用：临时替换注册表
with override_registry(test_registry):
    # 测试代码
    pass

# 重置注册表（测试清理）
reset_registry()
```

## 编排层 (modu_graph/)

### 图状态 (state.py)

[ModuAgentState](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/state.py#L47-L155) 是 TypedDict，定义了 LangGraph 图中流转的完整状态。

**核心字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages` | `Annotated[List[BaseMessage], add_messages]` | 消息历史（自动追加） |
| `user_id` / `session_id` / `trace_id` | `str` | 会话标识 |
| `input_data` | `Dict` | 原始输入 |
| `perception_result` | `Dict` | 感知融合结果 |
| `cleaned_text` | `str` | 清洗后文本 |
| `sensitivity_level` | `int` | 敏感度 (0-5) |
| `knowledge` | `List[Dict]` | 长期记忆检索结果 |
| `tool_results` | `List[Dict]` | 工具执行结果 |
| `response` | `str` | 最终响应 |
| `usage` | `Dict[str, int]` | Token 用量 |
| `evaluation` | `Dict` | 反馈评估结果 |
| `config_overrides` | `Dict` | 进化产生的配置覆盖 |
| `pending_tool_calls` | `List[Dict]` | HITL 待审批工具 |
| `subtasks` / `subtask_results` | `List/Dict` | 多Agent子任务 |

**辅助函数：**
- `make_initial_state()`: 构建初始状态
- `merge_subtask_results()`: 子任务结果合并 reducer

### 图节点 (nodes.py)

| 节点函数 | 创建方式 | 说明 |
|----------|----------|------|
| `perception_node` | 内置 | 异步感知管线（并行感知器） |
| `memory_query_node` | `make_memory_query_node(store)` | 长期记忆检索 |
| `make_agent_node(llm)` | 工厂 | LLM 推理 + Function Calling |
| `tools` | LangGraph ToolNode | 工具执行 |
| `tool_processor` | `make_tool_result_processor()` | 工具结果后处理 |
| `response_node` | 内置 | 生成最终响应 |
| `feedback_node` | `make_feedback_node(orchestrator)` | 质量评估与进化信号 |
| `memory_update_node` | `make_memory_update_node(store)` | 写入长期记忆 |
| `human_review_node` | `make_human_review_node()` | HITL 人工审批（P3-12.3.2） |
| `supervisor_node` | `make_supervisor_node()` | 多Agent任务拆分（P3-12.3.1） |
| `subagent_node` | `make_subagent_node(llm)` | 子Agent执行 |
| `consensus_node` | `make_consensus_node(judge_llm)` | 多Agent结果共识 |

**路由函数：**
- `route_after_perception`: 感知后路由（熔断→response / 正常→memory_query）
- `route_after_agent`: Agent后路由（有tool_calls→tools / 无→response）
- `route_after_human_review`: 审批后路由（通过→tools / 拒绝→response）
- `route_after_memory_query`: 记忆后路由（单Agent→agent / 多Agent→supervisor）
- `route_from_supervisor`: Supervisor分发（Send到subagent_run）

### 工厂类 (factory.py)

[create_agent()](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/factory.py#L154-L287) 是配置化创建 Agent 图的主入口。

```python
from modu_graph.factory import create_agent

# 默认配置
graph = create_agent()

# 运行时覆盖配置
graph = create_agent(config={
    "configurable": {
        "llm_provider": "deepseek",
        "temperature": 0.5,
        "tools": ["calculator", "search"],
        "checkpointer_type": "memory",
        "store_type": "chroma",
        "system_prompt": "你是一个助手..."
    }
})
```

**组件构建函数：**
- `build_checkpointer(type)`: 构建检查点（memory/sqlite/none）
- `build_store(type)`: 构建长期存储（chroma/in_memory/none）
- `build_chat_model(provider, config, ...)`: 构建LLM
- `build_langchain_tools(tool_names, config)`: 构建LangChain工具列表

### 运行器 (runner.py)

[runner.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/runner.py) 提供流式/非流式执行入口。

| 函数 | 说明 |
|------|------|
| `stream_response(graph, user_id, session_id, input_data)` | 异步流式输出（token级） |
| `run_sync(graph, user_id, session_id, input_data)` | 非流式，返回完整结果 |
| `get_runner(engine)` | 获取缓存的编译图（配置变更自动重建） |
| `resume_sync(graph, session_id, approved, feedback)` | 恢复HITL中断的执行 |
| `resume_stream(...)` | 恢复执行（流式） |
| `get_interrupt_state(graph, session_id)` | 查询当前是否在HITL暂停状态 |

**Runner 缓存机制（P1-12.2.6）：**
- 编译图实例缓存，避免每次请求重建
- 配置哈希检测，变更时自动失效
- 配置变更回调主动传导（llm.*/tools.*/memory.*变更即时失效）

### 图构建 (graph.py)

[build_modu_graph()](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/graph.py#L89-L318) 负责构建 StateGraph 拓扑。

[ModuGraph](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/graph.py#L53-L86) 是 CompiledStateGraph 的包装类：
- 透明委托底层编译图的所有方法（`__getattr__`）
- 显式持有 `orchestrator` 引用（替代monkey-patch）
- 提供 `.compiled` 属性访问底层实例

## 感知层 (components/perception/)

### 管线处理

[pipeline.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/components/perception/pipeline.py) 提供统一感知管线：

1. **输入路由**：根据 `input_type` 从配置获取感知器链
2. **串行/并行执行**：`run_perception_pipeline`（串行） / `run_perception_pipeline_async`（并行，P2-12.2.4）
3. **结果融合**：多路感知结果通过 PerceptionFusion 融合

```python
# 感知管线配置（默认）
perception:
  routing:
    text: { pipeline: ["text_preprocessor", "llm_parser"] }
    image: { pipeline: ["image_processor", "text_preprocessor"] }
    audio: { pipeline: ["audio_processor", "text_preprocessor"] }
  fusion:
    strategy: weighted_average
    weights: { text: 0.5, image: 0.3, audio: 0.2 }
```

### 内置感知器

| 感知器 | 路径 | 功能 |
|--------|------|------|
| TextPreprocessor | text/rule_based.py | 文本清洗、长度截断、基础检测 |
| LLMParser | text/llm_parser.py | LLM深度解析（意图、情感、NER） |
| ImageProcessor | vision/image_processor.py | 图像理解 |
| Camera | vision/camera.py | 摄像头捕获 |
| ASRProcessor | audio/asr_processor.py | 语音识别 |
| Guard | security/guard.py | 安全检测（注入/PII/敏感词） |

### 融合策略 (fusion.py)

PerceptionFusion 支持三种融合策略：
- `weighted_average`: 加权平均置信度
- `max_confidence`: 取最高置信度结果
- `voting`: 投票机制

## 推理层 (components/reasoning/)

### LLM 适配器

所有LLM适配器继承自 [base_llm.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/components/reasoning/llm/base_llm.py) 的 BaseLLMReasoner。

| 适配器 | 文件 | 提供商 |
|--------|------|--------|
| DeepSeek | deepseek.py | DeepSeek API |
| GPT | gpt.py | OpenAI GPT |
| Qwen | qwen.py | 通义千问 |
| GLM | glm.py | 智谱GLM |

LLM统一通过 modu_graph/adapters/llm_adapter.py 的 build_chat_model() 构建。

### 重试机制 (adapters/retry.py)

apply_llm_retry() 为LLM调用添加指数退避重试：
- 仅重试瞬时网络异常（不重试4xx/格式错误）
- 配置：`llm.retry.max_attempts`（默认2次）

## 行动层 (components/action/)

### 内置工具

| 工具 | 文件 | 功能 | 需审批 |
|------|------|------|--------|
| CalculatorTool | tools/calculator.py | 数学计算 | 否 |
| CodeExecutor | tools/code_executor.py | 代码执行 | 是 |
| DatetimeTool | tools/datetime_tool.py | 日期时间查询 | 否 |
| FileOpsTool | tools/file_ops.py | 文件读写操作 | 是（写操作） |
| HttpRequestTool | tools/http_request.py | HTTP请求 | 否 |
| SearchTool | tools/search.py | 网络搜索 | 否 |
| SqlQueryTool | tools/sql_query.py | SQL查询 | 是 |

### 执行器

- SyncActionExecutor (executors/synchronous.py): 同步执行器

## 记忆层 (components/memory/)

| 组件 | 文件 | 说明 |
|------|------|------|
| InMemoryShortTermMemory | cache/short_term_memory.py | 内存短期缓存 |
| ChromaLongTermMemory | vector/chroma.py | ChromaDB向量存储 |

**注意**：LangGraph重构后，短期记忆主要由 Checkpointer 管理（MemorySaver/SqliteSaver），长期记忆由 BaseStore 包装（ChromaStore/InMemoryStoreAdapter）。

## 反馈进化闭环

### 流程

```
response生成
    │
    ▼
feedback_node（图中节点）
    │
    ├─→ FeedbackLoop.evaluate()
    │       ├─→ QualityMonitor.evaluate()
    │       │    ├─ rule模式：规则评估
    │       │    ├─ llm模式：LLM-as-Judge
    │       │    └─ hybrid模式：规则+LLM
    │       └─→ EvolutionSignalCollector.collect()
    │
    └─→ should_evolve?
            ├─ Yes → EvolutionOrchestrator
            │       ├─→ ParameterTuneStrategy.analyze_and_adjust()
            │       │       生成 config_overrides，写入State
            │       └─→ 下次请求时应用新参数
            └─ No → 结束
```

### 质量监控模式

| 模式 | 说明 |
|------|------|
| `rule` | 规则评估（默认，无需额外LLM） |
| `llm` | 使用独立LLM作为评判（temperature=0） |
| `hybrid` | 规则初筛 + LLM复核 |

### 进化策略

- **ParameterTuneStrategy**: 参数调优（temperature、max_tokens等）
- **ComponentSwapStrategy**: 组件替换（切换LLM提供商/版本）
- **RollbackMechanism**: 版本回滚（质量持续下降时回退到上一稳定版本）
- **VersionedComponentStore**: 版本化组件存储，支持多版本并行

## 可观测性 (observability/)

| 模块 | 文件 | 功能 |
|------|------|------|
| LoggingConfig | logging_config.py | 结构化日志配置 |
| MetricsRegistry | metrics.py | Prometheus指标（请求计数、延迟、错误率） |
| Tracing | tracing.py | OpenTelemetry分布式追踪 |
| TraceContext | trace_context.py | trace_id传播 |
| Exporters | exporters.py | OTLP导出器 |

**Span埋点**：通过 `_span()` 上下文管理器统一埋点，Tracing启用时创建OTel span，未启用时退化为日志计时。

## 多Agent协作 (orchestration/)

### 消息总线

MessageBus 提供发布/订阅事件通信：
- AgentEvent: 标准化事件（AgentDomain/EventAction）
- 支持同步/异步事件处理
- 事件日志持久化

### AG-UI协议

[agui_adapter.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/orchestration/communication/agui_adapter.py) 实现 AG-UI 流式协议转换：
- 将 LangGraph stream 事件转换为前端标准事件
- 事件类型：THINKING_START/END、TEXT_MESSAGE_CONTENT/END、TOOL_CALL_START/RESULT、RUN_ERROR等
- 收集完整响应文本和工具调用记录

### 协作模式

- **Consensus**: 共识模式（多数投票 majority_vote / 加权 weighted / LLM裁决 llm_judge）
- **Delegation**: 委派模式（Supervisor拆分任务给Subagent）
