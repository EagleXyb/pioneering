from __future__ import annotations

import asyncio
import json
import logging
import os
import sys

# 加载环境变量
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from components.action.executors.synchronous import SyncActionExecutor
from components.action.tools.calculator import CalculatorTool
from components.action.tools.search import SearchTool
from components.memory.cache.short_term_memory import InMemoryShortTermMemory
from components.memory.vector.chroma import ChromaLongTermMemory
from components.perception.audio.asr_processor import AudioProcessor
from components.perception.text.llm_parser import LLMParser
from components.perception.text.rule_based import TextPreprocessor
from components.perception.vision.camera import CameraSensor, MicrophoneSensor
from components.perception.vision.image_processor import ImageProcessor
from components.reasoning.llm.glm import GLMLLMReasoner
from config.runtime_config import get_config
from core.registry import get_registry

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def register_components() -> None:
    registry = get_registry()
    config = get_config()

    # 感知层组件
    registry.register_perception("text_preprocessor", TextPreprocessor())

    # P1: LLM 深度解析器
    deep_parsing_config = config.get("perception.deep_parsing", {})
    llm_parser = LLMParser(
        enable_intent=deep_parsing_config.get("enable_intent", True),
        enable_quality=deep_parsing_config.get("enable_quality", False),
        enable_local_ner=deep_parsing_config.get("enable_local_ner", True),
        enable_local_sentiment=deep_parsing_config.get("enable_local_sentiment", True),
        spacy_model=deep_parsing_config.get("spacy_model"),
    )
    registry.register_perception("llm_parser", llm_parser)

    # P1: 图像处理器
    registry.register_perception("image_processor", ImageProcessor())

    # P1: 音频处理器
    registry.register_perception("audio_processor", AudioProcessor())

    # P1: 传感器
    registry.register_sensor("camera", CameraSensor())
    registry.register_sensor("microphone", MicrophoneSensor())

    # 推理引擎
    registry.register_reasoning_engine("glm", GLMLLMReasoner())

    # 记忆
    registry.register_memory("short_term", InMemoryShortTermMemory())
    registry.register_memory("long_term", ChromaLongTermMemory())

    # 工具
    registry.register_tool(SearchTool())
    registry.register_tool(CalculatorTool())

    # 行动执行器
    registry.register_action_executor("sync", SyncActionExecutor())

    logger.info("All components registered: %s", json.dumps(registry.list_all(), indent=2))


async def run_basic_flow() -> None:
    """基础流程 Demo（P0-2: 使用 LangGraph 替代 Coordinator）。"""
    from modu_graph.factory import create_agent
    from modu_graph.runner import run_sync

    graph = create_agent()
    user_id = "demo_user"
    session_id = "demo_session_001"

    result = await run_sync(
        graph=graph,
        user_id=user_id,
        session_id=session_id,
        input_data={
            "input_type": "text",
            "prompt": "你好，请介绍一下你自己",
            "required_fields": ["user_intent"],
        },
    )
    logger.info("Basic flow result: %s", json.dumps(result, ensure_ascii=False, indent=2))


async def run_tool_flow() -> None:
    """工具调用 Demo（P0-2: 使用 LangGraph 原生 function calling）。"""
    from modu_graph.factory import create_agent
    from modu_graph.runner import run_sync

    graph = create_agent()
    user_id = "demo_user"
    session_id = "demo_session_002"

    result = await run_sync(
        graph=graph,
        user_id=user_id,
        session_id=session_id,
        input_data={
            "input_type": "text",
            "prompt": "请帮我计算 3.14 * 2",
            "required_fields": ["user_intent"],
        },
    )
    logger.info("Tool flow result: %s", json.dumps(result, ensure_ascii=False, indent=2))


async def run_llm_swap_flow() -> None:
    """LLM 引擎切换 Demo（P0-2: 通过 configurable 覆盖 provider）。"""
    from modu_graph.factory import create_agent
    from modu_graph.runner import run_sync

    graph = create_agent(config={"configurable": {"llm_provider": "glm"}})
    user_id = "demo_user"
    session_id = "demo_session_003"

    logger.info("=== Using GLM engine ===")
    result = await run_sync(
        graph=graph,
        user_id=user_id,
        session_id=session_id,
        input_data={
            "input_type": "text",
            "prompt": "1+1等于几？",
            "required_fields": ["user_intent"],
        },
    )
    logger.info("GLM result: %s", json.dumps(result, ensure_ascii=False, indent=2))


async def run_perception_demo() -> None:
    registry = get_registry()
    perception = registry.get_perception("text_preprocessor")

    result = perception.perceive(
        input_type="text",
        raw_content="请帮我查询银行卡余额".encode("utf-8"),
    )
    logger.info("Perception result: %s", json.dumps(result, ensure_ascii=False, indent=2))


async def run_memory_demo() -> None:
    registry = get_registry()
    short_term = registry.get_memory("short_term")

    short_term.update(
        user_id="demo_user",
        new_data={"role": "user", "content": "你好"},
        metadata={"session_id": "s1"},
    )
    short_term.update(
        user_id="demo_user",
        new_data={"role": "assistant", "content": "你好！有什么可以帮你的？"},
        metadata={"session_id": "s1"},
    )

    result = short_term.query(
        user_id="demo_user",
        context_window="last_5_turns",
        required_fields=["role", "content"],
    )
    logger.info("Short-term memory: %s", json.dumps(result, ensure_ascii=False, indent=2))


# ============================================================
# LangGraph 重构版 Demo（对应重构方案阶段 6 示例对齐）
# ============================================================

async def run_langgraph_basic_flow() -> None:
    """LangGraph 版本的基础流程 Demo。

    使用 create_agent() 创建 LangGraph 实例，
    通过 run_sync() 调用（替代 Coordinator.process_request）。
    """
    from modu_graph.factory import create_agent
    from modu_graph.runner import run_sync

    graph = create_agent()
    user_id = "demo_user"
    session_id = "demo_session_lg_001"

    result = await run_sync(
        graph=graph,
        user_id=user_id,
        session_id=session_id,
        input_data={
            "input_type": "text",
            "prompt": "你好，请介绍一下你自己",
            "required_fields": ["user_intent"],
        },
    )
    logger.info("LangGraph basic flow result: %s", json.dumps(result, ensure_ascii=False, indent=2))


async def run_langgraph_tool_flow() -> None:
    """LangGraph 版本的工具调用 Demo。

    使用 LangGraph 原生 function calling（替代正则解析 ```tool_call```），
    通过 ToolNode 执行工具（替代 ToolAdapter.invoke_tool）。
    """
    from modu_graph.factory import create_agent
    from modu_graph.runner import run_sync

    graph = create_agent()
    user_id = "demo_user"
    session_id = "demo_session_lg_002"

    result = await run_sync(
        graph=graph,
        user_id=user_id,
        session_id=session_id,
        input_data={
            "input_type": "text",
            "prompt": "请帮我计算 3.14 * 2",
            "required_fields": ["user_intent"],
        },
    )
    logger.info("LangGraph tool flow result: %s", json.dumps(result, ensure_ascii=False, indent=2))


async def run_langgraph_stream_flow() -> None:
    """LangGraph 版本的流式输出 Demo。

    使用 LangGraph astream 实现流式输出（替代 Coordinator.stream_request），
    通过 EventBridge 桥接到 EventBus。
    """
    from modu_graph.factory import create_agent
    from modu_graph.runner import stream_response

    graph = create_agent()
    user_id = "demo_user"
    session_id = "demo_session_lg_003"

    logger.info("LangGraph stream tokens:")
    async for event in stream_response(
        graph=graph,
        user_id=user_id,
        session_id=session_id,
        input_data={
            "input_type": "text",
            "prompt": "请用三句话介绍 LangGraph",
            "required_fields": ["user_intent"],
        },
    ):
        event_type = event.get("type", "")
        if event_type == "messages":
            data = event.get("data", {})
            # 提取 token 内容
            chunk = data[0] if isinstance(data, list) and data else data
            content = getattr(chunk, "content", "") if hasattr(chunk, "content") else str(chunk)
            if content:
                logger.info("  token: %s", content[:100])
        elif event_type == "updates":
            node = event.get("node", "")
            logger.info("  update from node: %s", node)


async def main() -> None:
    register_components()

    logger.info("=" * 60)
    logger.info("1. Perception Demo")
    logger.info("=" * 60)
    await run_perception_demo()

    logger.info("=" * 60)
    logger.info("2. Memory Demo")
    logger.info("=" * 60)
    await run_memory_demo()

    logger.info("=" * 60)
    logger.info("3. Tool Flow Demo")
    logger.info("=" * 60)
    await run_tool_flow()

    logger.info("=" * 60)
    logger.info("4. Basic Flow Demo (requires LLM API key)")
    logger.info("=" * 60)
    config = get_config()
    provider = config.get("llm.default_provider", "deepseek")
    if provider:
        try:
            await run_basic_flow()
        except Exception as e:
            logger.warning("Basic flow skipped (LLM API unavailable): %s", e)
    else:
        logger.info("No LLM provider configured, skipping basic flow")

    logger.info("=" * 60)
    logger.info("5. GLM Reasoning Demo")
    logger.info("=" * 60)
    try:
        await run_llm_swap_flow()
    except Exception as e:
        logger.warning("GLM reasoning demo skipped: %s", e)

    # LangGraph 重构版 Demo
    logger.info("=" * 60)
    logger.info("6. LangGraph Basic Flow Demo (requires LLM API key)")
    logger.info("=" * 60)
    try:
        await run_langgraph_basic_flow()
    except Exception as e:
        logger.warning("LangGraph basic flow skipped: %s", e)

    logger.info("=" * 60)
    logger.info("7. LangGraph Tool Flow Demo (requires LLM API key)")
    logger.info("=" * 60)
    try:
        await run_langgraph_tool_flow()
    except Exception as e:
        logger.warning("LangGraph tool flow skipped: %s", e)

    logger.info("=" * 60)
    logger.info("8. LangGraph Stream Flow Demo (requires LLM API key)")
    logger.info("=" * 60)
    try:
        await run_langgraph_stream_flow()
    except Exception as e:
        logger.warning("LangGraph stream flow skipped: %s", e)

    logger.info("All demos completed")


if __name__ == "__main__":
    asyncio.run(main())
