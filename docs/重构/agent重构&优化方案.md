# ModuAgent → LangGraph 重构方案

## 一、当前架构核心剖析

### 1.1 分层结构

ModuAgent 是一个**强模块化的自研 Agent 框架**，由 5 大层 + 3 大横切关注点组成：

| 层 | 职责 | 关键文件 |
|---|---|---|
| **感知层 Perception** | 输入路由、文本清洗、敏感词分级、安全检测、多模态融合 | `components/perception/text/rule_based.py`、`components/perception/fusion.py` |
| **推理层 Reasoning** | LLM 调用（GLM/GPT/DeepSeek/Qwen）、原生 function calling、流式输出 | `components/reasoning/llm/base_llm.py` |
| **记忆层 Memory** | 短期（InMemory/Redis）+ 长期（Chroma 向量） | `components/memory/cache/redis_adapter.py`、`components/memory/vector/chroma.py` |
| **行动层 Action** | 工具（calculator/search/api_client）+ 执行器（sync/async） | `components/action/tools/calculator.py` |
| **反馈/进化层** | 质量监控、进化信号收集、组件热替换、参数调优、版本回滚 | `feedback/evolution_signal.py`, `feedback/loop_controller.py`, `feedback/quality_monitor.py`, `feedback/metrics/accuracy.py`, `feedback/metrics/efficiency.py`, `evolution/strategy/parameter_tune.py`, `evolution/strategy/component_swap.py`, `evolution/registry/versioned_store.py`, `evolution/registry/rollback_mechanism.py` |

### 1.2 核心编排器 Coordinator（重构重点）

`orchestration/coordinator.py` 是 **1047 行的"上帝类"**，承担了过多职责：

```
process_request() / stream_request() 主流程：
  1. _run_perception_pipeline()   → 输入路由 + 感知器链 + 融合
  2. 敏感度熔断 / 注入检测熔断      → 提前返回
  3. _storage_adapter.query_all()  → 短期 + 长期记忆查询
  4. _build_native_tools()         → OpenAI function calling 格式
  5. _llm_adapter.generate()      → LLM 首轮生成
  6. ReAct 循环（max_iterations）：
     - _parse_tool_calls_with_errors() → 正则解析 ```tool_call``` 块
     - _tool_adapter.invoke_tool()      → 执行工具（带超时，每次新建 ThreadPoolExecutor）
     - 格式错误自纠正（max_format_retries）
     - continuation_prompt 再生成
  7. SSE 流式输出（token 分块 / stream_request() 含模拟分块逻辑）
  8. _storage_adapter.update_all() → 记忆持久化（fire-and-forget，异常静默丢失）
  9. EventBus 发布事件（perception/memory/reasoning/tool/action）
 10. Sensor 生命周期管理（start_sensors/stop_sensors）
```

### 1.3 关键设计模式

- **Registry 模式**：`core/registry.py` 全局单例，支持运行时 `swap_component()` 热替换
- **Adapter 模式**：`LLMAdapter`/`ToolAdapter`/`StorageAdapter` 隔离具体实现
- **Pub/Sub**：`orchestration/communication/message_bus.py` 的 `EventBus` + `AgentEvent`
- **手动 ReAct**：正则 `r"\`\`\`tool_call\s*\n(.*?)\n\`\`\`"` 解析工具调用，带格式重试
- **AG-UI 适配**：`orchestration/communication/agui_adapter.py` 将内部 SSE 转为 AG-UI 协议

### 1.4 现有痛点（重构动机）

1. **Coordinator 过度膨胀**：1047 行，感知/记忆/推理/工具/流式/事件全耦合，难以测试与扩展
2. **手写 ReAct 循环**：正则解析脆弱，格式重试逻辑复杂，与 LangGraph 成熟的 `ToolNode` + `create_react_agent` 重复造轮
3. **状态管理隐式**：`context` dict 在节点间传递，无类型约束、无持久化检查点
4. **流式实现冗长**：`stream_request()` 与 `process_request()` 逻辑大量重复（约 400 行重复代码）
5. **记忆抽象与 LangGraph 重复**：`BaseMemory`/`StorageAdapter` 可被 `BaseCheckpointSaver` + `BaseStore` 替代
6. **事件系统与 LangGraph stream 重复**：`EventBus` + `SSEEncoder` 可被 LangGraph `astream_events` 替代

---

## 二、ModuAgent → LangGraph 概念映射

| ModuAgent 自研概念 | LangGraph 对应 | 说明 |
|---|---|---|
| `Coordinator.process_request` 主流程 | `StateGraph` + 节点 + 边 | 图结构显式化编排 |
| 手写 ReAct 循环 | `create_react_agent` 或 `ToolNode` + 条件边 | 内置工具调用循环 |
| 正则解析 `` ```tool_call``` `` | LangChain `ToolCall` / `bind_tools` | 原生 function calling |
| `context: Dict` 隐式状态 | `TypedDict` State + `StateGraph` | 类型安全 + 检查点 |
| `StorageAdapter`（短期） | `BaseCheckpointSaver`（Memory/Sqlite/Postgres） | 线程级状态持久化 |
| `StorageAdapter`（长期 Chroma） | `BaseStore` + `InMemoryStore`/自定义 ChromaStore | 跨线程长期记忆 |
| `EventBus` + `AgentEvent` | `astream_events` / `astream(stream_mode=...)` | 内置事件流 |
| `SSEEncoder` | LangGraph stream modes（values/updates/messages/custom） | 标准化流式 |
| `LLMAdapter` + `BaseReasoningEngine` | `BaseChatModel`（ChatOpenAI/ChatZhipuAI） | 统一 LLM 抽象 |
| `ToolAdapter` + `BaseTool` | `@tool` 装饰器 / `BaseTool` | LangChain 工具生态 |
| `PerceptionFusion` | 并行节点 / Subgraph | 多模态融合 |
| `ComponentRegistry.swap_component` | `RunnableConfig` + `configurable` | 运行时配置化 |
| `AGUIStreamAdapter` | LangGraph stream → AG-UI 转换器（保留） | 协议适配层保留 |
| `EvolutionSignalCollector` | `astream_events` 订阅 + 回调 | 信号收集器作为 stream 消费者 |

---

## 三、详细重构步骤（分 6 个阶段）

### 阶段 0：准备与依赖对齐

**目标**：引入 LangGraph 依赖，建立双轨运行能力，不破坏现有代码。

**步骤**：

1. 在 `pyproject.toml` 中确认依赖（已包含，无需修改）：

```toml
dependencies = [
    "httpx>=0.28.0",
    "chromadb>=0.5.0",
    "langgraph>=0.2.0",
    "langchain-core>=0.3.0",
    "langchain-openai>=0.2.0",
    "langchain-community>=0.3.0",
]
```

2. 新建 `langgraph/` 目录存放重构产物，与原 `orchestration/` 并存，便于灰度切换：

```
ModuAgent/
├── langgraph/              # 新增：重构代码
│   ├── __init__.py
│   ├── state.py            # 类型化 State
│   ├── nodes.py            # 图节点
│   ├── graph.py            # StateGraph 构建
│   ├── runner.py           # 运行入口（流式/非流式）
│   └── adapters/           # 适配器
│       ├── tool_adapter.py
│       ├── llm_adapter.py
│       └── store_adapter.py
├── orchestration/          # 保留：原有代码（灰度期双轨运行）
│   ├── coordinator.py
│   └── ...
├── components/             # 保留：组件实现不动
│   └── ...
```

3. 编写 `langgraph/__init__.py`（包初始化与聚合导出，28 行），确保 import 不冲突。

---

### 阶段 1：定义类型化 State（替换隐式 context dict）

**目标**：用 `TypedDict` 显式声明图状态，替代 `coordinator.py` 中四处传递的 `context: Dict[str, Any]`。

**步骤**：

1. 新建 `langgraph/state.py`：

```python
from typing import TypedDict, Annotated, List, Dict, Any, Optional
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class ModuAgentState(TypedDict, total=False):
    # 消息历史（LangGraph 内置 reducer，自动追加）
    messages: Annotated[List[BaseMessage], add_messages]

    # 会话标识
    user_id: str
    session_id: str
    trace_id: str

    # 原始输入
    input_data: Dict[str, Any]

    # 感知结果
    perception_result: Optional[Dict[str, Any]]
    cleaned_text: Optional[str]
    detected_language: Optional[str]
    sensitivity_level: int
    confidence: float
    injection_detected: bool

    # 记忆
    history: List[Dict[str, Any]]
    knowledge: List[Dict[str, Any]]

    # 工具
    tool_results: List[Dict[str, Any]]

    # 迭代控制
    iteration: int

    # 最终响应
    response: str
    error_code: str
    error_message: str
    usage: Dict[str, int]
```

**关键映射**：
- 原 `context["history"]` → `State.history`（由 Checkpointer 自动管理）
- 原 `context["perception"]` → `State.perception_result` / `cleaned_text`
- 原 `context["knowledge"]` → `State.knowledge`（由 Store.search 填充）
- 原 `context["native_tools"]` / `context["tool_descriptions"]` → 由 LangGraph `bind_tools()` 接管
- 原 `context["tool_results"]` → `State.tool_results`
- 新增 `input_data` / `detected_language` / `injection_detected` / `error_code` / `error_message` / `usage`
全部 State 字段获得类型检查与检查点持久化。

---

### 阶段 2：将组件适配为 LangChain 原生类型

**目标**：让现有 `BaseTool`/`BaseReasoningEngine`/`BaseMemory` 实现可被 LangGraph 直接消费，**保留原接口**以支持双轨运行。

#### 2.1 工具适配（BaseTool → langchain BaseTool）

现有 `components/action/tools/calculator.py` 的 `CalculatorTool` 已有 `name()`/`description()`/`parameters_schema()`/`invoke()`，与 LangChain `BaseTool` 高度同构。

**步骤**：新建 `langgraph/adapters/tool_adapter.py`：

```python
from langchain_core.tools import BaseTool as LCTool, StructuredTool
from core.registry import get_registry


def wrap_modu_tool(modu_tool) -> LCTool:
    """将 ModuAgent BaseTool 包装为 LangChain StructuredTool。"""
    return StructuredTool.from_function(
        func=lambda **kwargs: modu_tool.invoke(params=kwargs, context={}),
        name=modu_tool.name(),
        description=modu_tool.description(),
        args_schema=modu_tool.parameters_schema(),  # 复用现有 JSON Schema
    )


def build_langchain_tools(
    registry: ComponentRegistry | None = None,
    tool_names: list[str] | None = None,
) -> list[LCTool]:
    """从注册表构建 LangChain 工具列表。
    registry: 组件注册表（默认使用全局单例）
    tool_names: 指定工具名列表（None=全部工具）
    """
    if registry is None:
        registry = get_registry()
    all_tools = registry.list_tools()
    if tool_names:
        all_tools = {k: v for k, v in all_tools.items() if k in tool_names}
    return [wrap_modu_tool(registry.get_tool(name)) for name in all_tools]
```

**收益**：复用现有 `search.py`、`calculator.py`，无需重写工具逻辑；`ToolAdapter` 的超时/校验逻辑由 LangGraph `ToolNode` 接管。

#### 2.2 LLM 适配（BaseReasoningEngine → BaseChatModel）

现有 `components/reasoning/llm/base_llm.py` 用 `httpx` 直连 OpenAI 兼容 API。LangChain 的 `ChatOpenAI` 可直接对接 GLM/DeepSeek/Qwen（均兼容 OpenAI 协议）。

**步骤**：新建 `langgraph/adapters/llm_adapter.py`：

```python
from langchain_openai import ChatOpenAI
from config.runtime_config import get_config

# 环境变量映射表
_PROVIDER_CONFIG = {
    "glm": {
        "api_key": "MODU_GLM_API_KEY",
        "base_url": "MODU_GLM_BASE_URL",
        "model": "MODU_GLM_MODEL",
        "default_base_url": "https://open.bigmodel.cn/api/paas/v4",
        "default_model": "glm-4-flash",
    },
    "deepseek": {
        "api_key": "MODU_DEEPSEEK_API_KEY",
        "base_url": "MODU_DEEPSEEK_BASE_URL",
        "model": "MODU_DEEPSEEK_MODEL",
        "default_base_url": "https://api.deepseek.com",
        "default_model": "deepseek-chat",
    },
    "gpt": {
        "api_key": "OPENAI_API_KEY",
        "base_url": "OPENAI_BASE_URL",
        "model": "OPENAI_MODEL",
        "default_base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
    },
    "qwen": {
        "api_key": "MODU_QWEN_API_KEY",
        "base_url": "MODU_QWEN_BASE_URL",
        "model": "MODU_QWEN_MODEL",
        "default_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-plus",
    },
}


def build_chat_model(
    provider: str | None = None,
    config: RuntimeConfig | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> ChatOpenAI:
    """构建 LangChain ChatOpenAI 实例，复用现有环境变量约定。
    
    参数优先级：显式参数 > 环境变量 > 配置文件 > 默认值。
    """
    import os

    if config is None:
        config = get_config()
    provider = provider or config.get("llm.default_provider", "glm")
    pcfg = _PROVIDER_CONFIG.get(provider, _PROVIDER_CONFIG["glm"])

    return ChatOpenAI(
        api_key=os.getenv(pcfg["api_key"]) or os.getenv("LLM_API_KEY", ""),
        base_url=os.getenv(pcfg["base_url"]) or os.getenv("LLM_BASE_URL", pcfg["default_base_url"]),
        model=os.getenv(pcfg["model"]) or os.getenv("LLM_DEFAULT_MODEL", pcfg["default_model"]),
        temperature=temperature if temperature is not None else config.get("llm.temperature", 0.7),
        max_tokens=max_tokens if max_tokens is not None else config.get("llm.max_tokens", 512),
        streaming=True,  # 原生支持流式，替代手写 stream()
    )
```

**收益**：`bind_tools()` 原生 function calling 替代正则解析 `` ```tool_call``` ``；`stream()` 由 LangChain 统一处理，删除 `base_llm.py` 的手写 SSE 解析。

#### 2.3 记忆适配（StorageAdapter → Checkpointer + Store）

**短期记忆** → `MemorySaver` / `SqliteSaver` / `PostgresSaver`：
- 替代 `components/memory/cache/redis_adapter.py` 的 `InMemoryShortTermMemory`
- LangGraph 自动按 `thread_id`（= session_id）持久化整个 State，无需手写 `query`/`update`

**长期记忆** → `BaseStore`：
- 现有 `components/memory/vector/chroma.py` 的 `ChromaLongTermMemory` 包装为 LangGraph `BaseStore`

```python
# langgraph/adapters/store_adapter.py
from langgraph.store.base import BaseStore, Item
from langchain_community.vectorstores import Chroma


class ChromaStore(BaseStore):
    """复用现有 ChromaLongTermMemory 的 _embed_texts / collection 逻辑。"""
    # 实现 get/put/search/mdelete，内部委托给 ChromaLongTermMemory
```

**收益**：删除 `adapters/storage_adapter.py` 中 `query_all`/`update_all`/`_build_vectorization_text` 等胶水代码（约 250 行）。

---

### 阶段 3：构建 StateGraph（替换 Coordinator 主流程）

**目标**：将 `coordinator.py` 的 `process_request` 拆解为图节点，用 LangGraph 编排。

#### 3.1 节点定义

将 Coordinator 的内联逻辑提取为独立节点函数：

```python
# langgraph/nodes.py
import json
import logging
from typing import Any, Dict, Optional

from langgraph.types import Command
from components.perception.fusion import PerceptionFusion
from components.perception.text.rule_based import TextPreprocessor
from config.runtime_config import get_config
from core.registry import get_registry

logger = logging.getLogger(__name__)


def perception_node(state: ModuAgentState) -> dict:
    """对应 _run_perception_pipeline + 敏感度熔断。

    复用现有 PerceptionFusion + TextPreprocessor 的业务逻辑。
    """
    config = get_config()
    registry = get_registry()
    input_data = {
        "input_type": "text",
        "prompt": state.get("cleaned_text", ""),
    }

    # 输入路由 + 感知器链（复用 _run_perception_pipeline 逻辑）
    input_type = input_data.get("input_type", "text")
    raw_content = input_data.get("prompt", "").encode("utf-8")
    routing = config.get("perception.routing", {})
    pipeline = routing.get(input_type, {}).get("pipeline", ["text_preprocessor"])

    results = []
    current_content = raw_content
    current_input_type = input_type

    for processor_name in pipeline:
        perception = registry.get_perception(processor_name)
        if perception is None:
            continue
        try:
            result = perception.perceive(
                input_type=current_input_type,
                raw_content=current_content,
                sensitivity_level=0,
            )
            results.append(result)
            parsed = result.get("parsed_content", {})
            if parsed.get("text") and parsed.get("input_type") == "text":
                current_content = parsed["text"].encode("utf-8")
                current_input_type = "text"
        except Exception as e:
            logger.error("Perception '%s' failed: %s", processor_name, str(e))

    if not results:
        return {
            "perception_result": None,
            "cleaned_text": input_data.get("prompt", ""),
            "sensitivity_level": 0,
            "confidence": 1.0,
        }

    # 多路融合
    fusion = PerceptionFusion(
        strategy=config.get("perception.fusion.strategy", "weighted_average"),
        weights=config.get("perception.fusion.weights"),
    )
    fused = fusion.fuse(results) if len(results) > 1 else results[0]

    cleaned_text = None
    if fused and fused.get("parsed_content"):
        cleaned_text = fused["parsed_content"].get("text")

    detected_level = fused.get("metadata", {}).get("sensitivity_level", 0)
    confidence = fused.get("confidence", 1.0)

    return {
        "perception_result": fused,
        "cleaned_text": cleaned_text or input_data.get("prompt", ""),
        "sensitivity_level": detected_level,
        "confidence": confidence,
    }


def memory_query_node(state: ModuAgentState) -> dict:
    """对应 _storage_adapter.query_all。

    从 Checkpointer 取历史（自动），从 Store 取长期知识。
    """
    # 短期历史由 LangGraph Checkpointer 通过 thread_id 自动管理
    # 长期知识查询通过 Store.search()

    config = get_config()
    user_id = state["user_id"]

    # 从 Store 查询长期知识
    store = state.get("__store__")  # LangGraph 运行时注入
    knowledge = []
    if store and state.get("cleaned_text"):
        try:
            items = store.search(
                (user_id, "knowledge"),
                query=state["cleaned_text"],
            )
            knowledge = [item.value for item in items]
        except Exception as e:
            logger.warning("Store search error: %s", e)

    return {
        "knowledge": knowledge,
    }


def make_agent_node(bound_llm, system_prompt=None, confidence_threshold=0.5, conservative_temperature=0.3):
    """创建 agent 节点（闭包工厂模式）。

    使用绑定了工具的 LLM（bound_llm）进行推理，
    通过 LangChain 原生 bind_tools 实现 function calling，
    替代手写正则解析 ```tool_call``` 。

    新增功能：
    - 当感知置信度 < confidence_threshold 时，使用保守温度 conservative_temperature
    - 自动注入系统提示词、感知上下文、长期知识
    """
    def agent_node(state: ModuAgentState) -> dict:
        messages = list(state.get("messages", []))
        if not messages:
            cleaned_text = state.get("cleaned_text") or state.get("input_data", {}).get("prompt", "")
            if cleaned_text:
                messages.append(HumanMessage(content=cleaned_text))

        # 注入系统提示词、感知上下文、长期知识
        # ... 省略注入逻辑 ...

        response = bound_llm.invoke(messages)
        return {"messages": [response]}

    return agent_node


def route_after_perception(state: ModuAgentState) -> str:
    """对应 coordinator.py 中的敏感度熔断逻辑。
    
    注意：熔断时路由到 "response" 节点（非直接 END），
    由 response_node 统一构建错误响应。
    """
    config = get_config()

    # 敏感度熔断
    sensitivity_threshold = config.get("perception.sensitivity_threshold", 5)
    if state["sensitivity_level"] >= sensitivity_threshold:
        return "__end__"  # 在图中映射为 "response" 节点

    # 注入检测熔断
    security_config = config.get("perception.security", {})
    if security_config.get("block_on_injection"):
        if state.get("perception_result", {}).get("metadata", {}).get("injection_detected"):
            return "__end__"

    return "memory_query"


def route_after_agent(state: ModuAgentState) -> str:
    """对应 ReAct 循环退出判断。

    检查最后一条消息是否包含 tool_calls：
        - 有 tool_calls → "tools"（进入 tool_processor → agent ReAct 循环）
        - 无 tool_calls → "__end__"（映射到 "response" 节点）
    """
    messages = state.get("messages", [])
    if not messages:
        return "__end__"

    last_msg = messages[-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    return "__end__"


def route_after_tools(state: ModuAgentState) -> str:
    """工具执行完成后回到 agent 继续推理（ReAct 循环）。"""
    return "agent"
```

#### 3.2 图构建

```python
# langgraph/graph.py
from langgraph.graph import StateGraph, END, START
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver

from langgraph.state import ModuAgentState
from langgraph.nodes import (
    perception_node,
    memory_query_node,
    route_after_perception,
    route_after_agent,
    route_after_tools,
)


def build_modu_graph(tools, llm, checkpointer=None, store=None):
    """构建 ModuAgent LangGraph。

    Args:
        tools: LangChain BaseTool 列表
        llm: 绑定了 tools 的 ChatModel 实例
        checkpointer: 检查点保存器（None=内存）
        store: 长期记忆存储（None=跳过）

    Returns:
        编译后的 StateGraph
    """
    # 绑定工具到 LLM
    bound_llm = llm.bind_tools(tools) if tools else llm

    # 创建图
    graph = StateGraph(ModuAgentState)

    # 添加节点
    graph.add_node("perception", perception_node)

    if memory_node:
        graph.add_node("memory_query", memory_node)
    else:
        graph.add_node("memory_query", memory_query_node)

    # agent 节点：使用 make_agent_node 工厂构建
    agent_node = make_agent_node(bound_llm, system_prompt=system_prompt)
    graph.add_node("agent", agent_node)

    # 工具节点和结果处理节点
    graph.add_node("tools", ToolNode(tools) if tools else _noop_tools_node)
    graph.add_node("tool_processor", make_tool_result_processor())

    # 最终响应节点
    graph.add_node("response", response_node)

    # 添加边
    graph.add_conditional_edges(
        "perception",
        route_after_perception,
        {"memory_query": "memory_query", "__end__": "response"},
    )
    graph.add_conditional_edges(
        "agent",
        route_after_agent,
        {"tools": "tools", "__end__": "response"},
    )

    graph.add_edge(START, "perception")
    graph.add_edge("memory_query", "agent")
    graph.add_edge("tools", "tool_processor")
    graph.add_edge("tool_processor", "agent")  # ReAct 循环
    graph.add_edge("response", END)

    return graph.compile(checkpointer=checkpointer, store=store)
```

#### 3.3 条件路由逻辑对比

| 原 Coordinator 逻辑 | LangGraph 节点/边 | 说明 |
|---|---|---|
| 敏感度 >= threshold → 返回 error | `route_after_perception` → "response" | 路由到 response 节点返回错误 |
| 注入检测 → 返回 error | `route_after_perception` → "response" | 同上 |
| tool_calls 为空 → 返回 response | `route_after_agent` → "response" | 路由到 response 节点正常结束 |
| tool_calls 非空 → 执行工具 | `route_after_agent` → "tools" | 进入 ReAct 循环 |
| 工具执行完 → tool_processor → 继续推理 | `tools` → "tool_processor" → "agent" | 工具结果处理后回到 agent |
| max_iterations 到达 → 强制返回 | `recursion_limit` 配置 | LangGraph 内置限制 |

**收益**：
- 删除 `coordinator.py` 的手写 ReAct 循环（约 160 行）
- 删除 `_parse_tool_calls_with_errors`、`_build_tool_descriptions`、`_build_native_tools`（约 120 行）
- `max_iterations` 由 LangGraph `recursion_limit` 配置
- `max_format_retries` 由 LangChain 原生 function calling 消除（不再有格式错误）

---

### 阶段 4：流式输出与事件系统重构

**目标**：用 LangGraph 原生流式替代 `stream_request()` + `SSEEncoder` + `EventBus` 三件套。

#### 4.1 流式输出

现有 `coordinator.py` 的 `stream_request()`（约 400 行）与 `process_request()` 大量重复。LangGraph 提供 4 种 stream_mode：

```python
# langgraph/runner.py
import json
from typing import AsyncGenerator, Dict, Any, Optional

from langgraph.graph.graph import CompiledGraph
from langgraph.state import ModuAgentState


async def stream_response(
    graph: CompiledGraph,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
    event_bridge: Optional[LangGraphEventBridge] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """替代 Coordinator.stream_request()。

    使用 LangGraph 原生 astream 实现流式输出，
    通过 EventBridge 桥接到现有 EventBus。
    """
    initial_state = make_initial_state(
        user_id=user_id, session_id=session_id, trace_id=trace_id, input_data=input_data,
    )
    lg_config = {"configurable": {"thread_id": session_id}}

    if event_bridge is None:
        event_bridge = LangGraphEventBridge(
            trace_id=trace_id, session_id=session_id, user_id=user_id,
        )

    raw_stream = graph.astream(
        initial_state,
        config=lg_config,
        stream_mode=["messages", "updates", "values"],
    )

    async for event in event_bridge.consume(raw_stream):
        yield event


async def run_sync(
    graph: CompiledGraph,
    user_id: str,
    session_id: str,
    input_data: Dict[str, Any],
    trace_id: Optional[str] = None,
    event_bridge: Optional[LangGraphEventBridge] = None,
) -> Dict[str, Any]:
    """替代 Coordinator.process_request()。

    非流式调用，等待完整结果。返回与 Coordinator 兼容的格式。
    """
    initial_state = make_initial_state(
        user_id=user_id, session_id=session_id, trace_id=trace_id, input_data=input_data,
    )
    lg_config = {"configurable": {"thread_id": session_id}}

    if event_bridge is None:
        event_bridge = LangGraphEventBridge(
            trace_id=trace_id, session_id=session_id, user_id=user_id,
        )

    final_state = await graph.ainvoke(initial_state, config=lg_config)
    return {
        "status": "success",
        "error_code": "",
        "data": {
            "response": final_state.get("response", ""),
            "tool_results": final_state.get("tool_results", []),
            "trace_id": trace_id,
        },
    }
```

#### 4.2 事件系统桥接

现有 `EventBus` + `AgentEvent` + `PersistentEventLog` + `EvolutionSignalCollector` 可重构为 LangGraph 事件订阅者：

```python
# langgraph/adapters/event_bridge.py
from typing import Any, AsyncGenerator, Dict

from orchestration.communication.message_bus import get_event_bus
from orchestration.communication.protocol import AgentEvent, EventDomain, EventAction


class LangGraphEventBridge:
    """将 LangGraph astream_events 桥接到现有 EventBus。

    保留现有 EventBus 订阅者（PersistentEventLog、EvolutionSignalCollector）
    不受重构影响。
    """

    def __init__(self):
        self._event_bus = get_event_bus()

    async def consume(self, graph_stream: AsyncGenerator[Dict[str, Any], None]) -> AsyncGenerator[Dict[str, Any], None]:
        """消费 LangGraph stream 事件，同步发布到 EventBus。

        同时透传原始事件供上游消费（如 SSE 输出）。
        """
        async for event in graph_stream:
            agent_event = self._map_to_agent_event(event)
            if agent_event:
                await self._event_bus.publish(agent_event)
            yield event

    def _map_to_agent_event(self, event: Dict[str, Any]) -> AgentEvent | None:
        """将 LangGraph stream 事件映射为 AgentEvent。

        映射规则：
        - messages stream → REASONING.GENERATE
        - updates stream → 各 domain 事件
        """
        event_type = event.get("type", "")

        if event_type == "messages":
            return AgentEvent(
                trace_id=event.get("trace_id", ""),
                session_id=event.get("session_id", ""),
                user_id=event.get("user_id", ""),
                domain=EventDomain.REASONING,
                action=EventAction.GENERATE,
                metadata={
                    "token_count": str(len(event.get("data", ""))),
                },
            )

        if event_type == "updates":
            node = event.get("node", "")
            if node == "tools":
                return AgentEvent(
                    trace_id=event.get("trace_id", ""),
                    session_id=event.get("session_id", ""),
                    user_id=event.get("user_id", ""),
                    domain=EventDomain.TOOL,
                    action=EventAction.EXECUTE,
                    metadata=event.get("data", {}),
                )

        return None
```

**收益**：
- 删除 `stream_request()` 约 400 行重复代码
- `SSEEncoder` 的 8 个 encode 方法可由 LangGraph stream 事件直接产出
- `PersistentEventLog` 改为 `astream_events` 的订阅者，逻辑不变

#### 4.3 AG-UI 适配（保留并简化）

`orchestration/communication/agui_adapter.py` 的 `AGUIStreamAdapter` 仍需保留（AG-UI 协议适配），但输入源从 Coordinator 的自定义 SSE frame 改为 LangGraph stream 事件，**简化 transform 逻辑**：

```python
class AGUIStreamAdapter:
    """保留 AG-UI 协议适配层，仅改输入源。"""

    async def transform(self, langgraph_stream: AsyncGenerator) -> AsyncGenerator[str, None]:
        """直接消费 LangGraph 的 messages stream。

        事件映射：
        - messages stream → TEXT_MESSAGE_CONTENT
        - tool_calls → TOOL_CALL_START / TOOL_CALL_END
        - error → RUN_ERROR
        """
        async for event in langgraph_stream:
            event_type = event.get("type", "")
            if event_type == "messages":
                # 提取 token 输出 TEXT_MESSAGE_CONTENT 事件
                yield TextMessageContentEvent(delta=token).to_sse()
            elif "tool_call" in event_type:
                yield ToolCallStartEvent(...).to_sse()
            # ...
```

---

### 阶段 5：配置化与可演化性

**目标**：用 LangGraph 的 `RunnableConfig` + `configurable` 替代 `ComponentRegistry.swap_component` 的运行时热替换。

#### 5.1 配置驱动组件选择

```python
# langgraph/factory.py
from typing import Dict, Any, Optional

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph.graph import CompiledGraph

from config.runtime_config import get_config
from langgraph.adapters.llm_adapter import build_chat_model
from langgraph.adapters.tool_adapter import build_langchain_tools
from langgraph.adapters.store_adapter import ChromaStore
from langgraph.graph import build_modu_graph


def build_checkpointer(checkpointer_type: str = "memory"):
    """构建检查点保存器。

    支持类型：memory（默认）、sqlite
    """
    if checkpointer_type == "sqlite":
        return SqliteSaver.from_conn_string("checkpoints.db")
    return MemorySaver()


def build_store(store_type: str = "chroma"):
    """构建长期记忆存储。

    支持类型：chroma（默认）、in_memory
    """
    if store_type == "chroma":
        return ChromaStore()
    return None


def create_agent(
    config: Optional[RunnableConfig] = None,
    runtime_config: Optional[RuntimeConfig] = None,
    system_prompt: Optional[str] = None,
) -> CompiledGraph:
    """根据配置创建 ModuAgent LangGraph 实例。

    支持通过 config 覆盖运行时参数（如 LLM provider、temperature 等）。
    """
    if runtime_config is None:
        runtime_config = get_config()
    cfg = runtime_config

    configurable = {}
    if config and "configurable" in config:
        configurable = config["configurable"]

    # 从 config 读取 provider/temperature/max_tokens，支持运行时覆盖
    provider = configurable.get("llm_provider")
    temperature = configurable.get("temperature")
    max_tokens = configurable.get("max_tokens")

    # 构建组件
    llm = build_chat_model(provider=provider, config=cfg, temperature=temperature, max_tokens=max_tokens)
    tools = build_langchain_tools(tool_names=configurable.get("tools"))
    checkpointer = build_checkpointer(configurable.get("checkpointer_type", cfg.get("memory.checkpointer_type", "memory")))
    store = build_store(configurable.get("store_type", cfg.get("memory.store_type", "chroma")))

    # 构建并编译图
    return build_modu_graph(
        tools=tools, llm=llm, checkpointer=checkpointer, store=store,
        system_prompt=configurable.get("system_prompt", system_prompt),
    )
```

#### 5.2 进化机制

现有 `evolution/` 的 `component_swap.py`/`parameter_tune.py` 是空 stub。重构后：

| 进化操作 | 原方案 | LangGraph 方案 |
|---|---|---|
| **组件热替换** | `registry.swap_component("tool", "calculator", new_tool)` | 重新编译图：`create_agent(config={"configurable": {"tools": new_tool_list}})` |
| **参数调优** | `parameter_tune.py` | `RunnableConfig` 的 `configurable` 字段动态注入 temperature/max_tokens |
| **回滚** | `rollback_mechanism.py` | LangGraph 检查点支持 `get_state_history()` + `update_state()` 回滚到任意历史状态 |
| **多版本** | `versioned_store.py` | 多个编译图实例并行（`create_agent()` 每次返回新实例） |

---

### 阶段 6：迁移与验证

#### 6.1 灰度迁移

1. **双轨运行**：保留原 `Coordinator`，新增 `langgraph/runner.py` 作为并行入口
2. **Feature flag**：通过 `config.runtime_config` 的 `orchestration.engine` 字段切换（`legacy` / `langgraph`）

```python
# langgraph/runner.py 作为统一入口
def get_runner(engine: str = None):
    """根据配置选择运行引擎。"""
    cfg = get_config()
    engine = engine or cfg.get("orchestration.engine", "legacy")

    if engine == "langgraph":
        from langgraph.factory import create_agent
        return create_agent()
    else:
        from orchestration.coordinator import Coordinator
        return Coordinator()
```

3. **示例对齐**：将 `examples/single_agent.py` 的 5 个 demo 用 LangGraph 重写一遍，对比输出

#### 6.2 测试策略

| 测试类型 | 现有 | 重构后 |
|---|---|---|
| **单元测试** | 组件级 | 节点函数级（`perception_node`/`llm_node` 等可独立测试，无需 Coordinator） |
| **集成测试** | Coordinator 全流程（需 Mock LLM 和工具） | LangGraph 图 + 检查点（可注入 FakeLLM / FakeTool） |
| **端到端** | `examples/single_agent.py` | 双轨对比（legacy vs langgraph 输出一致性） |

节点级单元测试示例：

```python
# tests/langgraph/test_perception_node.py
def test_perception_node_normal_input():
    """测试感知节点正常输入处理。"""
    state = ModuAgentState(
        messages=[],
        user_id="test",
        session_id="test",
        trace_id="test",
        cleaned_text="你好，请帮我查询天气",
        # ... 其他字段默认值
    )
    result = perception_node(state)
    assert result["sensitivity_level"] == 0
    assert result["cleaned_text"] is not None


def test_perception_node_high_sensitivity():
    """测试感知节点高敏感度熔断。"""
    state = ModuAgentState(
        messages=[],
        user_id="test",
        session_id="test",
        trace_id="test",
        cleaned_text="我的银行卡密码是 123456",
        # ...
    )
    result = perception_node(state)
    assert result["sensitivity_level"] >= 5  # 触发熔断级别
```

#### 6.3 文件变更清单

**新增文件**：

| 文件 | 内容 | 预估行数 |
|---|---|---|
| `langgraph/__init__.py` | 包初始化与聚合导出 | 28 |
| `langgraph/state.py` | `ModuAgentState` TypedDict + `make_initial_state()` | 121 |
| `langgraph/nodes.py` | 图节点函数（perception/memory/route/agent/tool_processor/response）+ 事件发布辅助函数 | 642 |
| `langgraph/graph.py` | `build_modu_graph()` 图构建 + `_noop_tools_node` | 163 |
| `langgraph/runner.py` | 统一入口（流式/非流式）+ 灰度切换 + 兼容接口 | 308 |
| `langgraph/factory.py` | 配置化组件工厂 + `create_legacy_agent()` | 205 |
| `langgraph/adapters/tool_adapter.py` | BaseTool → LangChain StructuredTool + `_schema_to_pydantic_model()` | 147 |
| `langgraph/adapters/llm_adapter.py` | `build_chat_model()` + `build_conservative_chat_model()` | 142 |
| `langgraph/adapters/store_adapter.py` | `ChromaStore` + `InMemoryStoreAdapter` (LangGraph BaseStore) | 299 |
| `langgraph/adapters/event_bridge.py` | LangGraph stream → EventBus 桥接 + SSE 细粒度事件 + 进化信号集成 | 345 |
| **小计** | | **2400** |

**删除文件（重构稳定后）**：

| 文件 | 行数 | 替代方案 |
|---|---|---|
| `orchestration/coordinator.py` | 1047 | `langgraph/graph.py` + `nodes.py` |
| `adapters/llm_adapter.py` | 66 | `langgraph/adapters/llm_adapter.py` |
| `adapters/tool_adapter.py` | 109 | `ToolNode` |
| `adapters/storage_adapter.py` | 257 | `Checkpointer` + `Store` |
| `orchestration/communication/streaming.py` | 131 | LangGraph stream modes |
| `components/reasoning/llm/base_llm.py` | 168 | `ChatOpenAI` |
| **小计** | **1778** | |

**保留文件（不动）**：

| 文件 | 行数 | 保留原因 |
|---|---|---|
| `components/perception/text/rule_based.py` | ~860 | 敏感词分级、JSON 截断等**领域逻辑**，与编排无关 |
| `components/perception/fusion.py` | ~195 | 多模态融合策略，被 `perception_node` 调用 |
| `components/perception/security/guard.py` | - | 安全检测逻辑，被 `rule_based.py` 调用 |
| `components/action/tools/calculator.py` | ~86 | 工具业务逻辑，通过 `wrap_modu_tool` 包装 |
| `components/action/tools/search.py` | ~191 | 同上 |
| `orchestration/communication/agui_adapter.py` | ~900 | AG-UI 协议适配，仅改输入源 |
| `orchestration/communication/protocol.py` | ~211 | AgentEvent 定义，事件桥接仍用 |
| `orchestration/communication/message_bus.py` | ~378 | EventBus 被事件桥接消费 |
| `core/registry.py` | ~177 | 组件注册中心，`build_langchain_tools()` 依赖 |
| `config/runtime_config.py` | 169 | 配置管理（支持文件/env 加载 + 点路径访问 + deep merge），重构方案依赖 |

**修改文件**：

| 文件 | 变更 | 说明 |
|---|---|---|
| `pyproject.toml` | 增加 langchain/langgraph 依赖 | 阶段 0 |
| `config/runtime_config.py` | 增加 `orchestration.engine` 字段 | 灰度切换 |
| `examples/single_agent.py` | 增加 LangGraph 版本的 demo | 对齐验证 |

---

## 四、重构优先级与风险

### 4.1 推荐执行顺序

```
阶段 0 (依赖)  →  阶段 1 (State)  →  阶段 2 (适配器)
                                          ↓
阶段 6 (迁移)  ←  阶段 5 (配置)  ←  阶段 4 (流式)  ←  阶段 3 (Graph)
```

**阶段 3（Graph）是核心**，建议优先完成；阶段 2（适配器）是阶段 3 的前置依赖。

更细化的执行计划：

| 周次 | 里程碑 | 产出 |
|---|---|---|
| **第 1 周** | 阶段 0 + 阶段 1 | `pyproject.toml` 依赖更新；`langgraph/state.py` 完成；双轨目录结构就绪 |
| **第 2 周** | 阶段 2 | 3 个适配器文件完成测试；与现有 `BaseTool`/`BaseReasoningEngine` 集成验证 |
| **第 3 周** | 阶段 3（Graph 核心） | 最简 ReAct 流程跑通（perception → agent → tools → END）；节点单元测试通过 |
| **第 4 周** | 阶段 4（流式 + 事件） | `stream_response()` 替代 `stream_request()`；事件桥接就绪；AG-UI 适配简化 |
| **第 5 周** | 阶段 5（配置 + 进化） | `factory.py` 完成；进化机制重构验证 |
| **第 6 周** | 阶段 6（迁移 + 清理） | 双轨 feature flag 就绪；示例对齐完成；旧代码删除评审 |

### 4.2 关键风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| LangGraph `recursion_limit` 与现有 `max_reasoning_iterations` 语义不同 | ReAct 循环次数行为变化 | 显式设置 `recursion_limit = 2 * max_iterations + 4` |
| `ToolNode` 不支持现有 `timeout_ms`（1800s）超时 | 工具超时行为变化 | 用 `asyncio.wait_for` 包装或在工具内部实现超时 |
| LangGraph 检查点序列化要求 State 可序列化 | `perception_result` 含不可序列化字段 | 用 `json.dumps` 序列化，或实现自定义 serializer |
| `bind_tools` 要求 LLM 支持原生 function calling | GLM-4-Flash 等模型兼容性 | 已验证 GLM/DeepSeek/Qwen 均支持 OpenAI tools 格式 |
| AG-UI 协议事件时序变化 | 前端兼容性 | 保留 `AGUIStreamAdapter`，仅改输入源；对比测试事件序列 |
| `ComponentRegistry` 热替换与 LangGraph 编译时机冲突 | 运行时替换失效 | 用 `configurable` + 重新编译图替代 |
| 现有依赖 `langdetect`/`spaCy`/`SnowNLP` 与 LangChain 版本冲突 | import 或运行时错误 | 在独立 venv 中验证依赖兼容性 |

### 4.3 不建议重构的部分

1. **感知层业务逻辑**：`components/perception/text/rule_based.py` 的敏感词分级、JSON 感知截断、文本清洗等是领域逻辑，与编排框架无关，**保留原样**，仅作为 `perception_node` 的内部调用。
2. **AG-UI 协议适配**：`orchestration/communication/agui_adapter.py` 是协议层，与编排解耦，**保留并简化输入源**。
3. **工具实现**：`calculator.py`、`search.py` 的业务逻辑**保留**，仅用 `StructuredTool.from_function` 包装。
4. **安全检测**：`guard.py` 的 Prompt Injection / PII 检测是安全领域逻辑，**保留不动**。
5. **配置管理**：`config/runtime_config.py` 的配置加载逻辑**保留**，重构后的 `factory.py` 仍依赖 `get_config()`。

---

## 五、总结

重构核心是**用 LangGraph 的图编排 + 原生 ReAct + 检查点 + 流式**替代 ModuAgent 自研的 `Coordinator` 上帝类 + 手写循环 + 隐式状态 + 自定义事件流。

### 量化收益

| 指标 | 重构前 | 重构后 | 变化 |
|---|---|---|---|
| Coordinator 行数 | 1047 行 | 0（删除） | -100% |
| 编排层代码量 | ~1800 行（coordinator 1047 + adapters 432 + streaming 131 + 其他） | ~2400 行（langgraph/ 新增） | 增加 ~600 行（但消灭手写 ReAct 脆弱性、增加 SSE 细粒度事件、记忆更新节点等） |
| ReAct 实现方式 | 手写正则解析 + 格式重试 | LangGraph ToolNode | 消灭脆弱性 |
| 状态管理 | 隐式 `context: Dict` | 类型化 `ModuAgentState` | 类型安全 |
| 流式实现 | 手写 SSE 帧拼接 | LangGraph `astream` | 标准化 |
| 检查点 | 无（需手动存储） | Memory/Sqlite/Postgres | 开箱即用 |
| 测试难度 | 需 Mock 整个 Coordinator | 节点函数可独立测试 | 大幅降低 |

### 最大收益

- **重构编排层**：将 1047 行的 Coordinator 拆解为 LangGraph 图结构，获得类型安全 State、原生 function calling、自动检查点、标准化流式、可观测事件流
- **感知层/工具层/协议层代码零修改**，仅通过适配器包装
- **双轨灰度迁移**，降低重构风险

### 最大成本

- 感知层与 LangGraph State 的序列化适配
- AG-UI 事件时序对齐（需对比测试事件序列）
- 双轨迁移期的测试维护
- 团队学习 LangGraph/LangChain 生态的成本

### 建议起点

从**阶段 2（适配器）+ 阶段 3（Graph）**入手，先跑通一个最简 ReAct 流程（perception → agent → tools → END），再逐步补齐记忆、流式、进化机制。

---







## 六、代码深度分析与优化方案

### 6.1 代码结构总览

```
ModuAgent/
├── core/                  # 核心接口层（5 个 ABC + 注册中心）
│   ├── interfaces/        # perception/reasoning/memory/action/feedback 抽象基类
│   └── registry.py        # ComponentRegistry + get_registry() 全局单例
├── components/            # 组件实现层
│   ├── perception/        # ★ 最完善：text(862+393行) / vision / audio / security / fusion
│   ├── reasoning/llm/     # 4 个 LLM 适配器(glm/gpt/qwen/deepseek) 继承 BaseLLMReasoner
│   ├── memory/            # InMemoryShortTermMemory + ChromaLongTermMemory
│   └── action/            # SyncActionExecutor + Calculator/Search 工具
├── orchestration/         # 编排层
│   ├── coordinator.py     # ★ 1048 行"上帝类"，legacy 主流程
│   ├── communication/     # EventBus + Protocol + SSEEncoder + AGUIStreamAdapter(901行)
│   └── patterns/          # consensus / delegation 协作模式
├── langgraph/             # ★ LangGraph 重构层（双轨并存）
│   ├── state.py / graph.py / nodes.py / runner.py / factory.py
│   └── adapters/          # llm/tool/store/event_bridge 适配器
├── adapters/              # LLMAdapter / ToolAdapter / StorageAdapter
├── config/                # RuntimeConfig（点路径访问）+ schemas.py（几乎未用）
├── feedback/              # ✓ 已实现（EvolutionSignalCollector / FeedbackLoop / QualityMonitor / AccuracyMetrics / EfficiencyMetrics）
├── evolution/             # ✓ 已实现（ParameterTuneStrategy / ComponentSwapStrategy / VersionedComponentStore / RollbackMechanism，但闭环未接通）
└── examples/              # single_agent.py（双轨 Demo）
```

### 6.2 业务逻辑分析

#### 核心处理链路（以 `Coordinator.process_request` 为例）

```
输入 → 感知管线(路由+多路融合) → 敏感度/注入熔断
     → 记忆查询(短期history+长期knowledge)
     → 原生function calling或正则解析tool_call
     → ReAct循环(最多N轮: LLM生成→工具执行→观察反馈→再生成)
     → 流式/非流式响应
     → 异步记忆更新(fire-and-forget)
     → 全程EventBus发布事件(感知/记忆/推理/工具/行动)
```

**LangGraph 重构版**将上述流程拆为 StateGraph 节点：`perception → memory_query → agent ⇄ tools → response`，用原生 `bind_tools` + `ToolNode` 替代手写 ReAct 循环，用 `Checkpointer` 替代手写短期记忆管理。

#### 各层实现成熟度

| 模块 | 成熟度 | 说明 |
|------|--------|------|
| `components/perception` | ★★★★★ | 文本/图像/音频多模态 + 安全检测 + 融合，实现完善且有降级策略 |
| `orchestration/communication` | ★★★★ | EventBus + SSE + AGUI 适配完整，但 `_event_log` 与 `PersistentEventLog` 重叠 |
| `langgraph/` | ★★★★☆ | 重构方向正确，SSE 细粒度事件、记忆更新节点、进化信号收集均已补齐；但记忆更新节点尚未接入图结构 |
| `components/reasoning/llm` | ★★★☆ | 4 引擎结构清晰，但全用同步 `httpx`，异步环境需 `to_thread` 包装 |
| `orchestration/coordinator` | ★★☆ | 上帝类，process/stream 严重重复，正则解析 tool_call 已过时 |
| `components/memory` | ★★☆ | 基本可用，但 `redis_adapter.py` 名不副实，`faiss.py` 空 |
| `components/action` | ★★☆ | `async_executor.py`/`api_client.py` 空文件 |
| `config` | ★★☆ | schemas.py 定义了完整 dataclass 却几乎不用，全靠 `Dict[str, Any]` |
| `feedback` | ★★★★ | 已实现 `EvolutionSignalCollector`、`FeedbackLoop`、`QualityMonitor`、`AccuracyMetrics`、`EfficiencyMetrics`，但自动反馈闭环尚未接通 |
| `evolution` | ★★★★ | 已实现 `ParameterTuneStrategy`、`ComponentSwapStrategy`、`VersionedComponentStore`、`RollbackMechanism`，但未与 feedback 模块闭环联动 |

### 6.3 关键问题诊断

#### P0 — 架构层面

**1. `feedback` 和 `evolution` 模块已实现但闭环未接通**

`feedback/` 和 `evolution/` 模块的基本代码**已实现**（非空壳）：
- `feedback/`: `EvolutionSignalCollector`（信号收集）、`FeedbackLoop`（反馈循环）、`QualityMonitor`（质量监控）、`AccuracyMetrics`（准确率指标）、`EfficiencyMetrics`（效率指标）
- `evolution/`: `ParameterTuneStrategy`（参数调优）、`ComponentSwapStrategy`（组件热替换）、`VersionedComponentStore`（版本存储）、`RollbackMechanism`（回滚机制）

**但 `EvolutionSignalCollector` → `FeedbackLoop.evaluate` → `should_evolve` → `EvolutionStrategy.apply` → `ComponentRegistry.swap_component` 的完整自动闭环尚未接通**。目前各组件可独立使用，但缺少触发链路的编排层，信号收集后无人自动消费。

**2. 双轨架构导致大面积代码重复与能力割裂**

`legacy Coordinator`（1048 行）与 `langgraph/` 重构版并存：
- `coordinator._run_perception_pipeline` 与 `langgraph/nodes.py:perception_node` 几乎是复制粘贴（`coordinator.py:920-980` vs `nodes.py:48-149`）
- `process_request` 与 `stream_request` 内部逻辑（感知、熔断、记忆、ReAct）约 60% 重复（`coordinator.py:87-412` vs `414-798`）
- langgraph 版**原缺失能力已基本补齐**：SSE 细粒度事件（thinking/tool_call_start/tool_result，见 `event_bridge.py:_emit_sse_events`）、`memory_update_node`（见 `nodes.py`，但尚未接入图结构）、进化信号收集（见 `event_bridge.py` 中 `_evolution_collector.on_agent_event()` 调用）、低置信度保守模式（见 `make_agent_node` 的 `confidence_threshold` 参数）均已实现

**3. Coordinator 是 1048 行上帝类**

单文件承担：感知编排 + 熔断 + 记忆查询 + ReAct 循环 + 流式编码 + 事件发布 + Sensor 生命周期 + 持久化初始化，违反 SRP。

#### P1 — 实现层面

**4. LLM 推理引擎全用同步 `httpx.Client`**

`base_llm.py:65,117` 中 `reason()` 和 `stream()` 均为同步阻塞调用。在 async 的 Coordinator 中被迫用 `asyncio.to_thread()` 包装（`coordinator.py:542,587,713`），每次调用占用线程池，高并发下成为瓶颈。

**5. 手写 ReAct + 正则解析 tool_call 已过时**

`coordinator.py:225` 的 `tool_call_pattern = r"```tool_call\s*\n(.*?)\n```"` + `format_retries` 自我纠正机制（`coordinator.py:246-289`）已被 LangGraph 原生 `bind_tools` 取代，但 legacy 路径仍保留，增加维护负担。

**6. `schemas.py` 定义完整 dataclass 却几乎未使用**

`config/schemas.py` 定义了 `PerceptionInputSchema`/`MemoryQuerySchema`/`ToolCallSchema`/`LLMCallSchema` 等 11 个带校验的 dataclass，但全代码用 `Dict[str, Any]` 传参，类型安全形同虚设。

**7. 错误码使用不一致**

`coordinator.py:193,244` 用字符串字面量 `"INPUT_001"`/`"LLM_001"`，其余用 `ErrorCode.LLM_GENERATION_FAILED` 枚举，同一文件内不一致。

**8. 工具执行每次新建 `ThreadPoolExecutor`**

`tool_adapter.py:44` 每次调用 `with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:`，频繁创建/销毁线程池有开销。

#### P2 — 工程质量层面

**9. 记忆更新 fire-and-forget 风险**

`coordinator.py:387,791` 用 `asyncio.create_task(asyncio.to_thread(self._storage_adapter.update_all, ...))` 后台更新记忆，任务异常静默丢失，进程退出时可能未完成。

**10. 全局单例非线程安全且测试不友好**

`get_registry()`/`get_config()`/`get_event_bus()` 均为模块级全局变量单例，无锁，测试需手动 `reset_config()`。

**11. EventBus `_event_log` 与 `PersistentEventLog` 功能重叠**

`message_bus.py:42-43` 内存事件日志 + `PersistentEventLog` 文件日志双重存储，内存日志仅用于 `get_event_log()` 调试，生产价值低。

**12. 文件名与实现不符 + 空文件**

`redis_adapter.py` 实为纯内存实现（无 Redis）；`faiss.py`/`async_executor.py`/`api_client.py` 共 3 个空文件（`feedback/*` 和 `evolution/*` 均已实现非空）。

**13. 缺少测试**

`pyproject.toml` 配置 `testpaths = ["tests"]`，但 `tests/` 目录不存在。

**14. README.md 为空**

仅 `ARCHITECTURE.md` 有目录树，无使用说明。

### 6.4 优化方案（按优先级分阶段）

#### 阶段一：收敛双轨，消除重复（P0，预计 2-3 天）

**目标：** 完成 legacy → langgraph 迁移，删除上帝类。

1. **补齐 langgraph 版剩余差距（少量工作）**
   - ✅ 低置信度保守模式已在 `make_agent_node` 中实现（`confidence_threshold` 参数）
   - ✅ `memory_update_node` 已在 `nodes.py` 中定义，**但需在 `build_modu_graph()` 中作为图节点接入**
   - ✅ SSE 细粒度事件已在 `event_bridge.py:_emit_sse_events` 中实现（thinking/tool_call_start/tool_result）
   - ✅ `EvolutionSignalCollector` 已在 `event_bridge.py` 的 consume 方法中集成
   - 剩余工作：在 `graph.py` 的 `build_modu_graph()` 中将 `memory_update_node` 添加为图节点，使记忆更新可观测

2. **提取公共感知管线**
   将 `coordinator._run_perception_pipeline` 与 `nodes.perception_node` 的重复逻辑提取为 `components/perception/pipeline.py:run_perception_pipeline(input_data, config, registry)`，两处统一调用。

3. **删除 legacy Coordinator**
   确认 langgraph 版功能对等后，删除 `coordinator.py`（1048 行），`get_runner()` 移除 legacy 分支。

#### 阶段二：异步化 LLM 层 + 工具层 + 记忆更新接入（P1，预计 2-3 天）

1. **LLM 引擎改用 `httpx.AsyncClient`**
   ```python
   # base_llm.py - 新增 async reason/stream
   async def areason(self, prompt, context, **kwargs) -> Tuple[...]:
       async with httpx.AsyncClient(timeout=self._timeout) as client:
           response = await client.post(url, json=payload, headers=headers)
   ```
   对应 `langgraph/adapters/llm_adapter.py` 的 `ChatOpenAI` 已原生支持 async，确认 langgraph 路径全异步。

2. **ToolAdapter 复用线程池**
   ```python
   # tool_adapter.py - 实例级线程池
   class ToolAdapter:
       def __init__(self):
           self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)
   ```
   或直接将 `BaseTool.invoke` 改为 `async def`，消除线程池需求。

3. **将 memory_update_node 接入图结构**
   `memory_update_node` 已在 `nodes.py` 中定义但未在 `graph.py:build_modu_graph()` 中作为图节点接入。需在 `response` 节点后增加 `memory_update` 边，使记忆更新成为图的一部分而非 fire-and-forget task。

#### 阶段三：接通反馈进化闭环（P0，预计 2-3 天）

feedback 和 evolution 模块的**基本代码已实现**，但尚未组成自动闭环。本阶段目标是接通完整链路：

1. **闭环接线**
   `EvolutionSignalCollector` → `FeedbackLoop.evaluate` → `should_evolve` → `EvolutionStrategy.apply` → `ComponentRegistry.swap_component` / 参数更新。

   具体步骤：
   - 在 `langgraph/` 或 `orchestration/` 中新增 `evolution_orchestrator.py`，作为闭环编排器
   - 定时/事件触发：从 `EvolutionSignalCollector.get_signals()` 获取信号
   - 调用 `FeedbackLoop.evaluate()` 评估质量
   - 根据 `should_evolve()` 结果调用 `ParameterTuneStrategy` 或 `ComponentSwapStrategy`
   - 应用变更到 `RuntimeConfig` 或 `ComponentRegistry.swap_component()`

2. **可选增强：QualityMonitor 升级为 LLM-as-Judge**
   当前 `QualityMonitor` 使用基于规则的评估（关键词匹配），可升级为基于 LLM 的评估以提升准确率。

#### 阶段四：类型安全与工程治理（P2，预计 2-3 天）

1. **启用 schemas.py 替代 Dict[str, Any]**
   入口层（`process_request`/`run_sync`）用 `PerceptionInputSchema`/`MemoryQuerySchema` 校验输入，内部传递用 dataclass 而非裸 dict。

2. **统一错误码**
   全部改用 `ErrorCode` 枚举，删除 `"INPUT_001"`/`"LLM_001"` 字面量。

3. **配置类型化**
   将 `_DEFAULT_CONFIG` 字典改为 Pydantic `BaseModel`，`config.get("llm.temperature")` 改为 `config.llm.temperature`，获得 IDE 补全 + 校验。

4. **清理空文件与命名**
   - 删除或实现 `faiss.py`/`async_executor.py`/`api_client.py`
   - `redis_adapter.py` 重命名为 `short_term_memory.py` 或补真实 Redis 实现
   - 补充 `README.md` 使用说明
   - 创建 `tests/` 目录，补充核心链路单测

5. **EventBus 精简**
   移除 `_event_log` 内存日志（生产用 `PersistentEventLog`），仅保留调试钩子。

### 6.5 优化优先级矩阵

| 优化项 | 影响面 | 紧迫度 | 建议阶段 |
|--------|--------|--------|----------|
| 接通 feedback/evolution 闭环 | 核心能力缺失 | 🔴 高 | 阶段三 |
| 收敛双轨，删除 Coordinator 上帝类 | 维护性 | 🔴 高 | 阶段一 |
| LLM 异步化 | 性能 | 🟡 中 | 阶段二 |
| 补齐 langgraph 版剩余差距（memory_update 接入图） | 功能对等 | 🟡 中 | 阶段一 |
| 提取公共感知管线 | 消除重复 | 🟡 中 | 阶段一 |
| 启用 schemas 类型安全 | 质量防劣化 | 🟢 低 | 阶段四 |
| 清理空文件/命名 | 工程整洁 | 🟢 低 | 阶段四 |
| 补测试 | 质量保障 | 🟡 中 | 阶段四 |
| QualityMonitor 升级为 LLM-as-Judge | 质量提升 | 🟢 低 | 阶段三（可选） |

**总结：** ModuAgent 的**感知层和编排层设计成熟**，LangGraph 重构方向和实现正确，feedback/evolution 模块**基本代码已就绪**但尚欠闭环接通。存在三大短板：① feedback/evolution 闭环未接通导致"自进化"承诺未兑现；② 双轨并存导致 1048 行上帝类与重复代码；③ LLM 同步调用制约异步性能。建议优先按"收敛双轨 → 异步化 + 记忆更新接入图 → 接通反馈进化闭环"的路径推进，最终达成架构文档所描绘的模块化自进化 Agent 框架。

---

## 七、当前完成度全面评估

### 7.1 已完成优化项（对照文档六阶段规划）

基于对全量代码的逐一核查，以下是文档规划的 6 个阶段中**已实施完成**的项目：

#### 阶段 0：准备与依赖对齐 —— ✅ 已完成

| 计划项 | 完成状态 | 实际情况 |
|--------|---------|---------|
| `pyproject.toml` 依赖确认 | ✅ | `langgraph>=0.2.0`、`langchain-core>=0.3.0`、`langchain-openai>=0.2.0`、`langchain-community>=0.3.0` 已配置 |
| 新建 `langgraph/` 目录 | ✅ | 目录结构完整：`state.py`/`graph.py`/`nodes.py`/`runner.py`/`factory.py`/`adapters/` |
| 包 `__init__.py` | ✅ | `langgraph/__init__.py` 已创建 |
| 双轨并存 | ✅ | `orchestration/` 保留，`langgraph/` 新增，通过 `get_runner()` 按配置切换 |

#### 阶段 1：类型化 State —— ✅ 已完成

| 计划项 | 完成状态 | 实际情况 |
|--------|---------|---------|
| `langgraph/state.py` | ✅ | `ModuAgentState` TypedDict 定义完整，含 `messages`/`user_id`/`session_id`/`trace_id`/`input_data`/`perception_result`/`cleaned_text`/`detected_language`/`sensitivity_level`/`confidence`/`injection_detected`/`history`/`knowledge`/`tool_results`/`iteration`/`response`/`error_code`/`error_message`/`usage` |
| `make_initial_state()` 辅助 | ✅ | 工厂函数已完成，支持流式/非流式初始化 |

#### 阶段 2：组件适配为 LangChain 原生类型 —— ✅ 已完成

| 计划项 | 完成状态 | 实际情况 |
|--------|---------|---------|
| 工具适配 `tool_adapter.py` | ✅ | `wrap_modu_tool()` + `build_langchain_tools()` 完整实现，复用 `BaseTool` name/description/invoke |
| LLM 适配 `llm_adapter.py` | ✅ | `build_chat_model()` 支持 glm/deepseek/gpt/qwen 四引擎，`build_conservative_chat_model()` 低置信度模式已实现 |
| 记忆适配 `store_adapter.py` | ✅ | `ChromaStore` (BaseStore 子类) + `InMemoryStoreAdapter` 已实现 |

#### 阶段 3：StateGraph 构建 —— ✅ 主体已完成

| 计划项 | 完成状态 | 实际情况 |
|--------|---------|---------|
| `perception_node` | ✅ | 复用 `PerceptionFusion` + `TextPreprocessor`，含多路融合逻辑 |
| `memory_query_node` | ✅ | 从 Store 查询长期知识（短期历史由 Checkpointer 自动管理） |
| `make_agent_node` 工厂 | ✅ | `bind_tools` 原生 function calling，含 `confidence_threshold` 保守模式 |
| `route_after_perception` | ✅ | 敏感度熔断 + 注入检测熔断，路由到 response/memory_query |
| `route_after_agent` | ✅ | 检查 tool_calls 决定进入 tools 或结束 |
| `route_after_tools` | ✅ | 工具执行后回到 agent |
| `build_modu_graph()` | ✅ | 图构建完成：START→perception→memory_query→agent⇄tools→response→END |
| `ToolNode` 集成 | ✅ | 替代手写正则解析 |
| `recursion_limit` 替代 `max_iterations` | ✅ | LangGraph 内置限制 |

#### 阶段 4：流式输出与事件系统 —— ✅ 核心已完成

| 计划项 | 完成状态 | 实际情况 |
|--------|---------|---------|
| `stream_response()` | ✅ | 使用 `graph.astream(stream_mode=["messages", "updates", "values"])` |
| `run_sync()` | ✅ | 使用 `graph.ainvoke()` |
| SSE 细粒度事件 | ✅ | `event_bridge.py:_emit_sse_events()` 实现 thinking/tool_call_start/tool_result/agent_response 事件 |
| 事件桥接 `event_bridge.py` | ✅ | `LangGraphEventBridge.consume()` 将 LangGraph stream 映射为 AgentEvent 发布到 EventBus |

#### 阶段 5：配置化与可演化性 —— ✅ 基础已完成

| 计划项 | 完成状态 | 实际情况 |
|--------|---------|---------|
| `factory.py` | ✅ | `create_agent()` + `create_legacy_agent()` + `build_checkpointer()` + `build_store()` |
| `RunnableConfig` 配置化 | ✅ | 支持 `configurable` 动态注入 provider/temperature/max_tokens/checkpointer_type/store_type/system_prompt |
| 灰度切换 `get_runner()` | ✅ | 按 `orchestration.engine` 配置字段选择 legacy/langgraph |

#### 阶段 6：迁移与验证 —— ⚠️ 部分完成

| 计划项 | 完成状态 | 实际情况 |
|--------|---------|---------|
| 双轨 feature flag | ✅ | `get_runner()` 已实现 |
| 旧代码删除 | ❌ | `coordinator.py`（1047 行）仍保留且为默认引擎 |
| 示例对齐 | ⚠️ | `examples/single_agent.py` 有双轨 Demo 但未覆盖全部 5 个场景 |
| 测试 | ❌ | `tests/` 目录不存在 |

#### 代码深度分析中已实现的优化项

| 优化项 | 状态 | 实际情况 |
|--------|------|---------|
| `feedback/` 模块 | ✅ | `EvolutionSignalCollector`/`FeedbackLoop`/`QualityMonitor`/`AccuracyMetrics`/`EfficiencyMetrics` 均已实现 |
| `evolution/` 模块 | ✅ | `ParameterTuneStrategy`/`ComponentSwapStrategy`/`VersionedComponentStore`/`RollbackMechanism` 均已实现 |
| 进化信号集成到事件桥接 | ✅ | `event_bridge.py` 中 `_evolution_collector.on_agent_event()` 已调用 |

---

### 7.2 待完成优化项详细清单

以下按**架构影响面**和**紧迫程度**分级排列 20 项待完成工作：

---

#### P0-1：feedback/evolution 自动闭环未接通

- **所属阶段**：阶段三（接通反馈进化闭环）
- **当前状态**：`feedback/` 和 `evolution/` 模块的**独立代码均已实现**，但缺少触发链路的编排层，信号收集后无人自动消费
- **具体缺失**：
  - **架构设计缺失**：`EvolutionSignalCollector` 收集信号 → `FeedbackLoop.evaluate` 评估质量 → `should_evolve` 判断 → `EvolutionStrategy.apply` 执行 —— 这四个组件各自独立可用，但它们之间的**串联编排器（evolution_orchestrator.py）不存在**
  - **任务调度缺失**：没有定时或事件驱动的触发机制，无法在 Agent 运行过程中自动启动进化评估
  - **上下文管理缺失**：进化信号在多次 Agent 执行间如何聚合？阈值如何动态调整？版本快照何时创建？均无定义
- **预期目标**：实现完整的 `EvolutionOrchestrator`，使得一次典型的 Agent 调用完成后，自动触发质量评估 → 进化决策 → 策略执行 → 效果追踪的闭环
- **实现边界**：
  - **范围内**：新增 `langgraph/evolution_orchestrator.py` 或 `orchestration/evolution_orchestrator.py` 作为闭环编排器；在 `runner.py` 的 `run_sync`/`stream_response` 完成流程后触发进化检查；定义信号聚合策略（窗口/累计/衰减）
  - **范围外**：A/B 实验框架、生产级强化学习、多臂老虎机策略
  - **依赖**：P0-2（收敛双轨）完成后方可确定编排器的挂载位置

---

#### P0-2：双轨架构未收敛，Legacy Coordinator 仍为默认引擎

- **所属阶段**：阶段一（收敛双轨） + 阶段六（迁移验证）
- **当前状态**：`coordinator.py`（1047 行）与 `langgraph/` 重构版并存，且 legacy 仍是 `orchestration.engine` 默认值
- **具体缺失**：
  - **架构设计缺失**：`apps/backend/app/core/agent_bridge.py` 中硬编码使用 `Coordinator()`，LangGraph 路径在 API 层**完全不可达**；`get_runner()` 的灰度切换逻辑仅在 Demo 中使用
  - **执行效率缺失**：两套感知管线（`coordinator._run_perception_pipeline` 与 `nodes.perception_node`）为复制粘贴关系，任一修改需同步两处，维护成本高
  - **上下文管理缺失**：两套流式输出的事件格式不统一，AG-UI 前端若切换到 LangGraph 版可能遇到事件时序/格式不一致
- **预期目标**：Legacy Coordinator 完全删除，`langgraph/` 成为唯一编排引擎，`get_runner()` 移除 legacy 分支
- **实现边界**：
  - **范围内**：提取公共感知管线 `components/perception/pipeline.py` → 删除 `coordinator.py` → `agent_bridge.py` 切换到 `get_runner()` → 更新 `orchestration.engine` 默认值为 `langgraph`
  - **范围外**：Coordinator 中的 Sensor 生命周期管理（LangGraph 需新方案或移入 `runner.py`）
  - **前置依赖**：P0-3、P1-1、P1-2

---

#### P0-3：memory_update_node 已定义但未接入图结构

- **所属阶段**：阶段一（补齐 langgraph 版剩余差距）
- **当前状态**：`memory_update_node` 在 `nodes.py` 中已完整定义，但**未在 `graph.py:build_modu_graph()` 中作为图节点添加**
- **具体缺失**：
  - **架构设计缺失**：记忆更新未成为 StateGraph 的一部分，仍是 fire-and-forget 异步任务（在 `runner.py` 中通过 `asyncio.create_task` 后台执行），异常静默丢失
  - **上下文管理缺失**：记忆更新的成功/失败不可观测，缺少对 `state._store` 的可靠访问机制（TypedDict 无 `_store` 属性）
  - **执行效率缺失**：fire-and-forget 任务在进程退出时可能未完成，导致最近一次对话的短期记忆丢失
- **预期目标**：`memory_update_node` 接入图结构，在 `response` 节点后增加 `memory_update` 边，使记忆更新成为图的有向无环流的一部分
- **实现边界**：
  - **范围内**：修改 `graph.py:build_modu_graph()` 添加 `memory_update` 节点和边；调整 `store_adapter.py` 确保 `BaseStore` 可通过图状态访问
  - **范围外**：记忆更新的分布式事务保证
  - **依赖**：需确认 `ChromaStore` 的 async 方法与 LangGraph 节点兼容性

---

#### P1-1：AG-UI 适配器未迁移到 LangGraph 输入源

- **所属阶段**：阶段四（流式与事件重构）
- **当前状态**：`orchestration/communication/agui_adapter.py`（约 900 行）仍消费 Coordinator 的自定义 SSE 帧格式，未切换为 LangGraph stream 事件
- **具体缺失**：
  - **架构设计缺失**：文档中规划了 `AGUIStreamAdapter.transform()` 的 LangGraph 版本（事件映射：messages → `TEXT_MESSAGE_CONTENT`，tool_calls → `TOOL_CALL_START/END`，error → `RUN_ERROR`），但代码中**未实现**
  - **上下文管理缺失**：LangGraph 的 stream mode 产生的事件格式（messages/updates/values/custom）与 Coordinator 的自定义 SSE 帧不兼容，需重新实现事件映射表
- **预期目标**：`AGUIStreamAdapter` 的输入源从 Coordinator SSE 帧改为 LangGraph stream 事件，保持前端兼容性
- **实现边界**：
  - **范围内**：新增事件映射逻辑；对比测试事件序列确保前端无感切换
  - **范围外**：AG-UI 协议本身的变更
  - **依赖**：P0-2（收敛双轨）完成后无需同时维护两套 AG-UI 适配

---

#### P1-2：LangGraph 路径在 API 层不可达

- **所属阶段**：阶段六（迁移与验证）
- **当前状态**：`apps/backend/app/api/v1/agent.py` 和 `apps/backend/app/core/agent_bridge.py` 硬编码使用 `Coordinator()`，LangGraph 版的 `run_sync`/`stream_response` 仅存在于 `langgraph/runner.py` 中，无 API 入口
- **具体缺失**：
  - **架构设计缺失**：`agent_bridge.py` 未使用 `get_runner()` 进行引擎选择，LangGraph 版仅能通过 Demo 脚本调用
  - **执行效率缺失**：无法在生产环境验证 LangGraph 版的性能与稳定性
- **预期目标**：`agent_bridge.py` 通过 `get_runner()` 按配置选择引擎，LangGraph 路径可通过 API 正常访问
- **实现边界**：
  - **范围内**：修改 `agent_bridge.py` 的 `_init_moduagent()` 逻辑，使用 `get_runner()` 替代硬编码 `Coordinator()`；兼容两种引擎的返回格式差异
  - **范围外**：前端适配
  - **依赖**：P0-3、P1-1

---

#### P1-3：LLM 推理引擎同步阻塞，制约异步性能

- **所属阶段**：阶段二（异步化 LLM 层）
- **当前状态**：`base_llm.py` 中 `reason()` 和 `stream()` 均为同步 `httpx.Client` 调用；在 Legacy Coordinator 中被迫用 `asyncio.to_thread()` 包装
- **具体缺失**：
  - **执行效率缺失**：每次 LLM 调用占用独立线程（`asyncio.to_thread`），高并发下线程池耗尽或上下文切换开销显著；stream 模式尤为严重——流式 token 生成被包装为线程内循环，无法发挥 async 优势
  - **架构设计缺失**：LangGraph 路径使用 `ChatOpenAI`（原生 async），但若仍需要 `to_thread` 包装则未真正解决问题
- **预期目标**：`base_llm.py` 新增 `areason()`/`astream()` async 方法，使用 `httpx.AsyncClient`；LangGraph 路径确认全链路异步
- **实现边界**：
  - **范围内**：为 `BaseLLMReasoner` 子类添加 async 方法；`ToolAdapter.invoke` 改为 `async def`
  - **范围外**：HTTP/2 多路复用、连接池优化
  - **依赖**：无，可独立进行

---

#### P1-4：ToolAdapter 每次调用新建 ThreadPoolExecutor

- **所属阶段**：阶段二（异步化工具层）
- **当前状态**：`adapters/tool_adapter.py` 中每次 `invoke_tool` 调用 `with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:`，频繁创建/销毁线程池
- **具体缺失**：
  - **执行效率缺失**：线程池的创建和销毁是相对昂贵的操作（涉及 OS 线程资源），高频工具调用（如 ReAct 循环中多次工具执行）会累积可观的延迟
- **预期目标**：实例级线程池复用（`max_workers=8`），或直接改为 `async def invoke` 消除线程池需求
- **实现边界**：
  - **范围内**：`ToolAdapter` 持有实例级 `ThreadPoolExecutor`，在 `__del__` 或 `close()` 中释放
  - **范围外**：工具执行的进程级沙箱隔离
  - **依赖**：P1-3（若 LLM 层异步化，工具层同步跟随）

---

#### P1-5：感知管线逻辑重复（Coordinator ↔ nodes.perception_node）

- **所属阶段**：阶段一（提取公共感知管线）
- **当前状态**：`coordinator._run_perception_pipeline`（约 60 行）与 `nodes.perception_node`（约 100 行）实现的是同一套感知流程（输入路由 + 感知器链 + 多路融合），代码为复制粘贴关系但细节有差异
- **具体缺失**：
  - **架构设计缺失**：缺失 `components/perception/pipeline.py:run_perception_pipeline(input_data, config, registry)` 统一入口
  - **执行效率缺失**：两处修改需同步，维护成本高
- **预期目标**：提取公共函数，两处统一调用，消除重复
- **实现边界**：
  - **范围内**：新建 `components/perception/pipeline.py`，将感知管线逻辑提取为纯函数；`coordinator.py` 和 `nodes.py` 均改为调用该函数
  - **范围外**：感知器本身的实现变更
  - **依赖**：无，可在收敛双轨前独立完成

---

#### P1-6：schemas.py 类型体系未被使用

- **所属阶段**：阶段四（类型安全）
- **当前状态**：`config/schemas.py` 定义了 `PerceptionInputSchema`/`MemoryQuerySchema`/`ToolCallSchema`/`LLMCallSchema` 等 11 个带校验的 dataclass，但全代码用 `Dict[str, Any]` 传参
- **具体缺失**：
  - **架构设计缺失**：类型安全形同虚设，IDE 无自动补全，运行时无类型校验
  - **上下文管理缺失**：`Dict[str, Any]` 在多层传递中字段增减不可追踪，易出现 KeyError
- **预期目标**：入口层用 Pydantic/dataclass 校验输入，内部传递用结构化对象替代裸字典
- **实现边界**：
  - **范围内**：`process_request`/`run_sync` 入口参数校验；`ModuAgentState` 的部分字段改用 schema 定义
  - **范围外**：全量 `Dict[str, Any]` 替换（成本过高，应渐进式推进）
  - **依赖**：P0-2（收敛双轨后只需改一处入口）

---

#### P1-7：错误码使用不一致

- **所属阶段**：阶段四（工程治理）
- **当前状态**：`coordinator.py` 中部分使用字符串字面量 `"INPUT_001"`/`"LLM_001"`，部分使用 `ErrorCode.LLM_GENERATION_FAILED` 枚举
- **具体缺失**：
  - **架构设计缺失**：`ErrorCode` 枚举已在 `orchestration/communication/protocol.py` 中定义，但未被全面使用
- **预期目标**：全代码统一使用 `ErrorCode` 枚举
- **实现边界**：
  - **范围内**：搜索所有字符串错误码，替换为枚举引用
  - **范围外**：无
  - **依赖**：P0-2（收敛双轨后涉及文件减少）

---

#### P2-1：全局单例非线程安全且测试不友好

- **所属阶段**：阶段四（工程治理）
- **当前状态**：`get_registry()`/`get_config()`/`get_event_bus()` 均为模块级变量单例，无锁，测试需手动 `reset_config()`
- **具体缺失**：
  - **架构设计缺失**：测试隔离性差——一个测试修改 config 会影响其他测试；多线程并发访问单例无保护
  - **上下文管理缺失**：全局状态无法按测试用例隔离
- **预期目标**：支持测试隔离的配置/注册表注入机制
- **实现边界**：
  - **范围内**：`get_config()` 支持 `override` 参数用于测试；`ComponentRegistry` 支持非全局实例化
  - **范围外**：引入依赖注入框架

---

#### P2-2：EventBus `_event_log` 与 `PersistentEventLog` 功能重叠

- **所属阶段**：阶段四（工程治理）
- **当前状态**：`message_bus.py` 同时维护内存事件日志（`_event_log`）和 `PersistentEventLog` 文件日志
- **具体缺失**：
  - **架构设计缺失**：内存日志仅用于 `get_event_log()` 调试 API，生产价值低但占用内存；双重存储增加维护成本
- **预期目标**：移除 `_event_log`，仅保留 `PersistentEventLog`；调试场景使用 debug 级别日志
- **实现边界**：
  - **范围内**：删除 `_event_log` 和 `get_event_log()`；修改 `PersistentEventLog` 增加可选的 debug 模式
  - **范围外**：引入集中式日志系统（ELK/Loki）

---

#### P2-3：空文件与命名不符

- **所属阶段**：阶段四（工程治理）
- **当前状态**：
  - `components/action/executors/async_executor.py` — 空文件
  - `components/action/tools/api_client.py` — 空文件
  - `components/memory/vector/faiss.py` — 空文件
  - `components/action/__init__.py` — 空文件
  - `components/memory/__init__.py` — 空文件
  - `components/reasoning/__init__.py` — 空文件
  - `evolution/__init__.py` — 空文件
  - `feedback/__init__.py` — 空文件
  - `components/memory/cache/redis_adapter.py` — 名为 Redis 实为纯内存
- **具体缺失**：
  - **架构设计缺失**：空文件暗示功能规划但未实现，误导新开发者
  - **执行效率缺失**：`async_executor.py` 为空，意味着异步工具执行能力缺位
- **预期目标**：删除无计划实现的空文件；`redis_adapter.py` 重命名为 `short_term_memory.py` 或补真实 Redis 实现
- **实现边界**：
  - **范围内**：清理空文件清单；`__init__.py` 补模块导出
  - **范围外**：完整实现 FAISS/API Client/Async Executor（需独立评估需求）

---

#### P2-4：测试体系空白

- **所属阶段**：阶段六（测试策略）
- **当前状态**：`pyproject.toml` 配置 `testpaths = ["tests"]`，但 `tests/` 目录不存在；全项目零测试文件
- **具体缺失**：
  - **架构设计缺失**：无测试，重构过程中回归风险高；文档规划的节点级单元测试（如 `test_perception_node.py`）均未创建
  - **执行效率缺失**：无法量化重构前后的性能/正确性变化
- **预期目标**：创建 `tests/` 目录，覆盖核心链路：感知节点、图构建、工具适配、流式输出、事件桥接
- **实现边界**：
  - **范围内**：`tests/langgraph/test_perception_node.py`、`tests/langgraph/test_graph.py`、`tests/langgraph/test_runner.py`、`tests/adapters/test_tool_adapter.py`、`tests/adapters/test_event_bridge.py`
  - **范围外**：端到端 UI 测试、性能基准测试

---

#### P2-5：README.md 为空

- **所属阶段**：阶段四（工程治理）
- **当前状态**：`README.md` 为空文件；仅 `ARCHITECTURE.md` 有目录树
- **具体缺失**：
  - **架构设计缺失**：新开发者无法快速了解项目启动/运行/开发方式
- **预期目标**：补充项目简介、快速开始、架构概览、API 文档链接、开发指南
- **实现边界**：
  - **范围内**：README 基础内容（简介 + 安装 + 运行 + 架构图 + 配置说明）
  - **范围外**：详细的 API 文档（应用 swagger 自动生成）

---

#### P2-6：安全 PII 阻断未在熔断逻辑中实现

- **所属阶段**：非文档规划阶段，代码分析新发现
- **当前状态**：`components/perception/security/guard.py` 实现了 PII 检测，配置有 `block_on_pii` 字段，但 Coordinator 的 `route_after_perception` 仅检查 `block_on_injection`，未实现 PII 阻断
- **具体缺失**：
  - **架构设计缺失**：安全模块的 PII 检测能力未接入编排流程的熔断逻辑
- **预期目标**：`route_after_perception` 增加 PII 阻断检查
- **实现边界**：
  - **范围内**：`nodes.py` 的 `route_after_perception` 增加 `block_on_pii` 分支
  - **范围外**：PII 检测规则的增强

---

#### P2-7：QualityMonitor 基于规则，未升级为 LLM-as-Judge

- **所属阶段**：阶段三（可选增强）
- **当前状态**：`feedback/quality_monitor.py` 使用基于关键词匹配的规则评估
- **具体缺失**：
  - **执行效率缺失**：规则评估覆盖度低，无法评估语义层面的回复质量（如幽默感、同理心、逻辑性）
- **预期目标**：`QualityMonitor` 新增 LLM-as-Judge 模式，使用独立 LLM 调用评估回复质量
- **实现边界**：
  - **范围内**：`QualityMonitor` 增加 `evaluator_llm` 参数，支持 `rule`/`llm` 两种模式
  - **范围外**：多维度评分体系（BLEU/ROUGE/人类偏好对齐）

---

#### P2-8：无任务调度与重试机制

- **所属阶段**：非文档规划阶段，代码分析新发现
- **当前状态**：整个 Agent 系统**不存在任务调度器**：无任务队列、无优先级调度、无并发控制、无分布式执行能力；LLM 调用失败、工具调用失败均无自动重试（仅格式错误有重试）
- **具体缺失**：
  - **架构设计缺失**：请求-响应模式下无法支持批量任务、异步回调、延迟执行等场景
  - **执行效率缺失**：无失败重试意味着任何瞬时故障直接暴露给用户
  - **任务调度缺失**：无超时取消、限流、优先级等服务质量保障
- **预期目标**：至少实现工具调用的指数退避重试和 LLM 调用的 fallback 重试
- **实现边界**：
  - **范围内**：`ToolNode` 包装增加重试逻辑；LLM 调用增加 1 次 fallback 重试
  - **范围外**：分布式任务队列（Celery/Redis Queue）、复杂优先级调度

---

#### P2-9：无监控与可观测性

- **所属阶段**：非文档规划阶段，代码分析新发现
- **当前状态**：无 metrics 导出（Prometheus/OpenTelemetry）、无 tracing 集成（仅自建 `trace_id`）、无健康检查端点
- **具体缺失**：
  - **架构设计缺失**：生产环境无法监控 Agent 调用的延迟分布、工具调用成功率、LLM token 用量趋势
  - **上下文管理缺失**：`trace_id` 仅在应用层手动传递，渗透不到 LLM Provider 侧
- **预期目标**：增加基础健康检查端点；接入 OpenTelemetry tracing
- **实现边界**：
  - **范围内**：`/health` 端点；`runner.py` 中增加 span 埋点
  - **范围外**：完整的 SLO 仪表板、告警规则

---

#### P2-10：配置不支持运行时热更新

- **所属阶段**：阶段五（配置化）
- **当前状态**：`RuntimeConfig` 支持从文件和环境变量加载，但不支持运行时动态更新（无 watch 机制）
- **具体缺失**：
  - **架构设计缺失**：修改配置需重启服务；与 evolution 阶段的参数调优（需动态修改 temperature/max_tokens）矛盾
- **预期目标**：`RuntimeConfig` 支持 `update()` 方法，evolution 策略可直接修改运行时配置
- **实现边界**：
  - **范围内**：`RuntimeConfig.update(key_path, value)` 方法；线程安全的配置读写
  - **范围外**：配置文件的 hot-reload（watch 文件变更）

---

#### P2-11：Consensus/Delegation 多 Agent 模式未投入生产使用

- **所属阶段**：非文档规划阶段，代码分析新发现
- **当前状态**：`orchestration/patterns/consensus.py`（共识模式）和 `orchestration/patterns/delegation.py`（委托模式）已实现，但未与任何生产 API 或编排流程集成
- **具体缺失**：
  - **架构设计缺失**：多 Agent 编排的核心价值（多模型投票、按领域分发、结果聚合）无法在 LangGraph 版中体现
- **预期目标**：将 Consensus/Delegation 模式迁移为 LangGraph Subgraph
- **实现边界**：
  - **范围内**：评估 Consensus/Delegation 是否需要在 LangGraph 版中保留
  - **范围外**：全新的多 Agent 框架（如 LangGraph 的 `Send` API）

---

### 7.3 待完成项优先级汇总矩阵

| 优先级 | 编号 | 优化项 | 影响面 | 预估工作量 | 前置依赖 |
|--------|------|--------|--------|-----------|---------|
| 🔴 P0 | P0-1 | 接通 feedback/evolution 闭环 | 核心能力缺失 | 2-3 天 | P0-2 |
| 🔴 P0 | P0-2 | 收敛双轨，删除 Coordinator | 维护性/架构统一 | 2-3 天 | P0-3, P1-1, P1-2 |
| 🔴 P0 | P0-3 | memory_update_node 接入图结构 | 功能对等 | 0.5 天 | 无 |
| 🟡 P1 | P1-1 | AG-UI 适配器迁移 LangGraph 输入源 | 前端兼容性 | 1 天 | P0-2 |
| 🟡 P1 | P1-2 | LangGraph 路径暴露 API 层 | 功能可达性 | 1 天 | P0-2 |
| 🟡 P1 | P1-3 | LLM 推理引擎异步化 | 性能 | 1-2 天 | 无 |
| 🟡 P1 | P1-4 | ToolAdapter 复用线程池 | 性能 | 0.5 天 | P1-3 |
| 🟡 P1 | P1-5 | 提取公共感知管线 | 消除重复 | 0.5 天 | 无 |
| 🟡 P1 | P1-6 | 启用 schemas 类型安全 | 质量防劣化 | 1 天 | P0-2 |
| 🟡 P1 | P1-7 | 统一错误码 | 代码一致性 | 0.5 天 | P0-2 |
| 🟢 P2 | P2-1 | 全局单例测试隔离 | 可测试性 | 1 天 | 无 |
| 🟢 P2 | P2-2 | EventBus 精简 | 工程整洁 | 0.5 天 | 无 |
| 🟢 P2 | P2-3 | 清理空文件与命名 | 工程整洁 | 0.5 天 | 无 |
| 🟢 P2 | P2-4 | 补测试体系 | 质量保障 | 2 天 | P0-2 |
| 🟢 P2 | P2-5 | README.md | 开发者体验 | 0.5 天 | 无 |
| 🟢 P2 | P2-6 | PII 阻断接入熔断 | 安全补全 | 0.5 天 | 无 |
| 🟢 P2 | P2-7 | QualityMonitor 升级 LLM-as-Judge | 质量提升 | 1 天 | P0-1 |
| 🟢 P2 | P2-8 | 任务重试机制 | 鲁棒性 | 1 天 | 无 |
| 🟢 P2 | P2-9 | 监控与可观测性 | 运维能力 | 1 天 | 无 |
| 🟢 P2 | P2-10 | 配置运行时热更新 | 运维灵活性 | 1 天 | 无 |
| 🟢 P2 | P2-11 | 多 Agent 模式评估 | 架构完整性 | 0.5 天 | P0-2 |

---

### 7.4 推荐实施路径

基于依赖关系和影响面分析，推荐按以下 5 波推进：

```
第 1 波（1-2 天）：扫清障碍，可独立进行
  ├── P1-3: LLM 异步化（base_llm.py → httpx.AsyncClient）
  ├── P1-4: ToolAdapter 复用线程池
  ├── P1-5: 提取公共感知管线
  ├── P1-7: 统一错误码
  ├── P2-3: 清理空文件
  └── P2-6: PII 阻断接入熔断

第 2 波（1 天）：补齐 langgraph 功能差距
  ├── P0-3: memory_update_node 接入图（核心阻塞项）
  └── P1-1: AG-UI 适配器迁移（确认事件时序兼容）

第 3 波（2-3 天）：收敛双轨
  ├── P1-2: API 层暴露 LangGraph 路径
  ├── P0-2: 删除 Coordinator，langgraph 成为唯一引擎
  └── P1-6: 启用 schemas 类型安全（入口切换后）

第 4 波（2-3 天）：核心能力补全
  ├── P0-1: 接通 feedback/evolution 闭环
  ├── P2-7: QualityMonitor 升级 LLM-as-Judge
  └── P2-8: 工具/LLM 调用重试机制

第 5 波（1-2 天）：工程治理收尾
  ├── P2-4: 补测试体系
  ├── P2-1: 全局单例测试隔离
  ├── P2-2: EventBus 精简
  ├── P2-5: README.md
  ├── P2-9: 基础监控
  ├── P2-10: 配置热更新
  ├── P2-11: 多 Agent 模式评估
  └── 回归验证：端到端一致性测试
```

**总计预估工作量**：**6-11 个工作日**（按单人全职计算，含测试与验证）。

---

### 7.5 关键风险提示

| 风险项 | 影响 | 缓解措施 |
|--------|------|---------|
| `memory_update_node` 与 LangGraph Checkpointer + Store 的互操作 | 记忆更新节点可能无法正确访问 `BaseStore`（TypedDict 不包含 `_store` 属性） | 评估是否需要 LangGraph 的 `InjectedStore` 机制或 `RunnableConfig` 传递 |
| 删除 Coordinator 后 Sensor 生命周期管理缺位 | `Coordinator.start_sensors()/stop_sensors()` 管理摄像头/麦克风后台采集循环，LangGraph 版无对应机制 | 将 Sensor 管理移入 `runner.py` 的 context manager |
| AG-UI 事件时序与前端兼容性 | LangGraph stream 输出的事件序列与 Coordinator 自研 SSE 帧序列的格式/顺序可能不一致 | 录制 Coordinator 的事件序列作为 Golden Set，LangGraph 版进行对比测试 |
| LangGraph `recursion_limit` 与 `max_reasoning_iterations` 语义差异 | `recursion_limit` 计数所有图边遍历，而非仅 ReAct 循环，可能导致过早截断 | 显式设置 `recursion_limit = 2 * max_iterations + 4`（文档中已规划） |
| `ChromaStore` 的 async 兼容性 | ChromaDB 官方 client 部分方法不支持 async，在 LangGraph 节点中可能阻塞事件循环 | 在 `store_adapter.py` 中使用 `asyncio.to_thread` 包装同步调用 |

---

### 7.6 完成度总览

| 维度 | 完成进度 | 说明 |
|------|---------|------|
| **阶段 0-5（重构核心）** | ████████░░ 85% | 代码结构、State、适配器、Graph、流式、配置化均已完成；仅差 AG-UI 适配迁移和 memory_update 接入图 |
| **阶段 6（迁移验证）** | ███░░░░░░░ 30% | feature flag 就绪，但旧代码未删、API 层未切换、示例未全量对齐、测试空白 |
| **feedback/evolution 闭环** | ██████░░░░ 60% | 各组件独立实现完整，但编排串联层缺失 |
| **工程质量** | ███░░░░░░░ 30% | 类型安全未启用、错误码不统一、空文件多、零测试、无监控 |
| **整体完成度** | ██████░░░░ 55% | 架构骨架已搭好，但距生产就绪仍有约 6-11 人天的工作量 |

**核心结论**：ModuAgent 的 LangGraph 重构在架构层面方向正确、代码框架完整，**约 55% 的规划目标已达成**。剩余工作集中在三个方面：（1）**连通性**——将已就绪的独立模块（feedback/evolution、memory_update、AG-UI）串联为完整的数据流；（2）**收敛性**——删除 legacy Coordinator，使 langgraph 成为唯一编排引擎；（3）**生产化**——补齐测试、监控、类型安全、错误处理、异步性能。建议按照上文 5 波推进路径，优先以"可运行的最小闭环"为目标（第 1-3 波），再逐步增强生产就绪度（第 4-5 波）。
