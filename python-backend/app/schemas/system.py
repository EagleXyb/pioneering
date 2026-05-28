from pydantic import BaseModel


class SystemConfig(BaseModel):
    max_message_length: int = 10000
    max_session_count: int = 100
    supported_models: list[dict] = []
    file_upload: dict = {}


class ModelInfo(BaseModel):
    id: str
    name: str
    description: str
    max_tokens: int
    pricing: dict


class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: str


class ApiResponse(BaseModel):
    code: int = 200
    data: dict | list | None = None
    message: str = "success"