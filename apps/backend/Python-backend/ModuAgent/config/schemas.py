from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class PerceptionInputSchema:
    input_type: str = "text"
    raw_content: bytes = b""
    language: Optional[str] = None
    sensitivity_level: int = 0

    REQUIRED_FIELDS = {"input_type", "raw_content"}

    def __post_init__(self):
        if self.input_type not in ("text", "image", "audio"):
            raise ValueError(f"Invalid input_type: {self.input_type}, must be text/image/audio")
        if not 0 <= self.sensitivity_level <= 5:
            raise ValueError("sensitivity_level must be between 0 and 5")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "input_type": self.input_type,
            "raw_content": self.raw_content.hex() if self.raw_content else "",
            "language": self.language,
            "sensitivity_level": self.sensitivity_level,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PerceptionInputSchema":
        raw = data.get("raw_content", b"")
        if isinstance(raw, str) and raw:
            raw = bytes.fromhex(raw)
        return cls(
            input_type=data.get("input_type", "text"),
            raw_content=raw,
            language=data.get("language"),
            sensitivity_level=data.get("sensitivity_level", 0),
        )


@dataclass
class PerceptionOutputSchema:
    parsed_content: Dict[str, Any] = field(default_factory=dict)
    detected_language: Optional[str] = None
    confidence: float = 0.0
    metadata: Dict[str, str] = field(default_factory=dict)


@dataclass
class MemoryQuerySchema:
    user_id: str = ""
    context_window: str = "last_5_turns"
    required_fields: List[str] = field(default_factory=list)
    enable_compression: bool = False

    REQUIRED_FIELDS = {"user_id", "context_window", "required_fields"}

    def __post_init__(self):
        if not self.user_id:
            raise ValueError("user_id is required")
        if not self.context_window:
            raise ValueError("context_window is required")
        if not self.required_fields:
            raise ValueError("required_fields must be explicitly declared")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "context_window": self.context_window,
            "required_fields": self.required_fields,
            "enable_compression": self.enable_compression,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MemoryQuerySchema":
        return cls(
            user_id=data.get("user_id", ""),
            context_window=data.get("context_window", "last_5_turns"),
            required_fields=data.get("required_fields", []),
            enable_compression=data.get("enable_compression", False),
        )


@dataclass
class MemoryUpdateSchema:
    user_id: str = ""
    new_data: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    mode: str = "incremental"

    def __post_init__(self):
        if not self.user_id:
            raise ValueError("user_id is required")
        if self.mode not in ("incremental", "overwrite"):
            raise ValueError(f"Invalid mode: {self.mode}, must be incremental/overwrite")


@dataclass
class ToolCallSchema:
    tool_name: str = ""
    parameters: Dict[str, Any] = field(default_factory=dict)
    timeout_ms: int = 3000
    required_fields: List[str] = field(default_factory=list)

    REQUIRED_FIELDS = {"tool_name", "parameters"}

    def __post_init__(self):
        if not self.tool_name:
            raise ValueError("tool_name is required")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "parameters": self.parameters,
            "timeout_ms": self.timeout_ms,
            "required_fields": self.required_fields,
        }


@dataclass
class ToolResultSchema:
    status: str = "success"
    error_code: str = ""
    data: Dict[str, Any] = field(default_factory=dict)

    def is_success(self) -> bool:
        return self.status == "success"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "error_code": self.error_code,
            "data": self.data,
        }


@dataclass
class LLMCallSchema:
    prompt: str = ""
    context: Dict[str, Any] = field(default_factory=dict)
    temperature: float = 0.7
    max_tokens: int = 512

    def __post_init__(self):
        if not self.prompt:
            raise ValueError("prompt is required")
        if not 0.0 <= self.temperature <= 2.0:
            raise ValueError("temperature must be between 0.0 and 2.0")
        if self.max_tokens <= 0:
            raise ValueError("max_tokens must be positive")


@dataclass
class LLMResultSchema:
    content: str = ""
    model: str = ""
    tokens_used: int = 0
    finish_reason: str = ""


@dataclass
class FeedbackSignalSchema:
    source: str = ""
    metric_name: str = ""
    value: float = 0.0
    threshold: float = 0.0
    triggered: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)
