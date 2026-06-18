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
        "default_timeout_ms": 3000,
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
