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
from components.memory.cache.redis_adapter import InMemoryShortTermMemory
from components.perception.text.rule_based import TextPreprocessor
from components.reasoning.llm.glm import GLMLLMReasoner
from config.runtime_config import get_config
from core.registry import get_registry
from orchestration.coordinator import Coordinator

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def register_components() -> None:
    registry = get_registry()

    registry.register_perception("text_preprocessor", TextPreprocessor())

    registry.register_reasoning_engine("glm", GLMLLMReasoner())

    registry.register_memory("short_term", InMemoryShortTermMemory())

    registry.register_tool(SearchTool())
    registry.register_tool(CalculatorTool())

    registry.register_action_executor("sync", SyncActionExecutor())

    logger.info("All components registered: %s", json.dumps(registry.list_all(), indent=2))


async def run_basic_flow() -> None:
    coordinator = Coordinator()
    user_id = "demo_user"
    session_id = "demo_session_001"

    result = await coordinator.process_request(
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
    coordinator = Coordinator()
    user_id = "demo_user"
    session_id = "demo_session_002"

    result = await coordinator.process_request(
        user_id=user_id,
        session_id=session_id,
        input_data={
            "input_type": "text",
            "prompt": "请帮我计算 3.14 * 2",
            "required_fields": ["user_intent"],
            "tools": [
                {
                    "name": "calculator",
                    "parameters": {"expression": "3.14*2"},
                },
            ],
        },
    )
    logger.info("Tool flow result: %s", json.dumps(result, ensure_ascii=False, indent=2))


async def run_llm_swap_flow() -> None:
    registry = get_registry()
    coordinator = Coordinator()
    user_id = "demo_user"
    session_id = "demo_session_003"

    logger.info("=== Using GLM engine ===")
    result = await coordinator.process_request(
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

    logger.info("All demos completed")


if __name__ == "__main__":
    asyncio.run(main())
