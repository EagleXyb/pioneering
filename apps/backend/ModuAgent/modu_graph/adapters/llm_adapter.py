"""LLM 适配器：构建 LangChain ChatOpenAI 实例。

复用现有环境变量约定（MODU_GLM_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY 等），
将 ModuAgent 的 BaseReasoningEngine 适配为 LangChain BaseChatModel。

GLM / DeepSeek / Qwen 均兼容 OpenAI 协议，可直接用 ChatOpenAI 对接。
bind_tools() 原生 function calling 替代手写正则解析 ```` ```tool_call``` ````。
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from langchain_openai import ChatOpenAI

from config.runtime_config import RuntimeConfig, get_config

logger = logging.getLogger(__name__)

# Provider → 环境变量映射表
_PROVIDER_CONFIG: dict[str, dict[str, str]] = {
    "glm": {
        "api_key": "MODU_GLM_API_KEY",
        "base_url": "MODU_GLM_BASE_URL",
        "model": "MODU_GLM_MODEL",
        "default_base_url": "https://open.bigmodel.cn/api/paas/v4",
        "default_model": "glm-4-flash",
    },
    "deepseek": {
        "api_key": "MODU_DEEPSEEK_API_KEY",
        "base_url": "MODU_DEEPSEEK_BASE_URL",
        "model": "MODU_DEEPSEEK_MODEL",
        "default_base_url": "https://api.deepseek.com",
        "default_model": "deepseek-chat",
    },
    "gpt": {
        "api_key": "OPENAI_API_KEY",
        "base_url": "OPENAI_BASE_URL",
        "model": "OPENAI_MODEL",
        "default_base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
    },
    "qwen": {
        "api_key": "MODU_QWEN_API_KEY",
        "base_url": "MODU_QWEN_BASE_URL",
        "model": "MODU_QWEN_MODEL",
        "default_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-plus",
    },
}


def build_chat_model(
    provider: Optional[str] = None,
    config: Optional[RuntimeConfig] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    model: Optional[str] = None,
) -> ChatOpenAI:
    """构建 LangChain ChatOpenAI 实例，复用现有环境变量约定。

    Args:
        provider: LLM 提供商（glm/deepseek/gpt/qwen），None=从配置读取
        config: 运行时配置（默认使用全局单例）
        temperature: 温度参数覆盖
        max_tokens: 最大 token 覆盖
        model: 模型名覆盖（如 "deepseek-chat"），None=从环境变量读取

    Returns:
        ChatOpenAI 实例（streaming=True，支持原生 function calling）

    Raises:
        ValueError: provider 不支持或 API key 未配置
    """
    if config is None:
        config = get_config()

    provider = provider or config.get("llm.default_provider", "glm")
    pcfg = _PROVIDER_CONFIG.get(provider)

    if pcfg is None:
        logger.warning("Unknown provider '%s', falling back to glm", provider)
        pcfg = _PROVIDER_CONFIG["glm"]
        provider = "glm"

    # 解析 API key（优先 provider 专属变量，其次通用 LLM_API_KEY）
    api_key = os.getenv(pcfg["api_key"]) or os.getenv("LLM_API_KEY", "")
    if not api_key:
        logger.warning("API key not set for provider '%s' (env: %s)", provider, pcfg["api_key"])

    # 解析 base_url
    base_url = (
        os.getenv(pcfg["base_url"])
        or os.getenv("LLM_BASE_URL", pcfg["default_base_url"])
    )

    # 解析 model（参数覆盖 > 环境变量 > 默认值）
    effective_model = (
        model
        if model is not None
        else (
            os.getenv(pcfg["model"])
            or os.getenv("LLM_DEFAULT_MODEL", pcfg["default_model"])
        )
    )

    # 解析温度和 max_tokens（参数覆盖 > 配置 > 默认值）
    effective_temp = (
        temperature
        if temperature is not None
        else config.get("llm.temperature", 0.7)
    )
    effective_max_tokens = (
        max_tokens
        if max_tokens is not None
        else config.get("llm.max_tokens", 512)
    )

    logger.info(
        "Building ChatOpenAI: provider=%s model=%s base_url=%s temp=%.2f max_tokens=%d",
        provider, effective_model, base_url, effective_temp, effective_max_tokens,
    )

    return ChatOpenAI(
        api_key=api_key,
        base_url=base_url,
        model=effective_model,
        temperature=effective_temp,
        max_tokens=effective_max_tokens,
        streaming=True,  # 原生支持流式，替代手写 stream()
    )


def build_conservative_chat_model(
    provider: Optional[str] = None,
    config: Optional[RuntimeConfig] = None,
) -> ChatOpenAI:
    """构建保守模式 ChatModel（低温度），用于低置信度感知场景。

    对应 coordinator.py 中 confidence < 0.5 时降低 temperature 的逻辑。
    """
    return build_chat_model(
        provider=provider,
        config=config,
        temperature=0.3,
    )
