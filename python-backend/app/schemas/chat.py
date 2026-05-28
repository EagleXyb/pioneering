from datetime import datetime
from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    title: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    initial_message: str | None = None


class UpdateSessionRequest(BaseModel):
    title: str | None = None
    model: str | None = None
    model_params: dict | None = None


class SessionResponse(BaseModel):
    id: str
    title: str | None = None
    model: str | None = None
    model_params: dict | None = None
    message_count: int = 0
    last_message: dict | None = None
    created_at: datetime
    updated_at: datetime
    is_archived: bool = False

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
    total: int
    page: int
    page_size: int


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    content_blocks: list | None = None
    token_count: int | None = None
    feedback: str = "none"
    metadata: dict | None = None
    parent_message_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatCompletionRequest(BaseModel):
    session_id: str | None = None
    message: str
    model: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    stream: bool = True
    parent_message_id: str | None = None
    deep_think: bool = False
    net_search: bool = False
    message_id: str | None = None


class StopGenerationRequest(BaseModel):
    session_id: str
    message_id: str | None = None


class FeedbackRequest(BaseModel):
    feedback: str = Field(..., pattern="^(none|like|dislike)$")


class EditMessageRequest(BaseModel):
    content: str


class RegenerateRequest(BaseModel):
    model: str | None = None
    temperature: float | None = None


class QueryMessagesParams(BaseModel):
    page: int = 1
    page_size: int = 50


class QuerySessionsParams(BaseModel):
    page: int = 1
    page_size: int = 20
    archived: bool | None = None