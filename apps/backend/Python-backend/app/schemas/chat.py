from datetime import datetime
from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    title: str | None = None
    model: str | None = None
    systemPrompt: str | None = Field(None, alias="system_prompt")
    initialMessage: str | None = Field(None, alias="initial_message")

    model_config = {"populate_by_name": True}


class UpdateSessionRequest(BaseModel):
    title: str | None = None
    model: str | None = None
    modelConfig: dict | None = Field(None, alias="model_params")

    model_config = {"populate_by_name": True}


class SessionResponse(BaseModel):
    id: str
    title: str | None = None
    model: str | None = None
    modelConfig: dict | None = None
    messageCount: int = 0
    lastMessage: dict | None = None
    createdAt: datetime
    updatedAt: datetime
    isArchived: bool = False

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
    total: int
    page: int
    pageSize: int


class MessageResponse(BaseModel):
    id: str
    sessionId: str
    role: str
    content: str
    contentBlocks: list | None = None
    tokenCount: int | None = None
    feedback: str = "none"
    metadata: dict | None = None
    parentMessageId: str | None = None
    createdAt: datetime
    updatedAt: datetime

    model_config = {"from_attributes": True}


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    nextCursor: str | None = None
    hasMore: bool = False


class ChatCompletionRequest(BaseModel):
    sessionId: str | None = Field(None, alias="session_id")
    message: str
    model: str | None = None
    systemPrompt: str | None = Field(None, alias="system_prompt")
    temperature: float | None = None
    maxTokens: int | None = Field(None, alias="max_tokens")
    stream: bool = True
    parentMessageId: str | None = Field(None, alias="parent_message_id")
    deepThink: bool = False
    netSearch: bool = False
    messageId: str | None = Field(None, alias="message_id")

    model_config = {"populate_by_name": True}


class ChatCompletionResponse(BaseModel):
    id: str
    sessionId: str
    model: str
    choices: list[dict]
    usage: dict | None = None
    createdAt: str


class StopGenerationRequest(BaseModel):
    sessionId: str = Field(..., alias="session_id")
    messageId: str | None = Field(None, alias="message_id")

    model_config = {"populate_by_name": True}


class FeedbackRequest(BaseModel):
    feedback: str = Field(..., pattern="^(none|like|dislike)$")


class EditMessageRequest(BaseModel):
    content: str
    regenerate: bool = False


class RegenerateRequest(BaseModel):
    model: str | None = None
    temperature: float | None = None
    maxTokens: int | None = Field(None, alias="max_tokens")

    model_config = {"populate_by_name": True}


class QueryMessagesParams(BaseModel):
    cursor: str | None = None
    limit: int = 30
    direction: str = "before"


class QuerySessionsParams(BaseModel):
    page: int = 1
    pageSize: int = Field(20, ge=1, alias="page_size")
    archived: bool | None = None

    model_config = {"populate_by_name": True}