from __future__ import annotations

import copy
import json
import logging
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional

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
        # P2-8: LLM 调用重试配置
        "retry": {
            "max_attempts": 2,      # 最大尝试次数（含首次，LLM 重试代价高，默认仅 1 次重试）
        },
    },
    "memory": {
        "default_strategy": "cache",
        "context_window": "last_5_turns",
        "enable_compression": False,
        # LangGraph 重构新增字段
        "checkpointer_type": "memory",  # memory | sqlite | none
        "store_type": "chroma",         # chroma | in_memory | none
        # P2-12.3.2: ChromaDB 持久化路径（None=内存模式，生产环境建议设置为本地路径）
        "chroma_persist_path": None,
    },
    "orchestration": {
        # P0-2: LangGraph 成为唯一引擎（legacy Coordinator 已删除）
        "engine": "langgraph",
    },
    "tools": {
        "default_timeout_ms": 1800000,
        # P2-8: 工具调用重试配置
        "retry": {
            "max_attempts": 3,      # 最大尝试次数（含首次）
            "base_delay": 0.5,      # 指数退避基础延迟（秒）
            "max_delay": 5.0,       # 单次延迟上限（秒）
        },
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
        "enable_evolution": True,   # P0-1: 启用 feedback/evolution 闭环
        "min_sample_size": 10,      # 触发进化判断的最小样本量
        # P2-7: QualityMonitor LLM-as-Judge 配置
        "quality_monitor_mode": "rule",        # rule | llm | hybrid
        "quality_monitor_llm_timeout": 10.0,   # LLM 评估超时（秒）
        "quality_monitor_llm_provider": None,  # None=复用 llm.default_provider
        "quality_monitor_llm_temperature": 0.0,# LLM Judge 用低温度确保稳定
        "quality_monitor_llm_max_tokens": 256, # Judge 输出 JSON 所需 token 数
    },
}


class RuntimeConfig:
    """运行时配置（P2-10: 线程安全 + 热更新支持）。

    P2-10 增强：
        - 所有读写操作通过 `threading.RLock` 保护，支持多线程并发
        - 新增 `update(key_path, value)` 公共 API，返回旧值便于回滚
        - 新增 `update_many(updates)` 批量原子更新
        - 新增 `register_change_callback(callback)` 让 evolution 策略等组件监听变更
    """

    def __init__(self, config_data: Optional[Dict[str, Any]] = None):
        # P2-4 修复：深拷贝 _DEFAULT_CONFIG，避免嵌套 dict 被多个实例共享
        self._data: Dict[str, Any] = copy.deepcopy(_DEFAULT_CONFIG)
        if config_data:
            self._deep_merge(self._data, config_data)
        # P2-10: 线程安全锁（RLock 允许同一线程重复获取，便于嵌套调用）
        self._lock = threading.RLock()
        # P2-10: 配置变更回调列表（evolution 策略可注册监听）
        self._change_callbacks: List[Callable[[str, Any, Any], None]] = []

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
        """线程安全地读取配置值。"""
        with self._lock:
            keys = key_path.split(".")
            current = self._data
            for key in keys:
                if isinstance(current, dict) and key in current:
                    current = current[key]
                else:
                    return default
            # 返回浅拷贝避免外部直接修改内部状态（对 dict/list 类型）
            if isinstance(current, (dict, list)):
                return _shallow_copy(current)
            return current

    def set(self, key_path: str, value: Any) -> None:
        """线程安全地设置配置值（底层方法）。

        P2-10: 等价于 `update(key_path, value)` 但不返回旧值。
        保留以兼容现有调用方。
        """
        self.update(key_path, value)

    def update(self, key_path: str, value: Any) -> Any:
        """P2-10: 线程安全地更新配置值，返回旧值。

        供 evolution 策略（如 ParameterTuneStrategy）在运行时动态调整参数使用。
        变更后会触发已注册的回调。

        Args:
            key_path: 点分路径，如 "llm.temperature"
            value: 新值

        Returns:
            旧值（用于回滚）
        """
        with self._lock:
            keys = key_path.split(".")
            current = self._data
            for key in keys[:-1]:
                if key not in current or not isinstance(current[key], dict):
                    current[key] = {}
                current = current[key]
            old_value = current.get(keys[-1])
            current[keys[-1]] = value

        # 触发回调（在锁外执行，避免回调中再次获取锁导致死锁——RLock 允许重入，但仍建议锁外执行）
        self._notify_change(key_path, old_value, value)
        return old_value

    def update_many(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """P2-10: 批量原子更新配置。

        在单次锁获取内完成多个更新，减少锁竞争。
        适用于 evolution 策略一次调整多个参数的场景。

        Args:
            updates: {key_path: new_value} 字典

        Returns:
            {key_path: old_value} 字典，用于回滚
        """
        old_values: Dict[str, Any] = {}
        with self._lock:
            for key_path, value in updates.items():
                keys = key_path.split(".")
                current = self._data
                for key in keys[:-1]:
                    if key not in current or not isinstance(current[key], dict):
                        current[key] = {}
                    current = current[key]
                old_values[key_path] = current.get(keys[-1])
                current[keys[-1]] = value

        # 批量触发回调
        for key_path, value in updates.items():
            self._notify_change(key_path, old_values[key_path], value)
        return old_values

    def register_change_callback(
        self,
        callback: Callable[[str, Any, Any], None],
    ) -> Callable[[], None]:
        """P2-10: 注册配置变更回调。

        回调签名：callback(key_path: str, old_value: Any, new_value: Any) -> None
        evolution 策略可注册回调以响应配置变更（如重新构建图）。

        Args:
            callback: 变更回调函数

        Returns:
            注销函数（调用以移除回调）
        """
        with self._lock:
            self._change_callbacks.append(callback)

        def _unregister() -> None:
            with self._lock:
                try:
                    self._change_callbacks.remove(callback)
                except ValueError:
                    pass

        return _unregister

    def _notify_change(self, key_path: str, old_value: Any, new_value: Any) -> None:
        """通知所有注册的回调（异常隔离，单个回调失败不影响其他）。"""
        if old_value == new_value:
            return
        # 复制回调列表避免回调中修改列表
        with self._lock:
            callbacks = list(self._change_callbacks)
        for callback in callbacks:
            try:
                callback(key_path, old_value, new_value)
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "Config change callback failed for '%s': %s",
                    key_path, str(e),
                )

    def as_dict(self) -> Dict[str, Any]:
        """返回配置的深拷贝（避免外部修改内部状态）。"""
        with self._lock:
            return _deep_copy_dict(self._data)

    @staticmethod
    def _deep_merge(base: Dict, override: Dict) -> None:
        for key, value in override.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                RuntimeConfig._deep_merge(base[key], value)
            else:
                base[key] = value


_config: Optional[RuntimeConfig] = None


def get_config(override: Optional[RuntimeConfig] = None) -> RuntimeConfig:
    """获取全局 RuntimeConfig 单例。

    P2-1: 新增 `override` 参数用于测试隔离。
    生产代码不应使用此参数；测试在 teardown 中应调用 `reset_config()` 清理。

    Args:
        override: 测试时注入的实例。若提供，将替换全局单例并返回。

    Returns:
        全局 RuntimeConfig 实例
    """
    global _config
    if override is not None:
        _config = override
    if _config is None:
        config_path = os.getenv("MODU_CONFIG_PATH", "")
        if config_path:
            _config = RuntimeConfig.from_file(config_path)
        else:
            _config = RuntimeConfig.from_env()
    return _config


def reset_config() -> None:
    """重置全局 config 单例（测试清理用）。"""
    global _config
    _config = None


@contextmanager
def override_config(config: RuntimeConfig) -> Iterator[RuntimeConfig]:
    """P2-1: 测试用上下文管理器——临时替换全局 config 单例，退出时自动恢复。

    相比 `get_config(override=...)`，此方式更安全：即使测试抛异常也能恢复。
    """
    global _config
    old = _config
    _config = config
    try:
        yield _config
    finally:
        _config = old


def _shallow_copy(value: Any) -> Any:
    """对 dict/list 返回浅拷贝，其他类型原样返回。"""
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, list):
        return list(value)
    return value


def _deep_copy_dict(value: Any) -> Any:
    """使用 copy.deepcopy 复制配置值（处理嵌套 dict/list）。"""
    return copy.deepcopy(value)
