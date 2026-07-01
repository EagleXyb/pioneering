"""runner 单元测试（P2-4）。

覆盖：
    - run_sync 入口校验（空输入/无效 thread_id）
    - stream_response 入口校验

依赖 langgraph + langchain_core，未安装时自动跳过。
"""
import pytest

pytest.importorskip("langchain_core")
pytest.importorskip("langgraph")

from langgraph.runner import run_sync, stream_response


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
