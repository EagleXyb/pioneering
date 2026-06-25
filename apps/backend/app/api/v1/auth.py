from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.user import (
    RegisterRequest,
    LoginRequest,
    RefreshTokenRequest,
    TokenResponse,
    UserProfile,
    UpdateProfileRequest,
)
from app.models.user import User, RefreshToken
from app.core.security import hash_password, verify_password, create_access_token, decode_access_token
from app.api.deps import get_current_user
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


def _generate_refresh_token() -> str:
    return f"rt_{uuid4().hex}"


async def _create_refresh_token(db: AsyncSession, user_id: str) -> str:
    token_str = _generate_refresh_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expiration_days)
    rt = RefreshToken(
        id=f"rt_{uuid4().hex[:24]}",
        user_id=user_id,
        token=token_str,
        expires_at=expires_at,
    )
    db.add(rt)
    await db.flush()
    return token_str


async def _generate_auth_response(db: AsyncSession, user: User) -> TokenResponse:
    access_token = create_access_token(sub=user.id, extra_claims={"username": user.username})
    refresh_token = await _create_refresh_token(db, user.id)
    return TokenResponse(
        token=access_token,
        refreshToken=refresh_token,
        user={
            "id": user.id,
            "username": user.username,
            "nickname": user.nickname,
            "avatar": user.avatar,
            "email": user.email,
            "phone": user.phone,
        },
    )


@router.post("/register")
async def register(dto: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # 检查用户名是否已存在
    result = await db.execute(select(User).where(User.username == dto.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已被注册")

    # 检查邮箱是否已存在
    if dto.email:
        result = await db.execute(select(User).where(User.email == dto.email))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="邮箱已被注册")

    user = User(
        id=f"user_{uuid4().hex[:24]}",
        username=dto.username,
        email=dto.email,
        password_hash=hash_password(dto.password),
        nickname=dto.username,
        status=1,
    )
    db.add(user)
    await db.flush()
    return await _generate_auth_response(db, user)


@router.post("/login")
async def login(dto: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == dto.username))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if not user.password_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="该账号未设置密码，请使用微信登录")

    if not verify_password(dto.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    return await _generate_auth_response(db, user)


@router.post("/wechat/miniprogram")
async def wechat_miniprogram_login(code: str, db: AsyncSession = Depends(get_db)):
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="code 不能为空")

    mock_openid = f"wx_mp_{code[:16]}"
    result = await db.execute(select(User).where(User.username == mock_openid))
    user = result.scalar_one_or_none()

    if user:
        user.wechat_openid = mock_openid
    else:
        user = User(
            id=f"user_{uuid4().hex[:24]}",
            username=mock_openid,
            wechat_openid=mock_openid,
            nickname="微信用户",
        )
        db.add(user)

    await db.flush()
    return await _generate_auth_response(db, user)


@router.post("/wechat/web")
async def wechat_web_login(code: str, db: AsyncSession = Depends(get_db)):
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="code 不能为空")

    mock_openid = f"wx_web_{code[:16]}"
    result = await db.execute(select(User).where(User.username == mock_openid))
    user = result.scalar_one_or_none()

    if user:
        user.wechat_unionid = mock_openid
    else:
        user = User(
            id=f"user_{uuid4().hex[:24]}",
            username=mock_openid,
            wechat_unionid=mock_openid,
            nickname="微信用户",
        )
        db.add(user)

    await db.flush()
    return await _generate_auth_response(db, user)


@router.post("/refresh")
async def refresh_token(dto: RefreshTokenRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token == dto.refresh_token,
            RefreshToken.revoked == False,  # noqa: E712
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="刷新令牌无效或已过期")

    rt.revoked = True
    await db.flush()

    result = await db.execute(select(User).where(User.id == rt.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")

    return await _generate_auth_response(db, user)


@router.get("/profile", response_model=UserProfile)
async def get_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/profile", response_model=UserProfile)
async def update_profile(
    dto: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if dto.nickname is not None:
        current_user.nickname = dto.nickname
    if dto.avatar is not None:
        current_user.avatar = dto.avatar
    await db.flush()
    await db.refresh(current_user)
    return current_user