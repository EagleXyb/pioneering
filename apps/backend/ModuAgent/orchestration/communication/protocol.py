from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class EventDomain(str, Enum):
    PERCEPTION = "perception"
    REASONING = "reasoning"
    MEMORY = "memory"
    ACTION = "action"
    FEEDBACK = "feedback"
    TOOL = "tool"
    NLP = "nlp"
    VISION = "vision"


class EventAction(str, Enum):
    QUERY = "query"
    UPDATE = "update"
    ANALYZE = "analyze"
    ANALYZE_SCENE = "analyze_scene"
    EXECUTE = "execute"
    INVOKE = "invoke"
    GENERATE = "generate"
    STREAM = "stream"
    REGISTER = "register"
    NOTIFY = "notify"
    # P3-12.3.1 多 Agent 协作共识事件
    CONSENSUS_REACHED = "consensus_reached"
    CONSENSUS_FAILED = "consensus_failed"
    # P3-12.3.2 Human-in-the-loop 审批事件
    HUMAN_REVIEW_REQUIRED = "human_review_required"
    HUMAN_REVIEW_APPROVED = "human_review_approved"
    HUMAN_REVIEW_REJECTED = "human_review_rejected"


class EventPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class AgentEvent:
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    trace_id: str = field(default="")
    session_id: str = field(default="")
    user_id: str = field(default="")
    domain: str = field(default="")
    action: str = field(default="")
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    payload: bytes = field(default=b"")
    metadata: Dict[str, str] = field(default_factory=dict)
    priority: EventPriority = EventPriority.NORMAL

    def __post_init__(self):
        if not self.trace_id:
            self.trace_id = str(uuid.uuid4())
        if not self.user_id:
            raise ValueError("user_id is required")
        if not self.session_id:
            raise ValueError("session_id is required")
        if not self.domain:
            raise ValueError("domain is required")
        if not self.action:
            raise ValueError("action is required")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "trace_id": self.trace_id,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "domain": self.domain,
            "action": self.action,
            "timestamp": self.timestamp.isoformat(),
            "payload": self.payload.hex() if self.payload else "",
            "metadata": self.metadata,
            "priority": self.priority.value,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentEvent":
        ts = data.get("timestamp")
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)
        elif ts is None:
            ts = datetime.now(timezone.utc)

        payload = data.get("payload", b"")
        if isinstance(payload, str) and payload:
            payload = bytes.fromhex(payload)

        priority = data.get("priority", EventPriority.NORMAL.value)
        if isinstance(priority, str):
            priority = EventPriority(priority)

        return cls(
            event_id=data.get("event_id", str(uuid.uuid4())),
            trace_id=data.get("trace_id", ""),
            session_id=data.get("session_id", ""),
            user_id=data.get("user_id", ""),
            domain=data.get("domain", ""),
            action=data.get("action", ""),
            timestamp=ts,
            payload=payload,
            metadata=data.get("metadata", {}),
            priority=priority,
        )


@dataclass
class MemoryQueryRequest:
    context_window: str = "last_5_turns"
    required_fields: List[str] = field(default_factory=list)
    enable_compression: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "context_window": self.context_window,
            "required_fields": self.required_fields,
            "enable_compression": self.enable_compression,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MemoryQueryRequest":
        return cls(
            context_window=data.get("context_window", "last_5_turns"),
            required_fields=data.get("required_fields", []),
            enable_compression=data.get("enable_compression", False),
        )


@dataclass
class MemoryQueryResponse:
    fields: Dict[str, Any] = field(default_factory=dict)
    compressed: bool = False


@dataclass
class ToolCallRequest:
    tool_name: str = ""
    parameters: Dict[str, Any] = field(default_factory=dict)
    timeout_ms: int = 1800000
    required_fields: List[str] = field(default_factory=list)

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
class ToolCallResponse:
    status: str = "success"
    error_code: str = ""
    data: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PerceptionInput:
    input_type: str = "text"
    raw_content: bytes = b""
    language: Optional[str] = None
    sensitivity_level: int = 0

    def __post_init__(self):
        if self.input_type not in ("text", "image", "audio"):
            raise ValueError(f"Invalid input_type: {self.input_type}")
        if not 0 <= self.sensitivity_level <= 5:
            raise ValueError("sensitivity_level must be between 0 and 5")


@dataclass
class LLMRequest:
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
class LLMResponse:
    content: str = ""
    model: str = ""
    tokens_used: int = 0


class ErrorCode:
    TOOL_PARAMETER_INVALID = "TOOL_001"
    TOOL_SERVICE_TIMEOUT = "TOOL_002"
    MEMORY_CONTEXT_EXCEEDED = "MEMORY_101"
    MEMORY_FIELD_MISSING = "MEMORY_102"
    LLM_GENERATION_FAILED = "LLM_001"
    LLM_STREAM_ERROR = "LLM_002"
    PERCEPTION_INPUT_INVALID = "PERCEPTION_001"
    PERCEPTION_SENSITIVITY_REJECTED = "PERCEPTION_002"
    EVENT_BUS_ERROR = "BUS_001"
    # P3-12.3.1 多 Agent 协作错误码
    CONSENSUS_NOT_ENOUGH_PARTICIPANTS = "CONSENSUS_001"
    CONSENSUS_QUORUM_NOT_MET = "CONSENSUS_002"
    CONSENSUS_STRATEGY_ERROR = "CONSENSUS_003"
