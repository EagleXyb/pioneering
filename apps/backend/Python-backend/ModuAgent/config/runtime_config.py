from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG = {
    "llm": {
        "default_provider": "deepseek",
        "temperature": 0.7,
        "max_tokens": 512,
        "prompt_template": "",
        "tool_call_pattern": r"```tool_call\s*\n(.*?)\n```",
        "max_reasoning_iterations": 3,
        "max_format_retries": 2,
    },
    "memory": {
        "default_strategy": "cache",
        "context_window": "last_5_turns",
        "enable_compression": False,
    },
    "tools": {
        "default_timeout_ms": 1800000,
    },
    "streaming": {
        "chunk_size": 4,
    },
    "event_bus": {
        "max_log_size": 1000,
    },
    "perception": {
        "default_processor": "text_preprocessor",
        "max_length": 2048,
        "sensitivity_threshold": 5,
        # 输入类型路由（对应问题 9）
        "routing": {
            "text": {
                "pipeline": ["text_preprocessor", "llm_parser"],
            },
            "image": {
                "pipeline": ["image_processor", "text_preprocessor"],
            },
            "audio": {
                "pipeline": ["audio_processor", "text_preprocessor"],
            },
        },
        # 多路融合配置（对应问题 9）
        "fusion": {
            "strategy": "weighted_average",  # weighted_average | max_confidence | voting
            "weights": {"text": 0.5, "image": 0.3, "audio": 0.2},
        },
        # 安全检测开关（对应问题 5）
        "security": {
            "enable_guard": True,
            "block_on_injection": False,  # 检测到注入时是否直接拒绝
            "block_on_pii": False,        # 检测到 PII 时是否直接拒绝
        },
        # 深度解析开关（对应问题 2）
        "deep_parsing": {
            "enable": True,  # P1: 默认开启深度解析
            "enable_intent": True,
            "enable_quality": False,
            "enable_local_ner": True,      # P1: spaCy NER
            "enable_local_sentiment": True, # P1: SnowNLP 情感
            "spacy_model": None,           # None=自动选择
        },
        # P1: 事件日志持久化
        "event_log_path": "logs/perception_events.jsonl",
        "event_log_max_size_mb": 10.0,
        # P1: 进化信号报告间隔
        "evolution_report_interval": 100,
        # P1: 敏感词上下文降级开关
        "enable_context_reduction": True,
    },
    "feedback": {
        "evolution_threshold": 0.6,
    },
}


class RuntimeConfig:
    def __init__(self, config_data: Optional[Dict[str, Any]] = None):
        self._data: Dict[str, Any] = dict(_DEFAULT_CONFIG)
        if config_data:
            self._deep_merge(self._data, config_data)

    @classmethod
    def from_file(cls, path: str) -> "RuntimeConfig":
        file_path = Path(path)
        if not file_path.exists():
            logger.warning("Config file not found: %s, using defaults", path)
            return cls()
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(config_data=data)

    @classmethod
    def from_env(cls) -> "RuntimeConfig":
        data: Dict[str, Any] = {}
        provider = os.getenv("MODU_LLM_PROVIDER")
        if provider:
            data.setdefault("llm", {})["default_provider"] = provider
        temp = os.getenv("MODU_LLM_TEMPERATURE")
        if temp:
            data.setdefault("llm", {})["temperature"] = float(temp)
        strategy = os.getenv("MODU_MEMORY_STRATEGY")
        if strategy:
            data.setdefault("memory", {})["default_strategy"] = strategy
        return cls(config_data=data)

    def get(self, key_path: str, default: Any = None) -> Any:
        keys = key_path.split(".")
        current = self._data
        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return default
        return current

    def set(self, key_path: str, value: Any) -> None:
        keys = key_path.split(".")
        current = self._data
        for key in keys[:-1]:
            if key not in current or not isinstance(current[key], dict):
                current[key] = {}
            current = current[key]
        current[keys[-1]] = value

    def as_dict(self) -> Dict[str, Any]:
        return dict(self._data)

    @staticmethod
    def _deep_merge(base: Dict, override: Dict) -> None:
        for key, value in override.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                RuntimeConfig._deep_merge(base[key], value)
            else:
                base[key] = value


_config: Optional[RuntimeConfig] = None


def get_config() -> RuntimeConfig:
    global _config
    if _config is None:
        config_path = os.getenv("MODU_CONFIG_PATH", "")
        if config_path:
            _config = RuntimeConfig.from_file(config_path)
        else:
            _config = RuntimeConfig.from_env()
    return _config


def reset_config() -> None:
    global _config
    _config = None
