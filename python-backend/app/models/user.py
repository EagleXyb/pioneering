import uuid
from datetime import datetime, timezone

from decimal import Decimal as PyDecimal

from sqlalchemy import Column, DateTime, String, Text, SmallInteger, Integer, Float, BigInteger, Boolean, JSON, ForeignKey, Enum as SAEnum
from sqlalchemy import DECIMAL
from sqlalchemy.orm import relationship
import enum

from app.database import Base


def gen_id(prefix: str = "") -> str:
    uid = uuid.uuid4().hex[:24]
    return f"{prefix}{uid}" if prefix else uid


class MessageRole(str, enum.Enum):
    system = "system"
    user = "user"
    assistant = "assistant"
    tool = "tool"


class Feedback(str, enum.Enum):
    none = "none"
    like = "like"
    dislike = "dislike"


class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True, default=lambda: gen_id("user_"))
    username = Column(String(100), unique=True, nullable=False)
    nickname = Column(String(100), nullable=True)
    avatar = Column(String(500), nullable=True)
    email = Column(String(200), nullable=True)
    phone = Column(String(20), nullable=True)
    password_hash = Column("password_hash", String(255), nullable=True)
    wechat_openid = Column("wechat_openid", String(100), nullable=True)
    wechat_unionid = Column("wechat_unionid", String(100), nullable=True)
    status = Column(SmallInteger, default=1)
    created_at = Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column("updated_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    chat_sessions = relationship("ChatSession", back_populates="user")
    chat_messages = relationship("ChatMessage", back_populates="user")
    files = relationship("File", back_populates="user")
    token_usages = relationship("TokenUsage", back_populates="user")
    refresh_tokens = relationship("RefreshToken", back_populates="user")
    user_quota = relationship("UserQuota", back_populates="user", uselist=False)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(String(64), primary_key=True, default=lambda: gen_id())
    user_id = Column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(500), unique=True, nullable=False)
    device_info = Column("device_info", String(200), nullable=True)
    expires_at = Column("expires_at", DateTime(timezone=True), nullable=False)
    revoked = Column(Boolean, default=False)
    created_at = Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="refresh_tokens")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String(64), primary_key=True, default=lambda: gen_id("sess_"))
    user_id = Column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), default="新对话")
    model = Column(String(100), default="gpt-4o-mini")
    model_config = Column("model_config", JSON, nullable=True)
    system_prompt = Column("system_prompt", Text, nullable=True)
    message_count = Column("message_count", Integer, default=0)
    last_message_id = Column("last_message_id", String(64), nullable=True)
    is_archived = Column("is_archived", Boolean, default=False)
    agent_mode = Column("agent_mode", String(50), nullable=True)
    created_at = Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column("updated_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String(64), primary_key=True, default=lambda: gen_id("msg_"))
    session_id = Column("session_id", String(64), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    parent_message_id = Column("parent_message_id", String(64), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True)
    role = Column(SAEnum(MessageRole, name="MessageRole"), nullable=False)
    content = Column(Text, nullable=False)
    content_blocks = Column("content_blocks", JSON, nullable=True)
    token_count = Column("token_count", Integer, nullable=True)
    feedback = Column(SAEnum(Feedback, name="Feedback"), default=Feedback.none)
    extra_metadata = Column("metadata", JSON, nullable=True)

    # LLM 可观测性指标
    prompt_tokens = Column("prompt_tokens", Integer, nullable=True)
    completion_tokens = Column("completion_tokens", Integer, nullable=True)
    latency_ms = Column("latency_ms", Integer, nullable=True)

    # 用户反馈闭环
    user_rating = Column("user_rating", SmallInteger, nullable=True)
    user_feedback = Column("user_feedback", Text, nullable=True)

    created_at = Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column("updated_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    session = relationship("ChatSession", back_populates="messages")
    user = relationship("User", back_populates="chat_messages")
    parent_message = relationship("ChatMessage", back_populates="child_messages", remote_side="ChatMessage.id")
    child_messages = relationship("ChatMessage", back_populates="parent_message")


class File(Base):
    __tablename__ = "files"

    id = Column(String(64), primary_key=True, default=lambda: gen_id("file_"))
    user_id = Column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    original_name = Column("original_name", String(500), nullable=False)
    file_type = Column("file_type", String(50), nullable=True)
    file_size = Column("file_size", BigInteger, nullable=True)
    file_path = Column("file_path", String(1000), nullable=True)
    url = Column(String(1000), nullable=True)
    thumbnail_url = Column("thumbnail_url", String(1000), nullable=True)
    status = Column(SmallInteger, default=1)
    created_at = Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="files")


class TokenUsage(Base):
    __tablename__ = "token_usage"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id = Column("session_id", String(64), nullable=True)
    message_id = Column("message_id", String(64), nullable=True)
    model = Column(String(100), nullable=True)
    prompt_tokens = Column("prompt_tokens", Integer, nullable=True)
    completion_tokens = Column("completion_tokens", Integer, nullable=True)
    total_tokens = Column("total_tokens", Integer, nullable=True)
    cost = Column(DECIMAL(10, 6), nullable=True)
    created_at = Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="token_usages")


class UserQuota(Base):
    __tablename__ = "user_quotas"

    user_id = Column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    total_tokens = Column("total_tokens", BigInteger, default=1_000_000)
    used_tokens = Column("used_tokens", BigInteger, default=0)
    daily_limit = Column("daily_limit", BigInteger, default=100_000)
    daily_used = Column("daily_used", BigInteger, default=0)
    reset_at = Column("reset_at", DateTime(timezone=True), nullable=True)
    updated_at = Column("updated_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="user_quota")


class AiConfig(Base):
    __tablename__ = "ai_configs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    provider = Column(String(50), default="deepseek")
    model = Column(String(100), default="deepseek-v4-flash")
    api_key = Column("api_key", String(500), nullable=False)
    prompt = Column(Text, nullable=True)
    last_test_input = Column("last_test_input", String(500), nullable=True)
    last_test_result = Column("last_test_result", Text, nullable=True)
    last_test_time = Column("last_test_time", DateTime(timezone=True), nullable=True)
    created_at = Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column("updated_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class AgentToolExecution(Base):
    __tablename__ = "agent_tool_executions"

    id = Column(String(64), primary_key=True, default=lambda: gen_id("exec_"))
    message_id = Column("message_id", String(64), ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False)
    session_id = Column("session_id", String(64), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    tool_name = Column("tool_name", String(100), nullable=False)
    tool_call_id = Column("tool_call_id", String(100), nullable=True)

    input_params = Column("input_params", JSON, nullable=True)
    output_result = Column("output_result", Text, nullable=True)
    output_summary = Column("output_summary", Text, nullable=True)

    status = Column(String(20), default="pending")
    error_message = Column("error_message", Text, nullable=True)

    start_time = Column("start_time", DateTime(timezone=True), nullable=True)
    end_time = Column("end_time", DateTime(timezone=True), nullable=True)
    # duration_ms is a GENERATED ALWAYS column in DB, computed from start_time/end_time
    duration_ms = Column("duration_ms", Integer, nullable=True)

    metadata_ = Column("metadata", JSON, nullable=True)
    created_at = Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))