"""pytest 全局配置与共享 fixtures。"""

from __future__ import annotations

import os
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

# P2-12.2.1: 测试环境强制 ChromaDB 内存模式，避免在测试目录创建持久化文件
os.environ.setdefault("MODU_CHROMA_IN_MEMORY", "1")

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
        from modu_graph.runner import reset_runner_cache
        reset_runner_cache()
    except Exception:
        pass

    # P2-12.2.4: 重置配置回调注册标志，确保新 RuntimeConfig 实例能重新注册回调
    try:
        import modu_graph.runner as _runner_mod
        _runner_mod._config_callback_registered = False
    except Exception:
        pass

    # P3-12.3.5: 清理 observability 全局单例，避免测试间状态泄漏
    try:
        from observability.tracing import reset_span_manager
        reset_span_manager()
    except Exception:
        pass
    try:
        from observability.metrics import reset_metrics_registry
        reset_metrics_registry()
    except Exception:
        pass
    try:
        from observability.exporters import reset_exporters
        reset_exporters()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# P3-12.3.2 / 12.3.4 / 12.3.5 共享 fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_judge_llm():
    """P3: Mock LLM-as-Judge（用于共识裁决与质量评估）。

    返回 MagicMock，其 ``invoke`` 返回包含 JSON winner 字段的 mock AIMessage。
    """
    from unittest.mock import MagicMock

    llm = MagicMock()
    llm.invoke.return_value = MagicMock(
        content='{"winner": 0, "reason": "first is best"}'
    )
    return llm


@pytest.fixture
def temp_sqlite_db(tmp_path):
    """P3: 临时 SQLite 数据库路径（关系型记忆测试）。

    Returns:
        SQLite 连接字符串（如 "sqlite:///path/to/test_memory.db"）
    """
    db_path = tmp_path / "test_memory.db"
    db_path.touch()
    yield f"sqlite:///{db_path}"


@pytest.fixture
def mock_otel_tracer():
    """P3-12.3.5: Mock OTel tracer（避免实际 span 导出）。

    Yields:
        MagicMock span 对象，可断言 set_attribute/record_exception 等调用。
    """
    from unittest.mock import MagicMock, patch

    mock_span = MagicMock()
    mock_tracer = MagicMock()
    mock_tracer.start_as_current_span.return_value.__enter__.return_value = mock_span

    with patch("observability.tracing.trace") as mock_trace:
        mock_trace.get_tracer.return_value = mock_tracer
        yield mock_span


@pytest.fixture
def p3_config_enabled(fresh_config):
    """P3: 启用所有 P3 功能的配置。

    启用：
        - tools.human_in_loop.enabled
        - observability.tracing.enabled
        - observability.metrics.enabled
        - observability.logging.structured

    Note: multi_agent / memory 增强属中高风险，默认不启用。
    """
    fresh_config.set("tools.human_in_loop.enabled", True)
    fresh_config.set("observability.tracing.enabled", True)
    fresh_config.set("observability.metrics.enabled", True)
    fresh_config.set("observability.logging.structured", True)
    yield fresh_config


@pytest.fixture
def isolated_workdir(tmp_path):
    """P3: 隔离工作目录（文件操作工具测试）。

    Yields:
        Path 对象指向临时工作目录
    """
    workdir = tmp_path / "workspace"
    workdir.mkdir()
    yield workdir


# ---------------------------------------------------------------------------
# P3-12.3.4 工具 fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def code_executor_tool():
    """P3-12.3.4: CodeExecutorTool 实例。"""
    from components.action.tools.code_executor import CodeExecutorTool

    return CodeExecutorTool()


@pytest.fixture
def file_ops_tool(isolated_workdir):
    """P3-12.3.4: FileOpsTool 实例（工作目录设为隔离临时目录）。"""
    from components.action.tools.file_ops import FileOpsTool

    return FileOpsTool(allowed_root=str(isolated_workdir))


@pytest.fixture
def sql_query_tool(tmp_path):
    """P3-12.3.4: SqlQueryTool 实例（指向临时 SQLite 数据库）。"""
    from components.action.tools.sql_query import SqlQueryTool

    db_path = tmp_path / "test.db"
    db_path.touch()
    return SqlQueryTool(db_path=str(db_path))


@pytest.fixture
def datetime_tool():
    """P3-12.3.4: DateTimeTool 实例。"""
    from components.action.tools.datetime_tool import DateTimeTool

    return DateTimeTool()


@pytest.fixture
def http_request_tool():
    """P3-12.3.4: HttpRequestTool 实例。"""
    from components.action.tools.http_request import HttpRequestTool

    return HttpRequestTool()
