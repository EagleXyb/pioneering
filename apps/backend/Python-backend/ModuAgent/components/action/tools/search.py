from __future__ import annotations

import logging
from typing import Any, Dict

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)

_MOCK_RESULTS: list[Dict[str, str]] = [
    {"title": "AI Technology Trends 2026", "url": "https://example.com/ai-trends-2026", "snippet": "Latest developments in artificial intelligence..."},
    {"title": "Machine Learning Breakthroughs", "url": "https://example.com/ml-breakthroughs", "snippet": "Recent advances in deep learning and transformers..."},
    {"title": "AI Industry Report", "url": "https://example.com/ai-industry-report", "snippet": "Comprehensive analysis of the AI industry landscape..."},
]


class SearchTool(BaseTool):
    def name(self) -> str:
        return "search_engine"

    def description(self) -> str:
        return "通过搜索引擎获取实时信息，适用于天气、新闻等时效性查询"

    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词",
                },
                "max_results": {
                    "type": "integer",
                    "description": "最大返回结果数",
                    "default": 3,
                },
            },
            "required": ["query"],
        }

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        query = params.get("query", "")
        max_results = params.get("max_results", 3)

        if not isinstance(query, str) or len(query) < 2:
            return {
                "status": "error",
                "error_code": "TOOL_001",
                "data": {"message": "查询词过短，至少需要2个字符"},
            }

        if not isinstance(max_results, int) or max_results < 1:
            max_results = 3

        try:
            results = self._call_search_api(query, max_results)
            return {
                "status": "success",
                "error_code": "",
                "data": results,
            }
        except Exception as e:
            logger.error("SearchTool error: %s", str(e))
            return {
                "status": "error",
                "error_code": "TOOL_002",
                "data": {"message": f"搜索服务异常: {e}"},
            }

    def _call_search_api(self, query: str, max_results: int) -> list[Dict[str, str]]:
        logger.info("SearchTool query: %s, max_results: %d", query, max_results)
        return _MOCK_RESULTS[:max_results]
