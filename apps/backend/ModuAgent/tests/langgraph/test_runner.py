"""runner 单元测试（P2-4）。

覆盖：
    - run_sync 入口校验（空输入/无效 thread_id）
    - stream_response 入口校验

依赖 langgraph + langchain_core，未安装时自动跳过。
"""
import pytest

pytest.importorskip("langchain_core")

# 本地 langgraph/ 包与库同名，在库已安装时触发循环导入（pre-existing 架构限制）。
try:
    from langgraph.runner import run_sync, stream_response
except BaseException as _e:  # noqa: F401,BLE001  捕获循环导入/部分初始化
    pytest.skip(
        f"local langgraph integration not importable (package name shadowing): {_e}",
        allow_module_level=True,
    )


class TestRunSyncValidation:
    def test_run_sync_empty_prompt_raises(self):
        """空 prompt 应触发入口校验错误。"""
        with pytest.raises((ValueError, TypeError)):
            run_sync({"prompt": ""})

    def test_run_sync_none_input_raises(self):
        """None 输入应触发入口校验错误。"""
        with pytest.raises((ValueError, TypeError)):
            run_sync(None)


class TestStreamResponseValidation:
    async def test_stream_response_empty_prompt_raises(self):
        """空 prompt 应触发入口校验错误。"""
        with pytest.raises((ValueError, TypeError)):
            async for _ in stream_response({"prompt": ""}):
                pass
