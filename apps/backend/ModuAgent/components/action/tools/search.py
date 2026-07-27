from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Dict, List
from urllib.parse import quote_plus

import httpx

from core.interfaces.action import BaseTool

# 部分搜索接口对缺失 User-Agent 的请求会拒绝或返回异常，统一带上浏览器 UA
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

logger = logging.getLogger(__name__)


class SearchTool(BaseTool):
    """搜索引擎工具。

    优先级：Tavily(需 key, 境外) -> DuckDuckGo(免费, 境外, 建议代理) -> Bing HTML(免费, 国内可达, 无需 key)。
    在中国大陆网络下 DuckDuckGo/Tavily 常不可达，故新增 Bing HTML 兜底（无需 key、国内可达）。
    """

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

        # 1) 优先使用 Tavily API（如果有 key，境外服务，建议走代理）
        tavily_key = os.getenv("TAVILY_API_KEY", "")
        if tavily_key:
            try:
                results = self._with_retry(
                    lambda: self._search_tavily(query, max_results, tavily_key),
                    retries=2,
                )
                return {
                    "status": "success",
                    "error_code": "",
                    "data": {"results": results, "source": "tavily"},
                }
            except Exception as e:
                logger.warning("Tavily search failed, falling back: %s", e)

        # 2) 降级使用 DuckDuckGo Instant Answer API（免费，境外，建议代理）
        try:
            results = self._with_retry(
                lambda: self._search_duckduckgo(query, max_results),
                retries=0,
            )
            return {
                "status": "success",
                "error_code": "",
                "data": {"results": results, "source": "duckduckgo"},
            }
        except Exception as e:
            logger.warning("DuckDuckGo failed, falling back to Bing: %s", e)

        # 3) 国内可达兜底：直接抓取 Bing 搜索结果页（无需 key，bing.com 在国内通常可用）
        try:
            results = self._with_retry(
                lambda: self._search_bing(query, max_results),
                retries=0,
            )
            return {
                "status": "success",
                "error_code": "",
                "data": {"results": results, "source": "bing"},
            }
        except Exception as e:
            logger.error("SearchTool error: %s", str(e))
            return {
                "status": "error",
                "error_code": "TOOL_002",
                "data": {"message": f"搜索服务异常: {e}"},
            }

    def _with_retry(self, fn, retries: int = 2):
        """带指数退避的重试包装：失败重试 retries 次（默认 2 次），间隔 0.5s/1s..."""
        last = None
        for attempt in range(retries + 1):
            try:
                return fn()
            except Exception as e:
                last = e
                if attempt < retries:
                    time.sleep(0.5 * (attempt + 1))
        raise last

    def _client_kwargs(self) -> Dict[str, Any]:
        """构造 httpx 客户端参数，自动带上 UA 与代理（若设置了 HTTPS_PROXY/HTTP_PROXY）。"""
        kwargs: Dict[str, Any] = {
            # 区分连接/读取超时：境外源（DuckDuckGo/Tavily）在不可达时连接会挂起，
            # 用较短的 connect 超时让它快速失败并落到国内兜底源（Bing）
            "timeout": httpx.Timeout(connect=4.0, read=15.0, write=10.0, pool=8.0),
            "headers": {"User-Agent": USER_AGENT},
            # 部分搜索引擎会 302 跳转（如 Bing 跳到 cn.bing.com），需跟随重定向
            "follow_redirects": True,
        }
        proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY") or ""
        if proxy:
            # httpx 不同版本分别为 proxy / proxies，做兼容处理
            try:
                httpx.Client(timeout=1.0, proxies=proxy or None)
                kwargs["proxies"] = proxy
            except TypeError:
                kwargs["proxy"] = proxy
        return kwargs

    def _search_duckduckgo(self, query: str, max_results: int) -> List[Dict[str, str]]:
        """使用 DuckDuckGo Instant Answer API 进行搜索（免费，无需 API key，境外）。"""
        url = "https://api.duckduckgo.com/"
        params = {
            "q": query,
            "format": "json",
            "no_html": "1",
            "skip_disambig": "1",
        }

        kwargs = self._client_kwargs()
        kwargs.setdefault("headers", {})["Accept"] = "application/json"
        with httpx.Client(**kwargs) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

        # 提取摘要
        abstract = data.get("AbstractText", "")
        results: List[Dict[str, str]] = []
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
        """使用 Tavily API 进行搜索（需要 API key，境外）。"""
        url = "https://api.tavily.com/search"
        payload = {
            "api_key": api_key,
            "query": query,
            "max_results": max_results,
            "include_answer": True,
        }

        with httpx.Client(**self._client_kwargs()) as client:
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

    def _search_bing(self, query: str, max_results: int) -> List[Dict[str, str]]:
        """国内可达兜底：直接抓取 Bing 搜索结果页（https://www.bing.com/search）。

        无需 API key，bing.com 在中国大陆网络通常可达。通过正则解析 HTML 提取结果。
        """
        url = "https://www.bing.com/search"
        params = {
            "q": query,
            "count": max_results,
            "setlang": "zh-CN",
            "ensearch": "0",
        }
        headers = {
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Accept": "text/html,application/xhtml+xml",
        }
        kwargs = self._client_kwargs()
        kwargs.setdefault("headers", {}).update(headers)

        with httpx.Client(**kwargs) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            html = response.text

        return self._parse_bing_html(html, max_results)

    def _parse_bing_html(self, html: str, max_results: int) -> List[Dict[str, str]]:
        """从 Bing 搜索结果 HTML 中提取条目。

        结果块为 <li class="b_algo">，标题在 <h2><a href> 内，摘要在 <p> 内。
        """
        results: List[Dict[str, str]] = []
        blocks = re.findall(r'<li class="b_algo"[\s\S]*?<\/li>', html, flags=re.IGNORECASE)

        for block in blocks:
            if len(results) >= max_results:
                break

            # Bing 结构为 <a href="https://..."> 包裹 <h2>标题</h2>，故先取块内第一个 https 链接
            link_m = re.search(
                r'<a[^>]*href="(https?://[^"]+)"',
                block,
                flags=re.IGNORECASE,
            )
            if not link_m:
                continue

            url = link_m.group(1)
            title = ""
            h2_m = re.search(r'<h2[^>]*>([\s\S]*?)</h2>', block, flags=re.IGNORECASE)
            if h2_m:
                title = self._strip_tags(h2_m.group(1))
            # 无 h2 时退回用链接文字作为标题
            if not title:
                a_text_m = re.search(
                    r'<a[^>]*href="https?://[^"]+"[^>]*>([\s\S]*?)</a>',
                    block,
                    flags=re.IGNORECASE,
                )
                if a_text_m:
                    title = self._strip_tags(a_text_m.group(1))
            if not title:
                continue

            snippet_m = re.search(
                r'<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>',
                block,
                flags=re.IGNORECASE,
            ) or re.search(r'<p[^>]*>([\s\S]*?)<\/p>', block, flags=re.IGNORECASE)
            snippet = self._strip_tags(snippet_m.group(1)) if snippet_m else ""

            results.append({
                "title": title,
                "url": url,
                "snippet": snippet,
                "source": "Bing",
            })

        return results[:max_results]

    @staticmethod
    def _strip_tags(s: str) -> str:
        s = re.sub(r"<[^>]+>", "", s)
        s = re.sub(r"&[a-z#0-9]+;", " ", s, flags=re.IGNORECASE)
        return re.sub(r"\s+", " ", s).strip()
