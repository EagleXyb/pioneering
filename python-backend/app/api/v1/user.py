from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserQuota, TokenUsage
from app.schemas.user import (
    UserProfile,
    UpdateProfileRequest,
    UserListResponse,
    UserListItem,
    QuotaInfo,
    UsageQuery,
)
from app.api.deps import get_current_user

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/list")
async def list_users(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
):
    where = []
    if search:
        where.append(
            User.username.ilike(f"%{search}%") |
            User.nickname.ilike(f"%{search}%") |
            User.email.ilike(f"%{search}%")
        )

    count_q = select(func.count()).select_from(User).where(*where)
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = (
        select(User)
        .where(*where)
        .order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    users = result.scalars().all()

    user_list = []
    for u in users:
        quota_q = select(UserQuota).where(UserQuota.user_id == u.id)
        quota_result = await db.execute(quota_q)
        quota = quota_result.scalar_one_or_none()

        user_list.append(UserListItem(
            id=u.id,
            username=u.username,
            nickname=u.nickname,
            email=u.email,
            phone=u.phone,
            avatar=u.avatar,
            status=u.status,
            total_tokens=quota.total_tokens if quota else 0,
            used_tokens=quota.used_tokens if quota else 0,
            daily_limit=quota.daily_limit if quota else 0,
            daily_used=quota.daily_used if quota else 0,
            created_at=u.created_at,
            updated_at=u.updated_at,
        ))

    return UserListResponse(list=user_list, total=total, page=page, page_size=page_size)


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


@router.get("/quota")
async def get_quota(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(UserQuota).where(UserQuota.user_id == current_user.id))
    quota = result.scalar_one_or_none()
    if not quota:
        return QuotaInfo(
            total_tokens=1_000_000,
            used_tokens=0,
            daily_limit=100_000,
            daily_used=0,
        )
    return QuotaInfo(
        total_tokens=quota.total_tokens or 0,
        used_tokens=quota.used_tokens or 0,
        daily_limit=quota.daily_limit or 0,
        daily_used=quota.daily_used or 0,
        reset_at=quota.reset_at,
    )


@router.get("/quota/usage")
async def get_usage(
    query: UsageQuery,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    where = [TokenUsage.user_id == current_user.id]

    q = (
        select(TokenUsage)
        .where(*where)
        .order_by(TokenUsage.created_at.desc())
        .offset((query.page - 1) * query.page_size)
        .limit(query.page_size)
    )
    result = await db.execute(q)
    usages = result.scalars().all()

    count_q = select(func.count()).select_from(TokenUsage).where(*where)
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    return {
        "list": [
            {
                "id": u.id,
                "model": u.model,
                "prompt_tokens": u.prompt_tokens,
                "completion_tokens": u.completion_tokens,
                "total_tokens": u.total_tokens,
                "cost": float(u.cost) if u.cost else None,
                "created_at": u.created_at.isoformat(),
            }
            for u in usages
        ],
        "total": total,
        "page": query.page,
        "page_size": query.page_size,
    }