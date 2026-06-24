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
| **反馈/进化层** | 质量监控、进化信号收集、组件热替换 | `orchestration/communication/message_bus.py` 中 `EvolutionSignalCollector` |

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
     - _tool_adapter.invoke_tool()      → 执行工具（带超时）
     - 格式错误自纠正（max_format_retries）
     - continuation_prompt 再生成
  7. SSE 流式输出（token 分块）
  8. _storage_adapter.update_all() → 记忆持久化
  9. EventBus 发布事件（perception/memory/reasoning/tool/action）
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

1. 在 `pyproject.toml` 增加依赖：

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

3. 编写 `langgraph/__init__.py` 占位，确保 import 不冲突。

---

### 阶段 1：定义类型化 State（替换隐式 context dict）

**目标**：用 `TypedDict` 显式声明图状态，替代 `coordinator.py` 中四处传递的 `context: Dict[str, Any]`。

**步骤**：

1. 新建 `langgraph/state.py`：

```python
from typing import TypedDict, Annotated, List, Dict, Any, Optional
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class ModuAgentState(TypedDict):
    # 消息历史（LangGraph 内置 reducer，自动追加）
    messages: Annotated[List[BaseMessage], add_messages]

    # 会话标识
    user_id: str
    session_id: str
    trace_id: str

    # 感知结果
    perception_result: Optional[Dict[str, Any]]
    cleaned_text: Optional[str]

    # 记忆
    history: List[Dict[str, Any]]
    knowledge: List[Dict[str, Any]]

    # 工具
    tool_results: List[Dict[str, Any]]

    # 元数据
    sensitivity_level: int
    confidence: float

    # 迭代控制
    iteration: int

    # 最终响应
    response: str
```

**关键映射**：原 `context["history"]`、`context["perception"]`、`context["native_tools"]` 全部提升为 State 字段，获得类型检查与检查点持久化。

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


def build_langchain_tools() -> list[LCTool]:
    registry = get_registry()
    return [wrap_modu_tool(t) for t in registry._tools.values()]
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
        "api_key": "DEEPSEEK_API_KEY",
        "base_url": "DEEPSEEK_BASE_URL",
        "model": "DEEPSEEK_MODEL",
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
}


def build_chat_model(provider: str | None = None) -> ChatOpenAI:
    """构建 LangChain ChatOpenAI 实例，复用现有环境变量约定。"""
    import os

    cfg = get_config()
    provider = provider or cfg.get("llm.default_provider", "glm")
    pcfg = _PROVIDER_CONFIG.get(provider, _PROVIDER_CONFIG["glm"])

    return ChatOpenAI(
        api_key=os.getenv(pcfg["api_key"]) or os.getenv("LLM_API_KEY", ""),
        base_url=os.getenv(pcfg["base_url"]) or os.getenv("LLM_BASE_URL", pcfg["default_base_url"]),
        model=os.getenv(pcfg["model"]) or os.getenv("LLM_DEFAULT_MODEL", pcfg["default_model"]),
        temperature=cfg.get("llm.temperature", 0.7),
        max_tokens=cfg.get("llm.max_tokens", 512),
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


def llm_node(state: ModuAgentState) -> dict:
    """对应 _llm_adapter.generate + bind_tools。

    ChatModel.bind_tools(tools).invoke(state["messages"]) 实现原生 function calling。
    """
    # tools 通过编译时注入
    # messages 由 State 自动维护
    # 无需手动构建 prompt template / tool description
    # LangChain ChatModel 自动处理 function calling
    return {}  # 实际由 LangGraph 的 llm 调用节点处理


def route_after_perception(state: ModuAgentState) -> str:
    """对应 coordinator.py 中的敏感度熔断逻辑。"""
    config = get_config()

    # 敏感度熔断
    sensitivity_threshold = config.get("perception.sensitivity_threshold", 5)
    if state["sensitivity_level"] >= sensitivity_threshold:
        return "__end__"

    # 注入检测熔断
    security_config = config.get("perception.security", {})
    if security_config.get("block_on_injection"):
        if state.get("perception_result", {}).get("metadata", {}).get("injection_detected"):
            return "__end__"

    return "memory_query"


def route_after_agent(state: ModuAgentState) -> str:
    """对应 ReAct 循环退出判断。

    检查最后一条消息是否包含 tool_calls。
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
    graph.add_node("memory_query", memory_query_node)

    # agent 节点：使用绑定了工具的 LLM
    def agent_node(state: ModuAgentState) -> dict:
        messages = state.get("messages", [])
        if not messages:
            return {}
        response = bound_llm.invoke(messages)
        return {"messages": [response]}

    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(tools))

    # 添加边
    graph.add_conditional_edges(
        "perception",
        route_after_perception,
        {"memory_query": "memory_query", "__end__": END},
    )
    graph.add_conditional_edges(
        "agent",
        route_after_agent,
        {"tools": "tools", "__end__": END},
    )

    graph.add_edge(START, "perception")
    graph.add_edge("memory_query", "agent")
    graph.add_edge("tools", "agent")  # ReAct 循环

    return graph.compile(checkpointer=checkpointer, store=store)
```

#### 3.3 条件路由逻辑对比

| 原 Coordinator 逻辑 | LangGraph 节点/边 | 说明 |
|---|---|---|
| 敏感度 >= threshold → 返回 error | `route_after_perception` → END | 条件边直接终止 |
| 注入检测 → 返回 error | `route_after_perception` → END | 同上 |
| tool_calls 为空 → 返回 response | `route_after_agent` → END | 正常结束 |
| tool_calls 非空 → 执行工具 | `route_after_agent` → "tools" | 进入 ReAct 循环 |
| 工具执行完 → 继续推理 | `tools` → "agent" | 硬边，自动循环 |
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
    input_state: dict,
    config: dict,
) -> AsyncGenerator[Dict[str, Any], None]:
    """替代 Coordinator.stream_request。

    使用 LangGraph 原生 astream 实现流式输出。
    """
    async for event in graph.astream(
        input_state,
        config={"configurable": {"thread_id": config.get("session_id", "")}},
        stream_mode=["messages", "updates", "custom"],
    ):
        # stream_mode="messages" → token 级流式
        # stream_mode="updates" → 节点状态更新
        # stream_mode="custom" → 自定义事件
        yield event


async def run_sync(
    graph: CompiledGraph,
    input_state: dict,
    config: dict,
) -> Dict[str, Any]:
    """替代 Coordinator.process_request。

    非流式调用，等待完整结果。
    """
    final_state = await graph.ainvoke(
        input_state,
        config={"configurable": {"thread_id": config.get("session_id", "")}},
    )
    return {
        "status": "success",
        "error_code": "",
        "data": {
            "response": final_state.get("response", ""),
            "tool_results": final_state.get("tool_results", []),
            "trace_id": final_state.get("trace_id", ""),
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


def create_agent(config: Optional[RunnableConfig] = None) -> CompiledGraph:
    """根据配置创建 ModuAgent LangGraph 实例。

    支持通过 config 覆盖运行时参数（如 LLM provider、temperature 等）。
    """
    cfg = get_config()

    # 从 config 读取 provider，支持运行时覆盖
    provider = None
    if config and "configurable" in config:
        provider = config["configurable"].get("llm_provider")

    # 构建组件
    llm = build_chat_model(provider)
    tools = build_langchain_tools()
    checkpointer = build_checkpointer(cfg.get("memory.checkpointer_type", "memory"))
    store = build_store(cfg.get("memory.store_type", "chroma"))

    # 构建并编译图
    return build_modu_graph(tools, llm, checkpointer, store)
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
| `langgraph/__init__.py` | 包初始化 | 5 |
| `langgraph/state.py` | `ModuAgentState` TypedDict | 60 |
| `langgraph/nodes.py` | 图节点函数（perception/memory/route） | 200 |
| `langgraph/graph.py` | `build_modu_graph()` 图构建 | 100 |
| `langgraph/runner.py` | 统一入口（流式/非流式） | 120 |
| `langgraph/factory.py` | 配置化组件工厂 | 80 |
| `langgraph/adapters/tool_adapter.py` | BaseTool → LangChain 包装 | 60 |
| `langgraph/adapters/llm_adapter.py` | BaseReasoningEngine → ChatOpenAI | 70 |
| `langgraph/adapters/store_adapter.py` | ChromaLongTermMemory → BaseStore | 100 |
| `langgraph/adapters/event_bridge.py` | LangGraph stream → EventBus 桥接 | 80 |
| **小计** | | **875** |

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
| `config/runtime_config.py` | ~162 | 配置管理，重构方案依赖 |

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
| 编排层代码量 | ~1800 行 | ~875 行（新增） | **净减 ~900 行** |
| ReAct 实现方式 | 手写正则解析 + 格式重试 | LangGraph ToolNode | 消灭脆弱性 |
| 状态管理 | 隐式 `context: Dict` | 类型化 `ModuAgentState` | 类型安全 |
| 流式实现 | 手写 SSE 帧拼接 | LangGraph `astream` | 标准化 |
| 检查点 | 无（需手动存储） | Memory/Sqlite/Postgres | 开箱即用 |
| 测试难度 | 需 Mock 整个 Coordinator | 节点函数可独立测试 | 大幅降低 |

### 最大收益

- **删除约 1500 行编排胶水代码**，获得类型安全 State、原生 function calling、自动检查点、标准化流式、可观测事件流
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
│   ├── graph/nodes/state/runner/factory.py
│   └── adapters/          # llm/tool/store/event_bridge 适配器
├── adapters/              # LLMAdapter / ToolAdapter / StorageAdapter
├── config/                # RuntimeConfig（点路径访问）+ schemas.py（几乎未用）
├── feedback/              # ✗ 6 个文件全空
├── evolution/             # ✗ 5 个文件全空
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
| `langgraph/` | ★★★☆ | 重构方向正确，但缺少 legacy 的 SSE 细节、记忆更新、进化信号收集 |
| `components/reasoning/llm` | ★★★☆ | 4 引擎结构清晰，但全用同步 `httpx`，异步环境需 `to_thread` 包装 |
| `orchestration/coordinator` | ★★☆ | 上帝类，process/stream 严重重复，正则解析 tool_call 已过时 |
| `components/memory` | ★★☆ | 基本可用，但 `redis_adapter.py` 名不副实，`faiss.py` 空 |
| `components/action` | ★★☆ | `async_executor.py`/`api_client.py` 空文件 |
| `config` | ★★☆ | schemas.py 定义了完整 dataclass 却几乎不用，全靠 `Dict[str, Any]` |
| `feedback` | ☆ | **完全空壳**，6 个文件 0 行代码 |
| `evolution` | ☆ | **完全空壳**，5 个文件 0 行代码 |

### 6.3 关键问题诊断

#### P0 — 架构层面

**1. `feedback` 和 `evolution` 两大模块完全空壳**

README/ARCHITECTURE.md 将"反馈驱动"和"持续进化"作为系统核心卖点，但 `feedback/`（6 文件）和 `evolution/`（5 文件）**全部为空**。系统的自评估、质量监控、组件热替换、参数调优、版本回滚能力均不存在。`ComponentRegistry.swap_component` 和 `EvolutionSignalCollector` 收集的信号无人消费。

**2. 双轨架构导致大面积代码重复与能力割裂**

`legacy Coordinator`（1048 行）与 `langgraph/` 重构版并存：
- `coordinator._run_perception_pipeline` 与 `langgraph/nodes.py:perception_node` 几乎是复制粘贴（`coordinator.py:920-980` vs `nodes.py:48-149`）
- `process_request` 与 `stream_request` 内部逻辑（感知、熔断、记忆、ReAct）约 60% 重复（`coordinator.py:87-412` vs `414-798`）
- langgraph 版**缺失**：SSE 细粒度事件（thinking/tool_call_start/tool_result）、记忆更新（`update_all`）、进化信号收集、低置信度保守模式

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

`redis_adapter.py` 实为纯内存实现（无 Redis）；`faiss.py`/`async_executor.py`/`api_client.py`/`feedback/*`/`evolution/*` 共 14 个空文件。

**13. 缺少测试**

`pyproject.toml` 配置 `testpaths = ["tests"]`，但 `tests/` 目录不存在。

**14. README.md 为空**

仅 `ARCHITECTURE.md` 有目录树，无使用说明。

### 6.4 优化方案（按优先级分阶段）

#### 阶段一：收敛双轨，消除重复（P0，预计 3-5 天）

**目标：** 完成 legacy → langgraph 迁移，删除上帝类。

1. **补齐 langgraph 版缺失能力**
   - 在 `langgraph/nodes.py` 的 `agent_node` 中加入低置信度保守模式（动态降 `temperature`）
   - 在 `response_node` 后增加 `memory_update_node`，用图节点替代 fire-and-forget task
   - 在 `event_bridge.py` 中补全 SSE 细粒度事件映射（thinking/tool_call_start/tool_result）
   - 将 `EvolutionSignalCollector` 订阅接入 EventBridge

2. **提取公共感知管线**
   将 `coordinator._run_perception_pipeline` 与 `nodes.perception_node` 的重复逻辑提取为 `components/perception/pipeline.py:run_perception_pipeline(input_data, config, registry)`，两处统一调用。

3. **删除 legacy Coordinator**
   确认 langgraph 版功能对等后，删除 `coordinator.py`（1048 行），`get_runner()` 移除 legacy 分支。

#### 阶段二：异步化 LLM 层 + 工具层（P1，预计 2-3 天）

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

3. **记忆更新改为图节点**
   用 `memory_update_node` 替代 `asyncio.create_task`，确保异常可观测、进程退出前可等待。

#### 阶段三：补齐 feedback + evolution（P0，预计 5-7 天）

这是架构承诺但完全缺失的核心能力：

1. **feedback 模块实现**
   - `loop_controller.py`：实现 `FeedbackLoop(BaseFeedbackLoop)`，`evaluate()` 调用 quality_monitor + metrics，`should_evolve()` 对比阈值
   - `quality_monitor.py`：基于 LLM-as-Judge 或规则评估响应质量（相关性/完整性/准确性）
   - `metrics/accuracy.py`：工具调用成功率、答案事实准确性
   - `metrics/efficiency.py`：token 用量、延迟、ReAct 迭代次数

2. **evolution 模块实现**
   - `strategy/parameter_tune.py`：根据 feedback 信号自动调 `temperature`/`max_iterations`（消费 `EvolutionSignalCollector` 已收集的信号）
   - `strategy/component_swap.py`：基于质量对比自动切换 LLM provider（A/B 测试）
   - `registry/versioned_store.py`：组件版本快照存储
   - `registry/rollback_mechanism.py`：质量回退时自动回滚到上一版本

3. **闭环接线**
   `EvolutionSignalCollector` → `FeedbackLoop.evaluate` → `should_evolve` → `EvolutionStrategy.apply` → `ComponentRegistry.swap_component` / 参数更新。

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
| 补齐 feedback/evolution 空壳 | 核心能力缺失 | 🔴 高 | 阶段三 |
| 收敛双轨，删除 Coordinator 上帝类 | 维护性 | 🔴 高 | 阶段一 |
| LLM 异步化 | 性能 | 🟡 中 | 阶段二 |
| 补齐 langgraph 缺失能力 | 功能对等 | 🔴 高 | 阶段一 |
| 记忆更新可观测化 | 数据可靠性 | 🟡 中 | 阶段二 |
| 启用 schemas 类型安全 | 质量防劣化 | 🟢 低 | 阶段四 |
| 清理空文件/命名 | 工程整洁 | 🟢 低 | 阶段四 |
| 补测试 | 质量保障 | 🟡 中 | 阶段四 |

**总结：** ModuAgent 的**感知层和编排层设计成熟**，LangGraph 重构方向正确，但存在三大短板：① feedback/evolution 完全空壳导致"自进化"承诺落空；② 双轨并存导致 1048 行上帝类与重复代码；③ LLM 同步调用制约异步性能。建议优先按"收敛双轨 → 异步化 → 补齐反馈进化闭环"的路径推进，最终达成架构文档所描绘的模块化自进化 Agent 框架。
