from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional

from core.interfaces.perception import BasePerception

_DEFAULT_SENSITIVITY_PATTERNS: List[str] = [
    r"密码",
    r"身份证",
    r"银行卡",
    r"passport",
    r"password",
    r"credit\s*card",
]


class TextPreprocessor(BasePerception):
    def __init__(
        self,
        language: str = "zh",
        max_length: int = 2048,
        sensitivity_patterns: Optional[List[str]] = None,
    ) -> None:
        self._language = language
        self._max_length = max_length
        self._sensitivity_patterns = sensitivity_patterns or _DEFAULT_SENSITIVITY_PATTERNS

    def perceive(
        self,
        input_type: str,
        raw_content: bytes,
        language: Optional[str] = None,
        sensitivity_level: int = 0,
    ) -> Dict[str, Any]:
        if input_type != "text":
            return {
                "parsed_content": {"input_type": input_type, "error": "unsupported input type"},
                "detected_language": None,
                "confidence": 0.0,
                "metadata": {"sensitivity_level": 0},
            }

        text, truncated = self._decode_and_truncate(raw_content)
        detected_lang = language or self._detect_language(text)
        detected_sensitivity = self._detect_sensitivity(text)

        return {
            "parsed_content": {
                "input_type": "text",
                "text": text,
            },
            "detected_language": detected_lang,
            "confidence": 1.0,
            "metadata": {
                "sensitivity_level": max(sensitivity_level, detected_sensitivity),
                "truncated": truncated,
                "original_length": len(raw_content),
            },
        }

    def _decode_and_truncate(self, raw_content: bytes) -> tuple[str, bool]:
        try:
            text = raw_content.decode("utf-8")
        except UnicodeDecodeError:
            text = raw_content.decode("utf-8", errors="replace")

        text = unicodedata.normalize("NFKC", text)
        text = text.strip()

        if len(text) > self._max_length:
            return text[: self._max_length], True
        return text, False

    def _detect_language(self, text: str) -> str:
        cjk_count = 0
        latin_count = 0
        for char in text:
            cp = ord(char)
            if (0x4E00 <= cp <= 0x9FFF) or (0x3400 <= cp <= 0x4DBF) or (0x3000 <= cp <= 0x303F):
                cjk_count += 1
            elif (0x0041 <= cp <= 0x007A) or (0x00C0 <= cp <= 0x024F):
                latin_count += 1
        if cjk_count > latin_count:
            return "zh"
        if latin_count > 0:
            return "en"
        return self._language

    def _detect_sensitivity(self, text: str) -> int:
        for pattern in self._sensitivity_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return 5
        return 0
