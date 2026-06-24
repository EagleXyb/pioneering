"""工具适配器：ModuAgent BaseTool → LangChain StructuredTool。

将现有 components/action/tools/ 下的工具（CalculatorTool / SearchTool 等）
包装为 LangChain BaseTool，使 LangGraph 的 ToolNode 可直接消费。

保留原 BaseTool 接口以支持双轨运行（legacy Coordinator 仍可调用原工具）。
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from langchain_core.tools import BaseTool as LCTool, StructuredTool
from pydantic import BaseModel, create_model

from core.registry import ComponentRegistry, get_registry

logger = logging.getLogger(__name__)


def _schema_to_pydantic_model(
    name: str,
    schema: Dict[str, Any],
) -> Optional[type[BaseModel]]:
    """将 JSON Schema 转换为 Pydantic 模型（用于 StructuredTool.args_schema）。

    Args:
        name: 模型名称
        schema: JSON Schema 字典（含 properties / required）

    Returns:
        Pydantic 模型类，或 None（schema 为空时）
    """
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))

    if not properties:
        return None

    # JSON Schema type → Python type 映射
    _type_map = {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "array": list,
        "object": dict,
    }

    fields: Dict[str, Any] = {}
    for field_name, field_spec in properties.items():
        json_type = field_spec.get("type", "string")
        py_type = _type_map.get(json_type, str)
        description = field_spec.get("description", "")

        if field_name in required:
            fields[field_name] = (py_type, ...)
        else:
            fields[field_name] = (Optional[py_type], None)

        # 附加描述到 Field
        if description:
            from pydantic import Field
            default_val = ... if field_name in required else None
            fields[field_name] = (
                py_type if field_name in required else Optional[py_type],
                Field(default=default_val, description=description),
            )

    return create_model(name, **fields)  # type: ignore[arg-type]


def wrap_modu_tool(modu_tool: Any) -> LCTool:
    """将 ModuAgent BaseTool 包装为 LangChain StructuredTool。

    ModuAgent BaseTool 接口：
        - name() → str
        - description() → str
        - parameters_schema() → Dict (JSON Schema)
        - invoke(params: Dict, context: Dict) → Dict

    Args:
        modu_tool: ModuAgent BaseTool 实例

    Returns:
        LangChain StructuredTool 实例
    """
    tool_name = modu_tool.name()
    tool_desc = modu_tool.description()
    schema = modu_tool.parameters_schema()

    args_schema = _schema_to_pydantic_model(f"{tool_name}_schema", schema)

    def _invoke(**kwargs: Any) -> str:
        """同步调用 ModuAgent 工具，返回 JSON 字符串结果。"""
        import json

        result = modu_tool.invoke(params=kwargs, context={})
        return json.dumps(result, ensure_ascii=False)

    return StructuredTool.from_function(
        func=_invoke,
        name=tool_name,
        description=tool_desc,
        args_schema=args_schema,
    )


def build_langchain_tools(
    registry: Optional[ComponentRegistry] = None,
    tool_names: Optional[List[str]] = None,
) -> List[LCTool]:
    """从注册表构建 LangChain 工具列表。

    Args:
        registry: 组件注册表（默认使用全局单例）
        tool_names: 指定工具名列表（None=注册表中全部工具）

    Returns:
        LangChain BaseTool 列表
    """
    if registry is None:
        registry = get_registry()

    all_tools = registry.list_tools()

    if tool_names:
        all_tools = {
            name: info
            for name, info in all_tools.items()
            if name in tool_names
        }

    lc_tools: List[LCTool] = []
    for tool_name in all_tools:
        modu_tool = registry.get_tool(tool_name)
        if modu_tool is None:
            logger.warning("Tool '%s' not found in registry, skipping", tool_name)
            continue
        try:
            lc_tools.append(wrap_modu_tool(modu_tool))
        except Exception as e:
            logger.error("Failed to wrap tool '%s': %s", tool_name, str(e))

    logger.info("Built %d LangChain tools: %s", len(lc_tools), [t.name for t in lc_tools])
    return lc_tools
