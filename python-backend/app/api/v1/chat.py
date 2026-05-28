import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, delete as sa_delete, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.models.user import User, ChatSession, ChatMessage, MessageRole, Feedback
from app.schemas.chat import (
    CreateSessionRequest,
    UpdateSessionRequest,
    SessionResponse,
    SessionListResponse,
    MessageResponse,
    ChatCompletionRequest,
    StopGenerationRequest,
    FeedbackRequest,
    EditMessageRequest,
    RegenerateRequest,
    QueryMessagesParams,
    QuerySessionsParams,
)
from app.api.deps import get_current_user
from app.core.llm import llm_service

router = APIRouter(prefix="/chat", tags=["chat"])


def _gen_id(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:24]}"


async def _verify_session_owner(db: AsyncSession, session_id: str, user_id: str) -> ChatSession:
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    return session


# ========== 会话 ==========


@router.get("/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    archived: bool | None = None,
):
    where = [ChatSession.user_id == current_user.id]
    if archived is not None:
        where.append(ChatSession.is_archived == archived)

    count_q = select(func.count()).select_from(ChatSession).where(*where)
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = (
        select(ChatSession)
        .where(*where)
        .order_by(ChatSession.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    sessions = result.scalars().all()

    session_list = []
    for s in sessions:
        msg_q = (
            select(ChatMessage)
            .where(ChatMessage.session_id == s.id)
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        msg_result = await db.execute(msg_q)
        last_msg = msg_result.scalar_one_or_none()

        session_list.append(SessionResponse(
            id=s.id,
            title=s.title,
            model=s.model,
            model_params=s.model_config,
            message_count=s.message_count or 0,
            last_message={
                "content": last_msg.content[:50] if last_msg else None,
                "role": last_msg.role.value if last_msg else None,
                "created_at": last_msg.created_at.isoformat() if last_msg else None,
            } if last_msg else None,
            created_at=s.created_at,
            updated_at=s.updated_at,
            is_archived=s.is_archived or False,
        ))

    return SessionListResponse(sessions=session_list, total=total, page=page, page_size=page_size)


@router.post("/sessions")
async def create_session(
    dto: CreateSessionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = ChatSession(
        id=_gen_id("sess_"),
        user_id=current_user.id,
        title=dto.title or "新对话",
        model=dto.model or "gpt-4o-mini",
        system_prompt=dto.system_prompt,
    )
    db.add(session)
    await db.flush()

    if dto.initial_message:
        msg = ChatMessage(
            id=_gen_id("msg_"),
            session_id=session.id,
            user_id=current_user.id,
            role=MessageRole.user,
            content=dto.initial_message,
        )
        db.add(msg)
        session.message_count = (session.message_count or 0) + 1
        await db.flush()

    await db.refresh(session)
    return SessionResponse(
        id=session.id,
        title=session.title,
        model=session.model,
        model_params=session.model_config,
        message_count=session.message_count or 0,
        created_at=session.created_at,
        updated_at=session.updated_at,
        is_archived=session.is_archived or False,
    )


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _verify_session_owner(db, session_id, current_user.id)
    return SessionResponse(
        id=session.id,
        title=session.title,
        model=session.model,
        model_params=session.model_config,
        message_count=session.message_count or 0,
        created_at=session.created_at,
        updated_at=session.updated_at,
        is_archived=session.is_archived or False,
    )


@router.put("/sessions/{session_id}")
async def update_session(
    session_id: str,
    dto: UpdateSessionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _verify_session_owner(db, session_id, current_user.id)
    if dto.title is not None:
        session.title = dto.title
    if dto.model is not None:
        session.model = dto.model
    if dto.model_params is not None:
        session.model_config = dto.model_params
    await db.flush()
    await db.refresh(session)
    return SessionResponse(
        id=session.id,
        title=session.title,
        model=session.model,
        model_params=session.model_config,
        message_count=session.message_count or 0,
        created_at=session.created_at,
        updated_at=session.updated_at,
        is_archived=session.is_archived or False,
    )


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    archive: bool | None = None,
):
    session = await _verify_session_owner(db, session_id, current_user.id)
    if archive is True:
        session.is_archived = True
        await db.flush()
        return {"message": "会话已归档"}
    elif archive is False:
        session.is_archived = False
        await db.flush()
        return {"message": "会话已取消归档"}

    await db.execute(sa_delete(ChatMessage).where(ChatMessage.session_id == session_id))
    await db.delete(session)
    await db.flush()
    return {"message": "会话已删除"}


# ========== 消息 ==========


@router.get("/sessions/{session_id}/messages")
async def get_messages(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    await _verify_session_owner(db, session_id, current_user.id)
    q = (
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    messages = result.scalars().all()

    return [
        MessageResponse(
            id=m.id,
            session_id=m.session_id,
            role=m.role.value,
            content=m.content,
            content_blocks=m.content_blocks,
            token_count=m.token_count,
            feedback=m.feedback.value if m.feedback else "none",
            metadata=m.extra_metadata,
            parent_message_id=m.parent_message_id,
            created_at=m.created_at,
            updated_at=m.updated_at,
        )
        for m in messages
    ]


@router.put("/sessions/{session_id}/messages/{message_id}")
async def edit_message(
    session_id: str,
    message_id: str,
    dto: EditMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _verify_session_owner(db, session_id, current_user.id)
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.session_id == session_id,
            ChatMessage.user_id == current_user.id,
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息不存在")

    msg.content = dto.content
    await db.flush()
    await db.refresh(msg)
    return MessageResponse(
        id=msg.id,
        session_id=msg.session_id,
        role=msg.role.value,
        content=msg.content,
        content_blocks=msg.content_blocks,
        token_count=msg.token_count,
        feedback=msg.feedback.value if msg.feedback else "none",
        metadata=msg.extra_metadata,
        parent_message_id=msg.parent_message_id,
        created_at=msg.created_at,
        updated_at=msg.updated_at,
    )


# ========== 对话补全 ==========


@router.post("/completions")
async def chat_completion(
    dto: ChatCompletionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_id = dto.session_id
    if not session_id:
        session = ChatSession(
            id=_gen_id("sess_"),
            user_id=current_user.id,
            title=dto.message[:50],
            model=dto.model or "gpt-4o-mini",
        )
        db.add(session)
        await db.flush()
        session_id = session.id

    # save user message
    user_msg = ChatMessage(
        id=_gen_id("msg_"),
        session_id=session_id,
        user_id=current_user.id,
        role=MessageRole.user,
        content=dto.message,
        parent_message_id=dto.parent_message_id,
    )
    db.add(user_msg)

    # update session
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = result.scalar_one_or_none()
    if session:
        session.message_count = (session.message_count or 0) + 1

    await db.flush()

    # build message history
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    history = history_result.scalars().all()

    messages_for_llm = []
    for m in history:
        messages_for_llm.append({"role": m.role.value, "content": m.content})

    if dto.stream:
        async def event_generator():
            full_content = ""
            async for chunk in llm_service.chat_completion(
                messages=messages_for_llm,
                model=dto.model,
                temperature=dto.temperature,
                max_tokens=dto.max_tokens,
                stream=True,
            ):
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    full_content += content
                    yield {"event": "delta", "data": json.dumps({"content": content})}

            # save assistant message
            assistant_msg = ChatMessage(
                id=_gen_id("msg_"),
                session_id=session_id,
                user_id=current_user.id,
                role=MessageRole.assistant,
                content=full_content,
                parent_message_id=user_msg.id,
            )
            db.add(assistant_msg)
            if session:
                session.message_count = (session.message_count or 0) + 1
                session.last_message_id = assistant_msg.id
            await db.commit()

            yield {"event": "done", "data": json.dumps({"message_id": assistant_msg.id})}

        return EventSourceResponse(event_generator())

    # non-streaming
    result_data = await llm_service.chat_completion(
        messages=messages_for_llm,
        model=dto.model,
        temperature=dto.temperature,
        max_tokens=dto.max_tokens,
        stream=False,
    )
    content = result_data.get("choices", [{}])[0].get("message", {}).get("content", "")

    assistant_msg = ChatMessage(
        id=_gen_id("msg_"),
        session_id=session_id,
        user_id=current_user.id,
        role=MessageRole.assistant,
        content=content,
        parent_message_id=user_msg.id,
    )
    db.add(assistant_msg)
    if session:
        session.message_count = (session.message_count or 0) + 1
        session.last_message_id = assistant_msg.id
    await db.flush()

    return MessageResponse(
        id=assistant_msg.id,
        session_id=assistant_msg.session_id,
        role=assistant_msg.role.value,
        content=assistant_msg.content,
        token_count=result_data.get("usage", {}).get("total_tokens"),
        parent_message_id=assistant_msg.parent_message_id,
        created_at=assistant_msg.created_at,
        updated_at=assistant_msg.updated_at,
    )


@router.post("/completions/stop")
async def stop_generation(
    dto: StopGenerationRequest,
    current_user: User = Depends(get_current_user),
):
    return {"message": "stopped"}


# ========== 反馈 ==========


@router.post("/messages/{message_id}/feedback")
async def set_feedback(
    message_id: str,
    dto: FeedbackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.user_id == current_user.id,
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息不存在")

    msg.feedback = Feedback(dto.feedback)
    await db.flush()
    return {"message": "反馈已提交"}


# ========== 重新生成 ==========


@router.post("/messages/{message_id}/regenerate")
async def regenerate(
    message_id: str,
    dto: RegenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.user_id == current_user.id,
        )
    )
    original_msg = result.scalar_one_or_none()
    if not original_msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息不存在")

    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == original_msg.session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    history = history_result.scalars().all()

    messages_for_llm = [{"role": m.role.value, "content": m.content} for m in history]

    result_data = await llm_service.chat_completion(
        messages=messages_for_llm,
        model=dto.model,
        temperature=dto.temperature,
        stream=False,
    )
    content = result_data.get("choices", [{}])[0].get("message", {}).get("content", "")

    new_msg = ChatMessage(
        id=_gen_id("msg_"),
        session_id=original_msg.session_id,
        user_id=current_user.id,
        role=MessageRole.assistant,
        content=content,
        parent_message_id=original_msg.parent_message_id,
    )
    db.add(new_msg)
    await db.flush()

    return MessageResponse(
        id=new_msg.id,
        session_id=new_msg.session_id,
        role=new_msg.role.value,
        content=new_msg.content,
        token_count=result_data.get("usage", {}).get("total_tokens"),
        parent_message_id=new_msg.parent_message_id,
        created_at=new_msg.created_at,
        updated_at=new_msg.updated_at,
    )