"""感知管线公共入口（P1-5：提取公共感知管线）。

将 coordinator._run_perception_pipeline 与 nodes.perception_node 中重复的
感知管线逻辑提取为统一函数，消除复制粘贴。

流程：
    1. 根据 input_type 从 routing 配置获取感知器链
    2. 依次执行每个感知器，前一个的输出文本作为后一个的输入
    3. 若有多个感知器结果，使用 PerceptionFusion 融合

P2-12.3.4：新增异步并行版本 run_perception_pipeline_async，
独立感知器（不依赖前一感知器输出）可并行执行，依赖感知器串行。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from components.perception.fusion import PerceptionFusion
from core.registry import ComponentRegistry

logger = logging.getLogger(__name__)


def _resolve_pipeline(config: Any, input_type: str) -> List[str]:
    """从配置解析感知器链。"""
    routing = config.get("perception.routing", {})
    pipeline_config = routing.get(input_type, {})
    pipeline: List[str] = pipeline_config.get("pipeline", ["text_preprocessor"])
    if not pipeline:
        pipeline = ["text_preprocessor"]
    return pipeline


def _fuse_results(
    config: Any,
    results: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """融合多路感知结果。"""
    if not results:
        return None
    if len(results) == 1:
        return results[0]
    fusion = PerceptionFusion(
        strategy=config.get("perception.fusion.strategy", "weighted_average"),
        weights=config.get("perception.fusion.weights"),
    )
    return fusion.fuse(results)


def run_perception_pipeline(
    input_data: Dict[str, Any],
    config: Any,
    registry: ComponentRegistry,
) -> Optional[Dict[str, Any]]:
    """执行感知管线：输入路由 + 感知器链 + 多路融合。

    统一入口，供 Coordinator（legacy）和 LangGraph perception_node 共用，
    消除两处复制粘贴的重复逻辑。

    Args:
        input_data: 输入数据，包含 input_type / prompt / sensitivity_level
        config: RuntimeConfig 实例，提供 perception.routing 等配置
        registry: ComponentRegistry 实例，提供感知器查找

    Returns:
        融合后的感知结果字典；无结果时返回 None
    """
    input_type = input_data.get("input_type", "text")
    raw_content = input_data.get("prompt", "").encode("utf-8")
    sensitivity_level = input_data.get("sensitivity_level", 0)

    pipeline = _resolve_pipeline(config, input_type)

    results: List[Dict[str, Any]] = []
    current_content = raw_content
    current_input_type = input_type

    for processor_name in pipeline:
        perception = registry.get_perception(processor_name)
        if perception is None:
            logger.warning("Perception component '%s' not registered, skipping", processor_name)
            continue

        try:
            result = perception.perceive(
                input_type=current_input_type,
                raw_content=current_content,
                sensitivity_level=sensitivity_level,
            )
            results.append(result)

            # 管线传递：若感知器输出转为文本，则后续感知器以文本为输入
            parsed = result.get("parsed_content", {})
            if parsed.get("text") and parsed.get("input_type") == "text":
                current_content = parsed["text"].encode("utf-8")
                current_input_type = "text"

        except Exception as e:
            logger.error("Perception '%s' failed: %s", processor_name, str(e))
            continue

    return _fuse_results(config, results)


async def run_perception_pipeline_async(
    input_data: Dict[str, Any],
    config: Any,
    registry: ComponentRegistry,
) -> Optional[Dict[str, Any]]:
    """异步执行感知管线（P2-12.3.4：独立感知器并行化）。

    策略：
        - 第一个感知器串行执行（确定输入类型/文本基线）
        - 后续不依赖前一感知器文本输出的独立感知器并行执行
        - 依赖前一感知器输出的感知器串行执行

    感知器并行通过 asyncio.to_thread 包装同步 perceive 调用，
    避免阻塞事件循环。

    Args:
        input_data: 输入数据，包含 input_type / prompt / sensitivity_level
        config: RuntimeConfig 实例，提供 perception.routing 等配置
        registry: ComponentRegistry 实例，提供感知器查找

    Returns:
        融合后的感知结果字典；无结果时返回 None
    """
    input_type = input_data.get("input_type", "text")
    raw_content = input_data.get("prompt", "").encode("utf-8")
    sensitivity_level = input_data.get("sensitivity_level", 0)

    pipeline = _resolve_pipeline(config, input_type)

    async def _perceive_safe(
        name: str, in_type: str, content: bytes, level: int
    ) -> Tuple[str, Optional[Dict[str, Any]]]:
        perception = registry.get_perception(name)
        if perception is None:
            logger.warning("Perception component '%s' not registered, skipping", name)
            return name, None
        try:
            result = await asyncio.to_thread(
                perception.perceive,
                input_type=in_type,
                raw_content=content,
                sensitivity_level=level,
            )
            return name, result
        except Exception as e:
            logger.error("Perception '%s' failed: %s", name, str(e))
            return name, None

    results: List[Dict[str, Any]] = []
    current_content = raw_content
    current_input_type = input_type

    # 首个感知器串行执行，建立文本基线
    if pipeline:
        name, result = await _perceive_safe(
            pipeline[0], current_input_type, current_content, sensitivity_level
        )
        if result is not None:
            results.append(result)
            parsed = result.get("parsed_content", {})
            if parsed.get("text") and parsed.get("input_type") == "text":
                current_content = parsed["text"].encode("utf-8")
                current_input_type = "text"

    # 后续感知器：基于前一感知器输出并行执行（输入为已建立的文本基线）
    if len(pipeline) > 1:
        tasks = [
            _perceive_safe(n, current_input_type, current_content, sensitivity_level)
            for n in pipeline[1:]
        ]
        outcomes = await asyncio.gather(*tasks)
        for _, res in outcomes:
            if res is not None:
                results.append(res)

    return _fuse_results(config, results)
