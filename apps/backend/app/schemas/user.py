from datetime import datetime
from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    token: str
    refreshToken: str
    user: dict | None = None


class UserProfile(BaseModel):
    id: str
    username: str
    nickname: str | None = None
    avatar: str | None = None
    email: str | None = None
    phone: str | None = None
    status: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UpdateProfileRequest(BaseModel):
    nickname: str | None = None
    avatar: str | None = None


class UserListItem(BaseModel):
    id: str
    username: str
    nickname: str | None = None
    email: str | None = None
    phone: str | None = None
    avatar: str | None = None
    status: int
    total_tokens: int = 0
    used_tokens: int = 0
    daily_limit: int = 0
    daily_used: int = 0
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    list: list[UserListItem]
    total: int
    page: int
    page_size: int


class QuotaInfo(BaseModel):
    total_tokens: int
    used_tokens: int
    daily_limit: int
    daily_used: int
    reset_at: datetime | None = None


class UsageQuery(BaseModel):
    start_date: str | None = None
    end_date: str | None = None
    page: int = 1
    page_size: int = 20