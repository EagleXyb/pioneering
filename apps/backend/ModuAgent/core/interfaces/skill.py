"""Skill 抽象接口（P1）。

把文档「二、Skills 能力分析」中指出的"Skill 作为一等公民"高级特性，
以可插拔方式引入 ModuAgent。

设计要点：
    - Skill 在运行时对图完全透明：它最终降解为 (N 个 BaseTool) + (一段 system prompt 片段)。
    - 因此 graph.py / nodes.py / ToolNode / ReAct 循环均无需感知 Skill 的存在，
      复用既有 BaseTool + ComponentRegistry + tool_adapter 三件套。
    - 所有组件方法保持默认实现，子类按需覆写，确保零强制实现负担。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from core.interfaces.action import BaseTool


class BaseSkill(ABC):
    # ---------- 身份与元数据（对应文档 2.1 "自描述能力"）----------

    @abstractmethod
    def name(self) -> str:
        """Skill 唯一标识。"""
        ...

    @abstractmethod
    def description(self) -> str:
        """面向 LLM 的能力描述（会注入 system prompt）。"""
        ...

    @abstractmethod
    def version(self) -> str:
        """版本号（生态化能力，文档 2.1）。"""
        ...

    def tags(self) -> List[str]:
        """分类标签，用于发现与按需加载。"""
        return []

    def examples(self) -> List[Dict[str, str]]:
        """few-shot 示例，可选，注入提示。每项形如 {"input": ..., "output": ...}。"""
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
        """健康检查：依赖缺失/配置不全时返回 False，触发降级（见方案第 5 节）。

        Returns:
            True 表示可正常加载；False 时注册中心会跳过该 Skill。
        """
        return True

    def setup(self) -> None:
        """注册时一次性初始化（加载资源、建连接等）。异常被 Loader 隔离。"""
        pass

    def teardown(self) -> None:
        """卸载/进程退出时清理。"""
        pass
