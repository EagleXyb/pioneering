from __future__ import annotations

import os
from typing import Optional

from components.reasoning.llm.base_llm import BaseLLMReasoner

_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
_DEFAULT_MODEL = "glm-4-flash"


class GLMLLMReasoner(BaseLLMReasoner):
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout: float = 120.0,
        system_prompt: Optional[str] = None,
    ) -> None:
        resolved_key = api_key or os.getenv("MODU_GLM_API_KEY") or os.getenv("LLM_API_KEY", "")
        resolved_url = base_url or os.getenv("MODU_GLM_BASE_URL") or os.getenv("LLM_BASE_URL", _DEFAULT_BASE_URL)
        resolved_model = default_model or os.getenv("MODU_GLM_MODEL") or os.getenv("LLM_DEFAULT_MODEL", _DEFAULT_MODEL)
        super().__init__(
            api_key=resolved_key,
            base_url=resolved_url,
            default_model=resolved_model,
            timeout=timeout,
            system_prompt=system_prompt,
        )