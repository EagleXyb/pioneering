"""P3-12.3.4: HTTP 请求工具（URL 白名单 + SSRF 防护）。

安全策略：
    1. 协议限制：仅允许 http/https
    2. SSRF 防护：拒绝内网地址（127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16）
    3. 域名白名单：可选（``allowed_domains`` 参数）
    4. 方法限制：仅允许 GET/POST/PUT/DELETE
    5. 超时限制：默认 30s
    6. 响应大小限制：默认 1MB
    7. 禁止重定向到内网

需要人工审批（``requires_approval() = True``）。
"""
from __future__ import annotations

import ipaddress
import logging
import socket
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)


# 私有 IP 网段（用于 SSRF 防护）
_PRIVATE_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),   # CGNAT
    ipaddress.ip_network("::1/128"),         # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),        # IPv6 ULA
    ipaddress.ip_network("fe80::/10"),      # IPv6 link-local
]

_ALLOWED_METHODS = {"GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"}
_DEFAULT_TIMEOUT = 30
_DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024  # 1MB


class HttpRequestTool(BaseTool):
    """P3-12.3.4: HTTP 请求工具。

    支持 GET/POST/PUT/DELETE 方法，内置 SSRF 防护与域名白名单。

    Args:
        allowed_domains: 允许的域名白名单（None=不限制，仅 SSRF 防护）
        timeout: 请求超时（秒）
        max_response_bytes: 响应大小上限（字节）
    """

    def __init__(
        self,
        allowed_domains: Optional[List[str]] = None,
        timeout: int = _DEFAULT_TIMEOUT,
        max_response_bytes: int = _DEFAULT_MAX_RESPONSE_BYTES,
    ) -> None:
        self._allowed_domains: Optional[Set[str]] = (
            set(d.lower() for d in allowed_domains) if allowed_domains else None
        )
        self._timeout: int = timeout
        self._max_response_bytes: int = max_response_bytes

    def name(self) -> str:
        return "http_request"

    def description(self) -> str:
        return (
            "发起 HTTP 请求（GET/POST/PUT/DELETE），内置 SSRF 防护拒绝内网地址；"
            "可选域名白名单"
        )

    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "目标 URL（http/https）",
                },
                "method": {
                    "type": "string",
                    "description": "HTTP 方法",
                    "enum": ["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"],
                },
                "headers": {
                    "type": "object",
                    "description": "请求头（键值对）",
                },
                "body": {
                    "type": "string",
                    "description": "请求体（POST/PUT 用）",
                },
            },
            "required": ["url"],
        }

    def requires_approval(self) -> bool:
        """HTTP 请求需人工审批。"""
        return True

    def on_approval_rejected(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "status": "error",
            "error_code": "TOOL_APPROVAL_REJECTED",
            "data": {
                "message": "HTTP request was rejected by the human reviewer",
                "url": params.get("url", ""),
            },
        }

    def _is_private_ip(self, ip_str: str) -> bool:
        """检查 IP 是否为私有/内网地址（SSRF 防护）。"""
        try:
            ip = ipaddress.ip_address(ip_str)
            for network in _PRIVATE_NETWORKS:
                if ip in network:
                    return True
            return False
        except ValueError:
            return False

    def _resolve_host(self, host: str) -> List[str]:
        """解析主机名到 IP 地址列表。"""
        try:
            # getaddrinfo 返回 IPv4 与 IPv6 地址
            results = socket.getaddrinfo(host, None)
            ips = []
            for family, _, _, _, sockaddr in results:
                if family == socket.AF_INET:
                    ips.append(sockaddr[0])
                elif family == socket.AF_INET6:
                    ips.append(sockaddr[0])
            return ips
        except socket.gaierror:
            return []

    def _validate_url(self, url: str) -> Tuple[bool, str]:
        """校验 URL 安全性。

        Args:
            url: 待校验的 URL

        Returns:
            (is_valid, error_message)
        """
        if not url or not isinstance(url, str):
            return False, "URL is empty"

        try:
            parsed = urlparse(url)
        except Exception as e:
            return False, f"Invalid URL: {e}"

        # 协议白名单
        if parsed.scheme not in ("http", "https"):
            return False, f"Protocol not allowed: {parsed.scheme}"

        if not parsed.hostname:
            return False, "URL missing hostname"

        # 域名白名单检查
        if self._allowed_domains is not None:
            if parsed.hostname.lower() not in self._allowed_domains:
                return False, f"Domain not in whitelist: {parsed.hostname}"

        # SSRF 防护：直接 IP 地址检查
        try:
            ip = ipaddress.ip_address(parsed.hostname)
            if self._is_private_ip(str(ip)):
                return False, f"Private IP not allowed: {parsed.hostname}"
        except ValueError:
            # 不是 IP 地址，是域名；解析后检查所有解析结果
            ips = self._resolve_host(parsed.hostname)
            for ip_str in ips:
                if self._is_private_ip(ip_str):
                    return False, (
                        f"Host resolves to private IP {ip_str} "
                        f"(SSRF protection): {parsed.hostname}"
                    )

        return True, ""

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        url = params.get("url", "")
        method = (params.get("method", "GET") or "GET").upper()
        headers = params.get("headers", {})
        body = params.get("body", "")

        # 1. 方法校验
        if method not in _ALLOWED_METHODS:
            return {
                "status": "error",
                "error_code": "HTTP_001",
                "data": {"message": f"Method not allowed: {method}"},
            }

        # 2. URL 安全校验
        is_valid, error_msg = self._validate_url(url)
        if not is_valid:
            logger.warning("HttpRequest rejected: %s", error_msg)
            return {
                "status": "error",
                "error_code": "HTTP_002",
                "data": {"message": error_msg},
            }

        # 3. 发起请求（使用 httpx）
        try:
            import httpx
        except ImportError as e:
            return {
                "status": "error",
                "error_code": "HTTP_003",
                "data": {"message": f"httpx not available: {e}"},
            }

        try:
            # 禁用重定向防止 SSRF 重定向绕过
            with httpx.Client(
                timeout=self._timeout,
                follow_redirects=False,
                verify=True,
            ) as client:
                request_kwargs: Dict[str, Any] = {
                    "headers": headers if isinstance(headers, dict) else None,
                }
                if method in ("POST", "PUT", "PATCH") and body:
                    request_kwargs["content"] = body

                response = client.request(method, url, **request_kwargs)

                # 读取响应（限制大小）
                content = response.content[:self._max_response_bytes]
                text = content.decode("utf-8", errors="replace")

                return {
                    "status": "success",
                    "error_code": "",
                    "data": {
                        "status_code": response.status_code,
                        "headers": dict(response.headers),
                        "content": text,
                        "content_length": len(content),
                        "truncated": len(response.content) > self._max_response_bytes,
                    },
                }

        except httpx.TimeoutException:
            logger.warning("HttpRequest timeout after %ds: %s", self._timeout, url)
            return {
                "status": "error",
                "error_code": "HTTP_004",
                "data": {"message": f"Request timeout after {self._timeout}s"},
            }
        except httpx.ConnectError as e:
            logger.warning("HttpRequest connect error: %s", str(e))
            return {
                "status": "error",
                "error_code": "HTTP_005",
                "data": {"message": f"Connection error: {e}"},
            }
        except Exception as e:
            logger.error("HttpRequest unexpected error: %s", str(e))
            return {
                "status": "error",
                "error_code": "HTTP_006",
                "data": {"message": f"Unexpected error: {e}"},
            }
