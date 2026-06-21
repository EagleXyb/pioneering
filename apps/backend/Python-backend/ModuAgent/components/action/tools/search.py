from __future__ import annotations

import logging
import os
from typing import Any, Dict, List
from urllib.parse import quote_plus

import httpx

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)


class SearchTool(BaseTool):
    """搜索引擎工具，默认使用 DuckDuckGo（免费无需 key），可选 Tavily（需 API key）。"""

    def name(self) -> str:
        return "search_engine"

    def description(self) -> str:
        return "通过搜索引擎获取实时信息，适用于天气、新闻、知识查询等时效性或事实性查询"

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
                    "default": 5,
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
        max_results = params.get("max_results", 5)

        if not isinstance(query, str) or len(query) < 2:
            return {
                "status": "error",
                "error_code": "TOOL_001",
                "data": {"message": "查询词过短，至少需要2个字符"},
            }

        if not isinstance(max_results, int) or max_results < 1:
            max_results = 5

        # 优先使用 Tavily API（如果有 key）
        tavily_key = os.getenv("TAVILY_API_KEY", "")
        if tavily_key:
            try:
                results = self._search_tavily(query, max_results, tavily_key)
                return {
                    "status": "success",
                    "error_code": "",
                    "data": {"results": results, "source": "tavily"},
                }
            except Exception as e:
                logger.warning("Tavily search failed, falling back to DuckDuckGo: %s", e)

        # 降级使用 DuckDuckGo Instant Answer API
        try:
            results = self._search_duckduckgo(query, max_results)
            return {
                "status": "success",
                "error_code": "",
                "data": {"results": results, "source": "duckduckgo"},
            }
        except Exception as e:
            logger.error("SearchTool error: %s", str(e))
            return {
                "status": "error",
                "error_code": "TOOL_002",
                "data": {"message": f"搜索服务异常: {e}"},
            }

    def _search_duckduckgo(self, query: str, max_results: int) -> List[Dict[str, str]]:
        """使用 DuckDuckGo Instant Answer API 进行搜索（免费，无需 API key）。"""
        url = "https://api.duckduckgo.com/"
        params = {
            "q": query,
            "format": "json",
            "no_html": "1",
            "skip_disambig": "1",
        }

        results: List[Dict[str, str]] = []

        with httpx.Client(timeout=8.0) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

        # 提取摘要
        abstract = data.get("AbstractText", "")
        if abstract:
            results.append({
                "title": data.get("Heading", query),
                "url": data.get("AbstractURL", ""),
                "snippet": abstract,
                "source": data.get("AbstractSource", "DuckDuckGo"),
            })

        # 提取相关主题
        related = data.get("RelatedTopics", [])
        for topic in related:
            if len(results) >= max_results:
                break
            if isinstance(topic, dict):
                text = topic.get("Text", "")
                first_url = topic.get("FirstURL", "")
                if text and first_url:
                    results.append({
                        "title": text[:80] + ("..." if len(text) > 80 else ""),
                        "url": first_url,
                        "snippet": text,
                        "source": "DuckDuckGo",
                    })
                elif "Topics" in topic:
                    # 嵌套主题
                    for sub_topic in topic["Topics"]:
                        if len(results) >= max_results:
                            break
                        if isinstance(sub_topic, dict):
                            text = sub_topic.get("Text", "")
                            first_url = sub_topic.get("FirstURL", "")
                            if text and first_url:
                                results.append({
                                    "title": text[:80] + ("..." if len(text) > 80 else ""),
                                    "url": first_url,
                                    "snippet": text,
                                    "source": "DuckDuckGo",
                                })

        if not results:
            results.append({
                "title": query,
                "url": "",
                "snippet": f"未找到关于 '{query}' 的即时答案，建议尝试更具体的关键词。",
                "source": "DuckDuckGo",
            })

        return results[:max_results]

    def _search_tavily(self, query: str, max_results: int, api_key: str) -> List[Dict[str, str]]:
        """使用 Tavily API 进行搜索（需要 API key）。"""
        url = "https://api.tavily.com/search"
        payload = {
            "api_key": api_key,
            "query": query,
            "max_results": max_results,
            "include_answer": True,
        }

        with httpx.Client(timeout=8.0) as client:
            response = client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()

        results: List[Dict[str, str]] = []

        # Tavily 可能返回直接答案
        answer = data.get("answer", "")
        if answer:
            results.append({
                "title": "AI Answer",
                "url": "",
                "snippet": answer,
                "source": "Tavily AI",
            })

        for item in data.get("results", []):
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": item.get("content", ""),
                "source": "Tavily",
            })

        return results[:max_results]
