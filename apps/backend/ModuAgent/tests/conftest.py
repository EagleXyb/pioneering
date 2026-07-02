"""pytest 全局配置与共享 fixtures。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# 将 ModuAgent 包路径加入 sys.path（确保测试可独立运行）
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 模拟缺失的可选依赖（避免导入失败）
import types as _types_mod

def _safe_import(name: str) -> None:
    try:
        __import__(name)
    except ImportError:
        _mock = _types_mod.ModuleType(name)
        # P2-12.3.2: 同时支持 Client（内存）与 PersistentClient（持久化）
        _mock.Client = lambda *a, **kw: _MockChromaClient()  # noqa
        _mock.PersistentClient = lambda *a, **kw: _MockChromaClient()  # noqa
        sys.modules[name] = _mock


class _MockChromaClient:
    def get_or_create_collection(self, **kw):
        return _MockCollection()

    def count(self):
        return 0


class _MockCollection:
    def count(self):
        return 0
    def query(self, **kw):
        return {"documents": [[]], "metadatas": [[]], "distances": [[]]}
    def upsert(self, **kw):
        pass


_safe_import("chromadb")

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fresh_registry():
    """提供全新的 ComponentRegistry（测试隔离）。"""
    from core.registry import ComponentRegistry, reset_registry

    reset_registry()
    registry = ComponentRegistry()
    return registry


@pytest.fixture
def fresh_config():
    """提供全新的 RuntimeConfig。"""
    from config.runtime_config import RuntimeConfig, reset_config

    reset_config()
    return RuntimeConfig()


@pytest.fixture(autouse=True)
def _cleanup_globals():
    """每个测试结束后清理全局单例状态。"""
    yield
    from config.runtime_config import reset_config
    from core.registry import reset_registry

    reset_config()
    reset_registry()

    # P1-12.2.6: 清理 runner 图缓存，避免配置变更后测试间复用旧图
    try:
        from langgraph.runner import reset_runner_cache
        reset_runner_cache()
    except Exception:
        pass
